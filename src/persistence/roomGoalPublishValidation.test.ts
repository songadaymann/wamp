import { describe, expect, it } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomSnapshot, getRoomPublishValidationError } from './roomModel';

describe('published goal object categories', () => {
  it('counts direct and contained enemies while rejecting hazards and decorative contents', () => {
    const room = createDefaultRoomSnapshot();
    room.goal = { type: 'defeat_all', timeLimitMs: null };
    room.placedObjects = [{ id: 'spike', instanceId: 'hazard', x: 88, y: 200 }];
    expect(getRoomPublishValidationError(room)).toMatch(/at least one enemy/);
    room.placedObjects = [{ id: 'slime_blue', instanceId: 'enemy', x: 88, y: 200 }];
    expect(getRoomPublishValidationError(cloneRoomSnapshot(room))).toBeNull();
    room.placedObjects = [{ id: 'cage', instanceId: 'cage', containedObjectId: 'slime_blue', x: 88, y: 200 }];
    expect(getRoomPublishValidationError(cloneRoomSnapshot(room))).toBeNull();
    room.placedObjects = [{ id: 'coin_gold', instanceId: 'decoration', containedObjectId: 'slime_blue', x: 88, y: 200 }];
    expect(getRoomPublishValidationError(room)).toMatch(/at least one enemy/);
  });
});
