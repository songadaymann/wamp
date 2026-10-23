import { describe, expect, it } from 'vitest';
import { TERRAIN_COLLISION_PROFILES } from '../config/tilesets';
import {
  CUSTOM_ROOM_TILE_MAX_TILES,
  getCustomRoomTileCollisionProfile,
  getCustomRoomTileDefinitionForGid,
  getCustomRoomTileGid,
  normalizeCustomRoomTileDefinitions,
  type CustomRoomTileDefinition,
} from './model';

function makeTile(index: number, overrides: Partial<CustomRoomTileDefinition> = {}): CustomRoomTileDefinition {
  return {
    id: `tile_${index}`,
    name: `Tile ${index}`,
    pixels: Array.from({ length: 256 }, (_, pixel) => (pixel % 3 === 0 ? '#AABBCC' : null)),
    collision: index % 2 === 0 ? 'solid' : 'none',
    sourceSpriteId: `sprite_${index}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

/** Wraps a tile so every normalization of it is counted through its pixels read. */
function countNormalizations(tile: CustomRoomTileDefinition): { tile: CustomRoomTileDefinition; reads: () => number } {
  let reads = 0;
  const { pixels, ...rest } = tile;
  const counted = {
    ...rest,
    get pixels() {
      reads += 1;
      return pixels;
    },
  } as CustomRoomTileDefinition;
  return { tile: counted, reads: () => reads };
}

describe('custom room tile lookups', () => {
  it('normalizes a room tile list once across repeated lookups', () => {
    const counted = Array.from({ length: CUSTOM_ROOM_TILE_MAX_TILES }, (_, index) => countNormalizations(makeTile(index)));
    const room = { customTiles: counted.map((entry) => entry.tile) };

    for (let pass = 0; pass < 100; pass += 1) {
      for (let index = 0; index < CUSTOM_ROOM_TILE_MAX_TILES; index += 1) {
        getCustomRoomTileDefinitionForGid(room, getCustomRoomTileGid(index));
        getCustomRoomTileCollisionProfile(room, getCustomRoomTileGid(index));
      }
    }

    expect(counted.map((entry) => entry.reads())).toEqual(counted.map(() => 1));
  });

  it('returns the same definitions and profiles as a fresh normalization', () => {
    const room = {
      customTiles: [
        makeTile(0),
        makeTile(1, { id: '  padded  ', name: '', pixels: ['#ABCDEF', 'bad', ' #00FF00 '] }),
        { id: '' } as CustomRoomTileDefinition,
        makeTile(0, { name: 'Duplicate id is skipped' }),
        makeTile(2, { collision: 'solid' }),
      ],
    };
    const expected = normalizeCustomRoomTileDefinitions(room.customTiles);

    for (let index = 0; index < CUSTOM_ROOM_TILE_MAX_TILES; index += 1) {
      const gid = getCustomRoomTileGid(index);
      expect(getCustomRoomTileDefinitionForGid(room, gid)).toEqual(expected[index] ?? null);
      expect(getCustomRoomTileCollisionProfile(room, gid)).toBe(
        expected[index]
          ? expected[index].collision === 'solid' ? TERRAIN_COLLISION_PROFILES.full : TERRAIN_COLLISION_PROFILES.none
          : null,
      );
    }
    expect(getCustomRoomTileDefinitionForGid(room, 1)).toBeNull();
    expect(getCustomRoomTileDefinitionForGid({ customTiles: null }, getCustomRoomTileGid(0))).toBeNull();
    expect(getCustomRoomTileDefinitionForGid({}, getCustomRoomTileGid(0))).toBeNull();
  });

  it('sees editor tile changes, which replace the array', () => {
    const before = [makeTile(0, { collision: 'none' })];
    const room: { customTiles: CustomRoomTileDefinition[] } = { customTiles: before };
    expect(getCustomRoomTileCollisionProfile(room, getCustomRoomTileGid(0))).toBe(TERRAIN_COLLISION_PROFILES.none);

    // EditorRuntime.useCustomSpriteAsTile swaps in a new array with the updated tile.
    room.customTiles = [makeTile(0, { collision: 'solid', updatedAt: '2026-10-03T00:00:00.000Z' })];
    expect(getCustomRoomTileCollisionProfile(room, getCustomRoomTileGid(0))).toBe(TERRAIN_COLLISION_PROFILES.full);

    room.customTiles = [...room.customTiles, makeTile(1)];
    expect(getCustomRoomTileDefinitionForGid(room, getCustomRoomTileGid(1))?.id).toBe('tile_1');

    // The original array keeps its own cached answer.
    expect(getCustomRoomTileCollisionProfile({ customTiles: before }, getCustomRoomTileGid(0))).toBe(
      TERRAIN_COLLISION_PROFILES.none,
    );
  });

  it('re-normalizes when the same array grows or shrinks in place', () => {
    const tiles = [makeTile(0)];
    const room = { customTiles: tiles };
    expect(getCustomRoomTileDefinitionForGid(room, getCustomRoomTileGid(1))).toBeNull();

    tiles.push(makeTile(1));
    expect(getCustomRoomTileDefinitionForGid(room, getCustomRoomTileGid(1))?.id).toBe('tile_1');

    tiles.pop();
    expect(getCustomRoomTileDefinitionForGid(room, getCustomRoomTileGid(1))).toBeNull();
  });
});
