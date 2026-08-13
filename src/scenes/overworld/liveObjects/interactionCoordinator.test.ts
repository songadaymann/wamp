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
