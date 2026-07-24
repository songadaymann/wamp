import { describe, expect, it, vi } from 'vitest';
import { LiveObjectNpcController } from './npcController';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Between: (min: number) => min,
    },
  },
}));

describe('NPC path handling', () => {
  it('lets a walking NPC continue over an unsupported edge', () => {
    const controller = new LiveObjectNpcController({
      scene: { anims: { exists: () => false } },
      getCurrentTime: () => 0,
      getPlayerBody: () => null,
      resetDynamicObjectIfOutOfBounds: () => false,
      applyDirectionalFacing: () => {},
      hasSolidTerrainAtWorldPoint: () => false,
      playBounceFx: () => {},
      bouncePadVelocity: -320,
      bouncePadCooldownMs: 180,
    } as never);
    const liveObject = {
      runtime: {
        directionX: 1,
        npcCanJumpFall: false,
        npcWalking: true,
        nextActionAt: 0,
      },
      sprite: {},
      config: {},
    };
    const body = {
      blocked: { left: false, right: false, down: true },
      touching: { left: false, right: false, down: true },
      setVelocityX: vi.fn(),
      setVelocityY: vi.fn(),
    };
    const handleBlockedPath = (
      controller as unknown as {
        handleBlockedPath(
          room: object,
          candidate: typeof liveObject,
          candidateBody: typeof body,
          terrainActor: boolean,
          mode: 'patrol',
        ): boolean;
      }
    ).handleBlockedPath.bind(controller);

    expect(handleBlockedPath({} as never, liveObject, body, true, 'patrol')).toBe(false);
    expect(liveObject.runtime.directionX).toBe(1);
    expect(body.setVelocityY).not.toHaveBeenCalled();
  });

  it('still turns a patrol NPC around at a wall when jumping is disabled', () => {
    const controller = new LiveObjectNpcController({
      scene: { anims: { exists: () => false } },
      getCurrentTime: () => 0,
      getPlayerBody: () => null,
      resetDynamicObjectIfOutOfBounds: () => false,
      applyDirectionalFacing: () => {},
      hasSolidTerrainAtWorldPoint: () => false,
      playBounceFx: () => {},
      bouncePadVelocity: -320,
      bouncePadCooldownMs: 180,
    } as never);
    const liveObject = {
      runtime: {
        directionX: 1,
        npcCanJumpFall: false,
        npcWalking: true,
        nextActionAt: 0,
      },
      sprite: {},
      config: {},
    };
    const body = {
      blocked: { left: false, right: true, down: true },
      touching: { left: false, right: false, down: true },
      setVelocityX: vi.fn(),
      setVelocityY: vi.fn(),
    };
    const handleBlockedPath = (
      controller as unknown as {
        handleBlockedPath(
          room: object,
          candidate: typeof liveObject,
          candidateBody: typeof body,
          terrainActor: boolean,
          mode: 'patrol',
        ): boolean;
      }
    ).handleBlockedPath.bind(controller);

    expect(handleBlockedPath({} as never, liveObject, body, true, 'patrol')).toBe(false);
    expect(liveObject.runtime.directionX).toBe(-1);
    expect(body.setVelocityY).not.toHaveBeenCalled();
  });

  it('uses the checkbox only to jump a one-tile obstacle', () => {
    const hasSolidTerrainAtWorldPoint = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const controller = new LiveObjectNpcController({
      scene: { anims: { exists: () => false } },
      getCurrentTime: () => 0,
      getPlayerBody: () => null,
      resetDynamicObjectIfOutOfBounds: () => false,
      applyDirectionalFacing: () => {},
      hasSolidTerrainAtWorldPoint,
      playBounceFx: () => {},
      bouncePadVelocity: -320,
      bouncePadCooldownMs: 180,
    } as never);
    const liveObject = {
      runtime: {
        directionX: 1,
        npcCanJumpFall: true,
        npcWalking: true,
        nextActionAt: 0,
      },
      sprite: {},
      config: {},
    };
    const body = {
      right: 48,
      left: 24,
      bottom: 64,
      blocked: { left: false, right: true, down: true },
      touching: { left: false, right: false, down: true },
      setVelocityX: vi.fn(),
      setVelocityY: vi.fn(),
    };
    const handleBlockedPath = (
      controller as unknown as {
        handleBlockedPath(
          room: object,
          candidate: typeof liveObject,
          candidateBody: typeof body,
          terrainActor: boolean,
          mode: 'patrol',
        ): boolean;
      }
    ).handleBlockedPath.bind(controller);

    expect(handleBlockedPath({} as never, liveObject, body, true, 'patrol')).toBe(false);
    expect(body.setVelocityY).toHaveBeenCalledWith(-210);
    expect(liveObject.runtime.directionX).toBe(1);
  });
});
