import { Resend } from 'resend';
import { API_TOKEN_SCOPES, type ApiTokenRecord, type ApiTokenScope, type AuthUser } from '../../../auth/model';
import { HttpError } from '../core/http';
import type {
  ApiTokenRow,
  AuthSession,
  Env,
  MagicLinkJoinRow,
  RequestAuth,
  SessionJoinRow,
  UserRow,
  WalletChallengeRow,
} from '../core/types';

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const MAGIC_LINK_TTL_MS = 1000 * 60 * 15;
export const WALLET_CHALLENGE_TTL_MS = 1000 * 60 * 10;
export const DEFAULT_AUTH_EMAIL_FROM = "Everybody's Platformer <onboarding@resend.dev>";
export const API_TOKEN_PREFIX = 'epat_';
const API_TOKEN_SCOPE_SET = new Set<string>(API_TOKEN_SCOPES);

export async function findUserByEmail(env: Env, email: string): Promise<AuthUser | null> {
  const row = await env.DB.prepare(
    `
      SELECT id, email, wallet_address, display_name, created_at, updated_at
      FROM users
      WHERE email = ?
      LIMIT 1
    `
  )
    .bind(email)
    .first<UserRow>();

  return row ? mapUserRow(row) : null;
}

export async function findUserByWallet(env: Env, walletAddress: string): Promise<AuthUser | null> {
  const row = await env.DB.prepare(
    `
      SELECT id, email, wallet_address, display_name, created_at, updated_at
      FROM users
      WHERE wallet_address = ?
      LIMIT 1
    `
  )
    .bind(walletAddress)
    .first<UserRow>();

  return row ? mapUserRow(row) : null;
}

export async function createUserForEmail(env: Env, email: string): Promise<AuthUser> {
  const now = new Date().toISOString();
  const user: AuthUser = {
    id: crypto.randomUUID(),
    email,
    walletAddress: null,
    displayName: createDisplayNameFromEmail(email),
    createdAt: now,
  };

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO users (id, email, wallet_address, display_name, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `
    ).bind(user.id, user.email, user.displayName, now, now),
  ]);

  return user;
}

export async function createUserForWallet(env: Env, walletAddress: string): Promise<AuthUser> {
  const now = new Date().toISOString();
  const user: AuthUser = {
    id: crypto.randomUUID(),
    email: null,
    walletAddress,
    displayName: shortenAddress(walletAddress),
    createdAt: now,
  };

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO users (id, email, wallet_address, display_name, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?)
      `
    ).bind(user.id, walletAddress, user.displayName, now, now),
  ]);

  return user;
}

export async function attachWalletToUser(
  env: Env,
  user: AuthUser,
  walletAddress: string
): Promise<AuthUser> {
  const normalizedWallet = normalizeAddress(walletAddress);
  const existingWalletUser = await findUserByWallet(env, normalizedWallet);

  if (existingWalletUser && existingWalletUser.id !== user.id) {
    throw new HttpError(409, 'That wallet is already linked to another account.');
  }

  if (user.walletAddress === normalizedWallet) {
    return user;
  }

  if (user.walletAddress && user.walletAddress !== normalizedWallet) {
    throw new HttpError(409, 'This account is already linked to a different wallet.');
  }

  const updatedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE users
        SET wallet_address = ?, updated_at = ?
        WHERE id = ?
      `
    ).bind(normalizedWallet, updatedAt, user.id),
  ]);

  return {
    ...user,
    walletAddress: normalizedWallet,
  };
}

export async function loadMagicLinkByTokenHash(
  env: Env,
  tokenHash: string
): Promise<MagicLinkJoinRow | null> {
  return env.DB.prepare(
    `
      SELECT
        m.id,
        m.user_id,
        m.email,
        m.token_hash,
        m.expires_at,
        m.consumed_at,
        m.created_at,
        u.wallet_address,
        u.display_name,
        u.created_at AS user_created_at
      FROM magic_link_tokens m
      JOIN users u ON u.id = m.user_id
      WHERE m.token_hash = ?
      LIMIT 1
    `
  )
    .bind(tokenHash)
    .first<MagicLinkJoinRow>();
}

export async function createMagicLinkToken(
  env: Env,
  userId: string,
  email: string,
  tokenHash: string,
  expiresAt: string,
  createdAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO magic_link_tokens (id, user_id, email, token_hash, expires_at, consumed_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `
    ).bind(crypto.randomUUID(), userId, email, tokenHash, expiresAt, createdAt),
  ]);
}

export async function consumeMagicLinkToken(
  env: Env,
  magicLinkId: string,
  consumedAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE magic_link_tokens
        SET consumed_at = ?
        WHERE id = ?
      `
    ).bind(consumedAt, magicLinkId),
  ]);
}

export async function loadWalletChallengeByNonceHash(
  env: Env,
  nonceHash: string
): Promise<WalletChallengeRow | null> {
  return env.DB.prepare(
    `
      SELECT id, address, nonce_hash, message_text, expires_at, consumed_at, created_at
      FROM wallet_challenges
      WHERE nonce_hash = ?
      LIMIT 1
    `
  )
    .bind(nonceHash)
    .first<WalletChallengeRow>();
}

export async function createWalletChallenge(
  env: Env,
  address: string,
  nonceHash: string,
  messageText: string,
  expiresAt: string,
  createdAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO wallet_challenges (id, address, nonce_hash, message_text, expires_at, consumed_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `
    ).bind(crypto.randomUUID(), address, nonceHash, messageText, expiresAt, createdAt),
  ]);
}

export async function consumeWalletChallenge(
  env: Env,
  challengeId: string,
  consumedAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE wallet_challenges
        SET consumed_at = ?
        WHERE id = ?
      `
    ).bind(consumedAt, challengeId),
  ]);
}

export async function findApiTokenIdForUser(
  env: Env,
  tokenId: string,
  userId: string
): Promise<{ id: string } | null> {
  return env.DB.prepare(
    `
      SELECT id
      FROM api_tokens
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `
  )
    .bind(tokenId, userId)
    .first<{ id: string }>();
}

export async function createApiTokenForUser(
  env: Env,
  userId: string,
  label: string,
  tokenHash: string,
  scopes: ApiTokenScope[],
  createdAt: string,
  tokenId: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO api_tokens (
          id,
          user_id,
          label,
          token_hash,
          scopes_json,
          created_at,
          last_used_at,
          revoked_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
      `
    ).bind(tokenId, userId, label, tokenHash, JSON.stringify(scopes), createdAt),
  ]);
}

export async function revokeApiTokenForUser(
  env: Env,
  tokenId: string,
  userId: string,
  revokedAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE api_tokens
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE id = ? AND user_id = ?
      `
    ).bind(revokedAt, tokenId, userId),
  ]);
}

export async function loadSessionFromToken(env: Env, token: string): Promise<AuthSession | null> {
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `
      SELECT
        s.id,
        s.user_id,
        s.expires_at,
        s.created_at,
        s.last_seen_at,
        u.email,
        u.wallet_address,
        u.display_name,
        u.created_at AS user_created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
      LIMIT 1
    `
  )
    .bind(tokenHash)
    .first<SessionJoinRow>();

  if (!row) {
    return null;
  }

  if (isExpired(row.expires_at)) {
    await deleteSessionById(env, row.id);
    return null;
  }

  return {
    sessionId: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    user: {
      id: row.user_id,
      email: row.email,
      walletAddress: row.wallet_address,
      displayName: row.display_name,
      createdAt: row.user_created_at,
    },
  };
}

export async function loadApiTokenAuth(
  env: Env,
  rawToken: string
): Promise<RequestAuth | null> {
  const tokenHash = await hashToken(rawToken);
  const row = await env.DB.prepare(
    `
      SELECT
        t.id,
        t.user_id,
        t.label,
        t.scopes_json,
        t.created_at,
        t.last_used_at,
        t.revoked_at,
        u.email,
        u.wallet_address,
        u.display_name,
        u.created_at AS user_created_at
      FROM api_tokens t
      JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?
      LIMIT 1
    `
  )
    .bind(tokenHash)
    .first<ApiTokenRow>();

  if (!row || row.revoked_at) {
    return null;
  }

  const scopes = parseApiTokenScopes(row.scopes_json);
  const user: AuthUser = {
    id: row.user_id,
    email: row.email,
    walletAddress: row.wallet_address,
    displayName: row.display_name,
    createdAt: row.user_created_at,
  };

  const lastUsedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE api_tokens
        SET last_used_at = ?
        WHERE id = ?
      `
    ).bind(lastUsedAt, row.id),
  ]);

  return {
    source: 'api_token',
    user,
    session: null,
    scopes,
    isAdmin: false,
    apiToken: {
      id: row.id,
      label: row.label,
      scopes,
      createdAt: row.created_at,
      lastUsedAt,
      revokedAt: row.revoked_at,
    },
  };
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = generateOpaqueToken(32);
  const tokenHash = await hashToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).bind(crypto.randomUUID(), userId, tokenHash, expiresAt, nowIso, nowIso),
  ]);

  return token;
}

export async function deleteSessionById(env: Env, sessionId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        DELETE FROM sessions
        WHERE id = ?
      `
    ).bind(sessionId),
  ]);
}

export async function listApiTokensForUser(env: Env, userId: string): Promise<ApiTokenRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        id,
        label,
        scopes_json,
        created_at,
        last_used_at,
        revoked_at
      FROM api_tokens
      WHERE user_id = ? AND revoked_at IS NULL
      ORDER BY created_at DESC, id DESC
    `
  )
    .bind(userId)
    .all<{
      id: string;
      label: string;
      scopes_json: string;
      created_at: string;
      last_used_at: string | null;
      revoked_at: string | null;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    label: row.label,
    scopes: parseApiTokenScopes(row.scopes_json),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

export async function hashToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function generateOpaqueToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function parseCookie(rawCookie: string | null): Map<string, string> {
  const cookies = new Map<string, string>();

  if (!rawCookie) {
    return cookies;
  }

  for (const segment of rawCookie.split(';')) {
    const [rawKey, ...rest] = segment.split('=');
    const key = rawKey.trim();
    if (!key) continue;
    cookies.set(key, rest.join('=').trim());
  }

  return cookies;
}

export function mapUserRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    walletAddress: row.wallet_address,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export function resolvePublicBaseUrl(request: Request, env: Env): string {
  const configured = env.APP_BASE_URL?.trim();
  if (configured) {
    const normalized = configured.replace(/\/+$/, '');
    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }

    return `${new URL(request.url).protocol}//${normalized}`;
  }

  const origin = request.headers.get('Origin')?.trim();
  if (origin) {
    return origin.replace(/\/+$/, '');
  }

  return new URL(request.url).origin;
}

export async function sendMagicLinkEmail(
  env: Env,
  email: string,
  magicLink: string
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new HttpError(500, 'RESEND_API_KEY is missing.');
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const from = env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_EMAIL_FROM;

  const response = await resend.emails.send({
    from,
    to: email,
    subject: "Your sign-in link for Everybody's Platformer",
    text: [
      "Use this link to sign in to Everybody's Platformer:",
      magicLink,
      '',
      'The link expires in 15 minutes.',
    ].join('\n'),
    html: [
      '<div style="font-family: monospace; background: #050505; color: #f3eee2; padding: 24px;">',
      '<h2 style="margin: 0 0 16px;">Everybody&apos;s Platformer sign-in</h2>',
      '<p style="margin: 0 0 16px;">Use this link to sign in:</p>',
      `<p style="margin: 0 0 24px;"><a href="${escapeHtml(magicLink)}" style="color: #7de5ff;">${escapeHtml(magicLink)}</a></p>`,
      '<p style="margin: 0; color: #8c877b;">This link expires in 15 minutes.</p>',
      '</div>',
    ].join(''),
  });

  if (response.error) {
    const status = response.error.statusCode ?? 502;
    throw new HttpError(
      status >= 400 && status < 600 ? status : 502,
      `Failed to send sign-in email: ${response.error.message}`
    );
  }

  if (!response.data?.id) {
    throw new HttpError(502, 'Email provider did not confirm the sign-in email request.');
  }
}

export function createWalletChallengeMessage(
  request: Request,
  env: Env,
  address: string,
  nonce: string,
  issuedAt: string
): string {
  const host = new URL(resolvePublicBaseUrl(request, env)).host;

  return [
    "Everybody's Platformer wants you to sign in with your wallet.",
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Domain: ${host}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

export function extractNonceFromWalletMessage(message: string): string | null {
  const match = /^Nonce:\s+(.+)$/m.exec(message);
  return match?.[1]?.trim() ?? null;
}

export function createDisplayNameFromEmail(email: string): string {
  const local = email.split('@')[0] || 'player';
  return local.slice(0, 24);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function isValidAddress(address: string): boolean {
  return /^0x[a-f0-9]{40}$/.test(address);
}

export function shortenAddress(address: string): string {
  if (address.length < 10) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function isExpired(isoDate: string): boolean {
  return Date.parse(isoDate) <= Date.now();
}

export function normalizeApiTokenScopes(value: unknown): ApiTokenScope[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'scopes must be an array.');
  }

  const deduped = new Set<ApiTokenScope>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !API_TOKEN_SCOPE_SET.has(entry)) {
      throw new HttpError(400, `Unknown API token scope: ${String(entry)}`);
    }

    deduped.add(entry as ApiTokenScope);
  }

  return API_TOKEN_SCOPES.filter((scope) => deduped.has(scope));
}

export function parseApiTokenScopes(raw: string): ApiTokenScope[] {
  try {
    return normalizeApiTokenScopes(JSON.parse(raw));
  } catch {
    throw new HttpError(500, 'Stored API token scopes are invalid.');
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
