import {
  DEFAULT_GUESTBOOK_LIMIT,
  GUESTBOOK_DISPLAY_NAME_MAX_LENGTH,
  GUESTBOOK_MESSAGE_MAX_LENGTH,
  MAX_GUESTBOOK_LIMIT,
  type GuestbookConfigResponse,
  type GuestbookCreateRequestBody,
  type GuestbookCreateResponse,
  type GuestbookDeleteResponse,
  type GuestbookListResponse,
} from '../../../guestbook/model';
import { loadOptionalRequestAuth, requireAdminRequest } from '../auth/request';
import {
  HttpError,
  jsonResponse,
  parseJsonBody,
  parsePositiveIntegerQueryParam,
} from '../core/http';
import type { Env } from '../core/types';
import { assertNotSchoolRestricted } from '../school/restrictions';
import {
  countRecentGuestbookEntriesForIp,
  countRecentGuestbookEntriesForSession,
  createGuestbookEntry,
  hideGuestbookEntry,
  listGuestbookEntries,
} from './store';

const GUESTBOOK_IP_HOURLY_LIMIT = 5;
const GUESTBOOK_SESSION_MINUTE_LIMIT = 1;
const GUESTBOOK_SESSION_DAILY_LIMIT = 10;

export async function handleGuestbookRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (url.pathname === '/api/guestbook' && request.method === 'GET') {
    return handleGuestbookList(request, url, env);
  }

  if (url.pathname === '/api/guestbook' && request.method === 'POST') {
    return handleGuestbookCreate(request, env);
  }

  const deleteMatch = /^\/api\/guestbook\/entries\/([^/]+)$/.exec(url.pathname);
  if (deleteMatch && request.method === 'DELETE') {
    return handleGuestbookHide(request, env, decodeURIComponent(deleteMatch[1]));
  }

  throw new HttpError(404, 'Guestbook route not found.');
}

async function handleGuestbookList(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const limit = parsePositiveIntegerQueryParam(
    url.searchParams,
    'limit',
    DEFAULT_GUESTBOOK_LIMIT,
    1,
    MAX_GUESTBOOK_LIMIT,
  );
  const responseBody: GuestbookListResponse = {
    entries: await listGuestbookEntries(env, limit),
    config: getGuestbookConfig(env),
  };

  return jsonResponse(request, responseBody);
}

async function handleGuestbookCreate(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<GuestbookCreateRequestBody>(request);
  const displayName = normalizeGuestbookDisplayName(body.displayName);
  const message = normalizeGuestbookMessage(body.body);
  const guestSessionId = normalizeGuestSessionId(body.guestSessionId);
  const auth = await loadOptionalRequestAuth(env, request);
  if (auth) {
    assertNotSchoolRestricted(auth, 'sign the guestbook');
  }
  const remoteIp = getRequestIp(request);
  const ipHash = remoteIp ? await hashGuestbookIp(env, remoteIp) : null;
  const now = new Date();
  const nowIso = now.toISOString();

  await assertGuestbookRateLimit(env, {
    ipHash,
    guestSessionId,
    nowMs: now.getTime(),
  });
  const turnstileVerifiedAt = await verifyTurnstileToken(env, body.turnstileToken, remoteIp, nowIso);

  const responseBody: GuestbookCreateResponse = {
    entry: await createGuestbookEntry(env, {
      displayName,
      body: message,
      userId: auth?.user.id ?? null,
      guestSessionId,
      ipHash,
      userAgent: normalizeHeaderValue(request.headers.get('User-Agent')),
      turnstileVerifiedAt,
      createdAt: nowIso,
    }),
    config: getGuestbookConfig(env),
  };

  return jsonResponse(request, responseBody, { status: 201 });
}

async function handleGuestbookHide(
  request: Request,
  env: Env,
  entryId: string,
): Promise<Response> {
  requireAdminRequest(env, request, 'hide guestbook entries');

  if (!/^[A-Za-z0-9_-]{8,80}$/.test(entryId)) {
    throw new HttpError(400, 'Guestbook entry id is invalid.');
  }

  const auth = await loadOptionalRequestAuth(env, request);
  const hidden = await hideGuestbookEntry(
    env,
    entryId,
    auth?.user.id ?? null,
    new Date().toISOString(),
  );
  if (!hidden) {
    throw new HttpError(404, 'Guestbook entry not found.');
  }

  const responseBody: GuestbookDeleteResponse = {
    ok: true,
    entryId,
  };
  return jsonResponse(request, responseBody);
}

function getGuestbookConfig(env: Env): GuestbookConfigResponse {
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY?.trim() || null;
  return {
    turnstileSiteKey,
    turnstileRequired: Boolean(turnstileSiteKey || env.TURNSTILE_SECRET?.trim()),
  };
}

function normalizeGuestbookDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Name is required.');
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < 2) {
    throw new HttpError(400, 'Name must be at least 2 characters.');
  }

  if (normalized.length > GUESTBOOK_DISPLAY_NAME_MAX_LENGTH) {
    throw new HttpError(400, `Name must be ${GUESTBOOK_DISPLAY_NAME_MAX_LENGTH} characters or fewer.`);
  }

  if (/[<>]/.test(normalized)) {
    throw new HttpError(400, 'Name cannot contain angle brackets.');
  }

  return normalized;
}

function normalizeGuestbookMessage(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Message is required.');
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    throw new HttpError(400, 'Message is required.');
  }

  if (normalized.length > GUESTBOOK_MESSAGE_MAX_LENGTH) {
    throw new HttpError(400, `Message must be ${GUESTBOOK_MESSAGE_MAX_LENGTH} characters or fewer.`);
  }

  if (/[<>]/.test(normalized)) {
    throw new HttpError(400, 'Message cannot contain angle brackets.');
  }

  if (/(https?:\/\/|www\.)/i.test(normalized)) {
    throw new HttpError(400, 'Links are not allowed in the guestbook yet.');
  }

  return normalized;
}

function normalizeGuestSessionId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new HttpError(400, 'guestSessionId is invalid.');
  }

  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(trimmed)) {
    throw new HttpError(400, 'guestSessionId is invalid.');
  }

  return trimmed;
}

async function assertGuestbookRateLimit(
  env: Env,
  options: {
    ipHash: string | null;
    guestSessionId: string | null;
    nowMs: number;
  },
): Promise<void> {
  if (options.ipHash) {
    const hourAgo = new Date(options.nowMs - 60 * 60 * 1000).toISOString();
    const recentForIp = await countRecentGuestbookEntriesForIp(env, options.ipHash, hourAgo);
    if (recentForIp >= GUESTBOOK_IP_HOURLY_LIMIT) {
      throw new HttpError(429, 'Too many guestbook entries from this network. Try again later.');
    }
  }

  if (!options.guestSessionId) {
    return;
  }

  const minuteAgo = new Date(options.nowMs - 60 * 1000).toISOString();
  const recentForSession = await countRecentGuestbookEntriesForSession(env, options.guestSessionId, minuteAgo);
  if (recentForSession >= GUESTBOOK_SESSION_MINUTE_LIMIT) {
    throw new HttpError(429, 'Please wait a minute before signing again.');
  }

  const dayAgo = new Date(options.nowMs - 24 * 60 * 60 * 1000).toISOString();
  const recentForSessionDay = await countRecentGuestbookEntriesForSession(env, options.guestSessionId, dayAgo);
  if (recentForSessionDay >= GUESTBOOK_SESSION_DAILY_LIMIT) {
    throw new HttpError(429, 'This browser has signed the guestbook enough for today.');
  }
}

async function verifyTurnstileToken(
  env: Env,
  token: unknown,
  remoteIp: string | null,
  verifiedAt: string,
): Promise<string | null> {
  const secret = env.TURNSTILE_SECRET?.trim();
  if (!secret) {
    if (env.TURNSTILE_SITE_KEY?.trim()) {
      throw new HttpError(503, 'Turnstile verification is unavailable.');
    }
    return null;
  }

  if (typeof token !== 'string' || !token.trim()) {
    throw new HttpError(403, 'Turnstile verification is required.');
  }

  const body = new URLSearchParams({
    secret,
    response: token.trim(),
  });
  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  let result: { success?: boolean };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw new Error(`siteverify returned ${response.status}`);
    }
    result = await response.json() as { success?: boolean };
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Turnstile siteverify request failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    throw new HttpError(403, 'Turnstile verification failed. Try again.');
  }

  if (result.success !== true) {
    throw new HttpError(403, 'Turnstile verification failed. Try again.');
  }

  return verifiedAt;
}

function getRequestIp(request: Request): string | null {
  return normalizeHeaderValue(
    request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0]
    ?? null,
  );
}

async function hashGuestbookIp(env: Env, ip: string): Promise<string> {
  const salt = env.GUESTBOOK_IP_HASH_SALT?.trim() || 'wamp-guestbook';
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeHeaderValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.slice(0, 260) : null;
}
