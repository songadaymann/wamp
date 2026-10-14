import { SpecialTileBodySamples } from './liveObjects/specialTileSamples';
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
      Between: (min: number) => min,
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    },
    Animations: { Events: { ANIMATION_COMPLETE: 'animationcomplete' } },
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}));

import { getObjectById, ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import {
  OverworldLiveObjectController,
  type LoadedRoomObject,
} from './liveObjects';
import { CANNON_BULLET_CONFIG } from './liveObjects/projectiles';

function createBody(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    center: { x: left + width * 0.5, y: top + height * 0.5 },
    enable: true,
  };
}

function createLiveObject(
  objectId: string,
  body: ReturnType<typeof createBody>,
  x = body.center.x,
  y = body.center.y,
): LoadedRoomObject {
  const config = getObjectById(objectId);
  if (!config) {
    throw new Error(`Missing ${objectId} test config.`);
  }

  return {
    key: objectId,
    placedInstanceId: null,
    config,
    layer: 'terrain',
    runtime: { npcPlayerCollision: true },
    sprite: { active: true, body, x, y },
  } as unknown as LoadedRoomObject;
}

function createLoadedRoom(
  id: string,
  coordinates: { x: number; y: number },
  liveObjects: LoadedRoomObject[],
  placedObjects: Array<{ id: string; x: number; y: number; instanceId: string }> = [],
) {
  return {
    room: { id, coordinates, placedObjects },
    liveObjects,
  };
}

function createController(
  playerBody: ReturnType<typeof createBody>,
  loadedRooms: ReturnType<typeof createLoadedRoom>[] = [],
  scene: object = {},
) {
  return new OverworldLiveObjectController({
    scene,
    settings: {
      bouncePadVelocity: -320,
      bouncePadCooldownMs: 180,
    },
    getLoadedFullRooms: () => loadedRooms,
    getPlayerBody: () => playerBody,
    getPlacedObjectRuntimeKey: (
      _roomId: string,
      placedObject: { instanceId: string },
    ) => placedObject.instanceId,
    isCollectedObjectKey: () => false,
    getRoomOrigin: (coordinates: { x: number; y: number }) => ({
      x: coordinates.x * ROOM_PX_WIDTH,
      y: coordinates.y * ROOM_PX_HEIGHT,
    }),
    getCurrentTime: () => 0,
  } as never);
}

type RemovalHarness = {
  removeLiveObjectByKey: (roomId: string, objectKey: string) => boolean;
  syncWorldObjectColliders: (rooms: unknown) => void;
};

function removable(objectId: string, key: string): LoadedRoomObject {
  const liveObject = createLiveObject(objectId === CANNON_BULLET_CONFIG.id ? 'crate' : objectId, createBody(100, 100, 16, 16));
  return Object.assign(liveObject, {
    key,
    config: objectId === CANNON_BULLET_CONFIG.id ? CANNON_BULLET_CONFIG : liveObject.config,
    containedObjectId: null,
    interactions: [],
    worldColliders: [],
    helpers: [],
    sprite: Object.assign(liveObject.sprite, { active: false, destroy: vi.fn() }),
  });
}

describe('removing a live object (F008)', () => {
  it('rebuilds every collision link only when the removed object was a solid others collided with', () => {
    const bullet = removable('cannon_bullet', 'cannon:bullet:1');
    const crate = removable('crate', 'crate-1');
    const room = createLoadedRoom('1,-1', { x: 1, y: -1 }, [bullet, crate]);
    const controller = createController(createBody(0, 0, 16, 24), [room]) as unknown as RemovalHarness;
    const rebuild = vi.spyOn(controller, 'syncWorldObjectColliders').mockImplementation(() => undefined);

    expect(controller.removeLiveObjectByKey('1,-1', 'cannon:bullet:1')).toBe(true);
    expect(rebuild).not.toHaveBeenCalled();
    expect(bullet.sprite.destroy).toHaveBeenCalledOnce();
    expect(room.liveObjects).toEqual([crate]);

    expect(controller.removeLiveObjectByKey('1,-1', 'crate-1')).toBe(true);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(room.liveObjects).toEqual([]);
  });
});

it('reuses the computed conveyor contact and rechecks it after a behavior changes the body bounds', () => {
  const body = { left: 0, right: 10, top: 0, bottom: 20, center: { x: 5, y: 10 }, velocity: { x: 0, y: 0 }, setVelocityX: vi.fn() };
  const samples = new SpecialTileBodySamples();
  const environment = { gravityDirection: 'down', inWater: false, windX: 0, conveyorX: 1,
    onIce: false, onSticky: false, onBounce: false, onDamage: false };
  samples.record(body as never, environment as never);
  const lookup = vi.fn(() => -1);
  const controller = Object.assign(Object.create(OverworldLiveObjectController.prototype), {
    options: { getConveyorDirectionForBody: lookup }, specialTileBodySamples: samples,
    shouldLiveObjectRideConveyors: () => true, getDynamicBody: () => body, getLiveObjectGravityDirection: () => 'down',
  }) as { applyConveyorToLiveObject: (object: unknown) => void };
  controller.applyConveyorToLiveObject({ sprite: {} });
  expect(lookup).not.toHaveBeenCalled();expect(body.setVelocityX.mock.calls[0][0]).toBeGreaterThan(0);
  body.left++;
  controller.applyConveyorToLiveObject({ sprite: {} });
  expect(lookup).toHaveBeenCalledExactlyOnceWith(body, 'down');expect(body.setVelocityX.mock.calls[1][0]).toBeLessThan(0);
  samples.record(body as never, { ...environment, conveyorX: 0 } as never);
  controller.applyConveyorToLiveObject({ sprite: {} });expect(lookup).toHaveBeenCalledOnce();
});
