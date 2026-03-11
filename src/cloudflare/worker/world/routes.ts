import { computeWorldChunkWindow, computeWorldWindow, getRoomBoundsForChunkBounds } from '../../../persistence/worldModel';
import { HttpError, jsonResponse, parseIntegerQueryParam, parseWorldChunkBounds } from '../core/http';
import type { Env } from '../core/types';
import { loadPublishedRoomsInBounds } from '../rooms/store';

export async function handleWorldRequest(request: Request, url: URL, env: Env): Promise<Response> {
  const centerX = parseIntegerQueryParam(url.searchParams, 'centerX');
  const centerY = parseIntegerQueryParam(url.searchParams, 'centerY');
  const radius = parseIntegerQueryParam(url.searchParams, 'radius');

  if (radius < 0 || radius > 32) {
    throw new HttpError(400, 'Radius must be between 0 and 32.');
  }

  const publishedRooms = await loadPublishedRoomsInBounds(
    env,
    centerX - radius - 1,
    centerX + radius + 1,
    centerY - radius - 1,
    centerY + radius + 1
  );

  return jsonResponse(
    request,
    computeWorldWindow(publishedRooms, { x: centerX, y: centerY }, radius)
  );
}

export async function handleWorldChunksRequest(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const chunkBounds = parseWorldChunkBounds(url.searchParams);
  const roomBounds = getRoomBoundsForChunkBounds(chunkBounds);
  const publishedRooms = await loadPublishedRoomsInBounds(
    env,
    roomBounds.minX - 1,
    roomBounds.maxX + 1,
    roomBounds.minY - 1,
    roomBounds.maxY + 1
  );

  return jsonResponse(request, computeWorldChunkWindow(publishedRooms, chunkBounds));
}
