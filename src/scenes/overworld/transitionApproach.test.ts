import { describe, expect, it } from 'vitest';

import {
  SEAM_SUPPORT_TOLERANCE_PX,
  TransitionFloorMemory,
  canClimbToSeam,
  getBodyGravityY,
  getEffectiveGravityY,
  hasOpenDropBelow,
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

describe('climbing toward a seam against gravity', () => {
  it('gives a normal jump one more jump of lead past its 56 px peak', () => {
    const speed = -JUMP_VELOCITY;
    expect(canClimbToSeam(112, speed, GRAVITY)).toBe(true);
    expect(canClimbToSeam(113, speed, GRAVITY)).toBe(false);
  });

  it('predicts any rise into the top quarter of the room', () => {
    expect(canClimbToSeam(88, 40, GRAVITY)).toBe(true);
    expect(canClimbToSeam(89, 40, GRAVITY)).toBe(false);
  });

  it('lets springs clear tall rooms and needs actual movement toward the seam', () => {
    expect(canClimbToSeam(300, 700, GRAVITY)).toBe(true);
    expect(canClimbToSeam(300, 90, 0)).toBe(true);
    expect(canClimbToSeam(50, 0, GRAVITY)).toBe(false);
  });

  it('reads gravity from Arcade, gravity zones and water', () => {
    expect(getBodyGravityY(body())).toBe(GRAVITY);
    expect(getBodyGravityY(body({ allowGravity: false }))).toBe(0);
    expect(getEffectiveGravityY(body(), null)).toBe(GRAVITY);
    expect(getEffectiveGravityY(body({ allowGravity: false }), { gravityDirection: 'up', inWater: false })).toBe(-GRAVITY);
    expect(getEffectiveGravityY(body(), { gravityDirection: 'left', inWater: false })).toBe(0);
    expect(getEffectiveGravityY(body(), { gravityDirection: 'down', inWater: true })).toBeNull();
  });
});

describe('open drop to the room below', () => {
  // Bottom-row floor (y 336-352) with a 32 px hole at x 320-352.
  const isSolidAt = (x: number, y: number) => y >= 336 && !(x >= 320 && x < 352);

  it('is open only when the whole body span is over the hole', () => {
    expect(hasOpenDropBelow(isSolidAt, 328, 344, 330, ROOM_BOTTOM)).toBe(true);
    expect(hasOpenDropBelow(isSolidAt, 312, 328, 330, ROOM_BOTTOM)).toBe(false);
    expect(hasOpenDropBelow(isSolidAt, 200, 216, 300, ROOM_BOTTOM)).toBe(false);
  });

  it('sees a floor under the hole further down the column', () => {
    const ledge = (x: number, y: number) => isSolidAt(x, y) || (y >= 200 && y < 216);
    expect(hasOpenDropBelow(ledge, 328, 344, 150, ROOM_BOTTOM)).toBe(false);
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

  it('keeps the plain direction of travel while swimming and on ladders', () => {
    const swimKick = body({ blocked: {}, velocity: { x: 0, y: -168 }, bottom: 212 });
    expect(resolve(swimKick, 200)).toBe(0);
    expect(resolve(swimKick, 200, undefined, { gravityDirection: 'down', inWater: true })).toBe(-1);
    expect(resolve({ ...swimKick, allowGravity: false }, 200)).toBe(-1);
  });

  it('treats a jump in an up-gravity zone as a climb toward the room below', () => {
    const upZone = { gravityDirection: 'up' as const, inWater: false };
    const zoneJump = (playerY: number) =>
      body({ allowGravity: false, blocked: {}, velocity: { x: 150, y: -JUMP_VELOCITY }, bottom: playerY + 12 });

    expect(resolve(zoneJump(176), 176, undefined, upZone)).toBe(0);
    expect(resolve(zoneJump(300), 300, undefined, upZone)).toBe(1);
    expect(resolve(body({ allowGravity: false, blocked: {}, velocity: { x: 0, y: -200 } }), 176, undefined, upZone))
      .toBe(-1);
  });

  it('predicts a fall below only past the remembered floor', () => {
    const memory = new TransitionFloorMemory();
    memory.observe({ x: 0, y: 0 }, body({ bottom: 200 }), 200, ROOM_BOTTOM);
    const falling = (feet: number) => body({ blocked: {}, velocity: { x: 150, y: 200 }, bottom: feet });

    expect(resolve(falling(190), 178, memory)).toBe(0);
    expect(resolve(falling(205), 193, memory)).toBe(1);
  });

  it('predicts a fall over an open drop before it passes the floor', () => {
    const memory = new TransitionFloorMemory();
    memory.observe({ x: 0, y: 0 }, body({ bottom: 336 }), 336, ROOM_BOTTOM);
    const falling = body({ blocked: {}, velocity: { x: 150, y: 60 }, bottom: 320 });

    expect(resolveVerticalApproach({
      body: falling, environment: null, playerY: 308, feetY: 320, roomTop: 0, roomBottom: ROOM_BOTTOM,
      floorMemory: memory, hasOpenDropBelow: () => true,
    })).toBe(1);
    expect(resolveVerticalApproach({
      body: falling, environment: null, playerY: 308, feetY: 320, roomTop: 0, roomBottom: ROOM_BOTTOM,
      floorMemory: memory, hasOpenDropBelow: () => false,
    })).toBe(0);
  });
});
