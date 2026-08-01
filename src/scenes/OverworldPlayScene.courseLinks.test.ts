import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { getObjectById, getObjectDisplayOffset } from '../config';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { OverworldPlayScene } from './OverworldPlayScene';

describe('OverworldPlayScene prepared course links', () => {
  it('resolves a same-id replacement target from the prepared snapshot instead of the old runtime', () => {
    const oldRoom = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const replacementRoom = createDefaultRoomSnapshot('5,7', { x: 5, y: 7 });
    const sourceInstanceId = 'moving-platform-source';
    const targetInstanceId = 'moving-platform-target';
    oldRoom.placedObjects = [
      {
        id: 'moving_platform',
        x: 24,
        y: 48,
        instanceId: sourceInstanceId,
        linkedTargetInstanceIds: [targetInstanceId],
      },
      {
        id: 'moving_platform_endpoint',
        x: 48,
        y: 64,
        instanceId: targetInstanceId,
      },
    ];
    replacementRoom.version = oldRoom.version + 1;
    replacementRoom.updatedAt = `${oldRoom.updatedAt}:replacement`;
    replacementRoom.placedObjects = [
      {
        id: 'moving_platform',
        x: 24,
        y: 48,
        instanceId: sourceInstanceId,
        linkedTargetInstanceIds: [targetInstanceId],
      },
      {
        id: 'moving_platform_endpoint',
        x: 320,
        y: 192,
        instanceId: targetInstanceId,
      },
    ];
    const liveObject = {
      placedInstanceId: sourceInstanceId,
      linkedTargetRoomId: null,
      linkedTargetInstanceId: null,
      linkedTargetInstanceIds: [] as string[],
      linkedTargetWorldX: null,
      linkedTargetWorldY: null,
    };
    const oldRuntime = { room: oldRoom, liveObjects: [] };
    const replacementRuntime = { room: replacementRoom, liveObjects: [liveObject] };
    const loadedRooms = new Map([[oldRoom.id, oldRuntime]]);
    const roomOrigin = { x: 3_200, y: 2_464 };
    const getRoomSnapshotForCoordinates = vi.fn(() => oldRoom);
    const harness = Object.assign(
      Object.create(OverworldPlayScene.prototype),
      {
        activeCourseRun: null,
        worldStreamingController: {
          getLoadedFullRoomsById: () => loadedRooms,
        },
        getRoomOrigin: vi.fn(() => roomOrigin),
        getRoomSnapshotForCoordinates,
      },
    );

    callSyncActiveCourseObjectLinks(harness, [replacementRuntime]);

    const targetConfig = getObjectById('moving_platform_endpoint');
    const targetOffset = targetConfig
      ? getObjectDisplayOffset(targetConfig)
      : { x: 0, y: 0 };
    expect(liveObject.linkedTargetRoomId).toBe(replacementRoom.id);
    expect(liveObject.linkedTargetInstanceId).toBe(targetInstanceId);
    expect(liveObject.linkedTargetInstanceIds).toEqual([targetInstanceId]);
    expect(liveObject.linkedTargetWorldX).toBe(
      roomOrigin.x + replacementRoom.placedObjects[1].x + targetOffset.x,
    );
    expect(liveObject.linkedTargetWorldY).toBe(
      roomOrigin.y + replacementRoom.placedObjects[1].y + targetOffset.y,
    );
    expect(liveObject.linkedTargetWorldX).not.toBe(
      roomOrigin.x + oldRoom.placedObjects[1].x + targetOffset.x,
    );
    expect(getRoomSnapshotForCoordinates).not.toHaveBeenCalled();
  });
});

function callSyncActiveCourseObjectLinks(harness: object, loadedRooms: object[]): void {
  (
    OverworldPlayScene.prototype as unknown as {
      syncActiveCourseObjectLinks(rooms: Iterable<object>): void;
    }
  ).syncActiveCourseObjectLinks.call(harness, loadedRooms);
}
