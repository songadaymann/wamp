import { decodeTileDataValue, getSpecialTileKindForGid, LAYER_NAMES, ROOM_HEIGHT, ROOM_WIDTH,
  type LayerName, type SpecialTileKind } from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';

export interface IndexedSpecialTile {
  readonly layerName: LayerName;
  readonly kind: SpecialTileKind;
}
export interface RoomSpecialTileIndex {
  readonly occupiedCells: Uint32Array;
  readonly cells: ReadonlyArray<readonly IndexedSpecialTile[] | undefined>;
  readonly hasSpecialTiles: boolean;
}

// Play keeps authored grids immutable. Reloads and edited snapshots have a new grid
// identity, so their special-tile bitmap and decoded layer kinds are rebuilt once.
const indexes = new WeakMap<RoomSnapshot['tileData'], RoomSpecialTileIndex>();

export function getRoomSpecialTileIndex(tileData: RoomSnapshot['tileData']): RoomSpecialTileIndex {
  const cached = indexes.get(tileData);
  if (cached) return cached;
  const occupiedCells = new Uint32Array(Math.ceil(ROOM_WIDTH * ROOM_HEIGHT / 32));
  const cells: Array<IndexedSpecialTile[] | undefined> = new Array(ROOM_WIDTH * ROOM_HEIGHT);
  let hasSpecialTiles = false;
  for (const layerName of LAYER_NAMES) {
    for (let tileY = 0; tileY < ROOM_HEIGHT; tileY++) {
      for (let tileX = 0; tileX < ROOM_WIDTH; tileX++) {
        const value = tileData[layerName][tileY][tileX];
        if (value <= 0) continue;
        const kind = getSpecialTileKindForGid(decodeTileDataValue(value).gid);
        if (!kind) continue;
        const cell = tileY * ROOM_WIDTH + tileX;
        occupiedCells[cell >>> 5] |= 1 << (cell & 31);
        (cells[cell] ??= []).push({ layerName, kind });
        hasSpecialTiles = true;
      }
    }
  }
  const index = { occupiedCells, cells, hasSpecialTiles };
  indexes.set(tileData, index);
  return index;
}

export function roomHasSpecialTiles(tileData: RoomSnapshot['tileData']): boolean {
  return getRoomSpecialTileIndex(tileData).hasSpecialTiles;
}
