import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    },
  },
}));

import { OverworldSpecialTilesController } from './specialTiles';

function createBody(offset: number) {
  return {
    left: offset,
    right: offset + 10,
    top: 0,
    bottom: 14,
    center: { x: offset + 5, y: 7 },
  };
}

describe('OverworldSpecialTilesController environment reuse', () => {
  it('reuses and fully resets one environment per body', () => {
    const host = {
      getMode: vi.fn(() => 'play'),
      getLoadedFullRooms: vi.fn(() => []),
      getLoadedFullRoomById: vi.fn(() => null),
      getRoomCoordinatesForPoint: vi.fn(() => ({ x: 0, y: 0 })),
      getRoomOrigin: vi.fn(() => ({ x: 0, y: 0 })),
    };
    const controller = new OverworldSpecialTilesController({} as never, host as never);
    const firstBody = createBody(0);
    const secondBody = createBody(20);

    const firstScan = controller.getEnvironmentForBody(firstBody as never, 'up');
    expect(firstScan.gravityDirection).toBe('up');

    const secondScan = controller.getEnvironmentForBody(firstBody as never, 'down');
    expect(secondScan).toBe(firstScan);
    expect(secondScan).toEqual({
      gravityDirection: 'down',
      inWater: false,
      windX: 0,
      conveyorX: 0,
      onIce: false,
      onSticky: false,
      onBounce: false,
      onDamage: false,
    });
    expect(controller.getEnvironmentForBody(secondBody as never, 'down')).not.toBe(firstScan);
  });
});
