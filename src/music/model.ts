export const ROOM_MUSIC_LANE_IDS = ['drums', 'bass', 'arp', 'hold', 'melody'] as const;
export type RoomMusicLaneId = typeof ROOM_MUSIC_LANE_IDS[number];

export const ROOM_MUSIC_PACK_IDS = ['wamp-v1'] as const;
export type RoomMusicPackId = typeof ROOM_MUSIC_PACK_IDS[number];

export type RoomMusicKind = 'stemArrangement';

export interface RoomMusicLane {
  id: RoomMusicLaneId;
  label: string;
  shortLabel: string;
}

export interface RoomMusicClip {
  id: string;
  laneId: RoomMusicLaneId;
  label: string;
  assetPath: string;
}

export interface RoomMusicPack {
  id: RoomMusicPackId;
  label: string;
  bpm: number;
  beatsPerBar: number;
  barCount: number;
  loopDurationSec: number;
  lanes: RoomMusicLane[];
  clips: RoomMusicClip[];
}

export type RoomMusicLaneAssignments = Record<RoomMusicLaneId, string | null>;

export interface RoomMusicArrangement {
  laneAssignments: RoomMusicLaneAssignments;
}

export interface RoomMusic {
  kind: RoomMusicKind;
  packId: RoomMusicPackId;
  arrangement: RoomMusicArrangement;
}

export function createEmptyRoomMusicLaneAssignments(): RoomMusicLaneAssignments {
  return {
    drums: null,
    bass: null,
    arp: null,
    hold: null,
    melody: null,
  };
}

export function createEmptyRoomMusicArrangement(): RoomMusicArrangement {
  return {
    laneAssignments: createEmptyRoomMusicLaneAssignments(),
  };
}

export function createDefaultRoomMusic(packId: RoomMusicPackId = 'wamp-v1'): RoomMusic {
  return {
    kind: 'stemArrangement',
    packId,
    arrangement: createEmptyRoomMusicArrangement(),
  };
}

function normalizeAssignedClipId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLaneAssignments(value: unknown): RoomMusicLaneAssignments {
  const assignments = value && typeof value === 'object'
    ? (value as Partial<Record<RoomMusicLaneId, unknown>>)
    : null;

  return {
    drums: normalizeAssignedClipId(assignments?.drums),
    bass: normalizeAssignedClipId(assignments?.bass),
    arp: normalizeAssignedClipId(assignments?.arp),
    hold: normalizeAssignedClipId(assignments?.hold),
    melody: normalizeAssignedClipId(assignments?.melody),
  };
}

export function cloneRoomMusic(music: RoomMusic | null | undefined): RoomMusic | null {
  if (!music) {
    return null;
  }

  return {
    kind: 'stemArrangement',
    packId: music.packId,
    arrangement: {
      laneAssignments: normalizeLaneAssignments(music.arrangement?.laneAssignments),
    },
  };
}

export function normalizeRoomMusic(value: unknown): RoomMusic | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<RoomMusic> & {
    laneAssignments?: Partial<Record<RoomMusicLaneId, unknown>>;
  };
  const packId = candidate.packId === 'wamp-v1' ? 'wamp-v1' : null;
  if (!packId) {
    return null;
  }

  const laneAssignments = candidate.arrangement?.laneAssignments ?? candidate.laneAssignments;
  return {
    kind: 'stemArrangement',
    packId,
    arrangement: {
      laneAssignments: normalizeLaneAssignments(laneAssignments),
    },
  };
}

export function isRoomMusicEmpty(music: RoomMusic | null | undefined): boolean {
  if (!music) {
    return true;
  }

  return ROOM_MUSIC_LANE_IDS.every((laneId) => music.arrangement.laneAssignments[laneId] === null);
}
