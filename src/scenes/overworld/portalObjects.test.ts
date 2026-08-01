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
      Distance: {
        Squared: (x1: number, y1: number, x2: number, y2: number) =>
          (x2 - x1) ** 2 + (y2 - y1) ** 2,
      },
    },
  },
}));

import { getObjectById } from '../../config';
import { parseRoomId, type RoomCoordinates } from '../../persistence/roomModel';
import type { LoadedRoomObject } from './liveObjects';
import {
  createPortalTargetRoomPreparationAdapter,
  OverworldPortalObjectController,
} from './portalObjects';
import type { LoadedFullRoom } from './worldStreaming';

interface TestBody {
  x: number;
  y: number;
  width: number;
  height: number;
  center: { x: number; y: number };
  velocity: { x: number; y: number };
}

function setBodyPosition(body: TestBody, x: number, y: number): void {
  body.x = x;
  body.y = y;
  body.center.x = x + body.width * 0.5;
  body.center.y = y + body.height * 0.5;
}

function createPortalObject(
  id: 'portal_a' | 'portal_b',
  instanceId: string,
  x: number,
  y: number,
  linkedTargetRoomId: string | null = null,
  linkedTargetInstanceId: string | null = null,
): LoadedRoomObject {
  const config = getObjectById(id);
  if (!config) throw new Error(`Missing ${id} test config.`);
  return {
    key: `${instanceId}:${id}`,
    placedInstanceId: instanceId,
    linkedTargetRoomId,
    linkedTargetInstanceId,
    config,
    sprite: {
      active: true,
      x,
      y,
      getBounds: () => new MockRectangle(x - 8, y - 8, 16, 16),
    },
  } as unknown as LoadedRoomObject;
}

function createLoadedRoom(
  id: string,
  coordinates: RoomCoordinates,
  liveObjects: LoadedRoomObject[],
  collisionReady = true,
): LoadedFullRoom<LoadedRoomObject> {
  return {
    room: { id, coordinates },
    liveObjects,
    collisionReady,
  } as unknown as LoadedFullRoom<LoadedRoomObject>;
}

function createHarness() {
  const sourcePortal = createPortalObject(
    'portal_a',
    'source-portal',
    16,
    16,
    '2,0',
    'target-portal',
  );
  const sourceRoom = createLoadedRoom('0,0', { x: 0, y: 0 }, [sourcePortal]);
  const rooms = new Map<string, LoadedFullRoom<LoadedRoomObject>>([[sourceRoom.room.id, sourceRoom]]);
  const body: TestBody = {
    x: 8,
    y: 8,
    width: 16,
    height: 16,
    center: { x: 16, y: 16 },
    velocity: { x: 75, y: -40 },
  };
  let mode = 'play';
  const preparePortalTargetRoomForTransition = vi.fn(() => false);
  const clearPortalTargetRoomPreparation = vi.fn();
  const adapter = createPortalTargetRoomPreparationAdapter({
    resolveRoomCoordinates: parseRoomId,
    preparePortalTargetRoomForTransition,
    clearPortalTargetRoomPreparation,
  });
  const host = {
    getMode: vi.fn(() => mode),
    getCurrentTime: vi.fn(() => 1_000),
    getPlayerBody: vi.fn(() => body),
    getLoadedFullRooms: vi.fn(() => rooms.values()),
    getLoadedFullRoomById: vi.fn((roomId: string) => rooms.get(roomId) ?? null),
    requestPortalTargetRoomPreparation: vi.fn((roomId: string) => adapter.request(roomId)),
    clearPortalTargetRoomPreparation: vi.fn((roomId: string) => adapter.clear(roomId)),
    authorizeRoomTransition: vi.fn(),
    teleportPlayerTo: vi.fn(),
    playPortalFx: vi.fn(),
  };
  return {
    adapter,
    body,
    clearPortalTargetRoomPreparation,
    controller: new OverworldPortalObjectController(host as never),
    host,
    preparePortalTargetRoomForTransition,
    rooms,
    setMode: (nextMode: string) => { mode = nextMode; },
    sourcePortal,
    sourceRoom,
  };
}

describe('portal target room preparation adapter', () => {
  it('accepts a valid cold destination even while streaming reports it is not ready', () => {
    const prepare = vi.fn(() => false);
    const clear = vi.fn();
    const adapter = createPortalTargetRoomPreparationAdapter({
      resolveRoomCoordinates: parseRoomId,
      preparePortalTargetRoomForTransition: prepare,
      clearPortalTargetRoomPreparation: clear,
    });

    expect(adapter.request('5,7')).toBe(true);
    expect(prepare).toHaveBeenCalledWith({ x: 5, y: 7 });
    expect(adapter.request('not-a-room')).toBe(false);
    expect(prepare).toHaveBeenCalledOnce();
    adapter.clear('5,7');
    expect(clear).toHaveBeenCalledWith('5,7');
  });
});

describe('OverworldPortalObjectController cold destinations', () => {
  it('retains cold portal preparation across movement prediction clears and teleports only after collision is ready', () => {
    const harness = createHarness();
    const clearMovementPrediction = vi.fn();

    harness.controller.update();
    clearMovementPrediction();
    harness.controller.update();

    expect(harness.preparePortalTargetRoomForTransition).toHaveBeenNthCalledWith(1, { x: 2, y: 0 });
    expect(harness.preparePortalTargetRoomForTransition).toHaveBeenNthCalledWith(2, { x: 2, y: 0 });
    expect(harness.clearPortalTargetRoomPreparation).not.toHaveBeenCalled();
    expect(harness.host.teleportPlayerTo).not.toHaveBeenCalled();

    const targetPortal = createPortalObject('portal_b', 'target-portal', 1_296, 16);
    const targetRoom = createLoadedRoom('2,0', { x: 2, y: 0 }, [targetPortal], false);
    harness.rooms.set(targetRoom.room.id, targetRoom);
    harness.controller.update();
    expect(harness.host.teleportPlayerTo).not.toHaveBeenCalled();

    targetRoom.collisionReady = true;
    harness.controller.update();

    expect(harness.host.authorizeRoomTransition).toHaveBeenCalledWith({ x: 2, y: 0 });
    expect(harness.host.teleportPlayerTo).toHaveBeenCalledWith(1_296, 16, { x: 75, y: -40 });
    expect(harness.host.playPortalFx).toHaveBeenCalledWith(1_296, 16, { x: 2, y: 0 });

    setBodyPosition(harness.body, 200, 200);
    harness.controller.update();
    expect(harness.clearPortalTargetRoomPreparation).toHaveBeenCalledOnce();
    expect(harness.clearPortalTargetRoomPreparation).toHaveBeenCalledWith('2,0');
  });

  it('clears retained preparation when a link becomes invalid', () => {
    const harness = createHarness();
    harness.controller.update();

    harness.sourcePortal.linkedTargetRoomId = 'not-a-room';
    harness.controller.update();

    expect(harness.clearPortalTargetRoomPreparation).toHaveBeenCalledOnce();
    expect(harness.clearPortalTargetRoomPreparation).toHaveBeenCalledWith('2,0');
    expect(harness.preparePortalTargetRoomForTransition).toHaveBeenCalledOnce();
    expect(harness.host.teleportPlayerTo).not.toHaveBeenCalled();
  });

  it.each(['reset', 'destroy', 'leave-play'] as const)(
    'clears retained preparation on controller %s',
    (reason) => {
      const harness = createHarness();
      harness.controller.update();

      if (reason === 'reset') {
        harness.controller.resetAll();
      } else if (reason === 'destroy') {
        harness.controller.destroy();
      } else {
        harness.setMode('browse');
        harness.controller.update();
      }

      expect(harness.clearPortalTargetRoomPreparation).toHaveBeenCalledOnce();
      expect(harness.clearPortalTargetRoomPreparation).toHaveBeenCalledWith('2,0');
    },
  );
});
