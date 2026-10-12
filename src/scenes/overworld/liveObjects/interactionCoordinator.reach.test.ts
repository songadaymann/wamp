import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { getObjectById } from '../../../config';
import type { LoadedFullRoom } from '../worldStreaming';
import { LiveObjectInteractionCoordinator } from './interactionCoordinator';
import type { LoadedRoomObject } from './model';

// F008: moving objects only collide with the loaded rooms they are near, and their reach
// grows as they move.

const ROOM_W = 640;
const ROOM_H = 352;

interface TestBody {
  enable: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  velocity: { x: number; y: number };
}

interface Registration {
  object1: unknown;
  object2: unknown;
  collide?: () => void;
}

function body(left: number, top = 100, velocityX = 0): TestBody {
  return { enable: true, left, right: left + 16, top, bottom: top + 16, velocity: { x: velocityX, y: 0 } };
}

function moveBody(target: TestBody, left: number, velocityX = target.velocity.x): void {
  target.left = left;
  target.right = left + 16;
  target.velocity.x = velocityX;
}

function createLiveObject(objectId: string, key: string, objectBody: TestBody): LoadedRoomObject {
  const config = getObjectById(objectId);
  if (!config) throw new Error(`Missing ${objectId} test config.`);
  return {
    key,
    layer: 'terrain',
    config,
    sprite: { active: true, body: objectBody, key },
    helpers: [],
    interactions: [],
    worldColliders: [],
    runtime: { directionX: 1, npcMode: 'idle', npcPushable: false, npcPlayerCollision: false },
  } as unknown as LoadedRoomObject;
}

function createRoom(
  x: number,
  liveObjects: LoadedRoomObject[],
): LoadedFullRoom<LoadedRoomObject, unknown> {
  const id = `room-${x}`;
  return {
    room: { id, coordinates: { x, y: 0 } },
    liveObjects,
    terrainLayer: { terrain: id },
    terrainInsetBodies: null,
  } as unknown as LoadedFullRoom<LoadedRoomObject, unknown>;
}

function createHarness(options: { placesRooms?: boolean } = {}) {
  const registrations: Registration[] = [];
  const handleActorPushableContact = vi.fn();
  const coordinator = new LiveObjectInteractionCoordinator({
    scene: {
      physics: {
        add: {
          collider: (object1: unknown, object2: unknown, collide?: () => void) => {
            const registration = { object1, object2, collide, active: true, destroy: vi.fn() };
            registrations.push(registration);
            return registration;
          },
          overlap: vi.fn(),
        },
      },
    } as never,
    getPlayer: () => null,
    getPlayerPickupSensor: () => null,
    getPlayerBody: () => null,
    destroyInteractions: vi.fn(),
    destroyWorldColliders: (liveObject) => {
      for (const collider of liveObject.worldColliders) collider.destroy();
      liveObject.worldColliders = [];
    },
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
    shouldCollideWithLiveObject: (liveObject) =>
      Boolean(liveObject.sprite.active && (liveObject.sprite.body as TestBody | null)?.enable),
    shouldCollideWithLadderTopSupport: vi.fn(() => true),
    getRuntimeSolidObjects: (room) => room.liveObjects.filter((object) => object.config.id === 'crate'),
    ...(options.placesRooms === false
      ? {}
      : {
          getRoomWorldBounds: (room: { coordinates: { x: number; y: number } }) => ({
            left: room.coordinates.x * ROOM_W,
            right: (room.coordinates.x + 1) * ROOM_W,
            top: room.coordinates.y * ROOM_H,
            bottom: (room.coordinates.y + 1) * ROOM_H,
          }),
        }),
    usesDynamicObjectBody: (config) => config.id === 'crate' || config.id === 'penguin',
    handleBlockSwitchActorHit: vi.fn(),
    canActorPushPushableByContact: (liveObject) => liveObject.config.id === 'penguin',
    handleActorPushableContact,
  });
  const terrainOf = (liveObject: LoadedRoomObject) =>
    registrations
      .filter((registration) => registration.object1 === liveObject.sprite && 'terrain' in (registration.object2 as object))
      .map((registration) => (registration.object2 as { terrain: string }).terrain)
      .sort();
  const pairsOf = (liveObject: LoadedRoomObject) =>
    registrations
      .filter((registration) => registration.object1 === liveObject.sprite && !('terrain' in (registration.object2 as object)))
      .map((registration) => (registration.object2 as { key: string }).key)
      .sort();
  return { coordinator, registrations, terrainOf, pairsOf, handleActorPushableContact };
}

describe('world collider reach', () => {
  it('gives a moving object terrain and obstacle colliders only for rooms it is near', () => {
    const penguin = createLiveObject('penguin', 'penguin', body(100));
    const nearCrate = createLiveObject('crate', 'crate-near', body(300));
    const farCrate = createLiveObject('crate', 'crate-far', body(1500));
    const rooms = [createRoom(0, [penguin, nearCrate]), createRoom(1, []), createRoom(2, [farCrate])];
    const harness = createHarness();

    harness.coordinator.syncWorldColliders(rooms);

    expect(harness.terrainOf(penguin)).toEqual(['room-0']);
    expect(harness.pairsOf(penguin)).toEqual(['crate-near']);
    expect(harness.terrainOf(farCrate)).toEqual(['room-2']);
  });

  it('includes a neighbouring room when the body is close to the shared edge', () => {
    const penguin = createLiveObject('penguin', 'penguin', body(560));
    const rooms = [createRoom(0, [penguin]), createRoom(1, []), createRoom(2, [])];
    const harness = createHarness();

    harness.coordinator.syncWorldColliders(rooms);

    expect(harness.terrainOf(penguin)).toEqual(['room-0', 'room-1']);
  });

  it('looks further ahead for fast bodies', () => {
    const penguin = createLiveObject('penguin', 'penguin', body(300, 100, 600));
    const rooms = [createRoom(0, [penguin]), createRoom(1, []), createRoom(2, [])];
    const harness = createHarness();

    harness.coordinator.syncWorldColliders(rooms);

    expect(harness.terrainOf(penguin)).toEqual(['room-0', 'room-1']);
  });

  it('grows reach once a frame as an object travels toward another room', () => {
    const penguinBody = body(100);
    const penguin = createLiveObject('penguin', 'penguin', penguinBody);
    const farCrate = createLiveObject('crate', 'crate-far', body(1500));
    const rooms = [createRoom(0, [penguin]), createRoom(1, []), createRoom(2, [farCrate])];
    const harness = createHarness();
    harness.coordinator.syncWorldColliders(rooms);

    moveBody(penguinBody, 400);
    harness.coordinator.refreshWorldColliderReach();
    expect(harness.terrainOf(penguin)).toEqual(['room-0']);

    moveBody(penguinBody, 600);
    harness.coordinator.refreshWorldColliderReach();
    expect(harness.terrainOf(penguin)).toEqual(['room-0', 'room-1']);
    expect(harness.pairsOf(penguin)).toEqual([]);

    moveBody(penguinBody, 1240);
    harness.coordinator.refreshWorldColliderReach();
    harness.coordinator.refreshWorldColliderReach();
    expect(harness.terrainOf(penguin)).toEqual(['room-0', 'room-1', 'room-2']);
    expect(harness.pairsOf(penguin)).toEqual(['crate-far']);
    expect(penguin.worldColliders).toHaveLength(4);

    const pushCollider = harness.registrations.find(
      (registration) => registration.object1 === penguin.sprite && registration.object2 === farCrate.sprite,
    );
    pushCollider?.collide?.();
    expect(harness.handleActorPushableContact).toHaveBeenCalledWith(penguin, farCrate);
  });

  it('pairs a moving obstacle with actors in the rooms it reaches', () => {
    const crateBody = body(1500);
    const penguin = createLiveObject('penguin', 'penguin', body(100));
    const crate = createLiveObject('crate', 'crate', crateBody);
    const rooms = [createRoom(0, [penguin]), createRoom(1, []), createRoom(2, [crate])];
    const harness = createHarness();
    harness.coordinator.syncWorldColliders(rooms);
    expect(harness.pairsOf(penguin)).toEqual([]);

    moveBody(crateBody, 1000);
    harness.coordinator.refreshWorldColliderReach();
    expect(harness.pairsOf(penguin)).toEqual([]);

    moveBody(crateBody, 620);
    harness.coordinator.refreshWorldColliderReach();
    expect(harness.pairsOf(penguin)).toEqual(['crate']);
    expect(harness.terrainOf(crate)).toEqual(['room-0', 'room-1', 'room-2']);
  });

  it('keeps one collider per pair of moving solids', () => {
    const firstBody = body(100);
    const first = createLiveObject('crate', 'crate-a', firstBody);
    const second = createLiveObject('crate', 'crate-b', body(1500));
    const rooms = [createRoom(0, [first]), createRoom(1, []), createRoom(2, [second])];
    const harness = createHarness();
    harness.coordinator.syncWorldColliders(rooms);

    moveBody(firstBody, 1240);
    harness.coordinator.refreshWorldColliderReach();
    harness.coordinator.refreshWorldColliderReach();

    const pairs = harness.registrations.filter(
      (registration) =>
        (registration.object1 === first.sprite && registration.object2 === second.sprite)
        || (registration.object1 === second.sprite && registration.object2 === first.sprite),
    );
    expect(pairs).toHaveLength(1);
  });

  it('does not grow into suspended rooms, or for sleeping or removed objects', () => {
    const penguinBody = body(100);
    const sleeperBody = body(120);
    const penguin = createLiveObject('penguin', 'penguin', penguinBody);
    const sleeper = createLiveObject('penguin', 'sleeper', sleeperBody);
    const rooms = [createRoom(0, [penguin, sleeper]), createRoom(1, [])];
    const harness = createHarness();
    harness.coordinator.syncWorldColliders(rooms);

    rooms[1].runtimeSuspended = true;
    moveBody(penguinBody, 600);
    harness.coordinator.refreshWorldColliderReach();
    expect(harness.terrainOf(penguin)).toEqual(['room-0']);

    rooms[1].runtimeSuspended = false;
    sleeperBody.enable = false;
    moveBody(sleeperBody, 600);
    (penguin.sprite as { active: boolean }).active = false;
    harness.coordinator.refreshWorldColliderReach();
    expect(harness.terrainOf(penguin)).toEqual(['room-0']);
    expect(harness.terrainOf(sleeper)).toEqual(['room-0']);

    sleeperBody.enable = true;
    harness.coordinator.refreshWorldColliderReach();
    expect(harness.terrainOf(sleeper)).toEqual(['room-0', 'room-1']);
  });

  it('keeps every loaded room in reach when the host cannot place rooms', () => {
    const penguin = createLiveObject('penguin', 'penguin', body(100));
    const farCrate = createLiveObject('crate', 'crate-far', body(1500));
    const rooms = [createRoom(0, [penguin]), createRoom(1, []), createRoom(2, [farCrate])];
    const harness = createHarness({ placesRooms: false });

    harness.coordinator.syncWorldColliders(rooms);
    harness.coordinator.refreshWorldColliderReach();

    expect(harness.terrainOf(penguin)).toEqual(['room-0', 'room-1', 'room-2']);
    expect(harness.pairsOf(penguin)).toEqual(['crate-far']);
  });
});
