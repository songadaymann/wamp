import { describe, expect, it } from 'vitest';
import {
  cloneRoomSnapshot,
  createDefaultRoomSnapshot,
  type RoomSnapshotView,
} from '../persistence/roomModel';
import {
  getCachedRoomWeatherSurfaceSegments,
} from './surfaces';

describe('room weather surface cache', () => {
  it('reuses surfaces for the same room identity, version, and origin', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    room.tileData.terrain[10][4] = 9_999;
    const view: RoomSnapshotView = room;
    const origin = { x: 3_200, y: 2_464 };

    const first = getCachedRoomWeatherSurfaceSegments(view, origin);
    const second = getCachedRoomWeatherSurfaceSegments(view, origin);

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('invalidates on identity, version, timestamp, or origin changes', () => {
    const room = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    room.tileData.terrain[10][4] = 9_999;
    const origin = { x: 3_200, y: 2_464 };
    const first = getCachedRoomWeatherSurfaceSegments(room, origin);

    const replacement = cloneRoomSnapshot(room);
    const replacementResult = getCachedRoomWeatherSurfaceSegments(replacement, origin);
    expect(replacementResult).not.toBe(first);

    const beforeVersionChange = replacementResult;
    replacement.version += 1;
    const afterVersionChange = getCachedRoomWeatherSurfaceSegments(replacement, origin);
    expect(afterVersionChange).not.toBe(beforeVersionChange);

    const beforeTimestampChange = afterVersionChange;
    replacement.updatedAt = `${replacement.updatedAt}:new`;
    const afterTimestampChange = getCachedRoomWeatherSurfaceSegments(replacement, origin);
    expect(afterTimestampChange).not.toBe(beforeTimestampChange);

    const movedOriginResult = getCachedRoomWeatherSurfaceSegments(replacement, {
      x: origin.x + 1,
      y: origin.y,
    });
    expect(movedOriginResult).not.toBe(afterTimestampChange);
  });
});
