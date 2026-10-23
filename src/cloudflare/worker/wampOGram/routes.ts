import {
  makePublicWampOGramRecord,
  normalizeWampOGramCreateRequest,
  normalizeWampOGramSlug,
} from '../../../wampOGram/model';
import {
  requireAdminRequest,
  requireAuthenticatedRequestAuth,
  requireTrustedOriginForMutation,
} from '../auth/request';
import { assertNotSchoolRestricted } from '../school/restrictions';
import {
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
import type { Env, WorkerExecutionContextLike } from '../core/types';
import {
  createWampOGram,
  deleteWampOGramBySlug,
  loadWampOGramBySlug,
  resolveWampOGramRoomSnapshot,
} from './store';
import { wampOGramPreviewResponse } from './preview';

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
  context?: WorkerExecutionContextLike,
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
    const roomSnapshot = await resolveWampOGramRoomSnapshot(env, input.roomSnapshot, auth);
    await takeWampOGramSlots(request, env, auth.user.id);
    const record = await createWampOGram(env, { ...input, roomSnapshot }, auth);
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

  if (match[2]) {
    return wampOGramPreviewResponse(request, url, env, slug, context);
  }

  const record = await loadWampOGramBySlug(env, slug);
  if (!record) {
    throw new HttpError(404, 'Wamp-O-Gram not found.');
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
