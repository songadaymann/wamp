import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    },
  },
}));

import { getObjectById } from '../../../config';
import type { LoadedFullRoom } from '../worldStreaming';
import { LiveObjectLifecycleController } from './lifecycleController';
import type { CreateLiveObjectEntryOptions, LoadedRoomObject } from './model';

function createGameObject(input: {
  active?: boolean;
  visible?: boolean;
  bodyEnabled?: boolean | null;
  destroy?: () => void;
} = {}) {
  const data = new Map<string, unknown>();
  const body = input.bodyEnabled === null
    ? null
    : { enable: input.bodyEnabled ?? true };
  const gameObject = {
    active: input.active ?? true,
    visible: input.visible ?? true,
    body,
    destroy: input.destroy ?? vi.fn(),
    getData: (key: string) => data.get(key),
    setData: (key: string, value: unknown) => {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    },
    setActive: (active: boolean) => {
      gameObject.active = active;
      return gameObject;
    },
    setVisible: (visible: boolean) => {
      gameObject.visible = visible;
      return gameObject;
    },
  };
  return gameObject;
}

function createCollider(
  active: boolean,
  options: { object1?: unknown; object2?: unknown; destroy?: () => void } = {},
) {
  return {
    active,
    object1: options.object1,
    object2: options.object2,
    destroy: options.destroy ?? vi.fn(),
  };
}

function createLiveObject(
  objectId: string,
  options: {
    sprite?: ReturnType<typeof createGameObject>;
    helpers?: ReturnType<typeof createGameObject>[];
    interactions?: ReturnType<typeof createCollider>[];
    worldColliders?: ReturnType<typeof createCollider>[];
  } = {},
): LoadedRoomObject {
  const config = getObjectById(objectId);
  if (!config) throw new Error(`Missing ${objectId} test config.`);
  return {
    key: objectId,
    placedInstanceId: null,
    linkedTargetRoomId: null,
    linkedTargetInstanceId: null,
    linkedTargetInstanceIds: [],
    linkedTargetWorldX: null,
    linkedTargetWorldY: null,
    containedObjectId: null,
    signText: null,
    npcName: null,
    npcNameLabel: null,
    layer: 'terrain',
    countsTowardGoals: true,
    config,
    sprite: options.sprite ?? createGameObject(),
    helpers: options.helpers ?? [],
    interactions: options.interactions ?? [],
    worldColliders: options.worldColliders ?? [],
    runtime: {},
  } as unknown as LoadedRoomObject;
}

function createRoom(
  id: string,
  placedObjects: Array<Record<string, unknown>> = [],
  liveObjects: LoadedRoomObject[] = [],
) {
  return {
    room: { id, coordinates: { x: 0, y: 0 }, placedObjects },
    liveObjects,
    terrainLayer: null,
    terrainInsetBodies: null,
  } as unknown as LoadedFullRoom<LoadedRoomObject, unknown>;
}

function createHarness(
  room: LoadedFullRoom<LoadedRoomObject, unknown>,
  overrides: Partial<ConstructorParameters<typeof LiveObjectLifecycleController>[0]> = {},
) {
  const createLiveObjectEntry = vi.fn(
    (_loadedRoom: LoadedFullRoom<LoadedRoomObject, unknown>, options: CreateLiveObjectEntryOptions) =>
      createLiveObject(options.config.id),
  );
  const calls = {
    applySwitchBlockStates: vi.fn(),
    clearBlockSwitchActorLatchesForRoom: vi.fn(),
    clearPressureTriggerStatesForRoom: vi.fn(),
    invalidateRoomPartition: vi.fn(),
  };
  const controller = new LiveObjectLifecycleController({
    getLoadedFullRooms: () => [room],
    getPlacedObjectRuntimeKey: (_roomId, _placedObject, index) => `key-${index}`,
    isCollectedObjectKey: () => false,
    createLiveObjectEntry,
    ...calls,
    ...overrides,
  });
  return { controller, createLiveObjectEntry, ...calls };
}

describe('LiveObjectLifecycleController', () => {
  it('clamps batch bounds, skips unavailable/collected objects, and maps runtime options', () => {
    const room = createRoom('room', [
      { id: 'not-an-object', x: 0, y: 0, instanceId: 'unknown' },
      { id: 'crate', x: 16, y: 32, instanceId: 'collected' },
      {
        id: 'policewoman',
        x: 48,
        y: 64,
        instanceId: 'police',
        policeBehaviorMode: 'patrol',
        policePatrolShoots: true,
      },
      {
        id: 'jimothy',
        x: 80,
        y: 96,
        instanceId: 'npc',
        npcMode: 'follow',
        npcName: 'Helper',
        npcPushable: true,
      },
    ]);
    const harness = createHarness(room, {
      isCollectedObjectKey: (key) => key === 'key-1',
    });

    expect(harness.controller.createBatch(room, -4.8, 99.1, true)).toBe(4);
    expect(harness.createLiveObjectEntry).toHaveBeenCalledTimes(2);
    expect(harness.createLiveObjectEntry.mock.calls[0]?.[1]).toMatchObject({
      key: 'key-2',
      placedInstanceId: 'police',
      policeBehaviorMode: 'patrol',
      policePatrolShoots: true,
      countsTowardGoals: true,
    });
    expect(harness.createLiveObjectEntry.mock.calls[1]?.[1]).toMatchObject({
      key: 'key-3',
      placedInstanceId: 'npc',
      npcMode: 'follow',
      npcName: 'Helper',
      npcPushable: true,
      countsTowardGoals: true,
    });
    expect(room.liveObjects).toHaveLength(2);
    for (const liveObject of room.liveObjects) {
      expect(liveObject.sprite).toMatchObject({ active: false, visible: false });
      expect((liveObject.sprite.body as { enable: boolean }).enable).toBe(false);
    }
  });

  it('captures finalized switch collision while dormant and restores original object state once', () => {
    const sprite = createGameObject({ active: true, visible: true, bodyEnabled: true });
    const helper = createGameObject({ active: false, visible: false, bodyEnabled: false });
    const switchBlock = createLiveObject('switch_block_on', { sprite, helpers: [helper] });
    const room = createRoom('room', [], [switchBlock]);
    const harness = createHarness(room, {
      applySwitchBlockStates: () => {
        (sprite.body as { enable: boolean }).enable = true;
      },
    });

    harness.controller.setRoomDormant(room, true);
    harness.controller.finalizeCreation(room, true);
    expect((sprite.body as { enable: boolean }).enable).toBe(false);

    harness.controller.setRoomDormant(room, false);
    expect(sprite).toMatchObject({ active: true, visible: true });
    expect((sprite.body as { enable: boolean }).enable).toBe(true);
    expect(helper).toMatchObject({ active: false, visible: false });
    expect((helper.body as { enable: boolean }).enable).toBe(false);

    harness.controller.setRoomDormant(room, false);
    expect(harness.invalidateRoomPartition).toHaveBeenCalledTimes(4);
  });

  it('restores only colliders targeting a dormant room and preserves their prior active state', () => {
    const terrain = {};
    const inset = {};
    const targetedActive = createCollider(true, { object1: terrain });
    const targetedInactive = createCollider(false, { object2: inset });
    const unrelated = createCollider(true, { object1: {} });
    const liveObject = createLiveObject('crate', {
      worldColliders: [targetedActive, targetedInactive, unrelated],
    });
    const room = createRoom('room', [], [liveObject]);
    room.terrainLayer = terrain as never;
    room.terrainInsetBodies = inset as never;
    const harness = createHarness(room);

    harness.controller.setRoomWorldCollisionTargetDormant(room, true);
    expect([targetedActive.active, targetedInactive.active, unrelated.active]).toEqual([
      false,
      false,
      true,
    ]);

    harness.controller.setRoomWorldCollisionTargetDormant(room, false);
    expect([targetedActive.active, targetedInactive.active, unrelated.active]).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('finishes reverse-order partial-failure cleanup, clears arrays, and rethrows the first error', () => {
    const triggerError = new Error('trigger cleanup failed');
    const badInteraction = createCollider(true, {
      destroy: vi.fn(() => { throw new Error('interaction failed'); }),
    });
    const goodInteraction = createCollider(true);
    const worldCollider = createCollider(true);
    const helper = createGameObject();
    const last = createLiveObject('crate', {
      interactions: [badInteraction, goodInteraction],
      worldColliders: [worldCollider],
      helpers: [helper],
    });
    const first = createLiveObject('brick_box');
    const room = createRoom('room', [], [first, last]);
    const harness = createHarness(room, {
      clearBlockSwitchActorLatchesForRoom: () => { throw triggerError; },
    });

    expect(() => harness.controller.destroyBatch(room, 1, { clearRoomTriggerState: true }))
      .toThrow(triggerError);
    expect(room.liveObjects).toEqual([first]);
    expect(last.interactions).toEqual([]);
    expect(last.worldColliders).toEqual([]);
    expect(last.helpers).toEqual([]);
    expect(goodInteraction.destroy).toHaveBeenCalledOnce();
    expect(worldCollider.destroy).toHaveBeenCalledOnce();
    expect(helper.destroy).toHaveBeenCalledOnce();
    expect(last.sprite.destroy).toHaveBeenCalledOnce();
    expect(harness.clearPressureTriggerStatesForRoom).toHaveBeenCalledOnce();
    expect(harness.invalidateRoomPartition).toHaveBeenCalledWith('room');

    expect(harness.controller.destroyBatch(room, 0, {
      clearRoomTriggerState: true,
      preserveTriggerState: true,
    })).toBe(true);
    expect(harness.clearPressureTriggerStatesForRoom).toHaveBeenCalledOnce();
  });
});
