import {
  makePublicWampOGramRecord,
  normalizeWampOGramCreateRequest,
  normalizeWampOGramSlug,
  type WampOGramRecord,
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
  releaseRateLimitSlots,
  takeRateLimitSlots,
  type RateLimitRule,
} from '../core/rateLimit';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { maskBlockedArtInSnapshots } from '../customSprites/blockedArt';
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
    const slotIds = await takeWampOGramSlots(request, env, auth.user.id);
    let record: WampOGramRecord;
    try {
      record = await createWampOGram(env, { ...input, roomSnapshot }, auth);
    } catch (error) {
      await releaseRateLimitSlots(env, slotIds);
      throw error;
    }
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

  // The game draws the gram from this record, so it gets the same blocked-art masking as the preview
  // (F189). Read fresh every time, so a block, a hidden version or a delete applies at once.
  const [roomSnapshot] = await maskBlockedArtInSnapshots(env, [record.roomSnapshot]);
  return jsonResponse(request, makePublicWampOGramRecord({ ...record, roomSnapshot }), {
    headers: { 'Cache-Control': 'no-store' },
  });
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

async function takeWampOGramSlots(request: Request, env: Env, userId: string): Promise<number[]> {
  const ip = getClientIp(request);
  const userKey = await hashRateLimitKey(env, `wamp-o-gram-user:${userId}`);
  const { ids, limitedBy } = await takeRateLimitSlots(env, [
    { rule: GRAMS_PER_USER_PER_HOUR, keyHash: userKey },
    { rule: GRAMS_PER_USER_PER_DAY, keyHash: userKey },
    ...(ip ? [{ rule: GRAMS_PER_NETWORK_PER_DAY, keyHash: await hashRateLimitKey(env, networkKeyForIp(ip)) }] : []),
  ]);
  if (limitedBy) {
    throw new HttpError(429, 'You have made a lot of Wamp-O-Grams lately. Try again later.');
  }
  return ids;
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
