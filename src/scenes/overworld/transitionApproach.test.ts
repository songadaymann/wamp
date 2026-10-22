import { describe, expect, it } from 'vitest';

import {
  SEAM_SUPPORT_TOLERANCE_PX,
  TransitionFloorMemory,
  canRiseToSeam,
  getBodyGravityY,
  isBodySupportedAwayFromVerticalSeam,
  resolveVerticalApproach,
  type TransitionApproachBody,
} from './transitionApproach';

const ROOM_BOTTOM = 352;
const JUMP_VELOCITY = -280;
const GRAVITY = 700;

function body(overrides: Partial<TransitionApproachBody> = {}): TransitionApproachBody {
  return {
    velocity: { x: 150, y: 0 },
    bottom: ROOM_BOTTOM - 16,
    top: ROOM_BOTTOM - 40,
    allowGravity: true,
    gravity: { y: 0 },
    world: { gravity: { y: GRAVITY } },
    blocked: { down: true },
    ...overrides,
  };
}

describe('vertical seam support', () => {
  it('treats a bottom-row floor as support short of the seam', () => {
    expect(isBodySupportedAwayFromVerticalSeam(body(), 1, ROOM_BOTTOM)).toBe(true);
  });

  it('keeps the seam reachable while the body rests on its edge wall or clamp', () => {
    expect(SEAM_SUPPORT_TOLERANCE_PX).toBe(13);
    expect(isBodySupportedAwayFromVerticalSeam(body({ bottom: ROOM_BOTTOM - 12 }), 1, ROOM_BOTTOM)).toBe(false);
    expect(isBodySupportedAwayFromVerticalSeam(body({ bottom: ROOM_BOTTOM - 1 }), 1, ROOM_BOTTOM)).toBe(false);
  });

  it('ignores an unsupported body or one still moving toward the seam', () => {
    expect(isBodySupportedAwayFromVerticalSeam(body({ blocked: {} }), 1, ROOM_BOTTOM)).toBe(false);
    expect(isBodySupportedAwayFromVerticalSeam(
      body({ velocity: { x: 0, y: 60 } }),
      1,
      ROOM_BOTTOM,
    )).toBe(false);
    expect(isBodySupportedAwayFromVerticalSeam(null, 1, ROOM_BOTTOM)).toBe(false);
  });

  it('applies the same rule to a ceiling below the top seam', () => {
    const ceiling = body({ blocked: { up: true }, top: 40 });
    expect(isBodySupportedAwayFromVerticalSeam(ceiling, -1, 0)).toBe(true);
    expect(isBodySupportedAwayFromVerticalSeam(body({ blocked: { up: true }, top: 12 }), -1, 0)).toBe(false);
  });
});

describe('ballistic rise to the top seam', () => {
  it('lets a normal jump reach a seam within its 56 px peak only', () => {
    expect(canRiseToSeam(56, JUMP_VELOCITY, GRAVITY)).toBe(true);
    expect(canRiseToSeam(57, JUMP_VELOCITY, GRAVITY)).toBe(false);
  });

  it('lets springs clear tall rooms and ladders climb without gravity', () => {
    expect(canRiseToSeam(300, -700, GRAVITY)).toBe(true);
    expect(canRiseToSeam(300, -90, 0)).toBe(true);
    expect(canRiseToSeam(300, 0, 0)).toBe(false);
  });

  it('reads Arcade gravity only while the body uses it', () => {
    expect(getBodyGravityY(body())).toBe(GRAVITY);
    expect(getBodyGravityY(body({ allowGravity: false }))).toBe(0);
  });
});

describe('transition floor memory', () => {
  const room = { x: 0, y: 0 };

  it('does not treat a hop back onto the same floor as a fall below it', () => {
    const memory = new TransitionFloorMemory();
    memory.observe(room, body(), 336, ROOM_BOTTOM);
    memory.observe(room, body({ blocked: {}, velocity: { x: 150, y: 120 } }), 300, ROOM_BOTTOM);

    expect(memory.isBelowRememberedFloor(300)).toBe(false);
    expect(memory.isBelowRememberedFloor(336)).toBe(false);
    expect(memory.isBelowRememberedFloor(338)).toBe(true);
  });

  it('forgets the floor after a room change, a placement jump, or a reset', () => {
    const memory = new TransitionFloorMemory();
    memory.observe(room, body({ bottom: 200 }), 200, ROOM_BOTTOM);
    memory.observe({ x: 1, y: 0 }, body({ blocked: {} }), 190, ROOM_BOTTOM);
    expect(memory.isBelowRememberedFloor(150)).toBe(true);

    memory.observe(room, body({ bottom: 200 }), 200, ROOM_BOTTOM);
    memory.observe(room, body({ blocked: {} }), 100, ROOM_BOTTOM);
    expect(memory.isBelowRememberedFloor(150)).toBe(true);

    memory.observe(room, body({ bottom: 200 }), 200, ROOM_BOTTOM);
    memory.reset();
    expect(memory.isBelowRememberedFloor(150)).toBe(true);
  });

  it('does not remember the seam edge wall as a floor', () => {
    const memory = new TransitionFloorMemory();
    memory.observe(room, body({ bottom: ROOM_BOTTOM - 12 }), ROOM_BOTTOM - 12, ROOM_BOTTOM);

    expect(memory.isBelowRememberedFloor(ROOM_BOTTOM - 20)).toBe(true);
  });
});

describe('vertical approach', () => {
  function resolve(
    approachBody: TransitionApproachBody,
    playerY: number,
    memory = new TransitionFloorMemory(),
    environment: { gravityDirection: 'down' | 'up'; inWater: boolean } | null = null,
  ) {
    return resolveVerticalApproach({
      body: approachBody,
      environment,
      playerY,
      feetY: approachBody.bottom ?? playerY,
      roomTop: 0,
      roomBottom: ROOM_BOTTOM,
      floorMemory: memory,
    });
  }

  it('keeps the plain direction of travel in water and gravity zones', () => {
    const swimKick = body({ blocked: {}, velocity: { x: 0, y: -168 }, bottom: 212 });
    expect(resolve(swimKick, 200)).toBe(0);
    expect(resolve(swimKick, 200, undefined, { gravityDirection: 'down', inWater: true })).toBe(-1);
    expect(resolve(swimKick, 200, undefined, { gravityDirection: 'up', inWater: false })).toBe(-1);
  });

  it('predicts a fall below only past the remembered floor', () => {
    const memory = new TransitionFloorMemory();
    memory.observe({ x: 0, y: 0 }, body({ bottom: 200 }), 200, ROOM_BOTTOM);
    const falling = (feet: number) => body({ blocked: {}, velocity: { x: 150, y: 200 }, bottom: feet });

    expect(resolve(falling(190), 178, memory)).toBe(0);
    expect(resolve(falling(205), 193, memory)).toBe(1);
  });
});
