import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import type { CourseRoomRef } from '../model';
import type { RoomCoordinates } from '../../persistence/roomModel';

export interface CourseWorkspaceBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function getCourseWorkspaceBounds(roomRefs: CourseRoomRef[]): CourseWorkspaceBounds {
  if (roomRefs.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minX = roomRefs[0].coordinates.x;
  let maxX = roomRefs[0].coordinates.x;
  let minY = roomRefs[0].coordinates.y;
  let maxY = roomRefs[0].coordinates.y;

  for (const roomRef of roomRefs) {
    minX = Math.min(minX, roomRef.coordinates.x);
    maxX = Math.max(maxX, roomRef.coordinates.x);
    minY = Math.min(minY, roomRef.coordinates.y);
    maxY = Math.max(maxY, roomRef.coordinates.y);
  }

  return { minX, maxX, minY, maxY };
}

export function getCourseWorkspaceRoomOrigin(
  coordinates: RoomCoordinates,
  bounds: CourseWorkspaceBounds,
): { x: number; y: number } {
  return {
    x: (coordinates.x - bounds.minX) * ROOM_PX_WIDTH,
    y: (coordinates.y - bounds.minY) * ROOM_PX_HEIGHT,
  };
}

export function getCourseWorkspacePixelSize(
  bounds: CourseWorkspaceBounds,
): { width: number; height: number } {
  return {
    width: (bounds.maxX - bounds.minX + 1) * ROOM_PX_WIDTH,
    height: (bounds.maxY - bounds.minY + 1) * ROOM_PX_HEIGHT,
  };
}
