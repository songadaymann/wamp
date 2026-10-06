import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { getObjectById } from '../../../config';
import type { LoadedFullRoom } from '../worldStreaming';
import { LiveObjectInteractionCoordinator } from './interactionCoordinator';
import type { LoadedRoomObject } from './model';

interface PhysicsRegistration {
  kind: 'collider' | 'overlap';
  object1: unknown;
  object2: unknown;
  collide?: () => void;
  process?: () => boolean;
  result: { active: boolean; destroy: ReturnType<typeof vi.fn> };
}

function createLiveObject(
  objectId: string,
  options: {
    key?: string;
    active?: boolean;
    body?: unknown;
    helpers?: Array<{ body?: unknown }>;
  } = {},
): LoadedRoomObject {
  const config = getObjectById(objectId);
  if (!config) throw new Error(`Missing ${objectId} test config.`);
  return {
    key: options.key ?? objectId,
    layer: 'terrain',
    config,
    sprite: {
      active: options.active ?? true,
      body: options.body === undefined ? { enable: true } : options.body,
    },
    helpers: options.helpers ?? [],
    interactions: [],
    worldColliders: [],
    runtime: {
      directionX: 1,
      npcMode: 'idle',
      npcPushable: false,
      npcPlayerCollision: false,
    },
  } as unknown as LoadedRoomObject;
}

function createRoom(
  id: string,
  liveObjects: LoadedRoomObject[],
  options: { suspended?: boolean; inset?: boolean } = {},
): LoadedFullRoom<LoadedRoomObject, unknown> {
  return {
    room: { id },
    liveObjects,
    runtimeSuspended: options.suspended,
    terrainLayer: { room: id, kind: 'terrain' },
    terrainInsetBodies: options.inset ? { room: id, kind: 'inset' } : null,
  } as unknown as LoadedFullRoom<LoadedRoomObject, unknown>;
}

function createHarness(
  rooms: LoadedFullRoom<LoadedRoomObject, unknown>[],
  overrides: Record<string, unknown> = {},
) {
  const registrations: PhysicsRegistration[] = [];
  const register = (
    kind: PhysicsRegistration['kind'],
    object1: unknown,
    object2: unknown,
    collide?: () => void,
    process?: () => boolean,
  ) => {
    const result = { active: true, destroy: vi.fn() };
    registrations.push({ kind, object1, object2, collide, process, result });
    return result;
  };
  const player = {};
  const playerPickupSensor = {};
  const playerBody = { velocity: { x: 0, y: 0 }, bottom: 0 };
  const calls = {
    collectLiveObject: vi.fn(),
    addHazardInteraction: vi.fn(),
    handleEnemyContact: vi.fn(),
    handleNpcContact: vi.fn(),
    addNpcTornadoInteraction: vi.fn(),
    touchNpcQuicksand: vi.fn(),
    defeatNpc: vi.fn(),
    maybeBreakBrickBox: vi.fn(),
    maybeBreakButtStompableObject: vi.fn(() => false),
    maybeTriggerBlockSwitch: vi.fn(),
    addBouncePadInteraction: vi.fn(),
    handleLockedDoorContact: vi.fn(),
    shouldCollideWithLadderTopSupport: vi.fn(() => true),
    handleBlockSwitchActorHit: vi.fn(),
    handleActorPushableContact: vi.fn(),
  };
  const controller = new LiveObjectInteractionCoordinator({
    scene: {
      physics: {
        add: {
          collider: (
            object1: unknown,
            object2: unknown,
            collide?: () => void,
            process?: () => boolean,
          ) => register('collider', object1, object2, collide, process),
          overlap: (
            object1: unknown,
            object2: unknown,
            collide?: () => void,
            process?: () => boolean,
          ) => register('overlap', object1, object2, collide, process),
        },
      },
    } as never,
    getPlayer: () => player as never,
    getPlayerPickupSensor: () => playerPickupSensor as never,
    getPlayerBody: () => playerBody as never,
    destroyInteractions: (liveObject) => {
      for (const interaction of liveObject.interactions) interaction.destroy();
      liveObject.interactions = [];
    },
    destroyWorldColliders: (liveObject) => {
      for (const collider of liveObject.worldColliders) collider.destroy();
      liveObject.worldColliders = [];
    },
    ...calls,
    shouldCollideWithLiveObject: (liveObject) =>
      Boolean(liveObject.sprite.active && (liveObject.sprite.body as { enable?: boolean } | null)?.enable),
    getRuntimeSolidObjects: (room) => room.liveObjects,
    usesDynamicObjectBody: (config) => config.id === 'crate' || config.id === 'penguin',
    canActorPushPushableByContact: (liveObject) => liveObject.config.id === 'penguin',
    ...overrides,
  });
  return {
    controller,
    registrations,
    player,
    playerPickupSensor,
    playerBody,
    ...calls,
    rooms,
  };
}

describe('LiveObjectInteractionCoordinator', () => {
  it('retains both toxic-water hazards and gives new water no solid or lethal player interaction', () => {
    const toxicPool = createLiveObject('water_surface_a');
    const toxicRipple = createLiveObject('water_surface_b');
    const pool = createLiveObject('swimmable_water_pool');
    const ripple = createLiveObject('swimmable_water_ripple');
    const room = createRoom('water', [toxicPool, toxicRipple, pool, ripple]);
    const harness = createHarness([room]);
    harness.controller.syncPlayerInteractions([room]);
    expect(harness.addHazardInteraction.mock.calls).toEqual([
      [room, toxicPool, harness.player], [room, toxicRipple, harness.player],
    ]);
    expect(pool.interactions).toEqual([]);
    expect(ripple.interactions).toEqual([]);
    expect(harness.registrations).toEqual([]);
  });

  it('rebuilds active collectible interactions with the pickup sensor and ignores suspended rooms', () => {
    const activeCoin = createLiveObject('coin_gold');
    const suspendedCoin = createLiveObject('coin_silver');
    const activeOld = { active: true, destroy: vi.fn() };
    const suspendedOld = { active: true, destroy: vi.fn() };
    activeCoin.interactions.push(activeOld as never);
    suspendedCoin.interactions.push(suspendedOld as never);
    const activeRoom = createRoom('active', [activeCoin]);
    const suspendedRoom = createRoom('suspended', [suspendedCoin], { suspended: true });
    const harness = createHarness([activeRoom, suspendedRoom]);

    harness.controller.syncPlayerInteractions(harness.rooms);

    expect(activeOld.destroy).toHaveBeenCalledOnce();
    expect(suspendedOld.destroy).not.toHaveBeenCalled();
    expect(harness.registrations).toHaveLength(1);
    expect(harness.registrations[0]).toMatchObject({
      kind: 'overlap',
      object1: harness.playerPickupSensor,
      object2: activeCoin.sprite,
    });
    harness.registrations[0]?.collide?.();
    expect(harness.collectLiveObject).toHaveBeenCalledWith(activeRoom, activeCoin);
    expect(harness.controller.getReconciliationGeneration()).toBe(1);
  });

  it('preserves the ladder support process callback boundary', () => {
    const supportBody = { enable: true, top: 20 };
    const ladder = createLiveObject('ladder', { helpers: [{ body: supportBody }] });
    const room = createRoom('ladder-room', [ladder]);
    const harness = createHarness([room]);

    harness.controller.syncPlayerInteractions([room]);

    expect(harness.registrations).toHaveLength(1);
    expect(harness.registrations[0]?.kind).toBe('collider');
    expect(harness.registrations[0]?.process?.()).toBe(true);
    expect(harness.shouldCollideWithLadderTopSupport).toHaveBeenCalledWith(
      harness.playerBody,
      supportBody,
    );
  });

  it('creates terrain colliders in room order and only one collider for a dynamic pair', () => {
    const first = createLiveObject('crate', { key: 'crate-a' });
    const second = createLiveObject('crate', { key: 'crate-b' });
    const room = createRoom('room', [first, second], { inset: true });
    const harness = createHarness([room]);

    harness.controller.syncWorldColliders([room]);

    expect(first.worldColliders).toHaveLength(3);
    expect(second.worldColliders).toHaveLength(2);
    expect(harness.registrations.filter(
      ({ object1, object2 }) =>
        (object1 === first.sprite && object2 === second.sprite) ||
        (object1 === second.sprite && object2 === first.sprite),
    )).toHaveLength(1);
    expect(harness.registrations.slice(0, 2).map(({ object2 }) => object2)).toEqual([
      room.terrainLayer,
      room.terrainInsetBodies,
    ]);
    expect(harness.controller.getReconciliationGeneration()).toBe(1);
  });

  it('rebuilds sleeping enemy terrain and obstacle connections before its body wakes', () => {
    const body = { enable: false };
    const sleeper = createLiveObject('penguin', { body });
    const disabled = createLiveObject('penguin', { key: 'disabled', body: { enable: false } });
    const crate = createLiveObject('crate');
    const room = createRoom('room', [sleeper, disabled, crate], { inset: true });
    const neighbor = createRoom('neighbor', []);
    const harness = createHarness([room, neighbor], {
      isDistanceSleeping: (object: LoadedRoomObject) => object === sleeper,
      getRuntimeSolidObjects: (candidate: typeof room) => candidate === room ? [crate] : [],
    });

    harness.controller.syncWorldColliders([room, neighbor]);
    // A second reconciliation while asleep must retain the same connections.
    harness.controller.syncWorldColliders([room, neighbor]);

    expect(sleeper.worldColliders).toHaveLength(4);
    expect(disabled.worldColliders).toHaveLength(0);
    const current = harness.registrations.filter(({ result }) =>
      sleeper.worldColliders.includes(result as never),
    );
    expect(current.map(({ object2 }) => object2)).toEqual([
      room.terrainLayer, room.terrainInsetBodies, neighbor.terrainLayer, crate.sprite,
    ]);
    expect(current.every(({ process }) => process?.() === false)).toBe(true);

    body.enable = true;
    expect(current.every(({ process }) => process?.() === true)).toBe(true);
  });

  it('retains actor pairs with a sleeping solid NPC until the NPC wakes', () => {
    const actor = createLiveObject('penguin');
    const npcBody = { enable: false };
    const npc = createLiveObject('jimothy', { body: npcBody });
    const room = createRoom('room', [actor, npc]);
    const harness = createHarness([room], {
      isDistanceSleeping: (object: LoadedRoomObject) => object === npc,
      getRuntimeSolidObjects: () => [npc],
      usesDynamicObjectBody: () => true,
    });

    harness.controller.syncWorldColliders([room]);

    const pair = harness.registrations.find(({ object1, object2 }) =>
      object1 === actor.sprite && object2 === npc.sprite,
    );
    expect(pair).toBeDefined();
    expect(pair?.process?.()).toBe(false);
    npcBody.enable = true;
    expect(pair?.process?.()).toBe(true);
  });

  it('routes enemy collisions with block switches and pushables through domain callbacks', () => {
    const actor = createLiveObject('swordsman_ai', { key: 'actor' });
    const blockSwitch = createLiveObject('block_switch', { key: 'switch' });
    const crate = createLiveObject('crate', { key: 'crate' });
    const room = createRoom('room', [actor, blockSwitch, crate]);
    const harness = createHarness([room], {
      getRuntimeSolidObjects: () => [blockSwitch, crate],
      usesDynamicObjectBody: (config: { id: string }) =>
        config.id === 'swordsman_ai' || config.id === 'crate',
      canActorPushPushableByContact: (liveObject: LoadedRoomObject) =>
        liveObject === actor,
    });

    harness.controller.syncWorldColliders([room]);

    const switchRegistration = harness.registrations.find(
      ({ object1, object2 }) => object1 === actor.sprite && object2 === blockSwitch.sprite,
    );
    const pushRegistration = harness.registrations.find(
      ({ object1, object2 }) => object1 === actor.sprite && object2 === crate.sprite,
    );
    expect(switchRegistration).toBeDefined();
    expect(pushRegistration).toBeDefined();
    switchRegistration?.collide?.();
    pushRegistration?.collide?.();
    expect(harness.handleBlockSwitchActorHit).toHaveBeenCalledWith(
      room,
      blockSwitch,
      actor,
    );
    expect(harness.handleActorPushableContact).toHaveBeenCalledWith(actor, crate);
  });
});
