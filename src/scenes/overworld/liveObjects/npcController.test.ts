import { describe, expect, it, vi } from 'vitest';
import { LiveObjectNpcController, NPC_STEP_JUMP_VELOCITY_X } from './npcController';

const { directionRolls } = vi.hoisted(() => ({ directionRolls: [] as number[] }));

vi.mock('phaser', () => ({
  default: {
    Math: {
      Between: (min: number, max?: number) => {
        if (min === 0 && max === 1 && directionRolls.length > 0) {
          return directionRolls.shift() ?? min;
        }
        return min;
      },
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
      velocity: { x: 0, y: 0 },
      blocked: { left: false, right: true, down: true },
      touching: { left: false, right: false, down: true },
      setVelocity: vi.fn(),
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
    expect(body.setVelocity).toHaveBeenCalledWith(NPC_STEP_JUMP_VELOCITY_X, -210);
    expect(liveObject.runtime.directionX).toBe(1);
  });

  it('keeps a one-tile jump moving forward while the NPC is still against the step', () => {
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
    const blocked = { left: false, right: true, down: true as boolean };
    const touching = { left: false, right: false, down: true as boolean };
    const body = {
      right: 48,
      left: 24,
      bottom: 64,
      velocity: { x: 0, y: 0 },
      blocked,
      touching,
      setVelocity: vi.fn(),
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
    body.velocity.y = -180;
    blocked.down = false;
    touching.down = false;
    body.setVelocityX.mockClear();

    expect(handleBlockedPath({} as never, liveObject, body, true, 'patrol')).toBe(false);
    expect(body.setVelocityX).toHaveBeenCalledWith(NPC_STEP_JUMP_VELOCITY_X);
    expect(liveObject.runtime.directionX).toBe(1);
  });
});

describe('NPC wander', () => {
  it('starts walking in the placed facing direction instead of turning around at the spawn point', () => {
    const applyDirectionalFacing = vi.fn();
    const controller = new LiveObjectNpcController({
      scene: { anims: { exists: () => false } },
      getCurrentTime: () => 1_000,
      getPlayerBody: () => null,
      resetDynamicObjectIfOutOfBounds: () => false,
      getRoomWorldBounds: () => ({ left: 0, right: 640, top: 0, bottom: 352 }),
      applyDirectionalFacing,
      hasSolidTerrainAtWorldPoint: () => false,
      playBounceFx: () => {},
      bouncePadVelocity: -320,
      bouncePadCooldownMs: 180,
    } as never);
    const liveObject = {
      runtime: {
        directionX: -1,
        npcCanJumpFall: false,
        npcWalking: false,
        nextActionAt: 0,
        npcBounceCooldownUntil: 0,
        npcQuicksandUntil: 0,
        specialTileOnIce: false,
        specialTileOnSticky: false,
        specialTileWindX: 0,
      },
      sprite: { anims: { currentAnim: null } },
      config: { facingDirection: 'right' },
    };
    const body = {
      left: 20,
      right: 44,
      top: 40,
      bottom: 56,
      velocity: { x: 0, y: 0 },
      blocked: { left: false, right: false, down: true },
      touching: { left: false, right: false, down: true },
      setVelocityX: vi.fn(),
    };
    const updateWander = (
      controller as unknown as {
        updateWander(
          room: object,
          candidate: typeof liveObject,
          candidateBody: typeof body,
          terrainActor: boolean,
          delta: number,
        ): void;
      }
    ).updateWander.bind(controller);

    updateWander({}, liveObject, body, true, 16);

    expect(liveObject.runtime.directionX).toBe(-1);
    expect(liveObject.runtime.npcWalking).toBe(true);
    expect(body.setVelocityX).toHaveBeenCalledWith(-70);
    expect(applyDirectionalFacing).toHaveBeenCalledWith(
      liveObject.sprite,
      liveObject.config,
      -1,
    );
  });

  it('picks left or right after a wander stop instead of always turning around', () => {
    let now = 5_000;
    const controller = new LiveObjectNpcController({
      scene: { anims: { exists: () => false } },
      getCurrentTime: () => now,
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
        nextActionAt: now,
        npcBounceCooldownUntil: 0,
        npcQuicksandUntil: 0,
        specialTileOnIce: false,
        specialTileOnSticky: false,
        specialTileWindX: 0,
      },
      sprite: { anims: { currentAnim: null } },
      config: { facingDirection: 'right' },
    };
    const body = {
      left: 80,
      right: 104,
      top: 80,
      bottom: 96,
      velocity: { x: 70, y: 0 },
      blocked: { left: false, right: false, down: true },
      touching: { left: false, right: false, down: true },
      setVelocityX: vi.fn(),
    };
    const updateWander = (
      controller as unknown as {
        updateWander(
          room: object,
          candidate: typeof liveObject,
          candidateBody: typeof body,
          terrainActor: boolean,
          delta: number,
        ): void;
      }
    ).updateWander.bind(controller);

    updateWander({}, liveObject, body, true, 16);
    expect(liveObject.runtime.npcWalking).toBe(false);
    expect(liveObject.runtime.directionX).toBe(1);

    directionRolls.push(1);
    now = liveObject.runtime.nextActionAt;
    updateWander({}, liveObject, body, true, 16);
    expect(liveObject.runtime.npcWalking).toBe(true);
    expect(liveObject.runtime.directionX).toBe(1);
    expect(body.setVelocityX).toHaveBeenCalledWith(70);

    liveObject.runtime.nextActionAt = now;
    updateWander({}, liveObject, body, true, 16);
    expect(liveObject.runtime.directionX).toBe(1);
    directionRolls.push(0);
    now = liveObject.runtime.nextActionAt;
    body.setVelocityX.mockClear();
    updateWander({}, liveObject, body, true, 16);
    expect(liveObject.runtime.directionX).toBe(-1);
    expect(body.setVelocityX).toHaveBeenCalledWith(-70);
  });

  it('still turns away from a wall, then chooses either direction when that stop ends', () => {
    let now = 10_000;
    const applyDirectionalFacing = vi.fn();
    const controller = new LiveObjectNpcController({
      scene: { anims: { exists: () => false } },
      getCurrentTime: () => now,
      getPlayerBody: () => null,
      resetDynamicObjectIfOutOfBounds: () => false,
      applyDirectionalFacing,
      hasSolidTerrainAtWorldPoint: () => true,
      playBounceFx: () => {},
      bouncePadVelocity: -320,
      bouncePadCooldownMs: 180,
    } as never);

    const runWall = (startDirection: 1 | -1) => {
      const blockedSide = startDirection > 0 ? 'right' : 'left';
      const liveObject = {
        runtime: {
          directionX: startDirection,
          npcCanJumpFall: true,
          npcWalking: true,
          nextActionAt: now + 20_000,
          npcBounceCooldownUntil: 0,
          npcQuicksandUntil: 0,
          specialTileOnIce: false,
          specialTileOnSticky: false,
          specialTileWindX: 0,
        },
        sprite: { anims: { currentAnim: null } },
        config: { facingDirection: 'right' },
      };
      const blocked = { left: false, right: false, down: true as boolean };
      const touching = { left: false, right: false, down: true as boolean };
      blocked[blockedSide] = true;
      touching[blockedSide] = true;
      const body = {
        left: 80,
        right: 104,
        top: 80,
        bottom: 96,
        velocity: { x: startDirection * 70, y: 0 },
        blocked,
        touching,
        setVelocityX: vi.fn(),
        setVelocity: vi.fn(),
      };
      const updateWander = (
        controller as unknown as {
          updateWander(
            room: object,
            candidate: typeof liveObject,
            candidateBody: typeof body,
            terrainActor: boolean,
            delta: number,
          ): void;
        }
      ).updateWander.bind(controller);

      updateWander({}, liveObject, body, true, 16);
      expect(liveObject.runtime.directionX).toBe(-startDirection);
      expect(liveObject.runtime.npcWalking).toBe(false);
      expect(applyDirectionalFacing).toHaveBeenCalledWith(
        liveObject.sprite,
        liveObject.config,
        -startDirection,
      );

      const resumeDirection = startDirection > 0 ? 1 : 0;
      directionRolls.push(resumeDirection);
      now = liveObject.runtime.nextActionAt;
      blocked[blockedSide] = false;
      touching[blockedSide] = false;
      body.setVelocityX.mockClear();
      updateWander({}, liveObject, body, true, 16);

      const expectedDirection = resumeDirection === 0 ? -1 : 1;
      expect(liveObject.runtime.directionX).toBe(expectedDirection);
      expect(liveObject.runtime.npcWalking).toBe(true);
      expect(body.setVelocityX).toHaveBeenCalledWith(expectedDirection * 70);
    };

    runWall(1);
    now = 10_000;
    applyDirectionalFacing.mockClear();
    runWall(-1);
  });

});

describe('NPC player push', () => {
  it('pushes a free NPC and refuses to push one that is already against a tile', () => {
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
      runtime: { npcMode: 'wander', npcPushable: false },
    };
    const npcBody = {
      left: 40,
      right: 64,
      top: 40,
      bottom: 56,
      velocity: { x: 70, y: 0 },
      blocked: { left: false, right: false },
      touching: { left: false, right: false },
      setVelocityX: vi.fn(),
    };
    const playerBody = {
      left: 20,
      right: 42,
      top: 40,
      bottom: 56,
      velocity: { x: 150, y: 0 },
    };

    controller.applyPlayerPush(liveObject as never, npcBody as never, playerBody as never);
    expect(npcBody.setVelocityX).toHaveBeenCalledWith(150);

    npcBody.setVelocityX.mockClear();
    npcBody.blocked.right = true;
    controller.applyPlayerPush(liveObject as never, npcBody as never, playerBody as never);
    expect(npcBody.setVelocityX).not.toHaveBeenCalled();
  });
});

describe('NPC room containment', () => {
  function createController() {
    return new LiveObjectNpcController({
      scene: { anims: { exists: () => false } },
      getCurrentTime: () => 0,
      getPlayerBody: () => null,
      resetDynamicObjectIfOutOfBounds: () => false,
      getRoomWorldBounds: () => ({
        left: 0,
        right: 640,
        top: 0,
        bottom: 352,
      }),
      applyDirectionalFacing: () => {},
      hasSolidTerrainAtWorldPoint: () => false,
      playBounceFx: () => {},
      bouncePadVelocity: -320,
      bouncePadCooldownMs: 180,
    } as never);
  }

  it('clamps and reverses a patrol NPC at the owning room edge', () => {
    const controller = createController();
    const sprite = {
      x: 650,
      y: 104,
      setPosition: vi.fn(),
    };
    const liveObject = {
      runtime: {
        directionX: 1,
      },
      sprite,
    };
    const body = {
      left: 638,
      right: 662,
      top: 96,
      bottom: 112,
      velocity: {
        x: 70,
        y: 20,
      },
      reset: vi.fn(),
      setAllowGravity: vi.fn(),
      setVelocity: vi.fn(),
    };
    const containNpcInRoom = (
      controller as unknown as {
        containNpcInRoom(
          room: object,
          candidate: typeof liveObject,
          candidateBody: typeof body,
          mode: 'patrol',
        ): boolean;
      }
    ).containNpcInRoom.bind(controller);

    expect(containNpcInRoom({} as never, liveObject, body, 'patrol')).toBe(true);
    expect(body.reset).toHaveBeenCalledWith(627, 104);
    expect(sprite.setPosition).toHaveBeenCalledWith(627, 104);
    expect(body.setAllowGravity).not.toHaveBeenCalled();
    expect(body.setVelocity).toHaveBeenCalledWith(0, 20);
    expect(liveObject.runtime.directionX).toBe(-1);
  });

  it('stops a falling NPC at the bottom without cancelling horizontal motion', () => {
    const controller = createController();
    const sprite = {
      x: 132,
      y: 352,
      setPosition: vi.fn(),
    };
    const liveObject = {
      runtime: {
        directionX: 1,
      },
      sprite,
    };
    const body = {
      left: 120,
      right: 144,
      top: 344,
      bottom: 360,
      velocity: {
        x: 40,
        y: 180,
      },
      reset: vi.fn(),
      setAllowGravity: vi.fn(),
      setVelocity: vi.fn(),
    };
    const containNpcInRoom = (
      controller as unknown as {
        containNpcInRoom(
          room: object,
          candidate: typeof liveObject,
          candidateBody: typeof body,
          mode: 'follow',
        ): boolean;
      }
    ).containNpcInRoom.bind(controller);

    expect(containNpcInRoom({} as never, liveObject, body, 'follow')).toBe(true);
    expect(body.reset).toHaveBeenCalledWith(132, 343);
    expect(sprite.setPosition).toHaveBeenCalledWith(132, 343);
    expect(body.setAllowGravity).toHaveBeenCalledWith(false);
    expect(body.setVelocity).toHaveBeenCalledWith(40, 0);
    expect(liveObject.runtime.directionX).toBe(1);
  });
});
