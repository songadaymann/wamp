import type Phaser from 'phaser';
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  decodeTileDataValue,
  encodeTileDataValue,
  getPlacedObjectLayer,
  type LayerName,
  type PlacedObject,
} from '../../config';
import {
  CUSTOM_ROOM_TILE_MAX_TILES,
  getCustomRoomTileGid,
  getCustomRoomTileIndexForGid,
  type CustomRoomTileDefinition,
} from '../../customTiles/model';
import { findConflictingPlacedObjectAtAnchorCell, getPlacedObjectAnchorCell } from '../../placedObjects/occupancy';
import { getPlacedObjectPathTargetIds, withPlacedObjectPathTargets } from '../../placedObjects/objectPaths';
import { clonePlacedObjectDocument } from './placedObjectDocument';

export interface ClipboardTileBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A source room's custom tile, keyed by the GID the copied tiles use. */
export interface ClipboardCustomTile {
  gid: number;
  tile: CustomRoomTileDefinition;
}

/** Objects on `layer` whose anchor cell lies in the bounds, positioned relative to the bounds' top-left. */
export function collectClipboardObjects(
  placedObjects: readonly PlacedObject[],
  layer: LayerName,
  bounds: ClipboardTileBounds,
): PlacedObject[] {
  const inside = placedObjects.filter((placed) => {
    const anchor = getPlacedObjectAnchorCell(placed);
    return anchor !== null
      && getPlacedObjectLayer(placed) === layer
      && anchor.tileX >= bounds.minX && anchor.tileX <= bounds.maxX
      && anchor.tileY >= bounds.minY && anchor.tileY <= bounds.maxY;
  });
  return clonePlacedObjectDocument(inside).map((placed) => ({
    ...placed,
    x: placed.x - bounds.minX * TILE_SIZE,
    y: placed.y - bounds.minY * TILE_SIZE,
  }));
}

export interface ClipboardObjectPastePlan {
  added: PlacedObject[];
  /** Objects that would leave the room or land on another object's spot. */
  skipped: number;
  /** Links to objects that were not copied along with them. */
  droppedLinks: number;
}

/**
 * Places copied objects at a tile origin with fresh instance IDs. Links between
 * copied objects follow the copies; links to anything outside the copy are dropped.
 */
export function planClipboardObjectPaste(
  copied: readonly PlacedObject[],
  existing: readonly PlacedObject[],
  baseTileX: number,
  baseTileY: number,
  createInstanceId: () => string,
): ClipboardObjectPastePlan {
  const idMap = new Map(copied.map((placed) => [placed.instanceId, createInstanceId()]));
  const occupied = [...existing];
  const added: PlacedObject[] = [];
  let skipped = 0;
  let droppedLinks = 0;
  const landed = new Set<string>();
  for (const source of copied) {
    const placed = { ...source, x: source.x + baseTileX * TILE_SIZE, y: source.y + baseTileY * TILE_SIZE };
    const anchor = getPlacedObjectAnchorCell(placed);
    if (!anchor || anchor.tileX < 0 || anchor.tileX >= ROOM_WIDTH || anchor.tileY < 0 || anchor.tileY >= ROOM_HEIGHT
      || findConflictingPlacedObjectAtAnchorCell(occupied, anchor, placed)) {
      skipped += 1;
      continue;
    }
    occupied.push(placed);
    landed.add(source.instanceId);
    added.push(placed);
  }

  return {
    added: added.map((placed) => {
      const sourceId = placed.instanceId;
      const targets = getPlacedObjectPathTargetIds(placed);
      const kept = targets.flatMap((target) => (landed.has(target) ? [idMap.get(target)!] : []));
      droppedLinks += targets.length - kept.length;
      const relinked = targets.length > 0 ? withPlacedObjectPathTargets(placed, kept) : placed;
      return { ...relinked, instanceId: idMap.get(sourceId)! };
    }),
    skipped,
    droppedLinks,
  };
}

/** The custom tiles a copied tile grid uses, so another room can recreate them. */
export function collectClipboardCustomTiles(
  tiles: readonly (readonly number[])[],
  roomTiles: readonly CustomRoomTileDefinition[],
): ClipboardCustomTile[] {
  const used = new Map<number, ClipboardCustomTile>();
  for (const row of tiles) {
    for (const value of row) {
      if (value < 0) continue;
      const { gid } = decodeTileDataValue(value);
      const index = getCustomRoomTileIndexForGid(gid);
      const tile = index === null ? undefined : roomTiles[index];
      if (tile && !used.has(gid)) used.set(gid, { gid, tile: { ...tile, pixels: [...tile.pixels] } });
    }
  }
  return [...used.values()];
}

const sameTile = (left: CustomRoomTileDefinition, right: CustomRoomTileDefinition) =>
  left.id === right.id
  || (Boolean(left.sourceSpriteId) && left.sourceSpriteId === right.sourceSpriteId)
  || (left.collision === right.collision && left.pixels.length === right.pixels.length
    && left.pixels.every((pixel, index) => pixel === right.pixels[index]));

/**
 * Maps copied custom-tile GIDs onto a target room: reuse a matching tile, otherwise
 * append it while the room has space. Unmappable GIDs map to null (tile skipped).
 */
export function planClipboardCustomTiles(
  copied: readonly ClipboardCustomTile[],
  roomTiles: readonly CustomRoomTileDefinition[],
): { gidMap: Map<number, number | null>; additions: CustomRoomTileDefinition[] } {
  const gidMap = new Map<number, number | null>();
  const additions: CustomRoomTileDefinition[] = [];
  for (const { gid, tile } of copied) {
    const all = [...roomTiles, ...additions];
    const index = all.findIndex((candidate) => sameTile(candidate, tile));
    if (index >= 0) {
      gidMap.set(gid, getCustomRoomTileGid(index));
    } else if (all.length < CUSTOM_ROOM_TILE_MAX_TILES) {
      additions.push({ ...tile, pixels: [...tile.pixels] });
      gidMap.set(gid, getCustomRoomTileGid(all.length));
    } else {
      gidMap.set(gid, null);
    }
  }
  return { gidMap, additions };
}

/** Rewrites encoded tile values through a GID map, keeping flips; unmapped custom tiles become empty. */
export function remapClipboardTileValue(value: number, gidMap: ReadonlyMap<number, number | null>): number {
  if (value < 0) return value;
  const decoded = decodeTileDataValue(value);
  if (!gidMap.has(decoded.gid)) return value;
  const next = gidMap.get(decoded.gid);
  return next === null || next === undefined ? -1 : encodeTileDataValue(next, decoded.flipX, decoded.flipY);
}

/** Paste preview: copied tiles (or the copied area when it holds only objects) and a marker per object. */
export function drawClipboardPastePreview(
  graphics: Pick<Phaser.GameObjects.Graphics, 'fillStyle' | 'lineStyle' | 'fillRect' | 'strokeRect' | 'fillCircle' | 'strokeCircle'>,
  clipboard: { width: number; height: number; occupiedMask: boolean[][]; objects?: readonly PlacedObject[] },
  origin: { x: number; y: number },
  color: number,
): void {
  graphics.fillStyle(color, 0.12);
  graphics.lineStyle(2, color, 0.95);
  let drewCell = false;
  for (let dy = 0; dy < clipboard.height; dy += 1) {
    for (let dx = 0; dx < clipboard.width; dx += 1) {
      if (!clipboard.occupiedMask[dy]?.[dx]) continue;
      drewCell = true;
      graphics.fillRect(origin.x + dx * TILE_SIZE, origin.y + dy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      graphics.strokeRect(origin.x + dx * TILE_SIZE, origin.y + dy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  if (!drewCell) {
    graphics.fillRect(origin.x, origin.y, clipboard.width * TILE_SIZE, clipboard.height * TILE_SIZE);
    graphics.strokeRect(origin.x, origin.y, clipboard.width * TILE_SIZE, clipboard.height * TILE_SIZE);
  }
  for (const placed of clipboard.objects ?? []) {
    graphics.fillStyle(color, 0.85);
    graphics.fillCircle(origin.x + placed.x, origin.y + placed.y, 4);
    graphics.lineStyle(2, 0x18161c, 0.9);
    graphics.strokeCircle(origin.x + placed.x, origin.y + placed.y, 4);
  }
}
