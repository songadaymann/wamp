import {
  makePublicWampOGramRecord,
  normalizeWampOGramCreateRequest,
  normalizeWampOGramSlug,
} from '../../../wampOGram/model';
import { buildWampOGramPreviewPath, WAMP_O_GRAM_PREVIEW_VERSION } from '../../../wampOGram/links';
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
import { loadAnonymousPublicCache } from '../core/publicCache';
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
  wampOGramExists,
} from './store';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Grams are kept until an admin deletes them, so each account and network can make a bounded number. */
const GRAMS_PER_USER_PER_HOUR: RateLimitRule = { bucket: 'wamp-o-gram:user-hour', limit: 20, windowMs: HOUR_MS };
const GRAMS_PER_USER_PER_DAY: RateLimitRule = { bucket: 'wamp-o-gram:user-day', limit: 60, windowMs: DAY_MS };
const GRAMS_PER_NETWORK_PER_DAY: RateLimitRule = { bucket: 'wamp-o-gram:network', limit: 60, windowMs: DAY_MS };
const VERSIONED_PREVIEW_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const UNVERSIONED_PREVIEW_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600';

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

/**
 * A gram never changes, so its preview is drawn once per datacenter and kept, keyed by slug and
 * preview version, and the versioned og:image URL is immutable (F348). Every request still checks
 * that the gram exists before the cache, so a gram an admin deletes stops showing its preview
 * everywhere at once; purging the cache on delete would only reach one datacenter.
 */
async function wampOGramPreviewResponse(
  request: Request,
  url: URL,
  env: Env,
  slug: string,
  context: WorkerExecutionContextLike | undefined,
): Promise<Response> {
  if (!(await wampOGramExists(env, slug))) {
    throw new HttpError(404, 'Wamp-O-Gram not found.');
  }

  const cacheControl = url.searchParams.get('v') === WAMP_O_GRAM_PREVIEW_VERSION
    ? VERSIONED_PREVIEW_CACHE_CONTROL
    : UNVERSIONED_PREVIEW_CACHE_CONTROL;
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: previewHeaders(request, cacheControl) });
  }

  const cacheKey = new Request(new URL(buildWampOGramPreviewPath(slug), url.origin), request);
  const response = await loadAnonymousPublicCache(cacheKey, context, async () => {
    const record = await loadWampOGramBySlug(env, slug);
    if (!record) {
      throw new HttpError(404, 'Wamp-O-Gram not found.');
    }
    const bytes = await renderRoomSharePreviewPng(record.roomSnapshot);
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, { status: 200, headers: previewHeaders(request, VERSIONED_PREVIEW_CACHE_CONTROL) });
  });
  // Only the versioned URL is immutable: a link without ?v= may be drawn differently by a later version.
  response.headers.set('Cache-Control', cacheControl);
  return response;
}

function previewHeaders(request: Request, cacheControl: string): Headers {
  return new Headers({
    'Content-Type': 'image/png',
    'Cache-Control': cacheControl,
    'X-Wamp-Image-Width': String(ROOM_SHARE_IMAGE_WIDTH),
    'X-Wamp-Image-Height': String(ROOM_SHARE_IMAGE_HEIGHT),
    ...corsHeaders(request),
  });
}
