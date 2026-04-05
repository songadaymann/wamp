import { majorKey, minorKey } from '@tonaljs/key';
import { Interval, Note } from 'tonal';

export const ROOM_MUSIC_KEY_TONICS = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export type RoomMusicKeyTonic = typeof ROOM_MUSIC_KEY_TONICS[number];

export const ROOM_MUSIC_KEY_MODES = ['major', 'minor'] as const;
export type RoomMusicKeyMode = typeof ROOM_MUSIC_KEY_MODES[number];

export const DEFAULT_ROOM_MUSIC_KEY_TONIC: RoomMusicKeyTonic = 'C';
export const DEFAULT_ROOM_MUSIC_KEY_MODE: RoomMusicKeyMode = 'major';

const TONIC_TO_SEMITONE = new Map<RoomMusicKeyTonic, number>(
  ROOM_MUSIC_KEY_TONICS.map((tonic, index) => [tonic, index]),
);

function normalizeEnharmonicPitchClass(value: string): RoomMusicKeyTonic | null {
  const pitchClass = Note.pitchClass(value);
  if (!pitchClass) {
    return null;
  }

  const normalized = Note.enharmonic(pitchClass) || pitchClass;
  return ROOM_MUSIC_KEY_TONICS.find((candidate) => candidate === normalized) ?? null;
}

export function normalizeRoomMusicKeyTonic(value: unknown): RoomMusicKeyTonic {
  if (typeof value !== 'string') {
    return DEFAULT_ROOM_MUSIC_KEY_TONIC;
  }

  return normalizeEnharmonicPitchClass(value) ?? DEFAULT_ROOM_MUSIC_KEY_TONIC;
}

export function normalizeRoomMusicKeyMode(value: unknown): RoomMusicKeyMode {
  return value === 'minor' ? 'minor' : DEFAULT_ROOM_MUSIC_KEY_MODE;
}

export function getRoomMusicKeySemitone(tonic: RoomMusicKeyTonic): number {
  return TONIC_TO_SEMITONE.get(tonic) ?? 0;
}

export function transposeRoomMusicKeyTonic(
  tonic: RoomMusicKeyTonic,
  semitones: number,
): RoomMusicKeyTonic {
  const interval = Interval.fromSemitones(semitones);
  const transposed = Note.transpose(tonic, interval);
  return normalizeEnharmonicPitchClass(transposed) ?? tonic;
}

export function getRoomMusicKeyDeltaSemitones(
  sourceTonic: RoomMusicKeyTonic,
  targetTonic: RoomMusicKeyTonic,
): number {
  return getRoomMusicKeySemitone(targetTonic) - getRoomMusicKeySemitone(sourceTonic);
}

export function getRelativeRoomMusicKey(
  tonic: RoomMusicKeyTonic,
  mode: RoomMusicKeyMode,
  targetMode: RoomMusicKeyMode,
): { tonic: RoomMusicKeyTonic; mode: RoomMusicKeyMode } {
  if (mode === targetMode) {
    return { tonic, mode };
  }

  if (mode === 'major') {
    const relativeMinor = majorKey(tonic).minorRelative;
    return {
      tonic: normalizeEnharmonicPitchClass(relativeMinor) ?? tonic,
      mode: 'minor',
    };
  }

  const relativeMajor = minorKey(tonic).relativeMajor;
  return {
    tonic: normalizeEnharmonicPitchClass(relativeMajor) ?? tonic,
    mode: 'major',
  };
}

export function getRoomMusicKeyLabel(
  tonic: RoomMusicKeyTonic,
  mode: RoomMusicKeyMode,
): string {
  return `${tonic} ${mode === 'major' ? 'Major' : 'Minor'}`;
}
