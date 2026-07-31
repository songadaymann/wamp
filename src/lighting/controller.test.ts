import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    CANVAS: 1,
    WEBGL: 2,
    BlendModes: { ADD: 1 },
  },
}));

import { RoomLightingController } from './controller';

describe('RoomLightingController keyed emitter structure', () => {
  it('preserves emitter identity while mutating its position between frames', () => {
    const controller = new RoomLightingController({
      scene: {
        game: { renderer: { type: 1 } },
        time: { now: 0 },
      } as never,
      overlayDepth: 35,
    });

    controller.reconcileStructure({
      roomId: '0,0',
      bounds: { x: 0, y: 0, width: 640, height: 352 },
      lighting: { mode: 'playerAuraDark', darkness: 80, radius: 50 },
      emitters: [{
        key: 'player',
        emitter: { sourceType: 'player', x: 10, y: 20 },
      }],
    });
    const original = controller.getEmitterIdentity('player');

    expect(controller.updateEmitterPosition('player', 30, 40)).toBe(true);
    expect(controller.getEmitterIdentity('player')).toBe(original);
    expect(original).toMatchObject({ x: 30, y: 40 });

    controller.reconcileStructure({
      roomId: '0,0',
      bounds: { x: 0, y: 0, width: 640, height: 352 },
      lighting: { mode: 'playerAuraDark', darkness: 80, radius: 50 },
      emitters: [{
        key: 'player',
        emitter: { sourceType: 'player', x: 50, y: 60 },
      }],
    });

    expect(controller.getEmitterIdentity('player')).toBe(original);
    expect(original).toMatchObject({ x: 50, y: 60 });
  });

  it('drops emitter slots removed during structure reconciliation', () => {
    const controller = new RoomLightingController({
      scene: {
        game: { renderer: { type: 1 } },
        time: { now: 0 },
      } as never,
      overlayDepth: 35,
    });
    controller.reconcileStructure({
      roomId: '0,0',
      bounds: { x: 0, y: 0, width: 640, height: 352 },
      lighting: { mode: 'off', darkness: 80, radius: 50 },
      emitters: [{
        key: 'ghost:one',
        emitter: { sourceType: 'ghost', x: 10, y: 20 },
      }],
    });

    controller.reconcileStructure({
      roomId: '0,0',
      bounds: { x: 0, y: 0, width: 640, height: 352 },
      lighting: { mode: 'off', darkness: 80, radius: 50 },
      emitters: [],
    });

    expect(controller.hasEmitter('ghost:one')).toBe(false);
  });
});
