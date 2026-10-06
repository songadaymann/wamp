import { describe, expect, it } from 'vitest';
import { OverworldFollowCameraMotion, type FollowCameraMotionInput } from './followCameraMotion';

const input = (patch: Partial<FollowCameraMotionInput> = {}): FollowCameraMotionInput => ({
  playerY: 300, velocityX: 0, grounded: false, visibleWidth: 640, visibleHeight: 352, physicsSteps: 1, ...patch,
});

describe('platform follow camera motion', () => {
  it('holds full ordinary hops, then follows a higher or lower landing and grounded platforms', () => {
    const motion = new OverworldFollowCameraMotion(); motion.reset(300);
    for (const playerY of [280, 250, 240, 260, 290]) expect(motion.update(input({ playerY })).anchorY).toBe(300);
    expect(motion.update(input({ playerY: 252, grounded: true })).anchorY).toBe(252);
    expect(motion.update(input({ playerY: 260, grounded: true })).anchorY).toBe(260);
    expect(motion.update(input({ playerY: 320, grounded: true })).anchorY).toBe(320);
  });

  it('bounds extended rises and falls by the visible area without chasing ordinary hops', () => {
    const motion = new OverworldFollowCameraMotion(); motion.reset(300);
    expect(motion.update(input({ playerY: 150 })).anchorY).toBe(246);
    expect(motion.update(input({ playerY: 500 })).anchorY).toBe(404);
    motion.reset(300);
    expect(motion.update(input({ playerY: 250, visibleHeight: 160 })).anchorY).toBeCloseTo(294.8);
    expect(motion.update(input({ playerY: 400, visibleHeight: 160 })).anchorY).toBe(344);
  });

  it('eases toward running direction, returns on stop, and bounds narrow-screen lookahead', () => {
    const motion = new OverworldFollowCameraMotion(); motion.reset(300);
    const right = motion.update(input({ velocityX: 200, physicsSteps: 18 })).leadX;
    expect(right).toBeCloseTo(48 * (1 - Math.exp(-1)));
    const stopped = motion.update(input({ velocityX: 20, physicsSteps: 18 })).leadX;
    expect(stopped).toBeCloseTo(right / Math.E);
    expect(motion.update(input({ velocityX: -200, physicsSteps: 36 })).leadX).toBeLessThan(-30);
    motion.reset(300);
    expect(motion.update(input({ velocityX: 200, visibleWidth: 200, physicsSteps: 180 })).leadX).toBeLessThan(24);
  });

  it.each([30, 60, 90, 120, 144, 165, 240])('keeps identical one-second motion at %i render Hz', rate => {
    const motion = new OverworldFollowCameraMotion(); motion.reset(300);
    let consumed = 0;
    for (let frame = 1; frame <= rate; frame++) {
      const total = Math.floor(frame * 60 / rate + 1e-8);
      motion.update(input({ velocityX: 200, physicsSteps: total - consumed })); consumed = total;
    }
    expect(motion.describe().leadX).toBeCloseTo(48 * (1 - Math.exp(-1000 / 300)), 10);
    expect(motion.getAnchorY()).toBe(300);
  });

  it('ignores duplicate renders and resets all motion at lifecycle boundaries', () => {
    const motion = new OverworldFollowCameraMotion(); motion.reset(300);
    const initial = motion.update(input({ velocityX: 200 }));
    expect(motion.update(input({ playerY: 700, grounded: true, velocityX: -200, physicsSteps: 0 }))).toEqual(initial);
    motion.reset(); expect(motion.describe()).toEqual({ anchorY: null, leadX: 0 });
    expect(motion.update(input({ playerY: 100, physicsSteps: 0 }))).toEqual({ anchorY: 100, leadX: 0 });
  });
});
