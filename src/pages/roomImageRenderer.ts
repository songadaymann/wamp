import type { PagesWorkerEnv } from './model';
import { loadPublishedRoomSnapshot, loadBlockedCustomSpriteIds, type RoomCoordinates } from './shareMetadata';
import { createFallbackRoomSnapshot, markBlockedCustomSprites, renderRoomSharePreviewPng, roomImageCommunityArtIds } from '../roomImage/roomImageRenderer';
const ROOM_IMAGE_TIMEOUT_MS = 3500;

export async function handleRoomImageRequest(
  request: Request,
  env: PagesWorkerEnv,
  url: URL,
  coordinates: RoomCoordinates,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  const headers = {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
  };

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  const published = await loadPublishedRoomSnapshot(request, env, url, coordinates, ROOM_IMAGE_TIMEOUT_MS);
  const artIds = published ? roomImageCommunityArtIds(published) : [];
  let snapshot = published ?? createFallbackRoomSnapshot(coordinates);
  if (published && artIds.length > 0) {
    const blocked = await loadBlockedCustomSpriteIds(request, env, url, ROOM_IMAGE_TIMEOUT_MS);
    // Without the list, leave every community sprite out and cache only briefly.
    snapshot = markBlockedCustomSprites(published, blocked ?? new Set(artIds));
    if (!blocked) headers['Cache-Control'] = 'public, max-age=60, s-maxage=60';
  }
  const png = await renderRoomSharePreviewPng(request, env, url, snapshot);
  const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers,
  });
}
