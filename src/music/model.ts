import { getRoomMusicPack } from './catalog';
import {
  cloneRoomPatternMusic,
  createDefaultRoomPatternMusic,
  getRoomPatternBarDurationSec,
  getRoomPatternKey,
  getRoomPatternLoopDurationSec,
  isRoomPatternMusicEmpty,
  normalizeRoomPatternMusic,
  type RoomPatternDrumRowDefinition,
  type RoomPatternDrumRowId,
  type RoomPatternInstrumentMix,
  type RoomPatternInstrumentMixSettings,
  type RoomPatternInstrumentId,
  type RoomPatternMusic,
  type RoomPatternPitchMode,
  type RoomPatternRowNote,
  type RoomPatternScaleId,
  type RoomPatternTonalInstrumentId,
} from './pattern';

export {
  DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT,
  ROOM_PATTERN_ACTIVE_STEP_COLUMNS,
  ROOM_PATTERN_BAR_COUNT,
  ROOM_PATTERN_BEATS_PER_BAR,
  ROOM_PATTERN_BPM,
  ROOM_PATTERN_DRUM_GRID_START_ROW,
  ROOM_PATTERN_DRUM_ROWS,
  ROOM_PATTERN_GRID_ROWS,
  ROOM_PATTERN_INSTRUMENT_IDS,
  ROOM_PATTERN_INSTRUMENT_LABELS,
  ROOM_PATTERN_MARGIN_COLUMNS,
  ROOM_PATTERN_MARGIN_START_STEP,
  ROOM_PATTERN_MAX_OCTAVE_SHIFT,
  ROOM_PATTERN_MIN_OCTAVE_SHIFT,
  ROOM_PATTERN_PITCH_MODES,
  ROOM_PATTERN_SCALE_IDS,
  ROOM_PATTERN_STEP_COUNT,
  ROOM_PATTERN_STEPS_PER_BEAT,
  ROOM_PATTERN_TONAL_INSTRUMENT_IDS,
  cloneRoomPatternDrumTrack,
  cloneRoomPatternMusic,
  cloneRoomPatternTonalSteps,
  createDefaultRoomPatternMusic,
  createEmptyRoomPatternDrumTrack,
  createEmptyRoomPatternTonalSteps,
  getPatternDrumRowForGridRow,
  getPatternInstrumentLabel,
  getPatternRowLabel,
  getPatternRowNote,
  getRoomPatternBarDurationSec,
  getRoomPatternKey,
  getRoomPatternLoopDurationSec,
  isPatternDrumGridRowPlayable,
  isRoomPatternMusicEmpty,
  normalizeRoomPatternMusic,
  type RoomPatternDrumRowDefinition,
  type RoomPatternDrumRowId,
  type RoomPatternInstrumentMix,
  type RoomPatternInstrumentMixSettings,
  type RoomPatternInstrumentId,
  type RoomPatternMusic,
  type RoomPatternPitchMode,
  type RoomPatternRowNote,
  type RoomPatternScaleId,
  type RoomPatternTonalInstrumentId,
} from './pattern';

export const ROOM_MUSIC_LANE_IDS = ['drums', 'bass', 'arp', 'hold', 'melody'] as const;
export type RoomMusicLaneId = typeof ROOM_MUSIC_LANE_IDS[number];

export const ROOM_MUSIC_PACK_IDS = ['wamp-v1'] as const;
export type RoomMusicPackId = typeof ROOM_MUSIC_PACK_IDS[number];
export const DEFAULT_ROOM_MUSIC_BAR_COUNT = 4;

export type RoomMusicKind = 'stemArrangement' | 'pattern';

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

export interface StemArrangementRoomMusic {
  kind: 'stemArrangement';
  packId: RoomMusicPackId;
  arrangement: RoomMusicArrangement;
}

export type RoomMusic = StemArrangementRoomMusic | RoomPatternMusic;

export function isStemArrangementRoomMusic(
  music: RoomMusic | null | undefined,
): music is StemArrangementRoomMusic {
  return Boolean(music && music.kind === 'stemArrangement');
}

export function isPatternRoomMusic(
  music: RoomMusic | null | undefined,
): music is RoomPatternMusic {
  return Boolean(music && music.kind === 'pattern');
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

export function createDefaultRoomMusic(packId: RoomMusicPackId = 'wamp-v1'): StemArrangementRoomMusic {
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

function cloneStemArrangementRoomMusic(
  music: StemArrangementRoomMusic | null | undefined,
): StemArrangementRoomMusic | null {
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

export function cloneRoomMusic(music: RoomMusic | null | undefined): RoomMusic | null {
  if (!music) {
    return null;
  }

  if (music.kind === 'pattern') {
    return cloneRoomPatternMusic(music);
  }

  return cloneStemArrangementRoomMusic(music);
}

function normalizeStemArrangementRoomMusic(
  value: Partial<StemArrangementRoomMusic> & {
    laneAssignments?: Partial<Record<RoomMusicLaneId, unknown>>;
  },
): StemArrangementRoomMusic | null {
  const packId = value.packId === 'wamp-v1' ? 'wamp-v1' : null;
  if (!packId) {
    return null;
  }

  const barCount = getRoomMusicPackBarCount(packId);
  const laneAssignments = value.arrangement?.laneAssignments ?? value.laneAssignments;
  return {
    kind: 'stemArrangement',
    packId,
    arrangement: {
      laneAssignments: normalizeLaneAssignments(laneAssignments, barCount),
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

  if (
    candidate.kind === 'pattern' ||
    (
      candidate.kind !== 'stemArrangement' &&
      'tabs' in candidate &&
      Boolean((candidate as { tabs?: unknown }).tabs) &&
      typeof (candidate as { tabs?: unknown }).tabs === 'object'
    )
  ) {
    return normalizeRoomPatternMusic(candidate);
  }

  return normalizeStemArrangementRoomMusic(candidate as Partial<StemArrangementRoomMusic> & {
    laneAssignments?: Partial<Record<RoomMusicLaneId, unknown>>;
  });
}

export function isRoomMusicEmpty(music: RoomMusic | null | undefined): boolean {
  if (!music) {
    return true;
  }

  if (music.kind === 'pattern') {
    return isRoomPatternMusicEmpty(music);
  }

  return ROOM_MUSIC_LANE_IDS.every((laneId) =>
    music.arrangement.laneAssignments[laneId].every((clipId) => clipId === null)
  );
}

export function getRoomMusicBarDurationSec(music: RoomMusic | null | undefined): number {
  if (!music) {
    return 0;
  }

  if (music.kind === 'pattern') {
    return getRoomPatternBarDurationSec(music);
  }

  const pack = getRoomMusicPack(music.packId);
  return pack ? (60 / pack.bpm) * pack.beatsPerBar : 0;
}

export function getRoomMusicLoopDurationSec(music: RoomMusic | null | undefined): number {
  if (!music) {
    return 0;
  }

  if (music.kind === 'pattern') {
    return getRoomPatternLoopDurationSec(music);
  }

  return getRoomMusicPack(music.packId)?.loopDurationSec ?? 0;
}

export function getRoomMusicKey(music: RoomMusic | null | undefined): string | null {
  if (!music) {
    return null;
  }

  if (music.kind === 'pattern') {
    return getRoomPatternKey(music);
  }

  return [
    music.kind,
    music.packId,
    ...ROOM_MUSIC_LANE_IDS.map((laneId) => music.arrangement.laneAssignments[laneId].map((clipId) => clipId ?? '-').join(',')),
  ].join('|');
}
