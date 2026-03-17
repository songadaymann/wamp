import { computeWorldChunkWindow, computeWorldWindow, getRoomBoundsForChunkBounds } from '../../../persistence/worldModel';
import { HttpError, jsonResponse, parseIntegerQueryParam, parseWorldChunkBounds } from '../core/http';
import type { Env } from '../core/types';
import { loadPublishedCourseMembershipsInBounds } from '../courses/store';
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
  const memberships = await loadPublishedCourseMembershipsInBounds(
    env,
    centerX - radius - 1,
    centerX + radius + 1,
    centerY - radius - 1,
    centerY + radius + 1
  );
  const worldWindow = computeWorldWindow(publishedRooms, { x: centerX, y: centerY }, radius);
  applyCourseMemberships(worldWindow.rooms, memberships);

  return jsonResponse(request, worldWindow);
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
  const memberships = await loadPublishedCourseMembershipsInBounds(
    env,
    roomBounds.minX - 1,
    roomBounds.maxX + 1,
    roomBounds.minY - 1,
    roomBounds.maxY + 1
  );
  const chunkWindow = computeWorldChunkWindow(publishedRooms, chunkBounds);
  for (const chunk of chunkWindow.chunks) {
    applyCourseMemberships(chunk.rooms, memberships);
  }

  return jsonResponse(request, chunkWindow);
}

function applyCourseMemberships(
  rooms: Array<{
    id: string;
    course: {
      courseId: string;
      courseTitle: string | null;
      goalType: string | null;
      roomIndex: number;
      roomCount: number;
    } | null;
  }>,
  memberships: Array<{
    roomId: string;
    courseId: string;
    courseTitle: string | null;
    goalType: string | null;
    roomIndex: number;
    roomCount: number;
  }>
): void {
  const membershipsByRoomId = new Map(memberships.map((entry) => [entry.roomId, entry]));
  for (const room of rooms) {
    const membership = membershipsByRoomId.get(room.id);
    room.course = membership
      ? {
          courseId: membership.courseId,
          courseTitle: membership.courseTitle,
          goalType: membership.goalType,
          roomIndex: membership.roomIndex,
          roomCount: membership.roomCount,
        }
      : null;
  }
}
