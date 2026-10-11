import { describe, expect, it } from 'vitest';
import { SPECIAL_TILESET_FIRST_GID, SPECIAL_TILE_LOCAL_INDICES } from '../../config';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { roomHasSpecialTiles } from './specialTileRooms';

describe('rooms without special tiles are skipped by body scans (F006)', () => {
  it('finds a special tile on any layer and remembers the answer per tile grid', () => {
    const plain = createDefaultRoomSnapshot();
    plain.tileData.terrain[10][10] = 1;
    expect(roomHasSpecialTiles(plain.tileData)).toBe(false);

    const crumbling = createDefaultRoomSnapshot();
    crumbling.tileData.background[3][4] = SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES.crumbling;
    expect(roomHasSpecialTiles(crumbling.tileData)).toBe(true);

    // A reloaded room arrives with a new grid object, so it is checked again.
    const reloaded = createDefaultRoomSnapshot();
    reloaded.tileData.terrain[0][0] = SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES.crumbling;
    expect(roomHasSpecialTiles(reloaded.tileData)).toBe(true);
    expect(roomHasSpecialTiles(plain.tileData)).toBe(false);
  });
});
