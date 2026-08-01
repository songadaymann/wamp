import {
  decodeTileDataValue,
  getObjectById,
  getObjectRuntimeBodyRect,
  getPlacedObjectLayer,
  getTerrainCollisionProfileForGid,
  isSolidCustomSpriteObjectConfig,
  isSolidRuntimeObjectConfig,
  placedObjectLayerAllowsRuntimeCollision,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
} from '../config';
import { getCustomRoomTileCollisionProfile } from '../customTiles/model';
import type { RoomSnapshot, RoomSnapshotView } from '../persistence/roomModel';

export interface RoomWeatherSurfaceSegment {
  x1: number;
  x2: number;
  y: number;
}

export interface RoomWeatherSurfaceOrigin {
  x: number;
  y: number;
}

type RoomWeatherSurfaceSource = RoomSnapshot | RoomSnapshotView;

interface CachedRoomWeatherSurfaces {
  version: number;
  updatedAt: string;
  originX: number;
  originY: number;
  segments: RoomWeatherSurfaceSegment[];
}

const roomWeatherSurfaceCache = new WeakMap<object, CachedRoomWeatherSurfaces>();

export function buildRoomWeatherSurfaceSegments(
  room: RoomWeatherSurfaceSource,
  origin: RoomWeatherSurfaceOrigin = { x: 0, y: 0 },
): RoomWeatherSurfaceSegment[] {
  const surfaces: RoomWeatherSurfaceSegment[] = [];

  for (let tileY = 0; tileY < ROOM_HEIGHT; tileY += 1) {
    for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
      const profile = getRoomTerrainProfile(room, tileX, tileY);
      if (!profile.hasCollision || hasRoomTerrainCollision(room, tileX, tileY - 1)) {
        continue;
      }

      surfaces.push({
        x1: origin.x + tileX * TILE_SIZE,
        x2: origin.x + (tileX + 1) * TILE_SIZE,
        y: origin.y + tileY * TILE_SIZE + profile.topInset,
      });
    }
  }

  for (const placed of room.placedObjects) {
    const config = getObjectById(placed.id);
    if (!config || config.bodyWidth <= 0 || config.bodyHeight <= 0) {
      continue;
    }

    const collisionConfig = {
      ...config,
      customSpriteKind: placed.customSpriteKind ?? config.customSpriteKind ?? null,
    };
    if (
      !placedObjectLayerAllowsRuntimeCollision(collisionConfig, placed) ||
      (
        !isSolidRuntimeObjectConfig(collisionConfig) &&
        !isSolidCustomSpriteObjectConfig(collisionConfig)
      )
    ) {
      continue;
    }

    const layer = getPlacedObjectLayer(placed);
    if (layer !== 'terrain') {
      continue;
    }

    const rect = getObjectRuntimeBodyRect(collisionConfig, placed);
    surfaces.push({
      x1: origin.x + rect.x,
      x2: origin.x + rect.x + rect.width,
      y: origin.y + rect.y,
    });
  }

  return surfaces;
}

/**
 * Reuses rain collision surfaces for an immutable runtime room snapshot.
 * Replacing the snapshot, changing its version/update timestamp, or changing
 * the world origin invalidates the cached result.
 */
export function getCachedRoomWeatherSurfaceSegments(
  room: RoomSnapshotView,
  origin: RoomWeatherSurfaceOrigin = { x: 0, y: 0 },
): RoomWeatherSurfaceSegment[] {
  const cached = roomWeatherSurfaceCache.get(room);
  if (
    cached
    && cached.version === room.version
    && cached.updatedAt === room.updatedAt
    && cached.originX === origin.x
    && cached.originY === origin.y
  ) {
    return cached.segments;
  }

  const segments = buildRoomWeatherSurfaceSegments(room, origin);
  roomWeatherSurfaceCache.set(room, {
    version: room.version,
    updatedAt: room.updatedAt,
    originX: origin.x,
    originY: origin.y,
    segments,
  });
  return segments;
}

function hasRoomTerrainCollision(
  room: RoomWeatherSurfaceSource,
  tileX: number,
  tileY: number,
): boolean {
  return getRoomTerrainProfile(room, tileX, tileY).hasCollision;
}

function getRoomTerrainProfile(room: RoomWeatherSurfaceSource, tileX: number, tileY: number) {
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
    return { hasCollision: false, topInset: 0 };
  }

  const decoded = decodeTileDataValue(room.tileData.terrain[tileY][tileX]);
  if (decoded.gid <= 0) {
    return { hasCollision: false, topInset: 0 };
  }

  const profile =
    getCustomRoomTileCollisionProfile(room as RoomSnapshot, decoded.gid) ??
    getTerrainCollisionProfileForGid(decoded.gid);
  if (!profile.hasCollision) {
    return { hasCollision: false, topInset: 0 };
  }

  return {
    hasCollision: true,
    topInset: decoded.flipY ? 0 : profile.topInset,
  };
}
