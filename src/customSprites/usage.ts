import { decodeTileDataValue } from '../config/editorState';
import { getCustomRoomTileGid } from '../customTiles/model';
import { buildCustomSpriteObjectId } from './model';

export interface CustomSpriteUsageResponse {
  inUse: boolean;
}

export function roomSnapshotUsesCustomSprite(snapshot: unknown, spriteId: string): boolean {
  if (!snapshot || typeof snapshot !== 'object' || !spriteId) {
    return false;
  }

  const candidate = snapshot as {
    placedObjects?: unknown;
    customTiles?: unknown;
    tileData?: unknown;
  };
  const objectId = buildCustomSpriteObjectId(spriteId);
  if (
    Array.isArray(candidate.placedObjects)
    && candidate.placedObjects.some((placed) => {
      if (!placed || typeof placed !== 'object') {
        return false;
      }
      const object = placed as { id?: unknown; containedObjectId?: unknown };
      return object.id === objectId || object.containedObjectId === objectId;
    })
  ) {
    return true;
  }

  if (!Array.isArray(candidate.customTiles)) {
    return false;
  }

  const spriteTileGids = new Set<number>();
  for (let index = 0; index < candidate.customTiles.length; index += 1) {
    const tile = candidate.customTiles[index];
    if (
      tile
      && typeof tile === 'object'
      && (tile as { sourceSpriteId?: unknown }).sourceSpriteId === spriteId
    ) {
      spriteTileGids.add(getCustomRoomTileGid(index));
    }
  }
  if (spriteTileGids.size === 0 || !candidate.tileData || typeof candidate.tileData !== 'object') {
    return false;
  }

  for (const layer of Object.values(candidate.tileData)) {
    if (!Array.isArray(layer)) {
      continue;
    }
    for (const row of layer) {
      if (!Array.isArray(row)) {
        continue;
      }
      for (const encodedGid of row) {
        if (
          typeof encodedGid === 'number'
          && Number.isFinite(encodedGid)
          && spriteTileGids.has(decodeTileDataValue(encodedGid).gid)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}
