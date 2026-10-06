import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
import { getObjectById, ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../../config';
import type { LoadedFullRoom } from '../worldStreaming';
import type { LoadedRoomObject } from './model';
import { LiveObjectPartitionIndex } from './partitionIndex';

function createBody(left: number, top: number, width: number, height: number, dynamic = false) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    center: { x: left + width * 0.5, y: top + height * 0.5 },
    enable: true,
    ...(dynamic ? { velocity: { x: 0, y: 0 }, setAllowGravity: () => undefined } : {}),
  };
}

function createLiveObject(
  objectId: string,
  body: ReturnType<typeof createBody> | null,
  options: {
    instanceId?: string | null;
    layer?: LoadedRoomObject['layer'];
    key?: string;
  } = {},
): LoadedRoomObject {
  const config = getObjectById(objectId);
  if (!config) {
    throw new Error(`Missing ${objectId} test config.`);
  }
  return {
    key: options.key ?? objectId,
    placedInstanceId: options.instanceId ?? null,
    config,
    layer: options.layer ?? 'terrain',
    sprite: {
      active: true,
      body,
      x: body?.center.x ?? 0,
      y: body?.center.y ?? 0,
    },
    runtime: {},
  } as unknown as LoadedRoomObject;
}

function createRoom(
  id: string,
  coordinates: { x: number; y: number },
  liveObjects: LoadedRoomObject[],
): LoadedFullRoom<LoadedRoomObject, unknown> {
  return {
    room: { id, coordinates },
    liveObjects,
  } as LoadedFullRoom<LoadedRoomObject, unknown>;
}

function createIndex(rooms: Array<LoadedFullRoom<LoadedRoomObject, unknown>>) {
  return new LiveObjectPartitionIndex({
    getLoadedFullRooms: () => rooms,
    getRoomOrigin: (coordinates) => ({
      x: coordinates.x * ROOM_PX_WIDTH,
      y: coordinates.y * ROOM_PX_HEIGHT,
    }),
  });
}

function rectangle(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    width,
    height,
    left: x,
    right: x + width,
    top: y,
    bottom: y + height,
  } as Phaser.Geom.Rectangle;
}

describe('LiveObjectPartitionIndex', () => {
  it('swims only within the enabled terrain water volume, excluding solids and toxic water', () => {
    const poolBody = createBody(8, 8, 32, 24);
    const pool = createLiveObject('swimmable_water_pool', poolBody);
    const room = createRoom('water', { x: 0, y: 0 }, [pool,
      createLiveObject('water_surface_a', createBody(100, 8, 28, 16)),
      createLiveObject('swimmable_water_pool', createBody(200, 8, 32, 24), { layer: 'background' }),
      createLiveObject('swimmable_water_ripple', createBody(300, 8, 16, 12), { layer: 'foreground' }),
    ]);
    const index = createIndex([room]);
    expect(index.overlapsSwimmableWater(rectangle(10, 10, 14, 14))).toBe(true);
    expect(index.getRuntimeSolidObjects(room)).toEqual([]);
    for (const x of [100, 200, 300]) {
      expect(index.overlapsSwimmableWater(rectangle(x, 10, 14, 14))).toBe(false);
    }
    pool.sprite.active = false;
    expect(index.overlapsSwimmableWater(rectangle(10, 10, 14, 14))).toBe(false);
    pool.sprite.active = true;
    poolBody.enable = false;
    expect(index.overlapsSwimmableWater(rectangle(10, 10, 14, 14))).toBe(false);
    poolBody.enable = true;
    expect(index.overlapsSwimmableWater(rectangle(10, 10, 14, 14))).toBe(true);
  });

  it('does not swim while merely touching an edge, and joins adjacent water without a gap', () => {
    const pool = createLiveObject('swimmable_water_pool', createBody(32, 32, 32, 24));
    const ripple = createLiveObject('swimmable_water_ripple', createBody(64, 32, 16, 12));
    const index = createIndex([createRoom('water', { x: 0, y: 0 }, [pool, ripple])]);
    for (const bounds of [rectangle(18, 32, 14, 14), rectangle(80, 32, 14, 14),
      rectangle(32, 18, 14, 14), rectangle(32, 56, 14, 14)]) {
      expect(index.overlapsSwimmableWater(bounds)).toBe(false);
    }
    for (const x of [31.5, 57, 63.5, 65, 79.5]) {
      expect(index.overlapsSwimmableWater(rectangle(x, 32, 1, 1))).toBe(true);
    }
  });

  it('uses water across a room seam and drops unloaded or replaced volumes', () => {
    const water = createLiveObject('swimmable_water_pool', createBody(630, 8, 32, 24));
    const room = createRoom('water', { x: 0, y: 0 }, [water]);
    const rooms = [room];
    const index = createIndex(rooms);
    const bounds = rectangle(646, 10, 14, 14);
    expect(index.overlapsSwimmableWater(bounds)).toBe(true);
    room.liveObjects = [];
    expect(index.overlapsSwimmableWater(bounds)).toBe(false);
    room.liveObjects = [water];
    expect(index.overlapsSwimmableWater(bounds)).toBe(true);
    rooms.length = 0;
    expect(index.overlapsSwimmableWater(bounds)).toBe(false);
  });

  it('queries spatial bins without scanning distant water bodies each frame', () => {
    const near = createLiveObject('swimmable_water_pool', createBody(8, 8, 32, 24));
    const distantBody = createBody(500, 8, 32, 24);
    const distantRight = vi.fn(() => 532);
    Object.defineProperty(distantBody, 'right', { get: distantRight });
    const index = createIndex([createRoom('water', { x: 0, y: 0 }, [near,
      createLiveObject('swimmable_water_pool', distantBody),
    ])]);
    expect(index.overlapsSwimmableWater(rectangle(40, 10, 14, 14))).toBe(false);
    distantRight.mockClear();
    expect(index.overlapsSwimmableWater(rectangle(41, 10, 14, 14))).toBe(false);
    expect(distantRight).not.toHaveBeenCalled();
  });

  it('categorizes in source order, includes behavior-driven police, and keeps the last path target', () => {
    const brick = createLiveObject('brick_box', createBody(8, 8, 16, 16));
    const police = createLiveObject('police_patrolman', createBody(28, 8, 16, 16));
    const ladder = createLiveObject('ladder', createBody(48, 0, 16, 51));
    const crate = createLiveObject('crate', createBody(68, 8, 16, 16, true));
    const decorationNpc = createLiveObject(
      'jimothy',
      createBody(88, 8, 24, 16, true),
      { layer: 'background' },
    );
    const firstTarget = createLiveObject(
      'moving_platform_endpoint',
      null,
      { instanceId: 'target', key: 'target-first' },
    );
    const lastTarget = createLiveObject(
      'moving_platform_endpoint',
      null,
      { instanceId: 'target', key: 'target-last' },
    );
    const room = createRoom(
      'room',
      { x: 0, y: 0 },
      [brick, police, ladder, crate, decorationNpc, firstTarget, lastTarget],
    );
    const index = createIndex([room]);

    expect(index.getUpdatingObjects(room)).toEqual([police, crate, decorationNpc]);
    expect(index.getPushableObjects(room)).toEqual([crate]);
    expect(index.getRuntimeSolidObjects(room)).toEqual([brick, crate]);
    expect(index.getPathTarget(room, 'target')).toBe(lastTarget);
  });

  it('reuses a partition only while source identity and length are unchanged', () => {
    const firstCrate = createLiveObject('crate', createBody(8, 8, 16, 16, true));
    const secondCrate = createLiveObject('crate', createBody(28, 8, 16, 16, true));
    const room = createRoom('room', { x: 0, y: 0 }, [firstCrate]);
    const index = createIndex([room]);

    const initial = index.getPushableObjects(room);
    expect(index.getPushableObjects(room)).toBe(initial);

    room.liveObjects = [secondCrate];
    const replacedSource = index.getPushableObjects(room);
    expect(replacedSource).not.toBe(initial);
    expect(replacedSource).toEqual([secondCrate]);

    room.liveObjects.push(firstCrate);
    const changedLength = index.getPushableObjects(room);
    expect(changedLength).not.toBe(replacedSource);
    expect(changedLength).toEqual([secondCrate, firstCrate]);

    index.invalidateRoom(room.room.id);
    expect(index.getPushableObjects(room)).not.toBe(changedLength);
  });

  it('deduplicates multi-bin objects, preserves room/object order, and refreshes movement', () => {
    const spanningBody = createBody(8, 8, 136, 16, true);
    const spanningCrate = createLiveObject('crate', spanningBody, { key: 'spanning' });
    const laterCrate = createLiveObject('crate', createBody(24, 8, 16, 16, true), {
      key: 'later',
    });
    const nextRoomCrate = createLiveObject('crate', createBody(660, 8, 16, 16, true), {
      key: 'next-room',
    });
    const firstRoom = createRoom('first', { x: 0, y: 0 }, [spanningCrate, laterCrate]);
    const secondRoom = createRoom('second', { x: 1, y: 0 }, [nextRoomCrate]);
    const index = createIndex([firstRoom, secondRoom]);

    expect(Array.from(index.queryPushablesInBounds(rectangle(0, 0, 700, 64)))).toEqual([
      spanningCrate,
      laterCrate,
      nextRoomCrate,
    ]);

    spanningBody.left = 720;
    spanningBody.right = 856;
    spanningBody.center.x = 788;
    index.refreshDynamicObject(spanningCrate);

    expect(Array.from(index.queryPushablesInBounds(rectangle(0, 0, 200, 64)))).toEqual([
      laterCrate,
    ]);
    expect(Array.from(index.queryPushablesInBounds(rectangle(700, 0, 180, 64)))).toEqual([
      spanningCrate,
      nextRoomCrate,
    ]);
  });

  it('clamps negative padding and rejects distant rooms before reading object bodies', () => {
    const nearCrate = createLiveObject('crate', createBody(64, 8, 16, 16, true));
    const inaccessibleBody = {
      enable: true,
      center: { x: 5_128, y: 2_832 },
    } as ReturnType<typeof createBody>;
    for (const property of ['left', 'top', 'width', 'height'] as const) {
      Object.defineProperty(inaccessibleBody, property, {
        get: () => {
          throw new Error(`Distant body ${property} should not be read.`);
        },
      });
    }
    const farCrate = createLiveObject('crate', inaccessibleBody);
    const nearRoom = createRoom('near', { x: 0, y: 0 }, [nearCrate]);
    const farRoom = createRoom('far', { x: 8, y: 8 }, [farCrate]);
    const index = createIndex([farRoom, nearRoom]);

    expect(Array.from(index.queryPushablesInBounds(rectangle(0, 0, 64, 32), -100, -100)))
      .toEqual([]);
    expect(Array.from(index.queryPushablesInBounds(rectangle(0, 0, 64, 32), 1, 1)))
      .toEqual([nearCrate]);
  });

  it('creates dynamic indexes on demand and refreshes only existing category indexes', () => {
    const crateBody = createBody(8, 8, 16, 16, true);
    const crate = createLiveObject('crate', crateBody);
    const room = createRoom('room', { x: 0, y: 0 }, [crate]);
    const index = createIndex([room]);

    index.getPushableObjects(room);
    crateBody.left = 128;
    crateBody.right = 144;
    crateBody.center.x = 136;
    index.refreshDynamicObject(crate);

    expect(Array.from(index.queryPushablesInBounds(rectangle(120, 0, 32, 32)))).toEqual([crate]);

    index.prepareDynamicSpatialIndexes(room);
    crateBody.left = 192;
    crateBody.right = 208;
    crateBody.center.x = 200;
    index.refreshDynamicObject(crate);
    expect(Array.from(index.queryRuntimeSolidsInBounds(rectangle(184, 0, 32, 32))))
      .toEqual([crate]);
  });
});
