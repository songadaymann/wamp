import { describe, expect, it, vi } from 'vitest';

const { FakeGroup } = vi.hoisted(() => ({ FakeGroup: class {
  entries: object[] = [];
  add(child: object) { if (!this.contains(child)) { this.entries.push(child); this.createCallbackHandler(child); } return this; }
  remove(child: object) { this.entries = this.entries.filter(value => value !== child); this.removeCallbackHandler(child); }
  contains(child: object) { return this.entries.includes(child); }
  createCallbackHandler(_child: object) {}
  removeCallbackHandler(_child: object) {}
  getLength() { return this.entries.length; }
  destroy() { for (const child of [...this.entries]) this.remove(child); }
} }));
vi.mock('phaser', () => ({ default: { Physics: { Arcade: { Group: FakeGroup, STATIC_BODY: 1, DYNAMIC_BODY: 0 } } } }));

import { getObjectById } from '../../../config';
import type { LoadedFullRoom } from '../worldStreaming';
import { LiveObjectInteractionCoordinator } from './interactionCoordinator';
import type { LoadedRoomObject } from './model';

interface PhysicsRegistration {
  kind: 'collider' | 'overlap';
  object1: unknown;
  object2: unknown;
  collide?: (...objects: unknown[]) => void;
  process?: (...objects: unknown[]) => boolean;
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
    collide?: (...objects: unknown[]) => void,
    process?: (...objects: unknown[]) => boolean,
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
        world: {},
        add: {
          collider: (
            object1: unknown,
            object2: unknown,
            collide?: (...objects: unknown[]) => void,
            process?: (...objects: unknown[]) => boolean,
          ) => register('collider', object1, object2, collide, process),
          overlap: (
            object1: unknown,
            object2: unknown,
            collide?: (...objects: unknown[]) => void,
            process?: (...objects: unknown[]) => boolean,
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

describe('grouped world obstacle collisions', () => {
  it('uses two spatial groups, keeps dynamic pairs unique, and checks liveness on contact', () => {
    const a = createLiveObject('crate', { key: 'a', body: { enable: true, physicsType: 0 } });
    const b = createLiveObject('crate', { key: 'b', body: { enable: true, physicsType: 0 } });
    const wall = createLiveObject('brick_box', { body: { enable: true, physicsType: 1 } });
    const room = createRoom('active', [a, b, wall]);const h = createHarness([room]);h.controller.syncWorldColliders([room]);
    const groups = h.registrations.filter(r => r.object2 instanceof FakeGroup);
    expect(groups).toHaveLength(4); // two actor links to two body-type groups, not every pair
    const dynamicA = groups.find(r => r.object1 === a.sprite && (r.object2 as InstanceType<typeof FakeGroup>).contains(b.sprite));
    const dynamicB = groups.find(r => r.object1 === b.sprite && (r.object2 as InstanceType<typeof FakeGroup>).contains(a.sprite));
    expect(dynamicA?.process?.(a.sprite, b.sprite)).toBe(true);expect(dynamicB?.process?.(b.sprite, a.sprite)).toBe(false);
    expect(dynamicA?.process?.(a.sprite, a.sprite)).toBe(false);
    (b.sprite.body as { enable: boolean }).enable = false;expect(dynamicA?.process?.(a.sprite, b.sprite)).toBe(false);
    (b.sprite.body as { enable: boolean }).enable = true;room.runtimeSuspended = true;expect(dynamicA?.process?.(a.sprite, b.sprite)).toBe(false);
    room.runtimeSuspended = false;expect(dynamicA?.process?.(a.sprite, b.sprite)).toBe(true);
  });

  it('retains switch and pushing callbacks for actual grouped members', () => {
    const actor = createLiveObject('swordsman_ai', { body: { enable: true, physicsType: 0 } });
    const toggle = createLiveObject('block_switch', { body: { enable: true, physicsType: 1 } });
    const crate = createLiveObject('crate', { body: { enable: true, physicsType: 0 } });
    const room = createRoom('active', [actor, toggle, crate]);const h = createHarness([room], {
      getRuntimeSolidObjects: () => [toggle, crate], usesDynamicObjectBody: (config: {id:string}) => config.id === 'swordsman_ai' || config.id === 'crate',
      canActorPushPushableByContact: (object:LoadedRoomObject) => object === actor,
    });h.controller.syncWorldColliders([room]);
    const groupFor = (target: LoadedRoomObject) => h.registrations.find(r => r.object1 === actor.sprite && r.object2 instanceof FakeGroup && r.object2.contains(target.sprite));
    const sw = groupFor(toggle), push = groupFor(crate);expect(sw?.process?.(actor.sprite, toggle.sprite)).toBe(true);
    sw?.collide?.(actor.sprite, toggle.sprite);push?.collide?.(actor.sprite, crate.sprite);
    expect(h.handleBlockSwitchActorHit).toHaveBeenCalledExactlyOnceWith(room, toggle, actor);
    expect(h.handleActorPushableContact).toHaveBeenCalledExactlyOnceWith(actor, crate);
  });

  it('replaces old groups without destroying their members and keeps sleeping bodies connected', () => {
    const actor = createLiveObject('penguin', { body: { enable: false, physicsType: 0 } });
    const wall = createLiveObject('brick_box', { body: { enable: true, physicsType: 1 } });
    const room = createRoom('active', [actor, wall]);const h = createHarness([room], { isDistanceSleeping: () => true });
    h.controller.syncWorldColliders([room]);const oldGroup = h.registrations.find(r => r.object2 instanceof FakeGroup)!.object2 as InstanceType<typeof FakeGroup>;
    expect(oldGroup.getLength()).toBe(1);expect(actor.worldColliders.length).toBeGreaterThan(0);
    h.controller.syncWorldColliders([room]);expect(oldGroup.getLength()).toBe(0);expect(actor.sprite.active).toBe(true);
    expect((actor.sprite.body as { enable: boolean }).enable).toBe(false);
  });
  it('grows terrain reach without adding another group link and preserves obstacle reach gating', () => {
    const actorBody = { enable: true, physicsType: 0, left: 100, right: 116, top: 100, bottom: 124, velocity: { x: 0, y: 0 } };
    const actor = createLiveObject('penguin', { body: actorBody });
    const wall = createLiveObject('brick_box', { body: { enable: true, physicsType: 1, left: 900, right: 916, top: 100, bottom: 124 } });
    const a = createRoom('a', [actor]), b = createRoom('b', [wall]);
    const h = createHarness([a,b], { getRuntimeSolidObjects: (room: {room:{id:string}}) => room.room.id === 'b' ? [wall] : [],
      getRoomWorldBounds: (room: {id:string}) => ({ left: room.id === 'a' ? 0 : 640, right: room.id === 'a' ? 640 : 1280, top: 0, bottom: 352 }) });
    h.controller.syncWorldColliders([a,b]);
    const group = h.registrations.find(r => r.object1 === actor.sprite && r.object2 instanceof FakeGroup)!;
    expect(group.process?.(actor.sprite,wall.sprite)).toBe(false);
    const count = h.registrations.filter(r=>r.object2 instanceof FakeGroup).length;
    actorBody.left=620;actorBody.right=636;h.controller.refreshWorldColliderReach();
    expect(group.process?.(actor.sprite,wall.sprite)).toBe(true);
    expect(h.registrations.filter(r=>r.object2 instanceof FakeGroup)).toHaveLength(count);
  });

});
