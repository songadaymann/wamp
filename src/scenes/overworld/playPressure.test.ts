import { describe, expect, it } from 'vitest';

import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import { computeLocalPlayPressureMetrics } from './playPressure';

describe('local play pressure policy', () => {
  it('weights focus, cardinal, and diagonal room pressure independently', () => {
    const focus = createRoomWithCrates('0,0', { x: 0, y: 0 }, 1);
    const cardinal = createRoomWithCrates('1,0', { x: 1, y: 0 }, 1);
    const diagonal = createRoomWithCrates('1,1', { x: 1, y: 1 }, 1);
    const rooms = new Map([
      [focus.id, focus],
      [cardinal.id, cardinal],
      [diagonal.id, diagonal],
    ]);

    const metrics = computeLocalPlayPressureMetrics({
      focusCoordinates: focus.coordinates,
      getRoomSnapshot: (coordinates) => rooms.get(`${coordinates.x},${coordinates.y}`) ?? null,
      wasReduced: false,
    });

    expect(metrics.score).toBe(46.2);
    expect(metrics.profile).toBe('normal');
    expect(metrics.fullRoomBudgetOverride).toBeNull();
    expect(metrics.roomBreakdowns).toEqual([
      expect.objectContaining({
        roomId: focus.id,
        weight: 1,
        roomScore: 22,
        weightedRoomScore: 22,
        dynamicBodyCount: 1,
        pushableCount: 1,
        solidRuntimeObjectCount: 1,
      }),
      expect.objectContaining({
        roomId: cardinal.id,
        weight: 0.7,
        roomScore: 22,
        weightedRoomScore: 15.4,
      }),
      expect.objectContaining({
        roomId: diagonal.id,
        weight: 0.4,
        roomScore: 22,
        weightedRoomScore: 8.8,
      }),
    ]);
  });

  it('enters reduced mode at the high threshold and applies its one-room budget', () => {
    const focus = createRoomWithCrates('0,0', { x: 0, y: 0 }, 28, 2);

    const metrics = computeLocalPlayPressureMetrics({
      focusCoordinates: focus.coordinates,
      getRoomSnapshot: (coordinates) =>
        coordinates.x === focus.coordinates.x && coordinates.y === focus.coordinates.y
          ? focus
          : null,
      wasReduced: false,
    });

    expect(metrics.score).toBe(620);
    expect(metrics.profile).toBe('reduced');
    expect(metrics.fullRoomBudgetOverride).toBe(1);
  });

  it('uses hysteresis to retain reduced mode at 500 and release it below 500', () => {
    const retained = createRoomWithCrates('0,0', { x: 0, y: 0 }, 22, 8);
    const released = createRoomWithCrates('0,0', { x: 0, y: 0 }, 22, 7);

    const ordinaryAtMiddleScore = computeLocalPlayPressureMetrics({
      focusCoordinates: retained.coordinates,
      getRoomSnapshot: (coordinates) =>
        coordinates.x === retained.coordinates.x && coordinates.y === retained.coordinates.y
          ? retained
          : null,
      wasReduced: false,
    });
    const retainedReduced = computeLocalPlayPressureMetrics({
      focusCoordinates: retained.coordinates,
      getRoomSnapshot: (coordinates) =>
        coordinates.x === retained.coordinates.x && coordinates.y === retained.coordinates.y
          ? retained
          : null,
      wasReduced: true,
    });
    const releasedReduced = computeLocalPlayPressureMetrics({
      focusCoordinates: released.coordinates,
      getRoomSnapshot: (coordinates) =>
        coordinates.x === released.coordinates.x && coordinates.y === released.coordinates.y
          ? released
          : null,
      wasReduced: true,
    });

    expect(ordinaryAtMiddleScore).toMatchObject({
      score: 500,
      profile: 'normal',
      fullRoomBudgetOverride: null,
    });
    expect(retainedReduced).toMatchObject({
      score: 500,
      profile: 'reduced',
      fullRoomBudgetOverride: 1,
    });
    expect(releasedReduced).toMatchObject({
      score: 498,
      profile: 'normal',
      fullRoomBudgetOverride: null,
    });
  });
});

function createRoomWithCrates(
  id: string,
  coordinates: { x: number; y: number },
  crateCount: number,
  solidObjectCount = 0,
): RoomSnapshot {
  const room = createDefaultRoomSnapshot(id, coordinates);
  room.placedObjects = [
    ...Array.from({ length: crateCount }, (_, index) => ({
      id: 'crate',
      x: (index % 20) * 16,
      y: Math.floor(index / 20) * 16,
      instanceId: `${id}:crate:${index}`,
    })),
    ...Array.from({ length: solidObjectCount }, (_, index) => ({
      id: 'brick_box',
      x: (index % 20) * 16,
      y: 64 + Math.floor(index / 20) * 16,
      instanceId: `${id}:brick-box:${index}`,
    })),
  ];
  return room;
}
