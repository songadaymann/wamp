import {
  ROOM_PX_WIDTH,
  ROOM_PX_HEIGHT,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  TILE_SIZE,
} from '../../config';
import type { GoalMarkerPoint } from '../../goals/roomGoals';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { getTerrainTileCollisionProfile } from './terrainCollision';

export type GoalRunEntryContext = 'spawn' | 'respawn' | 'transition';

export interface GoalRunStartPoint extends GoalMarkerPoint {}

const START_TOUCH_RADIUS_PX = 18;

export function resolveGoalRunStartPoint(
  room: RoomSnapshot,
  playerHeight: number,
): GoalRunStartPoint {
  const originX = room.coordinates.x * ROOM_PX_WIDTH;
  const originY = room.coordinates.y * ROOM_PX_HEIGHT;

  if (room.spawnPoint) {
    return {
      x: originX + room.spawnPoint.x,
      y: originY + room.spawnPoint.y,
    };
  }

  const surfaceStart = resolveSurfaceGoalRunStartPoint(room, playerHeight);
  if (surfaceStart) {
    return surfaceStart;
  }

  return {
    x: originX + ROOM_PX_WIDTH / 2,
    y: originY + TILE_SIZE * 2 + playerHeight / 2,
  };
}

export function goalRunEntryStartsQualifiedAttempt(entryContext: GoalRunEntryContext): boolean {
  return entryContext === 'spawn' || entryContext === 'respawn';
}

export function playerTouchesGoalRunStartPoint(
  playerFeet: GoalMarkerPoint,
  startPoint: GoalRunStartPoint,
): boolean {
  return Math.hypot(playerFeet.x - startPoint.x, playerFeet.y - startPoint.y) <= START_TOUCH_RADIUS_PX;
}

function resolveSurfaceGoalRunStartPoint(
  room: RoomSnapshot,
  playerHeight: number,
): GoalRunStartPoint | null {
  const centerCol = Math.floor(ROOM_WIDTH / 2);
  const candidateCols: number[] = [centerCol];

  for (let offset = 1; offset < ROOM_WIDTH; offset += 1) {
    const left = centerCol - offset;
    const right = centerCol + offset;
    if (left >= 0) candidateCols.push(left);
    if (right < ROOM_WIDTH) candidateCols.push(right);
  }

  for (const tileX of candidateCols) {
    const surfaceTileY = findSpawnSurfaceTile(room, tileX, playerHeight);
    if (surfaceTileY === null) {
      continue;
    }

    const originX = room.coordinates.x * ROOM_PX_WIDTH;
    const originY = room.coordinates.y * ROOM_PX_HEIGHT;
    const profile = getTerrainTileCollisionProfile(room, tileX, surfaceTileY);
    return {
      x: originX + tileX * TILE_SIZE + TILE_SIZE / 2,
      y: originY + surfaceTileY * TILE_SIZE + profile.topInset,
    };
  }

  return null;
}

function findSpawnSurfaceTile(
  room: RoomSnapshot,
  tileX: number,
  playerHeight: number,
): number | null {
  const clearTilesNeeded = Math.max(2, Math.ceil(playerHeight / TILE_SIZE) + 1);

  for (let tileY = ROOM_HEIGHT - 1; tileY >= 0; tileY -= 1) {
    const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
    if (!profile.hasCollision) {
      continue;
    }

    let hasClearHeadroom = true;
    for (let offset = 1; offset <= clearTilesNeeded; offset += 1) {
      const aboveTileY = tileY - offset;
      if (aboveTileY < 0) {
        break;
      }

      if (getTerrainTileCollisionProfile(room, tileX, aboveTileY).hasCollision) {
        hasClearHeadroom = false;
        break;
      }
    }

    if (hasClearHeadroom) {
      return tileY;
    }
  }

  return null;
}
