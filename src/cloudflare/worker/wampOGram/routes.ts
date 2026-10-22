import {
  makePublicWampOGramRecord,
  normalizeWampOGramCreateRequest,
  normalizeWampOGramSlug,
} from '../../../wampOGram/model';
import {
  ROOM_SHARE_IMAGE_HEIGHT,
  ROOM_SHARE_IMAGE_WIDTH,
  renderRoomSharePreviewPng,
} from '../share/roomPreviewImage';
import {
  requireAdminRequest,
  requireAuthenticatedRequestAuth,
  requireTrustedOriginForMutation,
} from '../auth/request';
import { assertNotSchoolRestricted } from '../school/restrictions';
import {
  corsHeaders,
  HttpError,
  jsonResponse,
  parseJsonBody,
  validateRoomSnapshotForWrite,
} from '../core/http';
import {
  getClientIp,
  hashRateLimitKey,
  networkKeyForIp,
  takeRateLimitSlots,
  type RateLimitRule,
} from '../core/rateLimit';
import type { Env } from '../core/types';
import {
  assertWampOGramVideoAllowed,
  createWampOGram,
  deleteWampOGramBySlug,
  loadWampOGramBySlug,
} from './store';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Grams are kept until an admin deletes them, so each account and network can make a bounded number. */
const GRAMS_PER_USER_PER_HOUR: RateLimitRule = { bucket: 'wamp-o-gram:user-hour', limit: 20, windowMs: HOUR_MS };
const GRAMS_PER_USER_PER_DAY: RateLimitRule = { bucket: 'wamp-o-gram:user-day', limit: 60, windowMs: DAY_MS };
const GRAMS_PER_NETWORK_PER_DAY: RateLimitRule = { bucket: 'wamp-o-gram:network', limit: 60, windowMs: DAY_MS };

export async function handleWampOGramRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (url.pathname === '/api/wamp-o-grams' && request.method === 'POST') {
    const auth = await requireAuthenticatedRequestAuth(
      env,
      request,
      'create Wamp-O-Grams',
      'rooms:write',
    );
    assertNotSchoolRestricted(auth, 'send Wamp-O-Grams');
    const body = await parseJsonBody<unknown>(request, { maxBytes: 65_536 });
    const input = parseCreateRequest(body);
    // The same id, tile and object checks a room save gets.
    validateRoomSnapshotForWrite(input.roomSnapshot, input.roomSnapshot.id);
    await takeWampOGramSlots(request, env, auth.user.id);
    await assertWampOGramVideoAllowed(env, input.roomSnapshot, auth);
    const record = await createWampOGram(env, input, auth);
    return jsonResponse(request, record);
  }

  const match = /^\/api\/wamp-o-grams\/([^/]+)(?:\/(preview(?:\.png)?))?\/?$/.exec(url.pathname);
  if (!match) {
    throw new HttpError(404, 'Wamp-O-Gram route not found.');
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed.');
  }

  const slug = normalizeWampOGramSlug(decodeURIComponent(match[1]));
  if (!slug) {
    throw new HttpError(400, 'Wamp-O-Gram slug is invalid.');
  }

  const record = await loadWampOGramBySlug(env, slug);
  if (!record) {
    throw new HttpError(404, 'Wamp-O-Gram not found.');
  }

  const target = match[2] ?? 'record';
  if (target === 'preview' || target === 'preview.png') {
    return wampOGramPreviewResponse(request, record.roomSnapshot);
  }

  return jsonResponse(request, makePublicWampOGramRecord(record));
}

/** Admins can delete a gram by the slug in its link; the link then shows "not found". */
export async function handleAdminWampOGramRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  requireTrustedOriginForMutation(request);
  requireAdminRequest(env, request, 'delete Wamp-O-Grams');
  const match = /^\/api\/admin\/wamp-o-grams\/([^/]+)$/.exec(url.pathname);
  if (!match || request.method !== 'DELETE') {
    throw new HttpError(404, 'Wamp-O-Gram admin route not found.');
  }

  const slug = normalizeWampOGramSlug(decodeURIComponent(match[1]));
  if (!slug || !(await deleteWampOGramBySlug(env, slug))) {
    throw new HttpError(404, 'Wamp-O-Gram not found.');
  }

  return jsonResponse(request, { slug, deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
}

async function takeWampOGramSlots(request: Request, env: Env, userId: string): Promise<void> {
  const ip = getClientIp(request);
  const userKey = await hashRateLimitKey(env, `wamp-o-gram-user:${userId}`);
  const { limitedBy } = await takeRateLimitSlots(env, [
    { rule: GRAMS_PER_USER_PER_HOUR, keyHash: userKey },
    { rule: GRAMS_PER_USER_PER_DAY, keyHash: userKey },
    ...(ip ? [{ rule: GRAMS_PER_NETWORK_PER_DAY, keyHash: await hashRateLimitKey(env, networkKeyForIp(ip)) }] : []),
  ]);
  if (limitedBy) {
    throw new HttpError(429, 'You have made a lot of Wamp-O-Grams lately. Try again later.');
  }
}

function parseCreateRequest(body: unknown): ReturnType<typeof normalizeWampOGramCreateRequest> {
  try {
    return normalizeWampOGramCreateRequest(body);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Invalid Wamp-O-Gram request.',
    );
  }
}

function wampOGramPreviewResponse(
  request: Request,
  roomSnapshot: Parameters<typeof renderRoomSharePreviewPng>[0],
): Response {
  const headers = new Headers({
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
    'X-Wamp-Image-Width': String(ROOM_SHARE_IMAGE_WIDTH),
    'X-Wamp-Image-Height': String(ROOM_SHARE_IMAGE_HEIGHT),
    ...corsHeaders(request),
  });

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const bytes = renderRoomSharePreviewPng(roomSnapshot);
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    status: 200,
    headers,
  });
}
