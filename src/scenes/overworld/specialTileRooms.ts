import { decodeTileDataValue, getSpecialTileKindForGid, LAYER_NAMES } from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';

// Most rooms contain no special tiles. Remember that per tile grid (rooms get a new grid object
// when they are reloaded, and play never edits one in place) so body scans skip those rooms
// instead of decoding three layers per covered cell every frame (F006).
const roomHasSpecialTilesByTileData = new WeakMap<object, boolean>();

export function roomHasSpecialTiles(tileData: RoomSnapshot['tileData']): boolean {
  let hasSpecialTiles = roomHasSpecialTilesByTileData.get(tileData);
  if (hasSpecialTiles === undefined) {
    hasSpecialTiles = LAYER_NAMES.some((layerName) => tileData[layerName].some((row) =>
      row.some((value) => value > 0 && getSpecialTileKindForGid(decodeTileDataValue(value).gid) !== null)));
    roomHasSpecialTilesByTileData.set(tileData, hasSpecialTiles);
  }
  return hasSpecialTiles;
}
