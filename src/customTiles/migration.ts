import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  type LayerName,
  type PlacedObject,
} from '../config';
import {
  parseCustomSpriteObjectId,
  normalizeCustomSpriteDefinitions,
  type CustomSpriteDefinition,
} from '../customSprites/model';
import {
  buildCustomRoomTileFromSprite,
  findCustomRoomTileIndexForSourceSprite,
  getCustomRoomTileGid,
  normalizeCustomRoomTileDefinitions,
} from './model';
import { cloneRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';

export interface ConvertCustomSpriteObjectsToRoomTilesOptions {
  spriteIds?: readonly string[];
  layers?: readonly LayerName[];
  overwriteExistingTiles?: boolean;
}

export interface ConvertCustomSpriteObjectsToRoomTilesResult {
  changed: boolean;
  convertedObjectCount: number;
  skippedObjectCount: number;
  customTileCountBefore: number;
  customTileCountAfter: number;
  snapshot: RoomSnapshot;
}

export function convertCustomSpriteObjectsToRoomTiles(
  snapshot: RoomSnapshot,
  options: ConvertCustomSpriteObjectsToRoomTilesOptions = {},
): ConvertCustomSpriteObjectsToRoomTilesResult {
  const nextSnapshot = cloneRoomSnapshot(snapshot);
  const spriteIds = options.spriteIds?.length ? new Set(options.spriteIds) : null;
  const layers = new Set<LayerName>(options.layers?.length ? options.layers : LAYER_NAMES);
  const spriteById = new Map(
    normalizeCustomSpriteDefinitions(nextSnapshot.customSprites).map((sprite) => [sprite.id, sprite]),
  );
  const customTileCountBefore = normalizeCustomRoomTileDefinitions(nextSnapshot.customTiles).length;
  let customTiles = normalizeCustomRoomTileDefinitions(nextSnapshot.customTiles);
  const nextPlacedObjects: PlacedObject[] = [];
  let convertedObjectCount = 0;
  let skippedObjectCount = 0;

  const ensureTileForSprite = (sprite: CustomSpriteDefinition): number | null => {
    const existingIndex = findCustomRoomTileIndexForSourceSprite(customTiles, sprite.id);
    const existingTile = existingIndex >= 0 ? customTiles[existingIndex] : null;
    const tile = buildCustomRoomTileFromSprite(sprite, existingTile);
    if (!tile) {
      return null;
    }

    if (existingIndex >= 0) {
      customTiles = [
        ...customTiles.slice(0, existingIndex),
        tile,
        ...customTiles.slice(existingIndex + 1),
      ];
      return getCustomRoomTileGid(existingIndex);
    }

    const nextIndex = customTiles.length;
    customTiles = [...customTiles, tile];
    return getCustomRoomTileGid(nextIndex);
  };

  for (const placed of nextSnapshot.placedObjects) {
    const spriteId = parseCustomSpriteObjectId(placed.id);
    if (!spriteId || (spriteIds && !spriteIds.has(spriteId))) {
      nextPlacedObjects.push(placed);
      continue;
    }

    const layerName = normalizePlacedLayer(placed.layer);
    const sprite = spriteById.get(spriteId);
    if (!sprite || !layers.has(layerName)) {
      skippedObjectCount += 1;
      nextPlacedObjects.push(placed);
      continue;
    }

    const tileX = Math.floor(placed.x / TILE_SIZE);
    const tileY = Math.floor(placed.y / TILE_SIZE);
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      skippedObjectCount += 1;
      nextPlacedObjects.push(placed);
      continue;
    }

    const existingTile = nextSnapshot.tileData[layerName][tileY][tileX];
    const existingTileIndex = findCustomRoomTileIndexForSourceSprite(customTiles, sprite.id);
    const existingTileGid = existingTileIndex >= 0 ? getCustomRoomTileGid(existingTileIndex) : null;
    if (
      existingTile > 0 &&
      existingTile !== existingTileGid &&
      !options.overwriteExistingTiles
    ) {
      skippedObjectCount += 1;
      nextPlacedObjects.push(placed);
      continue;
    }

    const gid = ensureTileForSprite(sprite);
    if (!gid) {
      skippedObjectCount += 1;
      nextPlacedObjects.push(placed);
      continue;
    }

    nextSnapshot.tileData[layerName][tileY][tileX] = gid;
    convertedObjectCount += 1;
  }

  nextSnapshot.placedObjects = nextPlacedObjects;
  nextSnapshot.customTiles = customTiles;

  return {
    changed: convertedObjectCount > 0,
    convertedObjectCount,
    skippedObjectCount,
    customTileCountBefore,
    customTileCountAfter: customTiles.length,
    snapshot: nextSnapshot,
  };
}

function normalizePlacedLayer(layer: PlacedObject['layer']): LayerName {
  return layer && (LAYER_NAMES as readonly string[]).includes(layer) ? layer : 'terrain';
}
