import { expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { SPECIAL_TILESET_FIRST_GID, SPECIAL_TILE_LOCAL_INDICES } from '../../config';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { OverworldSpecialTilesController } from './specialTiles';
import { OverworldSpecialTileScanner } from './specialTileScanner';

it('matches full hazard detection across gravity changes while skipping water and wind scans', () => {
  const snapshot = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });const loaded = { room: snapshot };
  const kinds = ['damage', 'gravityUp', 'gravityLeft', 'gravityRight', 'gravityDown', 'water', 'windLeft', 'ice'] as const;
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
    snapshot.tileData.background[y][x] = SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES[kinds[(x + y) % kinds.length]];
    if ((x + y) % 3 === 0) snapshot.tileData.terrain[y][x] = SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES.damage;
  }
  const water = vi.fn(() => false), near = vi.spyOn(OverworldSpecialTileScanner.prototype, 'near');
  const controller = new OverworldSpecialTilesController({} as never, { getMode: () => 'play',
    isBodyInSwimmableWater: water, getLoadedFullRooms: () => [loaded], getLoadedFullRoomById: (id: string) => id === '0,0' ? loaded : null,
    getRoomCoordinatesForPoint: () => ({ x: 0, y: 0 }), getRoomOrigin: () => ({ x: 0, y: 0 }) } as never);
  try {
    for (let y = 1; y < 5; y++) for (let x = 1; x < 7; x++) {
      const left = x * 16, top = y * 16;
      const body = { left, right: left + 10, top, bottom: top + 20, center: { x: left + 5, y: top + 10 } } as never;
      const expected = controller.getEnvironmentForBody(body, 'down').onDamage;water.mockClear();near.mockClear();
      expect(controller.isBodyOnDamageTile(body)).toBe(expected);expect(water).not.toHaveBeenCalled();expect(near).not.toHaveBeenCalled();
    }
  } finally { near.mockRestore(); }
});
it('ignores hazards outside Play', () => {
  const controller = new OverworldSpecialTilesController({} as never, { getMode: () => 'browse' } as never);
  expect(controller.isBodyOnDamageTile({} as never)).toBe(false);
});
