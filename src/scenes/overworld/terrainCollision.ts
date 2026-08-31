import {
  decodeTileDataValue,
  getTerrainCollisionProfileForGid,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  SPECIAL_TILE_ONE_WAY_PLATFORM_GID,
  TILE_SIZE,
} from '../../config';
import { SMART_TERRAIN_VERSION, smartSemanticCellKey } from '../../autotiling/model';
import { SMART_BRUSH_DEFINITIONS } from '../../autotiling/registry';
import { getCustomRoomTileCollisionProfile } from '../../customTiles/model';
import type { RoomSnapshot } from '../../persistence/roomModel';

export interface TerrainTileCollisionProfile {
  hasCollision: boolean;
  topInset: number;
  bottomInset: number;
  height: number;
  /** True when collision is projected from an exposed Smart Ground edge on Background. */
  isSmartBackgroundSurface: boolean;
}

const NO_TERRAIN_COLLISION: TerrainTileCollisionProfile = {
  hasCollision: false,
  topInset: 0,
  bottomInset: 0,
  height: 0,
  isSmartBackgroundSurface: false,
};

function hasSolidSmartBackgroundCell(
  room: RoomSnapshot,
  tileX: number,
  tileY: number,
): boolean {
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
    return false;
  }
  const smartTerrain = room.smartTerrain;
  if (
    !smartTerrain
    || smartTerrain.version !== SMART_TERRAIN_VERSION
    || smartTerrain.editingDisabled
  ) {
    return false;
  }
  const cell = smartTerrain.semanticCells[smartSemanticCellKey('background', tileX, tileY)];
  return cell ? SMART_BRUSH_DEFINITIONS[cell.brushId]?.collisionRole === 'solid' : false;
}

/**
 * Background Smart Ground keeps its artwork pass-through, but an exposed north
 * edge behaves like a platform. The semantic brush role, rather than a visual
 * GID, determines which cells participate.
 */
export function hasSmartBackgroundOneWaySurface(
  room: RoomSnapshot,
  tileX: number,
  tileY: number,
): boolean {
  return hasSolidSmartBackgroundCell(room, tileX, tileY)
    && !hasSolidSmartBackgroundCell(room, tileX, tileY - 1);
}

export function roomHasTerrainTile(room: RoomSnapshot, tileX: number, tileY: number): boolean {
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
    return false;
  }

  const decoded = decodeTileDataValue(room.tileData.terrain[tileY][tileX]);
  return (
    decoded.gid > 0 && getRoomTerrainCollisionProfileForGid(room, decoded.gid).hasCollision
  ) || hasSmartBackgroundOneWaySurface(room, tileX, tileY);
}

export function getTerrainTileCollisionProfile(
  room: RoomSnapshot,
  tileX: number,
  tileY: number
): TerrainTileCollisionProfile {
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
    return NO_TERRAIN_COLLISION;
  }

  const decoded = decodeTileDataValue(room.tileData.terrain[tileY][tileX]);
  const collisionProfile = decoded.gid > 0
    ? getRoomTerrainCollisionProfileForGid(room, decoded.gid)
    : null;
  if (!collisionProfile?.hasCollision) {
    return hasSmartBackgroundOneWaySurface(room, tileX, tileY)
      ? {
        hasCollision: true,
        topInset: 0,
        bottomInset: 0,
        height: TILE_SIZE,
        isSmartBackgroundSurface: true,
      }
      : NO_TERRAIN_COLLISION;
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
    isSmartBackgroundSurface: false,
  };
}

/**
 * Resolves the value used by the invisible gameplay collision tilemap. Visual
 * room layers remain untouched. Background surfaces reuse Special A2 so the
 * existing one-way collision and drop-through behavior applies.
 */
export function getTerrainCollisionTileValue(
  room: RoomSnapshot,
  tileX: number,
  tileY: number,
): ReturnType<typeof decodeTileDataValue> {
  const decoded = decodeTileDataValue(room.tileData.terrain[tileY]?.[tileX] ?? -1);
  return getTerrainTileCollisionProfile(room, tileX, tileY).isSmartBackgroundSurface
    ? { gid: SPECIAL_TILE_ONE_WAY_PLATFORM_GID, flipX: false, flipY: false }
    : decoded;
}

function getRoomTerrainCollisionProfileForGid(
  room: RoomSnapshot,
  gid: number,
) {
  return getCustomRoomTileCollisionProfile(room, gid) ?? getTerrainCollisionProfileForGid(gid);
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
