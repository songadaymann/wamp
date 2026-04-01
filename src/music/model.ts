export const ROOM_MUSIC_LANE_IDS = ['drums', 'bass', 'arp', 'hold', 'melody'] as const;
export type RoomMusicLaneId = typeof ROOM_MUSIC_LANE_IDS[number];

export const ROOM_MUSIC_PACK_IDS = ['wamp-v1'] as const;
export type RoomMusicPackId = typeof ROOM_MUSIC_PACK_IDS[number];
export const DEFAULT_ROOM_MUSIC_BAR_COUNT = 4;

export type RoomMusicKind = 'stemArrangement';

export interface RoomMusicLane {
  id: RoomMusicLaneId;
  label: string;
  shortLabel: string;
  defaultGain: number;
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

export type RoomMusicBarClipId = string | null;
export type RoomMusicLaneBarAssignments = RoomMusicBarClipId[];
export type RoomMusicLaneAssignments = Record<RoomMusicLaneId, RoomMusicLaneBarAssignments>;

export interface RoomMusicArrangement {
  laneAssignments: RoomMusicLaneAssignments;
}

export interface RoomMusic {
  kind: RoomMusicKind;
  packId: RoomMusicPackId;
  arrangement: RoomMusicArrangement;
}

export function getRoomMusicPackBarCount(
  packId: RoomMusicPackId | string | null | undefined,
): number {
  if (packId === 'wamp-v1') {
    return DEFAULT_ROOM_MUSIC_BAR_COUNT;
  }

  return DEFAULT_ROOM_MUSIC_BAR_COUNT;
}

export function createEmptyRoomMusicLaneBarAssignments(
  barCount: number = DEFAULT_ROOM_MUSIC_BAR_COUNT,
): RoomMusicLaneBarAssignments {
  return Array.from(
    { length: Math.max(1, Math.floor(barCount) || DEFAULT_ROOM_MUSIC_BAR_COUNT) },
    () => null,
  );
}

export function cloneRoomMusicLaneBarAssignments(
  assignments: readonly RoomMusicBarClipId[] | null | undefined,
  barCount: number = DEFAULT_ROOM_MUSIC_BAR_COUNT,
): RoomMusicLaneBarAssignments {
  const next = createEmptyRoomMusicLaneBarAssignments(barCount);
  if (!assignments) {
    return next;
  }

  for (let index = 0; index < next.length; index += 1) {
    next[index] = normalizeAssignedClipId(assignments[index]);
  }

  return next;
}

export function createEmptyRoomMusicLaneAssignments(
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

export function createEmptyRoomMusicArrangement(
  barCount: number = DEFAULT_ROOM_MUSIC_BAR_COUNT,
): RoomMusicArrangement {
  return {
    laneAssignments: createEmptyRoomMusicLaneAssignments(barCount),
  };
}

export function createDefaultRoomMusic(packId: RoomMusicPackId = 'wamp-v1'): RoomMusic {
  const barCount = getRoomMusicPackBarCount(packId);
  return {
    kind: 'stemArrangement',
    packId,
    arrangement: createEmptyRoomMusicArrangement(barCount),
  };
}

function normalizeAssignedClipId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLaneBarAssignments(
  value: unknown,
  barCount: number,
): RoomMusicLaneBarAssignments {
  if (typeof value === 'string') {
    const normalized = normalizeAssignedClipId(value);
    return Array.from({ length: barCount }, () => normalized);
  }

  if (!Array.isArray(value)) {
    return createEmptyRoomMusicLaneBarAssignments(barCount);
  }

  return cloneRoomMusicLaneBarAssignments(value, barCount);
}

function normalizeLaneAssignments(value: unknown, barCount: number): RoomMusicLaneAssignments {
  const assignments =
    value && typeof value === 'object'
      ? (value as Partial<Record<RoomMusicLaneId, unknown>>)
      : null;

  return {
    drums: normalizeLaneBarAssignments(assignments?.drums, barCount),
    bass: normalizeLaneBarAssignments(assignments?.bass, barCount),
    arp: normalizeLaneBarAssignments(assignments?.arp, barCount),
    hold: normalizeLaneBarAssignments(assignments?.hold, barCount),
    melody: normalizeLaneBarAssignments(assignments?.melody, barCount),
  };
}

export function cloneRoomMusic(music: RoomMusic | null | undefined): RoomMusic | null {
  if (!music) {
    return null;
  }

  const barCount = getRoomMusicPackBarCount(music.packId);

  return {
    kind: 'stemArrangement',
    packId: music.packId,
    arrangement: {
      laneAssignments: normalizeLaneAssignments(music.arrangement?.laneAssignments, barCount),
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

  const barCount = getRoomMusicPackBarCount(packId);
  const laneAssignments = candidate.arrangement?.laneAssignments ?? candidate.laneAssignments;
  return {
    kind: 'stemArrangement',
    packId,
    arrangement: {
      laneAssignments: normalizeLaneAssignments(laneAssignments, barCount),
    },
  };
}

export function isRoomMusicEmpty(music: RoomMusic | null | undefined): boolean {
  if (!music) {
    return true;
  }

  return ROOM_MUSIC_LANE_IDS.every((laneId) =>
    music.arrangement.laneAssignments[laneId].every((clipId) => clipId === null)
  );
}
