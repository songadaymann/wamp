import { describe, expect, it, vi } from 'vitest';

const { MockGameObject } = vi.hoisted(() => ({
  MockGameObject: class {},
}));

vi.mock('phaser', () => ({
  default: {
    GameObjects: {
      GameObject: MockGameObject,
    },
  },
}));

import {
  LiveObjectPhysicsRegistry,
  type LiveObjectPhysicsGroupCategory,
} from './physicsRegistry';

interface FakeGroup {
  defaults: object;
  members: Set<object>;
  add(value: object): void;
  remove(value: object): void;
  clear(): void;
  destroy(): void;
  getLength(): number;
}

function createHarness() {
  const groups: FakeGroup[] = [];
  const colliders: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const createCollider = () => {
    const collider = { destroy: vi.fn() };
    colliders.push(collider);
    return collider;
  };
  const scene = {
    physics: {
      add: {
        group: vi.fn(() => {
          const members = new Set<object>();
          const group: FakeGroup = {
            defaults: {},
            members,
            add: vi.fn((value: object) => {
              members.add(value);
            }),
            remove: vi.fn((value: object) => {
              members.delete(value);
            }),
            clear: vi.fn(() => {
              members.clear();
            }),
            destroy: vi.fn(),
            getLength: () => members.size,
          };
          groups.push(group);
          return group;
        }),
        collider: vi.fn(createCollider),
        overlap: vi.fn(createCollider),
      },
    },
  };
  const callbacks = {
    onPlayerCollectible: vi.fn(),
    onPlayerHazard: vi.fn(),
    onPlayerEnemy: vi.fn(),
    onPlayerNpc: vi.fn(),
    onPlayerSolid: vi.fn(),
    onPlayerBouncePad: vi.fn(),
    onPlayerProjectile: vi.fn(),
    onNpcEnvironment: vi.fn(),
    onDynamicSolid: vi.fn(),
    onProjectileSolid: vi.fn(),
    onProjectileNpc: vi.fn(),
    onProjectileTerrain: vi.fn(),
    shouldPlayerNpc: vi.fn(() => true),
    shouldPlayerSolid: vi.fn(() => true),
    shouldPlayerLadder: vi.fn(() => true),
    shouldDynamicSolid: vi.fn(() => true),
  };
  const registry = new LiveObjectPhysicsRegistry<object, object>(
    scene as never,
    callbacks,
  );
  return { registry, groups, colliders };
}

describe('live-object physics registry', () => {
  it('removes and restores category membership across sleep, wake, and despawn', () => {
    const { registry } = createHarness();
    const room = {};
    const liveObject = {};
    const sprite = new MockGameObject();
    const categories: readonly LiveObjectPhysicsGroupCategory[] = [
      'enemies',
      'dynamicActors',
    ];

    registry.register(
      { room, liveObject },
      sprite as never,
      categories,
    );
    expect(registry.getDebugSnapshot().memberships).toMatchObject({
      enemies: 1,
      dynamicActors: 1,
    });

    registry.setSleeping(liveObject, sprite as never, true);
    expect(registry.getDebugSnapshot().memberships).toMatchObject({
      enemies: 0,
      dynamicActors: 0,
    });

    registry.setSleeping(liveObject, sprite as never, false);
    const ladderSupport = new MockGameObject();
    registry.registerHelper(
      { room, liveObject },
      ladderSupport as never,
      'ladderSupports',
    );
    expect(registry.getDebugSnapshot().memberships).toMatchObject({
      enemies: 1,
      dynamicActors: 1,
      ladderSupports: 1,
    });

    registry.unregister(liveObject, sprite as never, [ladderSupport as never]);
    expect(registry.getDebugSnapshot().memberships).toMatchObject({
      enemies: 0,
      dynamicActors: 0,
      ladderSupports: 0,
    });
  });

  it('destroys room terrain colliders on unload and all registry state on shutdown', () => {
    const { registry, groups, colliders } = createHarness();
    const room = {};

    registry.registerTerrain(room, {
      terrainLayer: new MockGameObject() as never,
      terrainInsetBodies: new MockGameObject() as never,
    });
    expect(registry.getDebugSnapshot()).toMatchObject({
      terrainRoomCount: 1,
      sharedObjectColliderCount: 5,
    });
    expect(colliders).toHaveLength(9);

    registry.unregisterTerrain(room);
    expect(registry.getDebugSnapshot().terrainRoomCount).toBe(0);
    expect(colliders.slice(-4).every((collider) => (
      collider.destroy.mock.calls.length === 1
    ))).toBe(true);

    registry.destroy();
    expect(registry.getDebugSnapshot()).toMatchObject({
      terrainRoomCount: 0,
      playerColliderCount: 0,
      sharedObjectColliderCount: 0,
    });
    expect(groups).toHaveLength(10);
    expect(groups.every((group) => (
      (group.destroy as ReturnType<typeof vi.fn>).mock.calls.length === 1
    ))).toBe(true);
  });
});
