import { roomIdFromCoordinates, type RoomCoordinates } from '../persistence/roomModel';
import type {
  PartyKitIdentityTokenSecretEnv,
  PartyKitIdentityTokenSecretSource,
} from './identityToken';
import { resolvePartykitIdentitySigningSecret } from './identityToken';

const TOKEN_VERSION = 'cpv1';
const DEFAULT_TOKEN_TTL_MS = 2 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const MAX_TOKEN_LENGTH = 2048;
const MAX_USER_ID_LENGTH = 96;
const MAX_NONCE_LENGTH = 96;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface ConstructionPreviewTokenClaims {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  userId: string;
  iat: number;
  exp: number;
  nonce: string;
}

export interface ConstructionPreviewTokenIssueResponse {
  token: string;
  expiresAt: string;
}

export interface ConstructionPreviewTokenCreateOptions {
  nowMs?: number;
  ttlMs?: number;
  nonce?: string;
}

export interface ConstructionPreviewTokenVerifyOptions {
  nowMs?: number;
}

export function resolveConstructionPreviewTokenSigningSecret(
  env: PartyKitIdentityTokenSecretEnv
): { secret: string; source: PartyKitIdentityTokenSecretSource } | null {
  return resolvePartykitIdentitySigningSecret(env);
}

export async function createConstructionPreviewToken(
  input: {
    roomId: string;
    roomCoordinates: RoomCoordinates;
    userId: string;
  },
  secret: string,
  options: ConstructionPreviewTokenCreateOptions = {}
): Promise<{ token: string; claims: ConstructionPreviewTokenClaims }> {
  const ttlMs = clampTokenTtl(options.ttlMs ?? DEFAULT_TOKEN_TTL_MS);
  const nowMs = Math.floor(options.nowMs ?? Date.now());
  const claims: ConstructionPreviewTokenClaims = {
    roomId: input.roomId,
    roomCoordinates: { ...input.roomCoordinates },
    userId: input.userId,
    iat: nowMs,
    exp: nowMs + ttlMs,
    nonce: normalizeShortString(options.nonce, MAX_NONCE_LENGTH) || crypto.randomUUID(),
  };
  const payload = encodeBase64Url(textEncoder.encode(JSON.stringify(claims)));
  const signedValue = `${TOKEN_VERSION}.${payload}`;
  const signature = await signHmacSha256(secret, signedValue);
  return {
    token: `${signedValue}.${encodeBase64Url(signature)}`,
    claims,
  };
}

export async function verifyConstructionPreviewToken(
  token: string,
  secret: string,
  options: ConstructionPreviewTokenVerifyOptions = {}
): Promise<ConstructionPreviewTokenClaims | null> {
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TOKEN_LENGTH) {
    return null;
  }

  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return null;
  }

  const signedValue = `${parts[0]}.${parts[1]}`;
  const signature = decodeBase64Url(parts[2]);
  if (!signature) {
    return null;
  }

  const verified = await verifyHmacSha256(secret, signedValue, signature);
  if (!verified) {
    return null;
  }

  const payloadBytes = decodeBase64Url(parts[1]);
  if (!payloadBytes) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(payloadBytes));
  } catch {
    return null;
  }

  return normalizeVerifiedClaims(parsed, options.nowMs ?? Date.now());
}

function normalizeVerifiedClaims(
  value: unknown,
  nowMs: number
): ConstructionPreviewTokenClaims | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<ConstructionPreviewTokenClaims>;
  const coordinates = normalizeRoomCoordinates(raw.roomCoordinates);
  const roomId = normalizeShortString(raw.roomId, 96);
  const userId = normalizeShortString(raw.userId, MAX_USER_ID_LENGTH);
  const iat = Number(raw.iat);
  const exp = Number(raw.exp);
  const nonce = normalizeShortString(raw.nonce, MAX_NONCE_LENGTH);

  if (
    !coordinates ||
    !roomId ||
    roomId !== roomIdFromCoordinates(coordinates) ||
    !userId ||
    !nonce ||
    !Number.isFinite(iat) ||
    !Number.isFinite(exp) ||
    exp <= nowMs - CLOCK_SKEW_MS ||
    iat > nowMs + CLOCK_SKEW_MS ||
    exp <= iat ||
    exp - iat > MAX_TOKEN_TTL_MS + CLOCK_SKEW_MS
  ) {
    return null;
  }

  return {
    roomId,
    roomCoordinates: coordinates,
    userId,
    iat,
    exp,
    nonce,
  };
}

function normalizeRoomCoordinates(value: unknown): RoomCoordinates | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<RoomCoordinates>;
  const x = raw.x;
  const y = raw.y;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isInteger(x) ||
    !Number.isInteger(y)
  ) {
    return null;
  }

  return {
    x,
    y,
  };
}

function normalizeShortString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function clampTokenTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs)) {
    return DEFAULT_TOKEN_TTL_MS;
  }

  return Math.max(30_000, Math.min(MAX_TOKEN_TTL_MS, Math.floor(ttlMs)));
}

async function signHmacSha256(secret: string, value: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return new Uint8Array(signature);
}

async function verifyHmacSha256(
  secret: string,
  value: string,
  signature: Uint8Array
): Promise<boolean> {
  const key = await importHmacKey(secret);
  return crypto.subtle.verify('HMAC', key, copyBytesToArrayBuffer(signature), textEncoder.encode(value));
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify']
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    return null;
  }

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (encodeBase64Url(bytes) !== value) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}
