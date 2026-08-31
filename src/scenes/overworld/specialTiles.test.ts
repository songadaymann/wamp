import { describe, expect, it, vi } from 'vitest';
import { SPECIAL_TILE_ONE_WAY_PLATFORM_GID } from '../../config';

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

describe('OverworldSpecialTilesController one-way collision', () => {
  it('lands from above and passes through Special A2 from below', () => {
    const playerBody = {
      prev: { y: 0 },
      y: 2,
      height: 14,
      top: 2,
      bottom: 16,
      velocity: { x: 0, y: 20 },
    };
    const host = {
      getCurrentTime: vi.fn(() => 0),
      getPlayerBody: vi.fn(() => playerBody),
    };
    const controller = new OverworldSpecialTilesController({} as never, host as never);
    const projectedBackgroundSurface = {
      index: SPECIAL_TILE_ONE_WAY_PLATFORM_GID,
      pixelX: 0,
      pixelY: 16,
    };

    expect(controller.shouldCollidePlayerWithTerrainTile(projectedBackgroundSurface as never))
      .toBe(true);

    playerBody.prev.y = 18;
    playerBody.y = 16;
    playerBody.top = 16;
    playerBody.bottom = 30;
    playerBody.velocity.y = -120;
    expect(controller.shouldCollidePlayerWithTerrainTile(projectedBackgroundSurface as never))
      .toBe(false);
  });
});
