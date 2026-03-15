import {
  decodeTileDataValue,
  getTerrainCollisionProfileForGid,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
} from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';

export interface TerrainTileCollisionProfile {
  hasCollision: boolean;
  topInset: number;
  bottomInset: number;
  height: number;
}

export function roomHasTerrainTile(room: RoomSnapshot, tileX: number, tileY: number): boolean {
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
    return false;
  }

  const decoded = decodeTileDataValue(room.tileData.terrain[tileY][tileX]);
  if (decoded.gid <= 0) {
    return false;
  }

  return getTerrainCollisionProfileForGid(decoded.gid).hasCollision;
}

export function getTerrainTileCollisionProfile(
  room: RoomSnapshot,
  tileX: number,
  tileY: number
): TerrainTileCollisionProfile {
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
    return { hasCollision: false, topInset: 0, bottomInset: 0, height: 0 };
  }

  const decoded = decodeTileDataValue(room.tileData.terrain[tileY][tileX]);
  if (decoded.gid <= 0) {
    return { hasCollision: false, topInset: 0, bottomInset: 0, height: 0 };
  }

  const collisionProfile = getTerrainCollisionProfileForGid(decoded.gid);
  if (!collisionProfile.hasCollision) {
    return { hasCollision: false, topInset: 0, bottomInset: 0, height: 0 };
  }

  const topInset =
    !decoded.flipY && !roomHasTerrainTile(room, tileX, tileY - 1)
      ? collisionProfile.topInset
      : 0;
  const bottomInset =
    decoded.flipY && !roomHasTerrainTile(room, tileX, tileY + 1)
      ? collisionProfile.topInset
      : 0;

  return {
    hasCollision: true,
    topInset,
    bottomInset,
    height: Math.max(1, TILE_SIZE - topInset - bottomInset),
  };
}

export function terrainTileNeedsInsetBody(
  room: RoomSnapshot,
  tileX: number,
  tileY: number
): boolean {
  const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
  return profile.hasCollision && (profile.topInset > 0 || profile.bottomInset > 0);
}

export function terrainTileDisablesTilemapCollision(
  room: RoomSnapshot,
  tileX: number,
  tileY: number
): boolean {
  const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
  return !profile.hasCollision || profile.topInset > 0 || profile.bottomInset > 0;
}

export function terrainTileCollidesAtLocalPixel(
  room: RoomSnapshot,
  tileX: number,
  tileY: number,
  localPixelY: number
): boolean {
  const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
  if (!profile.hasCollision) {
    return false;
  }

  return localPixelY >= profile.topInset && localPixelY < TILE_SIZE - profile.bottomInset;
}
