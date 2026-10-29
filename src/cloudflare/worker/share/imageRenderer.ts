import type { RoomImageData } from '../../../roomImage/roomImagePrimitives';
import { ROOM_PX_WIDTH, ROOM_PX_HEIGHT, TILE_SIZE } from '../../../config/room';
import { createDefaultRoomSnapshot, type RoomSnapshot, type RoomCoordinates } from '../../../persistence/roomModel';
import { composeRoomImages } from '../../../roomImage/compose';
import { decodeRoomImageBytes } from '../../../roomImage/roomImageAssets';
import { renderRoomImage, renderRoomSharePreviewPng as renderSingle } from '../../../roomImage/roomImageRenderer';
import { ROOM_SHARE_IMAGE_HEIGHT, ROOM_SHARE_IMAGE_WIDTH, type PublishedRoomSnapshot, type RoomImageEnvironment } from '../../../roomImage/types';
import { encodePng } from '../../../utils/pngEncoder';
import type { Env } from '../core/types';
import { handleBackgroundImageRequest } from '../backgroundImages/routes';

export { ROOM_SHARE_IMAGE_HEIGHT, ROOM_SHARE_IMAGE_WIDTH };
export interface ExpandedRoomSharePreviewCell { snapshot: RoomSnapshot; coordinates: RoomCoordinates }

function imageEnvironment(request: Request, env: Env): RoomImageEnvironment {
  const uploads = new Map<string, Promise<RoomImageData>>();
  return { ASSETS: env.ASSETS, loadCustomBackground: id => {
    let pending = uploads.get(id);
    if (pending) return pending;
    // Keep at most the current cell's decoded upload; sixteen large photos must not accumulate.
    uploads.clear();
    pending = (async () => {
      const url = new URL(`/api/background-images/${encodeURIComponent(id)}/image`, request.url);
      // Run the public approval/deletion checks directly; never self-fetch this Worker over HTTP.
      const response = await handleBackgroundImageRequest(new Request(url, { headers: { Accept: 'image/png' } }), url, env);
      if (!response.ok) throw new Error('Background image unavailable.');
      return decodeRoomImageBytes(new Uint8Array(await response.arrayBuffer()));
    })();
    uploads.set(id, pending); return pending;
  } };
}

export function renderRoomSharePreviewPng(snapshot: RoomSnapshot, request: Request, env: Env): Promise<Uint8Array> {
  return renderSingle(request, imageEnvironment(request, env), new URL(request.url), snapshot as unknown as PublishedRoomSnapshot);
}

export async function renderExpandedRoomSharePreviewPng(cells: ExpandedRoomSharePreviewCell[], request: Request, env: Env): Promise<Uint8Array> {
  const sorted = cells.filter(cell => Number.isFinite(cell.coordinates.x) && Number.isFinite(cell.coordinates.y))
    .sort((a, b) => a.coordinates.y - b.coordinates.y || a.coordinates.x - b.coordinates.x);
  if (sorted.length <= 1) return renderRoomSharePreviewPng(sorted[0]?.snapshot ?? createDefaultRoomSnapshot(), request, env);
  const context = imageEnvironment(request, env), url = new URL(request.url);
  const images = [];
  for (const cell of sorted) {
    images.push({ coordinates: cell.coordinates,
      image: await renderRoomImage(request, context, url, cell.snapshot as unknown as PublishedRoomSnapshot,
        { left: 0, top: 0, tileSize: TILE_SIZE }, { width: ROOM_PX_WIDTH, height: ROOM_PX_HEIGHT }, false) });
  }
  const canvas = composeRoomImages(images);
  return encodePng(ROOM_SHARE_IMAGE_WIDTH, ROOM_SHARE_IMAGE_HEIGHT, canvas.pixels);
}
