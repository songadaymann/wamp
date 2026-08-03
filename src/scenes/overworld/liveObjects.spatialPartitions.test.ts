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

function createStaticBody() {
  return {
    enable: true,
    updateFromGameObject: vi.fn(),
    setSize: vi.fn(),
    setOffset: vi.fn(),
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

describe('OverworldLiveObjectController spatial partitions', () => {
  it('keeps a cold coin destination buildable when boot registered an empty animation', () => {
    const data = new Map<string, unknown>();
    const play = vi.fn(() => {
      throw new Error('An empty Phaser animation must never be played.');
    });
    const sprite = {
      active: true,
      visible: true,
      body: null as ReturnType<typeof createStaticBody> | null,
      depth: 0,
      x: 184,
      y: 184,
      texture: { setFilter: vi.fn() },
      play,
      setOrigin: vi.fn(),
      setScale: vi.fn(),
      setDepth: vi.fn(),
      setActive: vi.fn((active: boolean) => { sprite.active = active; }),
      setVisible: vi.fn((visible: boolean) => { sprite.visible = visible; }),
      getData: vi.fn((key: string) => data.get(key)),
      setData: vi.fn((key: string, value: unknown) => {
        if (value === undefined) data.delete(key);
        else data.set(key, value);
      }),
    };
    const emptyAnimation = {
      key: 'coin_gold_anim',
      frames: [],
      manager: null as object | null,
      getTotalFrames: () => 0,
    };
    const animationManager = {
      exists: vi.fn(() => true),
      get: vi.fn(() => emptyAnimation),
    };
    emptyAnimation.manager = animationManager;
    const scene = {
      add: { sprite: vi.fn(() => sprite) },
      anims: animationManager,
      physics: {
        add: {
          existing: vi.fn(() => {
            sprite.body = createStaticBody();
          }),
        },
      },
    };
    const room = createLoadedRoom(
      '1,-7',
      { x: 1, y: -7 },
      [],
      [{
        id: 'coin_gold',
        x: 184,
        y: 184,
        instanceId: 'obj_7d850028-6a28-4889-8d99-0cd72f12b154',
      }],
    );
    const controller = createController(createBody(0, 0, 16, 24), [room], scene);

    expect(controller.createLiveObjectsBatch(room as never, 0, 1, true)).toBe(1);
    expect(room.liveObjects).toHaveLength(1);
    expect(play).not.toHaveBeenCalled();
    expect(sprite).toMatchObject({ active: false, visible: false });
  });

  it('rejects a distant ladder room before reading any ladder body bounds', () => {
    const playerBody = createBody(8, 8, 16, 24);
    const inaccessibleFarBody = { enable: true } as ReturnType<typeof createBody>;
    for (const property of ['left', 'right', 'top', 'bottom', 'width', 'height'] as const) {
      Object.defineProperty(inaccessibleFarBody, property, {
        get: () => {
          throw new Error(`Distant ladder body ${property} should not be read.`);
        },
      });
    }
    const farLadder = createLiveObject('ladder', inaccessibleFarBody, 5_128, 2_832);
    const nearLadder = createLiveObject('ladder', createBody(8, 0, 16, 51), 16, 26);
    const farRoom = createLoadedRoom('far', { x: 8, y: 8 }, [farLadder]);
    const nearRoom = createLoadedRoom('near', { x: 0, y: 0 }, [nearLadder]);
    const controller = createController(playerBody);

    expect(controller.findOverlappingLadder([farRoom, nearRoom] as never)).toBe(nearLadder);
  });

  it('uses ladder bins after the room index is warm', () => {
    const playerBody = createBody(8, 8, 16, 24);
    const nearLadder = createLiveObject('ladder', createBody(8, 0, 16, 51), 16, 26);
    const distantBody = createBody(520, 0, 16, 51);
    const distantLadder = createLiveObject('ladder', distantBody, 528, 26);
    const room = createLoadedRoom('room', { x: 0, y: 0 }, [distantLadder, nearLadder]);
    const controller = createController(playerBody);

    expect(controller.findOverlappingLadder([room] as never)).toBe(nearLadder);
    for (const property of ['left', 'right', 'top', 'bottom', 'width', 'height'] as const) {
      Object.defineProperty(distantBody, property, {
        configurable: true,
        get: () => {
          throw new Error(`Distant same-room ladder body ${property} should not be read.`);
        },
      });
    }

    expect(controller.findOverlappingLadder([room] as never)).toBe(nearLadder);
  });

  it('rejects distant rooms and same-room bins for pushable and runtime-solid queries', () => {
    const playerBody = createBody(628, 100, 16, 24);
    const seamCrate = createLiveObject('crate', createBody(645, 104, 16, 16));
    const sameRoomFarBrick = createLiveObject('brick_box', createBody(1_160, 104, 16, 16));
    const inaccessibleFarBody = { enable: true } as ReturnType<typeof createBody>;
    for (const property of ['left', 'right', 'top', 'bottom', 'width', 'height'] as const) {
      Object.defineProperty(inaccessibleFarBody, property, {
        get: () => {
          throw new Error(`Distant room body ${property} should not be read.`);
        },
      });
    }
    const farCrate = createLiveObject('crate', inaccessibleFarBody, 5_128, 2_832);
    const adjacentRoom = createLoadedRoom(
      'adjacent',
      { x: 1, y: 0 },
      [sameRoomFarBrick, seamCrate],
    );
    const farRoom = createLoadedRoom('far', { x: 8, y: 8 }, [farCrate]);
    const controller = createController(playerBody, [farRoom, adjacentRoom]);
    const bounds = new MockRectangle(628, 100, 16, 24) as never;

    expect(Array.from(controller.getPushableLiveObjectsInBounds(bounds, 10, 10))).toEqual([
      seamCrate,
    ]);
    expect(Array.from(controller.getRuntimeSolidLiveObjectsInBounds(bounds, 10, 10))).toEqual([
      seamCrate,
    ]);
  });

  it('moves dynamic membership across an owning-room seam without a category rescan', () => {
    const playerBody = createBody(0, 0, 16, 24);
    const crateBody = createBody(40, 40, 16, 16);
    const crate = createLiveObject('crate', crateBody);
    const room = createLoadedRoom('room', { x: 0, y: 0 }, [crate]);
    const controller = createController(playerBody, [room]);
    const harness = controller as unknown as {
      refreshLiveObjectSpatialMembership(liveObject: LoadedRoomObject): void;
    };

    expect(Array.from(controller.getPushableLiveObjectsInBounds(
      new MockRectangle(32, 32, 32, 32) as never,
    ))).toEqual([crate]);

    crateBody.left = 660;
    crateBody.right = 676;
    crateBody.center.x = 668;
    harness.refreshLiveObjectSpatialMembership(crate);

    expect(Array.from(controller.getPushableLiveObjectsInBounds(
      new MockRectangle(32, 32, 32, 32) as never,
    ))).toEqual([]);
    expect(Array.from(controller.getPushableLiveObjectsInBounds(
      new MockRectangle(652, 32, 32, 32) as never,
    ))).toEqual([crate]);
  });

  it('reuses categorized pushable and solid lists for an unchanged room', () => {
    const playerBody = createBody(0, 0, 16, 24);
    const crate = createLiveObject('crate', createBody(20, 20, 16, 16));
    const brick = createLiveObject('brick_box', createBody(40, 20, 16, 16));
    const room = createLoadedRoom('room', { x: 0, y: 0 }, [crate, brick]);
    const controller = createController(playerBody, [room]);
    const partitionController = controller as unknown as {
      getRoomLiveObjectPartition(loadedRoom: typeof room): object;
    };

    const firstPushables = Array.from(controller.getLoadedPushableLiveObjects());
    const firstSolids = Array.from(controller.getLoadedRuntimeSolidLiveObjects());
    const firstPartition = partitionController.getRoomLiveObjectPartition(room);
    const secondPushables = Array.from(controller.getLoadedPushableLiveObjects());
    const secondSolids = Array.from(controller.getLoadedRuntimeSolidLiveObjects());
    const secondPartition = partitionController.getRoomLiveObjectPartition(room);

    expect(secondPartition).toBe(firstPartition);
    expect(firstPushables).toEqual([crate]);
    expect(firstSolids).toEqual([crate, brick]);
    expect(secondPushables).toEqual(firstPushables);
    expect(secondSolids).toEqual(firstSolids);
  });

  it('stages finalized object state while dormant, then restores it at atomic activation', () => {
    const playerBody = createBody(0, 0, 16, 24);
    const placedObjects = [
      { id: 'crate', x: 16, y: 16, instanceId: 'crate-a' },
      { id: 'brick_box', x: 48, y: 16, instanceId: 'brick-b' },
    ];
    const room = createLoadedRoom('room', { x: 0, y: 0 }, [], placedObjects);
    const controller = createController(playerBody, [room]);
    const activeSprite = createDormancyGameObject({ active: true, visible: true, bodyEnabled: true });
    const inactiveSprite = createDormancyGameObject({ active: false, visible: false, bodyEnabled: false });
    const activeHelper = createDormancyGameObject({ active: true, visible: true, bodyEnabled: true });
    const inactiveHelper = createDormancyGameObject({ active: false, visible: false, bodyEnabled: false });
    const crate = createBatchLiveObject('crate', activeSprite, [inactiveHelper]);
    const brick = createBatchLiveObject('brick_box', inactiveSprite, [activeHelper]);
    const liveObjectsByKey = new Map([
      ['crate-a', crate],
      ['brick-b', brick],
    ]);
    const applySwitchBlockStates = vi.fn();
    const harness = controller as unknown as {
      createLiveObjectEntry(
        loadedRoom: typeof room,
        options: { key: string },
      ): LoadedRoomObject | null;
      triggerController: { applySwitchBlockStates(loadedRoom: typeof room): void };
      liveObjectPartitionsByRoomId: Map<string, unknown>;
      getRoomLiveObjectPartition(loadedRoom: typeof room): {
        pushables: LoadedRoomObject[];
        runtimeSolids: LoadedRoomObject[];
      };
    };
    harness.createLiveObjectEntry = vi.fn((_loadedRoom, options) => (
      liveObjectsByKey.get(options.key) ?? null
    ));
    harness.triggerController = { applySwitchBlockStates };

    expect(controller.createLiveObjectsBatch(room as never, 0, 1, true)).toBe(1);
    expect(activeSprite.active).toBe(false);
    expect(activeSprite.visible).toBe(false);
    expect(activeSprite.body.enable).toBe(false);
    expect(inactiveHelper.active).toBe(false);
    expect(inactiveHelper.visible).toBe(false);
    expect(inactiveHelper.body.enable).toBe(false);

    expect(controller.createLiveObjectsBatch(room as never, 1, 2, true)).toBe(2);
    for (const gameObject of [activeSprite, inactiveSprite, activeHelper, inactiveHelper]) {
      expect(gameObject.active).toBe(false);
      expect(gameObject.visible).toBe(false);
      expect(gameObject.body.enable).toBe(false);
    }

    const beforeFinalize = harness.getRoomLiveObjectPartition(room);
    expect(beforeFinalize.pushables).toEqual([crate]);
    expect(beforeFinalize.runtimeSolids).toEqual([crate, brick]);
    expect(harness.liveObjectPartitionsByRoomId.has(room.room.id)).toBe(true);

    controller.finalizeLiveObjectCreation(room as never, true);

    for (const gameObject of [activeSprite, inactiveSprite, activeHelper, inactiveHelper]) {
      expect(gameObject.active).toBe(false);
      expect(gameObject.visible).toBe(false);
      expect(gameObject.body.enable).toBe(false);
    }
    expect(applySwitchBlockStates).toHaveBeenCalledOnce();
    expect(applySwitchBlockStates).toHaveBeenCalledWith(room);
    expect(harness.liveObjectPartitionsByRoomId.has(room.room.id)).toBe(false);

    controller.setLoadedRoomLiveObjectsDormant(room as never, false);

    expect(activeSprite.active).toBe(true);
    expect(activeSprite.visible).toBe(true);
    expect(activeSprite.body.enable).toBe(true);
    expect(inactiveSprite.active).toBe(false);
    expect(inactiveSprite.visible).toBe(false);
    expect(inactiveSprite.body.enable).toBe(false);
    expect(activeHelper.active).toBe(true);
    expect(activeHelper.visible).toBe(true);
    expect(activeHelper.body.enable).toBe(true);
    expect(inactiveHelper.active).toBe(false);
    expect(inactiveHelper.visible).toBe(false);
    expect(inactiveHelper.body.enable).toBe(false);
    controller.finalizeLiveObjectCreation(room as never, true);

    expect(activeSprite.active).toBe(true);
    expect(activeSprite.visible).toBe(true);
    expect(activeSprite.body.enable).toBe(true);
    expect(inactiveSprite.active).toBe(false);
    expect(inactiveSprite.visible).toBe(false);
    expect(inactiveSprite.body.enable).toBe(false);
    expect(activeHelper.active).toBe(true);
    expect(activeHelper.visible).toBe(true);
    expect(activeHelper.body.enable).toBe(true);
    expect(inactiveHelper.active).toBe(false);
    expect(inactiveHelper.visible).toBe(false);
    expect(inactiveHelper.body.enable).toBe(false);
    expect(applySwitchBlockStates).toHaveBeenCalledTimes(2);

    const afterFinalize = harness.getRoomLiveObjectPartition(room);
    expect(afterFinalize).not.toBe(beforeFinalize);
    expect(afterFinalize.pushables).toEqual([crate]);
    expect(afterFinalize.runtimeSolids).toEqual([crate, brick]);
  });

  it.each([
    { roomSwitchActive: false, blueEnabled: true, redEnabled: false },
    { roomSwitchActive: true, blueEnabled: false, redEnabled: true },
  ])(
    'restores finalized switch-block collision after dormant activation (room switch active: $roomSwitchActive)',
    ({ roomSwitchActive, blueEnabled, redEnabled }) => {
      const playerBody = createBody(0, 0, 16, 24);
      const blueSprite = createDormancyGameObject({
        active: true,
        visible: true,
        bodyEnabled: true,
      });
      const redSprite = createDormancyGameObject({
        active: true,
        visible: true,
        bodyEnabled: true,
      });
      const blueBlock = createBatchLiveObject('switch_block_on', blueSprite, []);
      const redBlock = createBatchLiveObject('switch_block_off', redSprite, []);
      const room = createLoadedRoom('room', { x: 0, y: 0 }, [blueBlock, redBlock]);
      const controller = createController(playerBody, [room]);
      const harness = controller as unknown as {
        triggerController: {
          setRoomSwitchState(roomId: string, active: boolean): void;
        };
      };
      harness.triggerController.setRoomSwitchState(room.room.id, roomSwitchActive);

      controller.setLoadedRoomLiveObjectsDormant(room as never, true);
      controller.finalizeLiveObjectCreation(room as never, true);

      expect(blueSprite.active).toBe(false);
      expect(redSprite.active).toBe(false);
      expect(blueSprite.body.enable).toBe(false);
      expect(redSprite.body.enable).toBe(false);
      expect(blueSprite.getData('wampPreparedBodyEnabled')).toBe(blueEnabled);
      expect(redSprite.getData('wampPreparedBodyEnabled')).toBe(redEnabled);

      controller.setLoadedRoomLiveObjectsDormant(room as never, false);

      expect(blueSprite.active).toBe(true);
      expect(redSprite.active).toBe(true);
      expect(blueSprite.body.enable).toBe(blueEnabled);
      expect(redSprite.body.enable).toBe(redEnabled);
      expect(blueSprite.alpha).toBe(blueEnabled ? 1 : 0.16);
      expect(redSprite.alpha).toBe(redEnabled ? 1 : 0.16);
    },
  );

  it('tears down a cancelled dormant replacement without clearing active-room trigger state', () => {
    const playerBody = createBody(0, 0, 16, 24);
    const sprite = { destroy: vi.fn() };
    const room = createLoadedRoom(
      'room',
      { x: 0, y: 0 },
      [{
        key: 'room:trigger-a',
        helpers: [],
        interactions: [],
        worldColliders: [],
        sprite,
      } as unknown as LoadedRoomObject],
    );
    const controller = createController(playerBody, [room]);
    const clearBlockSwitchActorLatchesForRoom = vi.fn();
    const clearPressureTriggerStatesForRoom = vi.fn();
    const harness = controller as unknown as {
      triggerController: {
        clearBlockSwitchActorLatchesForRoom(loadedRoom: typeof room): void;
        clearPressureTriggerStatesForRoom(loadedRoom: typeof room): void;
      };
      destroyLiveObjectInteractions: ReturnType<typeof vi.fn>;
      destroyLiveObjectWorldColliders: ReturnType<typeof vi.fn>;
      destroyLiveObjectHelpers: ReturnType<typeof vi.fn>;
    };
    harness.triggerController = {
      clearBlockSwitchActorLatchesForRoom,
      clearPressureTriggerStatesForRoom,
    };
    harness.destroyLiveObjectInteractions = vi.fn();
    harness.destroyLiveObjectWorldColliders = vi.fn();
    harness.destroyLiveObjectHelpers = vi.fn();

    controller.destroyLiveObjects(room as never, { preserveTriggerState: true });

    expect(clearBlockSwitchActorLatchesForRoom).not.toHaveBeenCalled();
    expect(clearPressureTriggerStatesForRoom).not.toHaveBeenCalled();
    expect(sprite.destroy).toHaveBeenCalledOnce();
    expect(room.liveObjects).toEqual([]);
  });

  it('attempts every live-object resource and clears ownership when one destroy callback fails', () => {
    const playerBody = createBody(0, 0, 16, 24);
    const failure = new Error('injected sprite destroy failure');
    const failingInteraction = { destroy: vi.fn(() => { throw failure; }) };
    const siblingInteraction = { destroy: vi.fn() };
    const failingSprite = { destroy: vi.fn(() => { throw failure; }) };
    const siblingSprite = { destroy: vi.fn() };
    const failingObject = {
      key: 'room:failing',
      helpers: [{ destroy: vi.fn() }],
      interactions: [failingInteraction, siblingInteraction],
      worldColliders: [{ destroy: vi.fn() }],
      sprite: failingSprite,
    } as unknown as LoadedRoomObject;
    const siblingObject = {
      key: 'room:sibling',
      helpers: [],
      interactions: [],
      worldColliders: [],
      sprite: siblingSprite,
    } as unknown as LoadedRoomObject;
    const room = createLoadedRoom(
      'room',
      { x: 0, y: 0 },
      [siblingObject, failingObject],
    );
    const controller = createController(playerBody, [room]);
    const harness = controller as unknown as {
      triggerController: {
        clearBlockSwitchActorLatchesForRoom(loadedRoom: typeof room): void;
        clearPressureTriggerStatesForRoom(loadedRoom: typeof room): void;
      };
    };
    harness.triggerController = {
      clearBlockSwitchActorLatchesForRoom: vi.fn(),
      clearPressureTriggerStatesForRoom: vi.fn(),
    };

    expect(() => controller.destroyLiveObjectsBatch(room as never, 2)).toThrow(failure);

    expect(failingInteraction.destroy).toHaveBeenCalledOnce();
    expect(siblingInteraction.destroy).toHaveBeenCalledOnce();
    expect(failingSprite.destroy).toHaveBeenCalledOnce();
    expect(siblingSprite.destroy).toHaveBeenCalledOnce();
    expect(failingObject.interactions).toEqual([]);
    expect(failingObject.worldColliders).toEqual([]);
    expect(failingObject.helpers).toEqual([]);
    expect(room.liveObjects).toEqual([]);
  });

  it('deactivates and restores dormant-room interaction and world-collider handles', () => {
    const playerBody = createBody(0, 0, 16, 24);
    const sprite = createDormancyGameObject({
      active: true,
      visible: true,
      bodyEnabled: true,
    });
    const liveObject = createBatchLiveObject('crate', sprite, []);
    const interaction = { active: true, destroy: vi.fn() };
    const worldCollider = { active: true, destroy: vi.fn() };
    liveObject.interactions = [interaction as never];
    liveObject.worldColliders = [worldCollider as never];
    const room = createLoadedRoom('room', { x: 0, y: 0 }, [liveObject]);
    const controller = createController(playerBody, [room]);

    controller.setLoadedRoomLiveObjectsDormant(room as never, true);

    expect(sprite.active).toBe(false);
    expect(sprite.body.enable).toBe(false);
    expect(interaction.active).toBe(false);
    expect(worldCollider.active).toBe(false);
    expect(interaction.destroy).not.toHaveBeenCalled();
    expect(worldCollider.destroy).not.toHaveBeenCalled();

    controller.setLoadedRoomLiveObjectsDormant(room as never, false);

    expect(interaction.active).toBe(true);
    expect(worldCollider.active).toBe(true);
  });

  it('deactivates active-room collider handles targeting a suspended room', () => {
    const playerBody = createBody(0, 0, 16, 24);
    const targetTerrain = {};
    const targetInsets = {};
    const unrelatedTarget = {};
    const sourceObject = createLiveObject('crate', createBody(20, 20, 16, 16));
    const terrainCollider = { active: true, object1: sourceObject.sprite, object2: targetTerrain };
    const insetCollider = { active: true, object1: targetInsets, object2: sourceObject.sprite };
    const unrelatedCollider = {
      active: true,
      object1: sourceObject.sprite,
      object2: unrelatedTarget,
    };
    sourceObject.worldColliders = [
      terrainCollider,
      insetCollider,
      unrelatedCollider,
    ] as never;
    const sourceRoom = createLoadedRoom('source', { x: 0, y: 0 }, [sourceObject]);
    const targetRoom = {
      ...createLoadedRoom('target', { x: 1, y: 0 }, []),
      terrainLayer: targetTerrain,
      terrainInsetBodies: targetInsets,
    };
    const controller = createController(playerBody, [sourceRoom, targetRoom]);

    controller.setLoadedRoomWorldCollisionTargetDormant(targetRoom as never, true);

    expect(terrainCollider.active).toBe(false);
    expect(insetCollider.active).toBe(false);
    expect(unrelatedCollider.active).toBe(true);

    controller.setLoadedRoomWorldCollisionTargetDormant(targetRoom as never, false);

    expect(terrainCollider.active).toBe(true);
    expect(insetCollider.active).toBe(true);
    expect(unrelatedCollider.active).toBe(true);
  });

  it('does not simulate or repartition a suspended room', () => {
    const playerBody = createBody(0, 0, 16, 24);
    const liveObject = createLiveObject('crate', createBody(20, 20, 16, 16));
    const room = {
      ...createLoadedRoom('room', { x: 0, y: 0 }, [liveObject]),
      runtimeSuspended: true,
    };
    const controller = createController(playerBody, [room]);
    const harness = controller as unknown as {
      getRoomLiveObjectPartition: ReturnType<typeof vi.fn>;
      triggerController: { updatePressurePlates: ReturnType<typeof vi.fn> };
    };
    harness.getRoomLiveObjectPartition = vi.fn();
    harness.triggerController.updatePressurePlates = vi.fn();

    controller.updateLiveObjects([room] as never, 16);

    expect(harness.getRoomLiveObjectPartition).not.toHaveBeenCalled();
    expect(harness.triggerController.updatePressurePlates).toHaveBeenCalledWith([]);
  });
});

interface DormancyGameObject {
  active: boolean;
  visible: boolean;
  alpha: number;
  textureKey: string | null;
  body: { enable: boolean };
  setActive(active: boolean): DormancyGameObject;
  setVisible(visible: boolean): DormancyGameObject;
  setAlpha(alpha: number): DormancyGameObject;
  setTexture(textureKey: string, frame?: unknown): DormancyGameObject;
  setData(key: string, value: unknown): DormancyGameObject;
  getData(key: string): unknown;
}

function createDormancyGameObject(initial: {
  active: boolean;
  visible: boolean;
  bodyEnabled: boolean;
}): DormancyGameObject {
  const data = new Map<string, unknown>();
  return {
    active: initial.active,
    visible: initial.visible,
    alpha: 1,
    textureKey: null,
    body: { enable: initial.bodyEnabled },
    setActive(active) {
      this.active = active;
      return this;
    },
    setVisible(visible) {
      this.visible = visible;
      return this;
    },
    setAlpha(alpha) {
      this.alpha = alpha;
      return this;
    },
    setTexture(textureKey) {
      this.textureKey = textureKey;
      return this;
    },
    setData(key, value) {
      data.set(key, value);
      return this;
    },
    getData(key) {
      return data.get(key);
    },
  };
}

function createBatchLiveObject(
  objectId: string,
  sprite: DormancyGameObject,
  helpers: DormancyGameObject[],
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
    sprite,
    helpers,
    interactions: [],
    worldColliders: [],
  } as unknown as LoadedRoomObject;
}
