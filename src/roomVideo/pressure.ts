import { isRoomVideoLinkTarget } from './link';

export function roomHasPressedPressurePlate(
  rooms: Iterable<{
    room: { id: string };
    liveObjects: Iterable<{
      config: { id: string };
      linkedTargetInstanceId?: string | null;
      runtime: { pressureActive?: boolean };
      sprite?: { active?: boolean };
    }>;
  }>,
  roomId: string,
): boolean {
  for (const loadedRoom of rooms) {
    if (loadedRoom.room.id !== roomId) continue;
    for (const liveObject of loadedRoom.liveObjects) {
      if (
        liveObject.config.id === 'floor_trigger'
        && isRoomVideoLinkTarget(liveObject.linkedTargetInstanceId)
        && liveObject.sprite?.active !== false
        && liveObject.runtime.pressureActive === true
      ) {
        return true;
      }
    }
  }
  return false;
}
