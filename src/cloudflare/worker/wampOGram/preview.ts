import { listEmbeddedCustomSpriteIds } from '../../../customSprites/blockedArt';
import { buildWampOGramPreviewPath, WAMP_O_GRAM_PREVIEW_VERSION } from '../../../wampOGram/links';
import { corsHeaders, HttpError } from '../core/http';
import { loadAnonymousPublicCache, matchAnonymousPublicCache } from '../core/publicCache';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { maskBlockedArtInSnapshots } from '../customSprites/blockedArt';
import { hiddenVersionSnapshot } from '../rooms/versionRedaction';
import {
  ROOM_SHARE_IMAGE_HEIGHT,
  ROOM_SHARE_IMAGE_WIDTH,
  renderRoomSharePreviewPng,
} from '../share/roomPreviewImage';
import { loadWampOGramBySlug, loadWampOGramVisibility } from './store';

/** Browsers and image proxies ask again after an hour, so a taken-down preview leaves them within one. */
const CURRENT_PREVIEW_CACHE_CONTROL = 'public, max-age=3600';
/** A link without the current renderer version may be drawn differently by a later one. */
const OTHER_PREVIEW_CACHE_CONTROL = 'public, max-age=300';
/** This Worker's own copy: kept for a year, or an hour when it shows community art that could be blocked later (F189). */
const STORED_PREVIEW_CACHE_CONTROL = 'public, max-age=31536000';
const STORED_COMMUNITY_ART_PREVIEW_CACHE_CONTROL = 'public, max-age=3600';

/**
 * A gram never changes, so this Worker draws its preview once per datacenter and keeps it, keyed by
 * slug, preview version and whether its room version is hidden (F348). Every request first checks
 * that the gram exists and whether its room version was hidden, before the cache, so this Worker
 * stops serving a deleted gram's preview, or a hidden version's art, in every datacenter at once.
 * Copies that browsers and image proxies already hold last until their hour runs out; platforms
 * that keep their own copy of a link preview may keep it longer.
 */
export async function wampOGramPreviewResponse(
  request: Request,
  url: URL,
  env: Env,
  slug: string,
  context: WorkerExecutionContextLike | undefined,
): Promise<Response> {
  const visibility = await loadWampOGramVisibility(env, slug);
  if (visibility === 'missing') {
    throw new HttpError(404, 'Wamp-O-Gram not found.');
  }

  const hidden = visibility === 'room-version-hidden';
  const cacheControl = url.searchParams.get('renderer') === WAMP_O_GRAM_PREVIEW_VERSION
    ? CURRENT_PREVIEW_CACHE_CONTROL
    : OTHER_PREVIEW_CACHE_CONTROL;
  // Only drawings without community art get this tag, since nothing can change them.
  const etag = `"${slug}-v${WAMP_O_GRAM_PREVIEW_VERSION}${hidden ? '-hidden' : ''}"`;
  if (ifNoneMatchIncludes(request, etag)) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': cacheControl, ...corsHeaders(request) },
    });
  }

  const cacheUrl = new URL(buildWampOGramPreviewPath(slug), url.origin);
  if (hidden) cacheUrl.searchParams.set('room', 'hidden');
  const cacheKey = new Request(cacheUrl, { headers: request.headers });
  const response = request.method === 'HEAD'
    ? await headPreviewResponse(request, cacheKey, context)
    : await loadAnonymousPublicCache(cacheKey, context, () => drawPreview(request, env, slug, hidden, etag));
  response.headers.set('Cache-Control', cacheControl);
  return response;
}

/** HEAD never draws: a stored copy lends its length and tag, otherwise only the type is known. */
async function headPreviewResponse(
  request: Request,
  cacheKey: Request,
  context: WorkerExecutionContextLike | undefined,
): Promise<Response> {
  const stored = await matchAnonymousPublicCache(cacheKey, context);
  // The body is not needed. Not awaited: cancelling a teed body waits for its other branch.
  void stored?.body?.cancel().catch(() => undefined);
  return new Response(null, { status: 200, headers: stored ? new Headers(stored.headers) : previewHeaders(request) });
}

async function drawPreview(request: Request, env: Env, slug: string, hidden: boolean, etag: string): Promise<Response> {
  const record = await loadWampOGramBySlug(env, slug);
  if (!record) {
    throw new HttpError(404, 'Wamp-O-Gram not found.');
  }

  const [snapshot] = hidden
    ? [hiddenVersionSnapshot(record.roomSnapshot)]
    : await maskBlockedArtInSnapshots(env, [record.roomSnapshot]);
  const hasCommunityArt = listEmbeddedCustomSpriteIds(snapshot).length > 0;
  const bytes = await renderRoomSharePreviewPng(snapshot);
  const headers = previewHeaders(request);
  headers.set('Cache-Control', hasCommunityArt ? STORED_COMMUNITY_ART_PREVIEW_CACHE_CONTROL : STORED_PREVIEW_CACHE_CONTROL);
  headers.set('Content-Length', String(bytes.byteLength));
  if (!hasCommunityArt) headers.set('ETag', etag);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, { status: 200, headers });
}

function previewHeaders(request: Request): Headers {
  return new Headers({
    'Content-Type': 'image/png',
    'X-Wamp-Image-Width': String(ROOM_SHARE_IMAGE_WIDTH),
    'X-Wamp-Image-Height': String(ROOM_SHARE_IMAGE_HEIGHT),
    ...corsHeaders(request),
  });
}

function ifNoneMatchIncludes(request: Request, etag: string): boolean {
  const header = request.headers.get('If-None-Match');
  if (!header) return false;
  return header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}
