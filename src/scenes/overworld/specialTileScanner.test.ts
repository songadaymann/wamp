import { describe, expect, it, vi } from 'vitest';
import { LAYER_NAMES, ROOM_HEIGHT, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, ROOM_WIDTH,
  SPECIAL_TILESET_FIRST_GID, SPECIAL_TILE_LOCAL_INDICES, TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG } from '../../config';
import { createDefaultRoomSnapshot, roomIdFromCoordinates, type RoomCoordinates } from '../../persistence/roomModel';
import { getRoomSpecialTileIndex } from './specialTileRooms';
import { OverworldSpecialTileScanner } from './specialTileScanner';

type Kind = keyof typeof SPECIAL_TILE_LOCAL_INDICES;
const gid = (kind: Kind) => SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES[kind];
function room(coordinates: RoomCoordinates = { x: 0, y: 0 }) {
  return { room: { ...createDefaultRoomSnapshot(), id: roomIdFromCoordinates(coordinates), coordinates } };
}
function scanner(rooms: ReturnType<typeof room>[]) {
  return new OverworldSpecialTileScanner({ getLoadedFullRooms: () => rooms as never,
    getLoadedFullRoomById: id => rooms.find(room => room.room.id === id) as never ?? null,
    getRoomCoordinatesForPoint: (x, y) => ({ x: Math.floor(x / ROOM_PX_WIDTH), y: Math.floor(y / ROOM_PX_HEIGHT) }),
    getRoomOrigin: coordinates => ({ x: coordinates.x * ROOM_PX_WIDTH, y: coordinates.y * ROOM_PX_HEIGHT }) });
}
function body(left = 16, top = 16, right = 32, bottom = 32) {
  return { left, top, right, bottom, center: { x: (left + right) / 2, y: (top + bottom) / 2 } } as never;
}

describe('special tile bitmap and retained decoded kinds', () => {
  it('keeps bit 31, the next word and the last cell, including flipped tiles and layer order', () => {
    const { tileData } = createDefaultRoomSnapshot();
    tileData.background[0][31] = (gid('water') | TILE_FLIP_X_FLAG | TILE_FLIP_Y_FLAG) >>> 0;
    tileData.terrain[0][31] = gid('ice');
    tileData.foreground[0][31] = gid('damage');
    tileData.terrain[0][32] = gid('bounce');
    tileData.foreground[ROOM_HEIGHT - 1][ROOM_WIDTH - 1] = gid('windLeft');
    const index = getRoomSpecialTileIndex(tileData);
    expect(index.hasSpecialTiles).toBe(true);
    expect(index.occupiedCells[0] >>> 31).toBe(1);
    expect(index.occupiedCells[1] & 1).toBe(1);
    const last = ROOM_WIDTH * ROOM_HEIGHT - 1;
    expect(index.occupiedCells[last >>> 5] & (1 << (last & 31))).not.toBe(0);
    expect(index.cells[31]).toEqual(LAYER_NAMES.map((layerName, i) => ({ layerName, kind: ['water', 'ice', 'damage'][i] })));
    expect(index.cells[32]).toEqual([{ layerName: 'terrain', kind: 'bounce' }]);
    expect(index.cells[0]).toBeUndefined();
  });

  it('does not read tile rows again after warming the immutable grid', () => {
    const loaded = room();loaded.room.tileData.background[1][1] = gid('water');
    const rows = loaded.room.tileData.background, read = vi.fn(() => rows);
    Object.defineProperty(loaded.room.tileData, 'background', { get: read });
    const scan = scanner([loaded]);const actor = body();const first = scan.overlapping(actor);const match = first[0];
    expect(read).toHaveBeenCalled();read.mockClear();
    for (let i = 0; i < 100; i++) {
      expect(scan.overlapping(actor)).toBe(first);
      expect(first[0]).toBe(match);
      scan.near(actor, 8);scan.contact(actor, 'down');
    }
    expect(read).not.toHaveBeenCalled();
    scan.reset();expect(first).toHaveLength(0);
  });

  it('rebuilds for a replacement tile grid on the same loaded room', () => {
    const loaded = room();const scan = scanner([loaded]);expect(scan.overlapping(body())).toHaveLength(0);
    loaded.room.tileData = createDefaultRoomSnapshot().tileData;
    loaded.room.tileData.background[1][1] = gid('gravityRight');
    expect(scan.overlapping(body()).map(match => match.kind)).toEqual(['gravityRight']);
    loaded.room.tileData = createDefaultRoomSnapshot().tileData;
    expect(scan.overlapping(body())).toHaveLength(0);
  });
});

describe('special tile scan geometry and precedence', () => {
  it.each([
    ['up', 1, 0, 'gravityUp'], ['down', 1, 2, 'conveyorRight'],
    ['left', 0, 1, 'water'], ['right', 2, 1, 'windRight'],
  ] as const)('samples %s gravity contact and removes repeated probe hits', (direction, x, y, kind) => {
    const loaded = room();loaded.room.tileData.background[y][x] = gid(kind);
    loaded.room.tileData.terrain[y][x] = gid('ice');
    const matches = scanner([loaded]).contact(body(), direction);
    expect(matches.map(match => [match.tileX, match.tileY, match.layerName, match.kind])).toEqual([
      [x, y, 'background', kind], [x, y, 'terrain', 'ice'],
    ]);
  });

  it('finds cells across a room seam with negative coordinates in the original room/layer order', () => {
    const left = room({ x: -1, y: -1 }), right = room({ x: 0, y: -1 });
    left.room.tileData.background[1][ROOM_WIDTH - 1] = gid('water');
    left.room.tileData.foreground[1][ROOM_WIDTH - 1] = gid('gravityUp');
    right.room.tileData.terrain[1][0] = gid('windRight');
    const scan = scanner([left, right]);
    expect(scan.overlapping(body(-4, -ROOM_PX_HEIGHT + 16, 4, -ROOM_PX_HEIGHT + 31)).map(match =>
      [match.loadedRoom.room.id, match.tileX, match.layerName, match.kind])).toEqual([
      ['-1,-1', ROOM_WIDTH - 1, 'background', 'water'], ['-1,-1', ROOM_WIDTH - 1, 'foreground', 'gravityUp'],
      ['0,-1', 0, 'terrain', 'windRight'],
    ]);
  });

  it('keeps padding, empty rooms and out-of-room probes separate', () => {
    const loaded = room();loaded.room.tileData.background[1][0] = gid('windLeft');
    const scan = scanner([loaded]);expect(scan.overlapping(body())).toHaveLength(0);
    expect(scan.near(body(), 8).map(match => match.kind)).toEqual(['windLeft']);
    expect(scan.contact(body(-16, -16, 0, 0), 'up')).toHaveLength(0);
    const empty = room();expect(scanner([empty]).near(body(), 8)).toHaveLength(0);
  });
});
