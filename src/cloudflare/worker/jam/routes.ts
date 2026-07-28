import {
  DEFAULT_JAM_SUBMISSIONS_CLOSE_AT,
  DEFAULT_JAM_SUBMISSIONS_OPEN_AT,
  JAM_ROOM_CLAIM_CLOSE_AT,
  JAM_ROOM_CLAIM_OPEN_AT,
  JAM_SLUG,
  parseJamRoomReference,
  type JamConfigResponse,
  type JamRegistrationRequestBody,
  type JamRegistrationResponse,
  type JamSubmissionRequestBody,
  type JamSubmissionResponse,
} from '../../../jam/model';
import { normalizeProfileUsername, validateProfileUsername } from '../../../profiles/username';
import { requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { upsertJamRegistration, upsertJamSubmission } from './store';

const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const MAX_EMAIL_LENGTH = 254;
const MAX_ROOM_REFERENCE_LENGTH = 300;

interface JamAccountRow {
  id: string;
  username: string;
  email: string;
}

interface JamRoomRow {
  claimer_user_id: string | null;
  claimed_at: string | null;
}

export async function handleJamRequest(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/api/jam' && request.method === 'GET') {
    return handleJamConfig(request, env);
  }

  if (url.pathname === '/api/jam/submissions' && request.method === 'POST') {
    return handleJamSubmissionCreate(request, env);
  }

  if (url.pathname === '/api/jam/registrations' && request.method === 'POST') {
    return handleJamRegistrationCreate(request, env);
  }

  throw new HttpError(404, 'Jam route not found.');
}

function handleJamConfig(request: Request, env: Env): Response {
  const openAt = getConfiguredTimestamp(env.JAM_SUBMISSIONS_OPEN_AT, DEFAULT_JAM_SUBMISSIONS_OPEN_AT);
  const closeAt = getConfiguredTimestamp(env.JAM_SUBMISSIONS_CLOSE_AT, DEFAULT_JAM_SUBMISSIONS_CLOSE_AT);
  const now = Date.now();
  const response: JamConfigResponse = {
    openAt,
    closeAt,
    registrationOpen: now <= Date.parse(closeAt),
    submissionsOpen: now >= Date.parse(openAt) && now <= Date.parse(closeAt),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() || null,
    turnstileRequired: Boolean(env.TURNSTILE_SECRET_KEY?.trim()),
  };

  return jsonResponse(request, response, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function handleJamRegistrationCreate(request: Request, env: Env): Promise<Response> {
  requireTrustedOriginForMutation(request);
  assertRegistrationWindowOpen(env);

  const body = await parseJsonBody<JamRegistrationRequestBody>(request, {
    maxBytes: MAX_REQUEST_BODY_BYTES,
  });
  assertHoneypotEmpty(body.website);
  const username = normalizeJamUsername(body.username);
  const email = normalizeEmail(body.email);
  if (body.rulesAccepted !== true) {
    throw new HttpError(400, 'Accept the jam rules before joining.');
  }

  const nowIso = new Date().toISOString();
  const remoteIp = getRequestIp(request);
  const turnstileVerifiedAt = await verifyTurnstileToken(
    env,
    body.turnstileToken,
    remoteIp,
    nowIso,
  );
  const matchedAccount = await findMatchingJamAccount(env, username, email);
  const result = await upsertJamRegistration(env, {
    jamSlug: JAM_SLUG,
    username: matchedAccount?.username ?? username,
    usernameNormalized: username,
    email: matchedAccount?.email ?? email,
    emailNormalized: email,
    matchedUserId: matchedAccount?.id ?? null,
    ipHash: remoteIp ? await hashJamIp(env, remoteIp) : null,
    userAgent: normalizeHeaderValue(request.headers.get('User-Agent')),
    turnstileVerifiedAt,
    nowIso,
  });

  const response: JamRegistrationResponse = result;
  return jsonResponse(request, response, { status: result.updated ? 200 : 201 });
}

async function handleJamSubmissionCreate(request: Request, env: Env): Promise<Response> {
  requireTrustedOriginForMutation(request);
  assertSubmissionWindowOpen(env);

  const body = await parseJsonBody<JamSubmissionRequestBody>(request, {
    maxBytes: MAX_REQUEST_BODY_BYTES,
  });
  assertHoneypotEmpty(body.website);
  const username = normalizeJamUsername(body.username);
  const email = normalizeEmail(body.email);
  const roomReferenceInput = normalizeRoomReferenceInput(body.roomReference);
  const roomReference = parseJamRoomReference(roomReferenceInput);
  if (!roomReference) {
    throw new HttpError(400, 'Enter coordinates like 12, -4 or a WAMP room URL.');
  }
  if (body.rulesAccepted !== true) {
    throw new HttpError(400, 'Accept the jam rules before submitting.');
  }

  const nowIso = new Date().toISOString();
  const remoteIp = getRequestIp(request);
  const turnstileVerifiedAt = await verifyTurnstileToken(
    env,
    body.turnstileToken,
    remoteIp,
    nowIso,
  );
  const account = await loadMatchingJamAccount(env, username, email);
  const roomClaimedAt = await assertJamRoomOwnedByAccount(
    env,
    account.id,
    roomReference.coordinates.x,
    roomReference.coordinates.y,
  );

  const result = await upsertJamSubmission(env, {
    jamSlug: JAM_SLUG,
    userId: account.id,
    username: account.username,
    email: account.email,
    roomX: roomReference.coordinates.x,
    roomY: roomReference.coordinates.y,
    roomUrl: roomReference.canonicalUrl,
    roomReferenceInput,
    roomClaimedAt,
    ipHash: remoteIp ? await hashJamIp(env, remoteIp) : null,
    userAgent: normalizeHeaderValue(request.headers.get('User-Agent')),
    turnstileVerifiedAt,
    nowIso,
  });

  const response: JamSubmissionResponse = result;
  return jsonResponse(request, response, { status: result.updated ? 200 : 201 });
}

function assertRegistrationWindowOpen(env: Env): void {
  const closeAt = getConfiguredTimestamp(env.JAM_SUBMISSIONS_CLOSE_AT, DEFAULT_JAM_SUBMISSIONS_CLOSE_AT);
  if (Date.now() > Date.parse(closeAt)) {
    throw new HttpError(410, 'Jam registration closed July 28 at 8:00 AM Eastern.');
  }
}

function assertSubmissionWindowOpen(env: Env): void {
  const openAt = getConfiguredTimestamp(env.JAM_SUBMISSIONS_OPEN_AT, DEFAULT_JAM_SUBMISSIONS_OPEN_AT);
  const closeAt = getConfiguredTimestamp(env.JAM_SUBMISSIONS_CLOSE_AT, DEFAULT_JAM_SUBMISSIONS_CLOSE_AT);
  const now = Date.now();
  if (now < Date.parse(openAt)) {
    throw new HttpError(403, 'Jam submissions open July 20 at 12:00 AM Eastern.');
  }
  if (now > Date.parse(closeAt)) {
    throw new HttpError(410, 'Jam submissions closed July 28 at 8:00 AM Eastern.');
  }
}

async function loadMatchingJamAccount(env: Env, username: string, email: string): Promise<JamAccountRow> {
  const account = await findMatchingJamAccount(env, username, email);

  if (!account) {
    throw new HttpError(400, 'Use the username and email connected to the same WAMP account.');
  }
  return account;
}

async function findMatchingJamAccount(
  env: Env,
  username: string,
  email: string,
): Promise<JamAccountRow | null> {
  const account = await env.DB.prepare(
    `
      SELECT id, username, email
      FROM users
      WHERE lower(username) = ?
        AND lower(email) = ?
      LIMIT 1
    `,
  )
    .bind(username, email)
    .first<JamAccountRow>();

  return account?.username && account.email ? account : null;
}

async function assertJamRoomOwnedByAccount(
  env: Env,
  userId: string,
  x: number,
  y: number,
): Promise<string> {
  const room = await env.DB.prepare(
    `
      SELECT claimer_user_id, claimed_at
      FROM rooms
      WHERE x = ? AND y = ?
      LIMIT 1
    `,
  )
    .bind(x, y)
    .first<JamRoomRow>();

  if (!room?.claimed_at || room.claimer_user_id !== userId) {
    throw new HttpError(400, 'That Room is not claimed by the WAMP account you entered.');
  }

  const claimedAtMs = Date.parse(room.claimed_at);
  if (
    Number.isNaN(claimedAtMs)
    || claimedAtMs < Date.parse(JAM_ROOM_CLAIM_OPEN_AT)
    || claimedAtMs > Date.parse(JAM_ROOM_CLAIM_CLOSE_AT)
  ) {
    throw new HttpError(400, 'The submitted Room must be newly claimed between July 20 and July 26.');
  }

  return new Date(claimedAtMs).toISOString();
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Email is required.');
  }
  const email = value.trim().toLowerCase();
  if (
    !email
    || email.length > MAX_EMAIL_LENGTH
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || /[<>]/.test(email)
  ) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  return email;
}

function normalizeJamUsername(value: unknown): string {
  const username = normalizeProfileUsername(value);
  const usernameError = validateProfileUsername(username);
  if (usernameError) {
    throw new HttpError(400, usernameError);
  }
  return username;
}

function assertHoneypotEmpty(value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    throw new HttpError(400, 'Submission could not be accepted.');
  }
}

function normalizeRoomReferenceInput(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Room coordinates or URL are required.');
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_ROOM_REFERENCE_LENGTH || /[<>]/.test(normalized)) {
    throw new HttpError(400, 'Room coordinates or URL are invalid.');
  }
  return normalized;
}

function getConfiguredTimestamp(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  return Number.isNaN(Date.parse(candidate)) ? fallback : new Date(candidate).toISOString();
}

async function verifyTurnstileToken(
  env: Env,
  token: unknown,
  remoteIp: string | null,
  verifiedAt: string,
): Promise<string | null> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    return null;
  }
  if (typeof token !== 'string' || !token.trim()) {
    throw new HttpError(400, 'Turnstile verification is required.');
  }

  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token.trim());
  if (remoteIp) {
    form.set('remoteip', remoteIp);
  }
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new HttpError(502, 'Turnstile verification failed.');
  }
  const result = await response.json() as { success?: boolean };
  if (!result.success) {
    throw new HttpError(400, 'Turnstile verification failed. Try again.');
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

async function hashJamIp(env: Env, ip: string): Promise<string> {
  const salt = env.JAM_IP_HASH_SALT?.trim() || env.GUESTBOOK_IP_HASH_SALT?.trim() || 'wamp-jam';
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
