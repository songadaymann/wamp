import {
  ROOM_MUSIC_LANE_IDS,
  type RoomMusicClip,
  type RoomMusicLane,
  type RoomMusicLaneId,
  type RoomMusicPack,
  type RoomMusicPackId,
} from './model';

const WAMP_V1_LANES: RoomMusicLane[] = [
  { id: 'drums', label: 'Drums', shortLabel: 'Drums' },
  { id: 'bass', label: 'Bass', shortLabel: 'Bass' },
  { id: 'arp', label: 'Arp', shortLabel: 'Arp' },
  { id: 'hold', label: 'Hold', shortLabel: 'Hold' },
  { id: 'melody', label: 'Melody', shortLabel: 'Melody' },
];

function createLaneClips(
  laneId: RoomMusicLaneId,
  baseName: string,
  count: number,
): RoomMusicClip[] {
  return Array.from({ length: count }, (_value, index) => {
    const clipNumber = index + 1;
    return {
      id: `${laneId}-${clipNumber}`,
      laneId,
      label: `${baseName} ${clipNumber}`,
      assetPath: `assets/music/wamp-v1/${baseName}${clipNumber}.mp3`,
    };
  });
}

const WAMP_V1_CLIPS: RoomMusicClip[] = [
  ...createLaneClips('drums', 'Drums', 3),
  ...createLaneClips('bass', 'Bass', 3),
  ...createLaneClips('arp', 'Arp', 3),
  ...createLaneClips('hold', 'Hold', 2),
  ...createLaneClips('melody', 'Melody', 3),
];

export const WAMP_V1_PACK: RoomMusicPack = {
  id: 'wamp-v1',
  label: 'WAMP Pack 1',
  bpm: 120,
  beatsPerBar: 4,
  barCount: 4,
  loopDurationSec: 8,
  lanes: WAMP_V1_LANES,
  clips: WAMP_V1_CLIPS,
};

export const ROOM_MUSIC_PACKS: RoomMusicPack[] = [WAMP_V1_PACK];

const PACK_BY_ID = new Map<RoomMusicPackId, RoomMusicPack>(
  ROOM_MUSIC_PACKS.map((pack) => [pack.id, pack]),
);

export function getRoomMusicPack(packId: RoomMusicPackId | string): RoomMusicPack | null {
  if (packId !== 'wamp-v1') {
    return null;
  }
  return PACK_BY_ID.get(packId) ?? null;
}

export function getRoomMusicLane(pack: RoomMusicPack, laneId: RoomMusicLaneId): RoomMusicLane | null {
  return pack.lanes.find((lane) => lane.id === laneId) ?? null;
}

export function getRoomMusicClip(pack: RoomMusicPack, clipId: string): RoomMusicClip | null {
  return pack.clips.find((clip) => clip.id === clipId) ?? null;
}

export function getRoomMusicClipsForLane(
  pack: RoomMusicPack,
  laneId: RoomMusicLaneId,
): RoomMusicClip[] {
  return pack.clips.filter((clip) => clip.laneId === laneId);
}

export function isRoomMusicClipIdValidForLane(
  pack: RoomMusicPack,
  laneId: RoomMusicLaneId,
  clipId: string | null | undefined,
): boolean {
  if (!clipId) {
    return true;
  }

  return getRoomMusicClipsForLane(pack, laneId).some((clip) => clip.id === clipId);
}

export function getDefaultRoomMusicPack(): RoomMusicPack {
  return WAMP_V1_PACK;
}

export function getAllRoomMusicLaneIds(): RoomMusicLaneId[] {
  return [...ROOM_MUSIC_LANE_IDS];
}
