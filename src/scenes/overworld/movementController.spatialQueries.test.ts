import { describe, expect, it, vi } from 'vitest';

const { MockRectangle } = vi.hoisted(() => ({
  MockRectangle: class MockRectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}

    get left(): number { return this.x; }
    get right(): number { return this.x + this.width; }
    get top(): number { return this.y; }
    get bottom(): number { return this.y + this.height; }
    get centerX(): number { return this.x + this.width * 0.5; }
    get centerY(): number { return this.y + this.height * 0.5; }
  },
}));

vi.mock('phaser', () => ({
  default: {
    Geom: {
      Rectangle: MockRectangle,
      Intersects: {
        RectangleToRectangle: (
          first: InstanceType<typeof MockRectangle>,
          second: InstanceType<typeof MockRectangle>,
        ) => (
          first.right >= second.left &&
          first.left <= second.right &&
          first.bottom >= second.top &&
          first.top <= second.bottom
        ),
      },
    },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Linear: (start: number, end: number, amount: number) => start + (end - start) * amount,
    },
    Input: {
      Keyboard: {
        JustDown: () => false,
      },
    },
    Animations: { Events: { ANIMATION_COMPLETE: 'animationcomplete' } },
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}));

vi.mock('../../audio/sfx', () => ({
  playSfx: vi.fn(),
  stopSfx: vi.fn(),
}));

import { getObjectById } from '../../config';
import type { LoadedRoomObject } from './liveObjects';
import { OverworldMovementController } from './movementController';

interface FakeBody {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  center: { x: number; y: number };
  enable: boolean;
  velocity: { x: number; y: number };
  drag: { x: number; y: number };
  setAllowGravity(value: boolean): void;
}

function createBody(left: number, top: number, width: number, height: number): FakeBody {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    center: { x: left + width * 0.5, y: top + height * 0.5 },
    enable: true,
    velocity: { x: 0, y: 0 },
    drag: { x: 0, y: 0 },
    setAllowGravity: vi.fn(),
  };
}

function createLiveObject(objectId: string, body: FakeBody): LoadedRoomObject {
  const config = getObjectById(objectId);
  if (!config) {
    throw new Error(`Missing ${objectId} test config.`);
  }

  return {
    config,
    layer: 'terrain',
    runtime: { npcPlayerCollision: true },
    sprite: { active: true, body },
  } as unknown as LoadedRoomObject;
}

function createHarness(playerBody: FakeBody, liveObjects: LoadedRoomObject[]) {
  const getArcadeBodyBounds = vi.fn((body: FakeBody) =>
    new MockRectangle(body.left, body.top, body.width, body.height));
  const queryLiveObjects = vi.fn((
    bounds: InstanceType<typeof MockRectangle>,
    paddingX = 0,
    paddingY = paddingX,
  ) => liveObjects.filter((liveObject) => {
    const body = liveObject.sprite.body as unknown as FakeBody | null;
    return Boolean(
      body &&
      body.right >= bounds.left - paddingX &&
      body.left <= bounds.right + paddingX &&
      body.bottom >= bounds.top - paddingY &&
      body.top <= bounds.bottom + paddingY,
    );
  }));
  const host = {
    state: {
      activeCrateInteractionMode: null,
      activeCrateInteractionFacing: null,
    },
    getPlayerBody: () => playerBody,
    getPushableLiveObjectsInBounds: queryLiveObjects,
    getRuntimeSolidLiveObjectsInBounds: queryLiveObjects,
    getArcadeBodyBounds,
    getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
    getRoomSnapshotForCoordinates: () => null,
  };
  const controller = new OverworldMovementController(host as never, {
    playerWidth: playerBody.width,
    playerStandingHeight: 24,
    crateInteractionMaxGap: 4,
  } as never);
  const spatialController = controller as unknown as {
    findCrateInteraction(
      tangentInput: number,
      crouchHeld: boolean,
      gravityDirection: 'up' | 'down' | 'left' | 'right',
    ): { crateBody: FakeBody; mode: 'push' | 'pull' } | null;
    isSupportedBySolidRuntimeObject(body: FakeBody): boolean;
    canPlayerFitHitbox(height: number, body: FakeBody): boolean;
  };

  return { controller: spatialController, host, getArcadeBodyBounds, queryLiveObjects };
}

describe('OverworldMovementController spatial queries', () => {
  it('keeps a seam-crossing crate eligible while pruning distant pushables', () => {
    const playerBody = createBody(628, 100, 16, 24);
    const seamCrateBody = createBody(645, 104, 16, 16);
    const farCrateBody = createBody(4_000, 100, 16, 16);
    const seamCrate = createLiveObject('crate', seamCrateBody);
    const farCrate = createLiveObject('crate', farCrateBody);
    const { controller, getArcadeBodyBounds, queryLiveObjects } = createHarness(
      playerBody,
      [farCrate, seamCrate],
    );

    const interaction = controller.findCrateInteraction(1, false, 'down');

    expect(interaction).toMatchObject({ crateBody: seamCrateBody, mode: 'push' });
    expect(getArcadeBodyBounds).toHaveBeenCalledTimes(2);
    expect(getArcadeBodyBounds).not.toHaveBeenCalledWith(farCrateBody);
    expect(queryLiveObjects).toHaveBeenCalledWith(
      expect.objectContaining({ x: 628, y: 100, width: 16, height: 24 }),
      10,
      10,
    );
  });

  it('preserves crate interaction under sideways gravity', () => {
    const playerBody = createBody(100, 100, 16, 24);
    const crateBody = createBody(100, 80, 16, 16);
    const { controller } = createHarness(playerBody, [createLiveObject('crate', crateBody)]);

    expect(controller.findCrateInteraction(1, false, 'left')).toMatchObject({
      crateBody,
      mode: 'push',
    });
  });

  it('preserves the extended same-tick pull coupling distance', () => {
    const playerBody = createBody(100, 100, 16, 24);
    const crateBody = createBody(74, 104, 16, 16);
    const { controller, host } = createHarness(playerBody, [createLiveObject('crate', crateBody)]);
    (host.state as { activeCrateInteractionMode: 'push' | 'pull' | null })
      .activeCrateInteractionMode = 'pull';

    expect(controller.findCrateInteraction(1, true, 'down')).toMatchObject({
      crateBody,
      mode: 'pull',
    });
  });

  it('uses solid indexes and coarse bounds for support and standing headroom', () => {
    const supportPlayer = createBody(100, 70, 16, 24);
    const supportBody = createBody(100, 96, 16, 16);
    const farSolidBody = createBody(3_000, 3_000, 16, 16);
    const supportHarness = createHarness(supportPlayer, [
      createLiveObject('brick_box', farSolidBody),
      createLiveObject('brick_box', supportBody),
    ]);

    expect(supportHarness.controller.isSupportedBySolidRuntimeObject(supportPlayer)).toBe(true);
    expect(supportHarness.getArcadeBodyBounds).toHaveBeenCalledTimes(2);
    expect(supportHarness.getArcadeBodyBounds).not.toHaveBeenCalledWith(farSolidBody);
    expect(supportHarness.queryLiveObjects).toHaveBeenCalledWith(
      expect.objectContaining({ x: 100, y: 70, width: 16, height: 24 }),
      1,
      8,
    );

    const crouchedPlayer = createBody(100, 88, 16, 12);
    const headroomBody = createBody(100, 78, 16, 8);
    const headroomHarness = createHarness(crouchedPlayer, [
      createLiveObject('brick_box', farSolidBody),
      createLiveObject('brick_box', headroomBody),
    ]);

    expect(headroomHarness.controller.canPlayerFitHitbox(24, crouchedPlayer)).toBe(false);
    expect(headroomHarness.getArcadeBodyBounds).toHaveBeenCalledTimes(1);
    expect(headroomHarness.getArcadeBodyBounds).not.toHaveBeenCalledWith(farSolidBody);
    expect(headroomHarness.queryLiveObjects).toHaveBeenCalledWith(
      expect.objectContaining({ x: 101, y: 76, width: 14, height: 12 }),
    );
  });
});
