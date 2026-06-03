const TOKEN_VERSION = 'v1';
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const MAX_TOKEN_LENGTH = 2048;
const MAX_USER_ID_LENGTH = 96;
const MAX_DISPLAY_NAME_LENGTH = 32;
const MAX_AVATAR_ID_LENGTH = 96;
const MAX_NONCE_LENGTH = 96;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type PartyKitIdentityTokenSource = 'auth' | 'guest';
export type PartyKitIdentityTokenSecretSource =
  | 'PARTYKIT_IDENTITY_TOKEN_SECRET'
  | 'PARTYKIT_INTERNAL_TOKEN';

export interface PartyKitIdentityTokenSecretEnv {
  PARTYKIT_IDENTITY_TOKEN_SECRET?: unknown;
  PARTYKIT_INTERNAL_TOKEN?: unknown;
}

export interface PartyKitIdentity {
  userId: string;
  displayName: string;
  avatarId: string;
}

export interface PartyKitIdentityTokenClaims extends PartyKitIdentity {
  source: PartyKitIdentityTokenSource;
  iat: number;
  exp: number;
  nonce: string;
}

export interface PartyKitIdentityTokenIssueRequestBody {
  identity?: Partial<PartyKitIdentity> | null;
  userId?: unknown;
  displayName?: unknown;
  avatarId?: unknown;
}

export interface PartyKitIdentityTokenIssueResponse {
  token: string;
  expiresAt: string;
  identity: PartyKitIdentity;
  source: PartyKitIdentityTokenSource;
}

export interface PartyKitIdentityTokenCreateOptions {
  nowMs?: number;
  ttlMs?: number;
  nonce?: string;
}

export interface PartyKitIdentityTokenVerifyOptions {
  nowMs?: number;
}

export function resolvePartykitIdentitySigningSecret(
  env: PartyKitIdentityTokenSecretEnv
): { secret: string; source: PartyKitIdentityTokenSecretSource } | null {
  const dedicated = normalizeSecret(env.PARTYKIT_IDENTITY_TOKEN_SECRET);
  if (dedicated) {
    return {
      secret: dedicated,
      source: 'PARTYKIT_IDENTITY_TOKEN_SECRET',
    };
  }

  const fallback = normalizeSecret(env.PARTYKIT_INTERNAL_TOKEN);
  return fallback
    ? {
        secret: fallback,
        source: 'PARTYKIT_INTERNAL_TOKEN',
      }
    : null;
}

export function normalizePartykitAuthIdentity(input: {
  userId: unknown;
  displayName: unknown;
  avatarId: unknown;
}): PartyKitIdentity | null {
  const userId = normalizeIdentityString(input.userId, MAX_USER_ID_LENGTH);
  const displayName = normalizeIdentityString(input.displayName, MAX_DISPLAY_NAME_LENGTH);
  const avatarId = normalizeIdentityString(input.avatarId, MAX_AVATAR_ID_LENGTH) || 'default-player';
  if (!userId || !displayName || !avatarId) {
    return null;
  }

  return {
    userId,
    displayName,
    avatarId,
  };
}

export function normalizePartykitGuestIdentity(input: {
  userId: unknown;
  displayName: unknown;
  avatarId: unknown;
}): PartyKitIdentity | null {
  const identity = normalizePartykitAuthIdentity(input);
  if (!identity || !isGuestPresenceUserId(identity.userId)) {
    return null;
  }

  return identity;
}

export async function createPartykitIdentityToken(
  identity: PartyKitIdentity,
  source: PartyKitIdentityTokenSource,
  secret: string,
  options: PartyKitIdentityTokenCreateOptions = {}
): Promise<{ token: string; claims: PartyKitIdentityTokenClaims }> {
  const ttlMs = clampTokenTtl(options.ttlMs ?? DEFAULT_TOKEN_TTL_MS);
  const nowMs = Math.floor(options.nowMs ?? Date.now());
  const claims: PartyKitIdentityTokenClaims = {
    ...identity,
    source,
    iat: nowMs,
    exp: nowMs + ttlMs,
    nonce: normalizeIdentityString(options.nonce, MAX_NONCE_LENGTH) || crypto.randomUUID(),
  };
  const payload = encodeBase64Url(textEncoder.encode(JSON.stringify(claims)));
  const signedValue = `${TOKEN_VERSION}.${payload}`;
  const signature = await signHmacSha256(secret, signedValue);
  return {
    token: `${signedValue}.${encodeBase64Url(signature)}`,
    claims,
  };
}

export async function verifyPartykitIdentityToken(
  token: string,
  secret: string,
  options: PartyKitIdentityTokenVerifyOptions = {}
): Promise<PartyKitIdentityTokenClaims | null> {
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
): PartyKitIdentityTokenClaims | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<PartyKitIdentityTokenClaims>;
  const source = raw.source === 'auth' || raw.source === 'guest' ? raw.source : null;
  const rawIdentity = {
    userId: raw.userId,
    displayName: raw.displayName,
    avatarId: raw.avatarId,
  };
  const identity =
    source === 'guest'
      ? normalizePartykitGuestIdentity(rawIdentity)
      : source === 'auth'
        ? normalizePartykitAuthIdentity(rawIdentity)
        : null;
  const iat = Number(raw.iat);
  const exp = Number(raw.exp);
  const nonce = normalizeIdentityString(raw.nonce, MAX_NONCE_LENGTH);

  if (
    !source ||
    !identity ||
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
    ...identity,
    source,
    iat,
    exp,
    nonce,
  };
}

function normalizeSecret(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeIdentityString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function isGuestPresenceUserId(userId: string): boolean {
  return /^guest-[a-zA-Z0-9-]{8,80}$/.test(userId);
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
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
