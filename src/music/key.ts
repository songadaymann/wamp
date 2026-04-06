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

function getCandidateScaleSemitones(
  tonic: RoomMusicKeyTonic,
  mode: RoomMusicKeyMode,
): Set<number> {
  const scaleNotes = mode === 'major'
    ? majorKey(tonic).scale
    : minorKey(tonic).natural.scale;
  return new Set(
    scaleNotes
      .map((note) => normalizeEnharmonicPitchClass(note))
      .filter((candidate): candidate is RoomMusicKeyTonic => candidate !== null)
      .map((note) => getRoomMusicKeySemitone(note)),
  );
}

export function detectRoomMusicKeyFromMidiSequence(
  values: readonly number[],
): { tonic: RoomMusicKeyTonic; mode: RoomMusicKeyMode } | null {
  const midis = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.round(value));
  if (midis.length === 0) {
    return null;
  }

  const semitones = midis.map((midi) => ((midi % 12) + 12) % 12);
  const firstSemitone = semitones[0] ?? null;
  const lastSemitone = semitones.at(-1) ?? null;
  const lowestSemitone = ((Math.min(...midis) % 12) + 12) % 12;
  const pitchClassCounts = new Map<number, number>();
  for (const semitone of semitones) {
    pitchClassCounts.set(semitone, (pitchClassCounts.get(semitone) ?? 0) + 1);
  }
  const mostFrequentCount = Math.max(...pitchClassCounts.values());

  let bestMatch:
    | {
        tonic: RoomMusicKeyTonic;
        mode: RoomMusicKeyMode;
        score: number;
        tiebreak: number;
      }
    | null = null;

  for (const tonic of ROOM_MUSIC_KEY_TONICS) {
    const tonicSemitone = getRoomMusicKeySemitone(tonic);
    for (const mode of ROOM_MUSIC_KEY_MODES) {
      const candidateScale = getCandidateScaleSemitones(tonic, mode);
      let score = 0;
      for (const semitone of semitones) {
        score += candidateScale.has(semitone) ? 3 : -4;
        if (semitone === tonicSemitone) {
          score += 2;
        }
      }

      const tonicCount = pitchClassCounts.get(tonicSemitone) ?? 0;
      const tiebreak =
        (lastSemitone === tonicSemitone ? 12 : 0) +
        (firstSemitone === tonicSemitone ? 6 : 0) +
        (lowestSemitone === tonicSemitone ? 4 : 0) +
        tonicCount * 2 +
        (tonicCount === mostFrequentCount ? 3 : 0);

      if (
        !bestMatch ||
        score > bestMatch.score ||
        (score === bestMatch.score && tiebreak > bestMatch.tiebreak)
      ) {
        bestMatch = {
          tonic,
          mode,
          score,
          tiebreak,
        };
      }
    }
  }

  return bestMatch
    ? {
        tonic: bestMatch.tonic,
        mode: bestMatch.mode,
      }
    : null;
}
