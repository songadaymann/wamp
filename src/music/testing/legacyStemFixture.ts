// Test-only fixtures for persisted rooms from the retired stems editor.
import { DEFAULT_ROOM_MUSIC_BAR_COUNT, createEmptyRoomMusicLaneBarAssignments, getRoomMusicPackBarCount, type RoomMusicLaneAssignments, type RoomMusicArrangement, type RoomMusicPackId, type StemArrangementRoomMusic } from '../model';


function createEmptyRoomMusicLaneAssignments(
  barCount: number = DEFAULT_ROOM_MUSIC_BAR_COUNT,
): RoomMusicLaneAssignments {
  return {
    drums: createEmptyRoomMusicLaneBarAssignments(barCount),
    bass: createEmptyRoomMusicLaneBarAssignments(barCount),
    arp: createEmptyRoomMusicLaneBarAssignments(barCount),
    hold: createEmptyRoomMusicLaneBarAssignments(barCount),
    melody: createEmptyRoomMusicLaneBarAssignments(barCount),
  };
}


function createEmptyRoomMusicArrangement(
  barCount: number = DEFAULT_ROOM_MUSIC_BAR_COUNT,
): RoomMusicArrangement {
  return {
    laneAssignments: createEmptyRoomMusicLaneAssignments(barCount),
  };
}


export function createDefaultRoomMusic(packId: RoomMusicPackId = 'wamp-v1'): StemArrangementRoomMusic {
  const barCount = getRoomMusicPackBarCount(packId);
  return {
    kind: 'stemArrangement',
    packId,
    arrangement: createEmptyRoomMusicArrangement(barCount),
  };
}
