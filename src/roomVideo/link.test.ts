import { describe, expect, it } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomSnapshot } from '../persistence/roomModel';
import { hitsRoomVideoAnchor, ROOM_VIDEO_LINK_TARGET_ID } from './link';
import { roomHasPressedPressurePlate } from './pressure';
import type { RoomVideo } from './model';

const video = {
  youtubeId: 'abcdefghijk',
  x: 40,
  y: 80,
  width: 160,
  aspect: 16 / 9,
  loop: true,
  autoplay: false,
  trigger: true,
  volume: 0.8,
  muteMusic: false,
  snap: false,
} satisfies RoomVideo;

describe('room video pressure anchor', () => {
  it('hits the video frame and keeps the connection dot in the center', () => {
    expect(hitsRoomVideoAnchor(video, 120, 125, 1)).toBe(true);
    expect(hitsRoomVideoAnchor(video, 40, 80, 1)).toBe(true);
    expect(hitsRoomVideoAnchor(video, 20, 80, 1)).toBe(false);
    expect(hitsRoomVideoAnchor({ ...video, trigger: false }, 120, 125, 1)).toBe(false);
  });

  it('keeps a pressure plate linked to the video when the room is saved', () => {
    const room = createDefaultRoomSnapshot();
    room.placedObjects = [{
      id: 'floor_trigger',
      instanceId: 'plate',
      x: 40,
      y: 80,
      triggerTargetInstanceId: ROOM_VIDEO_LINK_TARGET_ID,
    }];
    expect(cloneRoomSnapshot(room).placedObjects[0]?.triggerTargetInstanceId).toBe(ROOM_VIDEO_LINK_TARGET_ID);
  });

  it('starts the video only from a plate linked to the anchor', () => {
    const rooms = [{
      room: { id: 'room-1' },
      liveObjects: [
        { config: { id: 'floor_trigger' }, linkedTargetInstanceId: 'door', runtime: { pressureActive: true } },
        { config: { id: 'floor_trigger' }, linkedTargetInstanceId: ROOM_VIDEO_LINK_TARGET_ID, runtime: { pressureActive: true } },
      ],
    }];
    expect(roomHasPressedPressurePlate(rooms, 'room-1')).toBe(true);
    expect(roomHasPressedPressurePlate([{
      room: { id: 'room-1' },
      liveObjects: [
        { config: { id: 'floor_trigger' }, linkedTargetInstanceId: 'door', runtime: { pressureActive: true } },
      ],
    }], 'room-1')).toBe(false);
  });
});
