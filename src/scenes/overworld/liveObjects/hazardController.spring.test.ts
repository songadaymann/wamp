import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { getObjectById } from '../../../config';
import { LiveObjectHazardController } from './hazardController';
import { getGravityVector, getGravityRightVector, type PlayerGravityDirection } from '../specialTiles';
import type { LoadedRoomObject } from './model';

function harness(id: string, direction: PlayerGravityDirection = 'down', facing: -1 | 1 = 1) {
  let now = 0, touch: () => void = () => {};
  const body = { left: 0, right: 10, top: 0, bottom: 16, center: { x: 5, y: 8 }, velocity: { x: 0, y: 50 },
    setVelocity(x: number, y: number) { this.velocity = { x, y }; } };
  const pad = { left: 0, right: 16, top: 16, bottom: 24, center: { x: 8, y: 20 } };
  const object = { config: getObjectById(id), sprite: { x: 8, y: 20, body: pad },
    interactions: [], runtime: { cooldownUntil: 0, activatedUntil: 0, directionX: facing } } as unknown as LoadedRoomObject;
  const options = { scene: { physics: { add: { overlap: vi.fn((_a, _b, callback) => { touch = callback; return {}; }) } } },
    settings: { bouncePadVelocity: -392, bouncePadCooldownMs: 350, bouncePadActiveMs: 160 },
    getCurrentTime: () => now, getPlayerBody: () => body, getPlayerGravityDirection: () => direction,
    launchPlayerFromSpring: vi.fn((x, y) => body.setVelocity(x, y)),
    grantExternalLaunchGrace: vi.fn(), playBounceFx: vi.fn(), showTransientStatus: vi.fn() };
  const controller = new LiveObjectHazardController(options as never);
  controller.addBouncePadInteraction({ room: { coordinates: { x: 1, y: 2 } } } as never, object, {} as never);
  return { body, pad, object, options, touch: () => touch(), setNow: (value: number) => { now = value; } };
}

describe('spring contact and launch', () => {
  it.each(['down', 'up', 'left', 'right'] as const)('existing bounce pad launches against %s gravity without changing tangent speed', direction => {
    const h = harness('bounce_pad', direction), g = getGravityVector(direction), right = getGravityRightVector(direction);
    h.body.velocity = { x: g.x * 50 + right.x * 17, y: g.y * 50 + right.y * 17 };
    if (direction === 'up') h.body.top = 24;
    if (direction === 'left') h.body.left = 16;
    if (direction === 'right') h.body.right = 0;
    h.touch(); expect(h.body.velocity.x).toBeCloseTo(g.x * -392 + right.x * 17);
    expect(h.body.velocity.y).toBeCloseTo(g.y * -392 + right.y * 17);
    expect(h.options.grantExternalLaunchGrace).toHaveBeenCalledWith(180);
    h.body.velocity = { x: g.x * 50, y: g.y * 50 }; h.touch();
    expect(h.options.playBounceFx).toHaveBeenCalledOnce();
    h.setNow(350); h.touch(); expect(h.options.playBounceFx).toHaveBeenCalledTimes(2);
  });

  it.each(['spring_side', 'spring_diagonal'])('launches %s in both saved facing directions with protected momentum', id => {
    for (const facing of [-1, 1] as const) {
      const h = harness(id, 'down', facing);
      h.body.center = { x: h.pad.center.x + facing * 5, y: h.pad.center.y - 4 };
      h.body.velocity = { x: -facing * 100, y: 0 };
      h.touch();
      expect(h.body.velocity.x).toBeCloseTo(facing * (id === 'spring_side' ? 392 : 392 / Math.SQRT2));
      expect(h.body.velocity.y).toBeCloseTo(id === 'spring_side' ? 0 : -392 / Math.SQRT2);
      expect(h.options.launchPlayerFromSpring).toHaveBeenCalledWith(h.body.velocity.x, h.body.velocity.y, 180);
      h.touch(); expect(h.options.launchPlayerFromSpring).toHaveBeenCalledOnce();
    }
  });

  it('ignores the back of a directional spring and actors already departing its tip', () => {
    const h = harness('spring_side'); h.body.center.x = h.pad.center.x - 12; h.touch();
    h.body.center.x = h.pad.center.x + 4; h.body.velocity.x = 100; h.touch();
    expect(h.options.launchPlayerFromSpring).not.toHaveBeenCalled();
  });
});
