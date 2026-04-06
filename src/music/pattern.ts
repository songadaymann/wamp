import {
  DEFAULT_ROOM_MUSIC_KEY_MODE,
  DEFAULT_ROOM_MUSIC_KEY_TONIC,
  getRoomMusicKeySemitone,
  normalizeRoomMusicKeyMode,
  normalizeRoomMusicKeyTonic,
  type RoomMusicKeyMode,
  type RoomMusicKeyTonic,
} from './key';

export const ROOM_PATTERN_INSTRUMENT_IDS = ['drums', 'triangle', 'saw', 'square'] as const;
export type RoomPatternInstrumentId = typeof ROOM_PATTERN_INSTRUMENT_IDS[number];

export const ROOM_PATTERN_TONAL_INSTRUMENT_IDS = ['triangle', 'saw', 'square'] as const;
export type RoomPatternTonalInstrumentId = typeof ROOM_PATTERN_TONAL_INSTRUMENT_IDS[number];

export const ROOM_PATTERN_PITCH_MODES = ['scale', 'chromatic'] as const;
export type RoomPatternPitchMode = typeof ROOM_PATTERN_PITCH_MODES[number];

export const ROOM_PATTERN_BPM = 120;
export const ROOM_PATTERN_MIN_BPM = 60;
export const ROOM_PATTERN_MAX_BPM = 200;
export const ROOM_PATTERN_TEMPO_STEP = 5;
export const ROOM_PATTERN_SWING_PERCENT = 50;
export const ROOM_PATTERN_MIN_SWING_PERCENT = 50;
export const ROOM_PATTERN_MAX_SWING_PERCENT = 100;
export const ROOM_PATTERN_SWING_STEP = 1;
export const ROOM_PATTERN_BEATS_PER_BAR = 4;
export const ROOM_PATTERN_STEPS_PER_BEAT = 4;
export const ROOM_PATTERN_STEP_COUNT = 32;
export const ROOM_PATTERN_BAR_COUNT = 2;
export const ROOM_PATTERN_GRID_ROWS = 22;
export const ROOM_PATTERN_ACTIVE_STEP_COLUMNS = 32;
export const ROOM_PATTERN_MARGIN_COLUMNS = 8;
export const ROOM_PATTERN_MARGIN_START_STEP = ROOM_PATTERN_ACTIVE_STEP_COLUMNS;
export const ROOM_PATTERN_DRUM_GRID_START_ROW = 6;
export const ROOM_PATTERN_MIN_OCTAVE_SHIFT = -2;
export const ROOM_PATTERN_MAX_OCTAVE_SHIFT = 2;

export const DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT: Record<RoomPatternTonalInstrumentId, number> = {
  triangle: -1,
  saw: 0,
  square: 0,
};

export const ROOM_PATTERN_INSTRUMENT_LABELS: Record<RoomPatternInstrumentId, string> = {
  drums: 'Drums',
  triangle: 'Triangle',
  saw: 'Saw',
  square: 'Square',
};

export const ROOM_PATTERN_INSTRUMENT_ICONS: Record<RoomPatternInstrumentId, string> = {
  drums: '🥁',
  triangle: '▲',
  saw: '🪚',
  square: '■',
};

export const ROOM_PATTERN_INSTRUMENT_COLORS: Record<RoomPatternInstrumentId, number> = {
  drums: 0xffe86b,
  triangle: 0x56cfde,
  saw: 0xff533f,
  square: 0xc9de3e,
};

export interface RoomPatternInstrumentMixSettings {
  volume: number;
  pan: number;
}

export type RoomPatternInstrumentMix = Record<RoomPatternInstrumentId, RoomPatternInstrumentMixSettings>;

export const DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX: RoomPatternInstrumentMix = {
  drums: { volume: 1, pan: 0 },
  triangle: { volume: 1, pan: 0 },
  saw: { volume: 0.6, pan: 0 },
  square: { volume: 0.5, pan: 0 },
};

export type RoomPatternDrumRowId =
  | 'fx-click'
  | 'tambourine'
  | 'shaker'
  | 'cowbell'
  | 'crash'
  | 'ride'
  | 'open-hat'
  | 'closed-hat'
  | 'high-tom'
  | 'mid-tom'
  | 'low-tom'
  | 'rim'
  | 'clap'
  | 'snare'
  | 'kick-2'
  | 'kick-1';

export interface RoomPatternDrumRowDefinition {
  id: RoomPatternDrumRowId;
  label: string;
  shortLabel: string;
  gridRow: number;
  defaultGain: number;
}

export const ROOM_PATTERN_DRUM_ROWS: RoomPatternDrumRowDefinition[] = [
  { id: 'fx-click', label: 'FX Click', shortLabel: 'Click', gridRow: 6, defaultGain: 0.5 },
  { id: 'tambourine', label: 'Tambourine', shortLabel: 'Tamb', gridRow: 7, defaultGain: 0.58 },
  { id: 'shaker', label: 'Shaker', shortLabel: 'Shake', gridRow: 8, defaultGain: 0.42 },
  { id: 'cowbell', label: 'Cowbell', shortLabel: 'Bell', gridRow: 9, defaultGain: 0.46 },
  { id: 'crash', label: 'Crash', shortLabel: 'Crash', gridRow: 10, defaultGain: 0.62 },
  { id: 'ride', label: 'Ride', shortLabel: 'Ride', gridRow: 11, defaultGain: 0.44 },
  { id: 'open-hat', label: 'Open Hat', shortLabel: 'OHat', gridRow: 12, defaultGain: 0.42 },
  { id: 'closed-hat', label: 'Closed Hat', shortLabel: 'CHat', gridRow: 13, defaultGain: 0.38 },
  { id: 'high-tom', label: 'High Tom', shortLabel: 'HTom', gridRow: 14, defaultGain: 0.54 },
  { id: 'mid-tom', label: 'Mid Tom', shortLabel: 'MTom', gridRow: 15, defaultGain: 0.56 },
  { id: 'low-tom', label: 'Low Tom', shortLabel: 'LTom', gridRow: 16, defaultGain: 0.58 },
  { id: 'rim', label: 'Rim', shortLabel: 'Rim', gridRow: 17, defaultGain: 0.42 },
  { id: 'clap', label: 'Clap', shortLabel: 'Clap', gridRow: 18, defaultGain: 0.48 },
  { id: 'snare', label: 'Snare', shortLabel: 'Snr', gridRow: 19, defaultGain: 0.64 },
  { id: 'kick-2', label: 'Kick 2', shortLabel: 'K2', gridRow: 20, defaultGain: 0.74 },
  { id: 'kick-1', label: 'Kick 1', shortLabel: 'K1', gridRow: 21, defaultGain: 0.82 },
] as const;

export interface RoomPatternTonalTrack {
  steps: (number | null)[];
  ties: boolean[];
}

export type RoomPatternDrumTrack = Record<RoomPatternDrumRowId, number[]>;
export type RoomPatternPhraseSources = Record<RoomPatternInstrumentId, string[]>;
export type RoomPatternPhraseNameSuffixes = Record<RoomPatternInstrumentId, string | null>;

export interface RoomPatternPlaybackSequence {
  bpm: number;
  swingPercent: number;
  beatsPerBar: number;
  stepsPerBeat: number;
  stepCount: number;
  barCount: number;
  pitchMode: RoomPatternPitchMode;
  keyTonic: RoomMusicKeyTonic;
  keyMode: RoomMusicKeyMode;
  octaveShift: Record<RoomPatternTonalInstrumentId, number>;
  mix: RoomPatternInstrumentMix;
  tabs: {
    drums: RoomPatternDrumTrack;
    triangle: RoomPatternTonalTrack;
    saw: RoomPatternTonalTrack;
    square: RoomPatternTonalTrack;
  };
}

export interface RoomPatternMusic extends RoomPatternPlaybackSequence {
  kind: 'pattern';
  sourcePhraseIds: RoomPatternPhraseSources;
  phraseNameSuffixes: RoomPatternPhraseNameSuffixes;
}

export interface RoomPatternRowNote {
  rowIndex: number;
  midi: number;
  frequencyHz: number;
  label: string;
}

const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10] as const;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

function clampInteger(value: number, min: number, max: number): number {
  const normalized = Math.floor(value);
  return Math.max(min, Math.min(max, normalized));
}

function normalizeStepIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const step = Math.floor(value);
  return step >= 0 && step < ROOM_PATTERN_STEP_COUNT ? step : null;
}

function normalizeRowIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const row = Math.floor(value);
  return row >= 0 && row < ROOM_PATTERN_GRID_ROWS ? row : null;
}

function normalizePitchMode(value: unknown): RoomPatternPitchMode {
  return value === 'chromatic' ? 'chromatic' : 'scale';
}

export function normalizeRoomPatternBpm(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ROOM_PATTERN_BPM;
  }

  return clampInteger(value, ROOM_PATTERN_MIN_BPM, ROOM_PATTERN_MAX_BPM);
}

export function normalizeRoomPatternSwingPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ROOM_PATTERN_SWING_PERCENT;
  }

  return clampInteger(value, ROOM_PATTERN_MIN_SWING_PERCENT, ROOM_PATTERN_MAX_SWING_PERCENT);
}

function normalizeSourcePhraseIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    normalized.add(trimmed);
  }

  return [...normalized];
}

function normalizePhraseNameSuffix(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 24);
}

function normalizeOctaveShift(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return clampInteger(value, ROOM_PATTERN_MIN_OCTAVE_SHIFT, ROOM_PATTERN_MAX_OCTAVE_SHIFT);
}

function normalizeMixValue(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}

function cloneRoomPatternInstrumentMixSettings(
  value: Partial<RoomPatternInstrumentMixSettings> | null | undefined,
  fallback: RoomPatternInstrumentMixSettings,
): RoomPatternInstrumentMixSettings {
  return {
    volume: normalizeMixValue(value?.volume, 0, 1, fallback.volume),
    pan: normalizeMixValue(value?.pan, -1, 1, fallback.pan),
  };
}

export function cloneRoomPatternInstrumentMix(
  value: Partial<Record<RoomPatternInstrumentId, Partial<RoomPatternInstrumentMixSettings>>> | null | undefined,
): RoomPatternInstrumentMix {
  return {
    drums: cloneRoomPatternInstrumentMixSettings(value?.drums, DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX.drums),
    triangle: cloneRoomPatternInstrumentMixSettings(value?.triangle, DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX.triangle),
    saw: cloneRoomPatternInstrumentMixSettings(value?.saw, DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX.saw),
    square: cloneRoomPatternInstrumentMixSettings(value?.square, DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX.square),
  };
}

function noteLabelFromMidi(midi: number): string {
  const noteName = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${noteName}${octave}`;
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function getBaseMidiForInstrument(instrumentId: RoomPatternTonalInstrumentId): number {
  return instrumentId === 'triangle' ? 36 : 48;
}

export function createEmptyRoomPatternTonalSteps(): (number | null)[] {
  return Array.from({ length: ROOM_PATTERN_STEP_COUNT }, () => null);
}

export function createEmptyRoomPatternTonalTies(): boolean[] {
  return Array.from({ length: ROOM_PATTERN_STEP_COUNT }, () => false);
}

export function createEmptyRoomPatternTonalTrack(): RoomPatternTonalTrack {
  return {
    steps: createEmptyRoomPatternTonalSteps(),
    ties: createEmptyRoomPatternTonalTies(),
  };
}

export function createEmptyRoomPatternDrumTrack(): RoomPatternDrumTrack {
  return ROOM_PATTERN_DRUM_ROWS.reduce((track, row) => {
    track[row.id] = [];
    return track;
  }, {} as RoomPatternDrumTrack);
}

export function createDefaultRoomPatternMusic(): RoomPatternMusic {
  return {
    kind: 'pattern',
    bpm: ROOM_PATTERN_BPM,
    swingPercent: ROOM_PATTERN_SWING_PERCENT,
    beatsPerBar: ROOM_PATTERN_BEATS_PER_BAR,
    stepsPerBeat: ROOM_PATTERN_STEPS_PER_BEAT,
    stepCount: ROOM_PATTERN_STEP_COUNT,
    barCount: ROOM_PATTERN_BAR_COUNT,
    pitchMode: 'scale',
    keyTonic: DEFAULT_ROOM_MUSIC_KEY_TONIC,
    keyMode: DEFAULT_ROOM_MUSIC_KEY_MODE,
    octaveShift: {
      triangle: DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.triangle,
      saw: DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.saw,
      square: DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.square,
    },
    mix: cloneRoomPatternInstrumentMix(DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX),
    sourcePhraseIds: createEmptyRoomPatternPhraseSources(),
    phraseNameSuffixes: createEmptyRoomPatternPhraseNameSuffixes(),
    tabs: {
      drums: createEmptyRoomPatternDrumTrack(),
      triangle: createEmptyRoomPatternTonalTrack(),
      saw: createEmptyRoomPatternTonalTrack(),
      square: createEmptyRoomPatternTonalTrack(),
    },
  };
}

export function cloneRoomPatternMusic(
  value: RoomPatternMusic | null | undefined,
): RoomPatternMusic | null {
  if (!value) {
    return null;
  }

  return {
    kind: 'pattern',
    bpm: normalizeRoomPatternBpm(value.bpm),
    swingPercent: normalizeRoomPatternSwingPercent(value.swingPercent),
    beatsPerBar: ROOM_PATTERN_BEATS_PER_BAR,
    stepsPerBeat: ROOM_PATTERN_STEPS_PER_BEAT,
    stepCount: ROOM_PATTERN_STEP_COUNT,
    barCount: ROOM_PATTERN_BAR_COUNT,
    pitchMode: normalizePitchMode(value.pitchMode),
    keyTonic: normalizeRoomMusicKeyTonic((value as Partial<RoomPatternMusic> & { scaleId?: unknown }).keyTonic ?? (value as { scaleId?: unknown }).scaleId),
    keyMode: normalizeRoomMusicKeyMode((value as Partial<RoomPatternMusic>).keyMode),
    octaveShift: {
      triangle: normalizeOctaveShift(value.octaveShift?.triangle ?? DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.triangle),
      saw: normalizeOctaveShift(value.octaveShift?.saw ?? DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.saw),
      square: normalizeOctaveShift(value.octaveShift?.square ?? DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.square),
    },
    mix: cloneRoomPatternInstrumentMix(value.mix),
    sourcePhraseIds: cloneRoomPatternPhraseSources(value.sourcePhraseIds),
    phraseNameSuffixes: cloneRoomPatternPhraseNameSuffixes(value.phraseNameSuffixes),
    tabs: {
      drums: cloneRoomPatternDrumTrack(value.tabs?.drums),
      triangle: cloneRoomPatternTonalTrack(value.tabs?.triangle),
      saw: cloneRoomPatternTonalTrack(value.tabs?.saw),
      square: cloneRoomPatternTonalTrack(value.tabs?.square),
    },
  };
}

export function createEmptyRoomPatternPhraseSources(): RoomPatternPhraseSources {
  return {
    drums: [],
    triangle: [],
    saw: [],
    square: [],
  };
}

export function createEmptyRoomPatternPhraseNameSuffixes(): RoomPatternPhraseNameSuffixes {
  return {
    drums: null,
    triangle: null,
    saw: null,
    square: null,
  };
}

export function cloneRoomPatternPhraseSources(
  value: Partial<Record<RoomPatternInstrumentId, readonly string[]>> | null | undefined,
): RoomPatternPhraseSources {
  return {
    drums: normalizeSourcePhraseIds(value?.drums),
    triangle: normalizeSourcePhraseIds(value?.triangle),
    saw: normalizeSourcePhraseIds(value?.saw),
    square: normalizeSourcePhraseIds(value?.square),
  };
}

export function cloneRoomPatternPhraseNameSuffixes(
  value: Partial<Record<RoomPatternInstrumentId, string | null>> | null | undefined,
): RoomPatternPhraseNameSuffixes {
  return {
    drums: normalizePhraseNameSuffix(value?.drums),
    triangle: normalizePhraseNameSuffix(value?.triangle),
    saw: normalizePhraseNameSuffix(value?.saw),
    square: normalizePhraseNameSuffix(value?.square),
  };
}

export function cloneRoomPatternTonalSteps(
  value: readonly (number | null)[] | null | undefined,
): (number | null)[] {
  const steps = createEmptyRoomPatternTonalSteps();
  if (!Array.isArray(value)) {
    return steps;
  }

  for (let index = 0; index < ROOM_PATTERN_STEP_COUNT; index += 1) {
    steps[index] = normalizeRowIndex(value[index]);
  }

  return steps;
}

export function cloneRoomPatternTonalTrack(
  value: Partial<RoomPatternTonalTrack> | null | undefined,
): RoomPatternTonalTrack {
  const steps = cloneRoomPatternTonalSteps(value?.steps);
  const preserveLegacyTies = !Array.isArray(value?.ties);
  const ties = createEmptyRoomPatternTonalTies();

  for (let index = 1; index < ROOM_PATTERN_STEP_COUNT; index += 1) {
    const currentRow = steps[index];
    const previousRow = steps[index - 1];
    if (currentRow === null || previousRow === null || currentRow !== previousRow) {
      continue;
    }

    ties[index] = preserveLegacyTies ? true : value?.ties?.[index] === true;
  }

  return { steps, ties };
}

export function cloneRoomPatternDrumTrack(
  value: Partial<Record<RoomPatternDrumRowId, readonly number[]>> | null | undefined,
): RoomPatternDrumTrack {
  const track = createEmptyRoomPatternDrumTrack();
  if (!value || typeof value !== 'object') {
    return track;
  }

  for (const row of ROOM_PATTERN_DRUM_ROWS) {
    track[row.id] = normalizeDrumSteps(value[row.id]);
  }

  return track;
}

function normalizeDrumSteps(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<number>();
  for (const item of value) {
    const step = normalizeStepIndex(item);
    if (step !== null) {
      unique.add(step);
    }
  }

  return [...unique].sort((left, right) => left - right);
}

export function normalizeRoomPatternMusic(value: unknown): RoomPatternMusic | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<RoomPatternMusic>;
  const tabs = candidate.tabs && typeof candidate.tabs === 'object' ? candidate.tabs : {};
  return {
    kind: 'pattern',
    bpm: normalizeRoomPatternBpm(candidate.bpm),
    swingPercent: normalizeRoomPatternSwingPercent(candidate.swingPercent),
    beatsPerBar: ROOM_PATTERN_BEATS_PER_BAR,
    stepsPerBeat: ROOM_PATTERN_STEPS_PER_BEAT,
    stepCount: ROOM_PATTERN_STEP_COUNT,
    barCount: ROOM_PATTERN_BAR_COUNT,
    pitchMode: normalizePitchMode(candidate.pitchMode),
    keyTonic: normalizeRoomMusicKeyTonic((candidate as Partial<RoomPatternMusic> & { scaleId?: unknown }).keyTonic ?? (candidate as { scaleId?: unknown }).scaleId),
    keyMode: normalizeRoomMusicKeyMode(candidate.keyMode),
    octaveShift: {
      triangle: normalizeOctaveShift(candidate.octaveShift?.triangle ?? DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.triangle),
      saw: normalizeOctaveShift(candidate.octaveShift?.saw ?? DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.saw),
      square: normalizeOctaveShift(candidate.octaveShift?.square ?? DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.square),
    },
    mix: cloneRoomPatternInstrumentMix(candidate.mix),
    sourcePhraseIds: cloneRoomPatternPhraseSources(candidate.sourcePhraseIds),
    phraseNameSuffixes: cloneRoomPatternPhraseNameSuffixes(candidate.phraseNameSuffixes),
    tabs: {
      drums: cloneRoomPatternDrumTrack((tabs as RoomPatternMusic['tabs']).drums),
      triangle: cloneRoomPatternTonalTrack((tabs as RoomPatternMusic['tabs']).triangle),
      saw: cloneRoomPatternTonalTrack((tabs as RoomPatternMusic['tabs']).saw),
      square: cloneRoomPatternTonalTrack((tabs as RoomPatternMusic['tabs']).square),
    },
  };
}

export function isRoomPatternMusicEmpty(value: RoomPatternMusic | null | undefined): boolean {
  if (!value) {
    return true;
  }

  const defaults = createDefaultRoomPatternMusic();
  if (
    value.bpm !== defaults.bpm
    || value.swingPercent !== defaults.swingPercent
    || value.pitchMode !== defaults.pitchMode
    || value.keyTonic !== defaults.keyTonic
    || value.keyMode !== defaults.keyMode
  ) {
    return false;
  }

  for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
    if (
      value.mix[instrumentId].volume !== defaults.mix[instrumentId].volume
      || value.mix[instrumentId].pan !== defaults.mix[instrumentId].pan
    ) {
      return false;
    }
  }

  for (const instrumentId of ROOM_PATTERN_TONAL_INSTRUMENT_IDS) {
    if (value.octaveShift[instrumentId] !== defaults.octaveShift[instrumentId]) {
      return false;
    }
  }

  for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
    if ((value.phraseNameSuffixes[instrumentId] ?? null) !== (defaults.phraseNameSuffixes[instrumentId] ?? null)) {
      return false;
    }
  }

  for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
    const sourceIds = value.sourcePhraseIds[instrumentId];
    if (sourceIds && sourceIds.length > 0) {
      return false;
    }
  }

  const tonalEmpty = ROOM_PATTERN_TONAL_INSTRUMENT_IDS.every((instrumentId) =>
    value.tabs[instrumentId].steps.every((rowIndex) => rowIndex === null),
  );
  if (!tonalEmpty) {
    return false;
  }

  return ROOM_PATTERN_DRUM_ROWS.every((row) => value.tabs.drums[row.id].length === 0);
}

export function getRoomPatternLoopDurationSec(
  pattern: Pick<RoomPatternMusic, 'bpm' | 'stepCount' | 'stepsPerBeat'>,
): number {
  return (60 / pattern.bpm) * (pattern.stepCount / pattern.stepsPerBeat);
}

export function getRoomPatternBarDurationSec(
  pattern: Pick<RoomPatternMusic, 'bpm' | 'beatsPerBar'>,
): number {
  return (60 / pattern.bpm) * pattern.beatsPerBar;
}

export function getPatternDrumRowForGridRow(rowIndex: number): RoomPatternDrumRowDefinition | null {
  return ROOM_PATTERN_DRUM_ROWS.find((row) => row.gridRow === rowIndex) ?? null;
}

export function isPatternDrumGridRowPlayable(rowIndex: number): boolean {
  return getPatternDrumRowForGridRow(rowIndex) !== null;
}

export function getPatternInstrumentLabel(instrumentId: RoomPatternInstrumentId): string {
  return ROOM_PATTERN_INSTRUMENT_LABELS[instrumentId];
}

export function getPatternInstrumentIcon(instrumentId: RoomPatternInstrumentId): string {
  return ROOM_PATTERN_INSTRUMENT_ICONS[instrumentId];
}

export function getPatternInstrumentColor(instrumentId: RoomPatternInstrumentId): number {
  return ROOM_PATTERN_INSTRUMENT_COLORS[instrumentId];
}

export function getPatternInstrumentColorCss(instrumentId: RoomPatternInstrumentId): string {
  return `#${ROOM_PATTERN_INSTRUMENT_COLORS[instrumentId].toString(16).padStart(6, '0')}`;
}

export function getPatternInstrumentColorRgbCss(instrumentId: RoomPatternInstrumentId): string {
  const color = ROOM_PATTERN_INSTRUMENT_COLORS[instrumentId];
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  return `${red}, ${green}, ${blue}`;
}

export function getPatternRowNote(
  instrumentId: RoomPatternTonalInstrumentId,
  rowIndex: number,
  pitchMode: RoomPatternPitchMode,
  octaveShift: number,
  keyTonic: RoomMusicKeyTonic,
  keyMode: RoomMusicKeyMode,
): RoomPatternRowNote | null {
  const normalizedRow = normalizeRowIndex(rowIndex);
  if (normalizedRow === null) {
    return null;
  }

  const scaleIntervals = keyMode === 'minor' ? MINOR_SCALE_INTERVALS : MAJOR_SCALE_INTERVALS;
  const baseMidi =
    getBaseMidiForInstrument(instrumentId)
    + normalizeOctaveShift(octaveShift) * 12
    + getRoomMusicKeySemitone(keyTonic);
  const ascendingIndex = ROOM_PATTERN_GRID_ROWS - 1 - normalizedRow;
  const midi =
    pitchMode === 'chromatic'
      ? baseMidi + ascendingIndex
      : baseMidi
        + Math.floor(ascendingIndex / scaleIntervals.length) * 12
        + scaleIntervals[ascendingIndex % scaleIntervals.length];

  return {
    rowIndex: normalizedRow,
    midi,
    frequencyHz: midiToFrequency(midi),
    label: noteLabelFromMidi(midi),
  };
}

export function getPatternRowLabel(
  instrumentId: RoomPatternInstrumentId,
  rowIndex: number,
  pitchMode: RoomPatternPitchMode,
  octaveShift: number,
  keyTonic: RoomMusicKeyTonic,
  keyMode: RoomMusicKeyMode,
): string {
  if (instrumentId === 'drums') {
    return getPatternDrumRowForGridRow(rowIndex)?.shortLabel ?? '';
  }

  return getPatternRowNote(instrumentId, rowIndex, pitchMode, octaveShift, keyTonic, keyMode)?.label ?? '';
}

export function findClosestPatternRowIndexForMidi(
  instrumentId: RoomPatternTonalInstrumentId,
  midi: number,
  pitchMode: RoomPatternPitchMode,
  octaveShift: number,
  keyTonic: RoomMusicKeyTonic,
  keyMode: RoomMusicKeyMode,
): number | null {
  let bestRowIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let rowIndex = 0; rowIndex < ROOM_PATTERN_GRID_ROWS; rowIndex += 1) {
    const note = getPatternRowNote(instrumentId, rowIndex, pitchMode, octaveShift, keyTonic, keyMode);
    if (!note) {
      continue;
    }

    const distance = Math.abs(note.midi - midi);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRowIndex = rowIndex;
    }
  }

  return bestRowIndex;
}

export function getRoomPatternKey(pattern: RoomPatternMusic): string {
  const parts = [
    pattern.kind,
    `bpm:${pattern.bpm}`,
    `swing:${pattern.swingPercent}`,
    pattern.pitchMode,
    pattern.keyTonic,
    pattern.keyMode,
    String(pattern.octaveShift.triangle),
    String(pattern.octaveShift.saw),
    String(pattern.octaveShift.square),
    ...ROOM_PATTERN_INSTRUMENT_IDS.flatMap((instrumentId) => [
      instrumentId,
      pattern.mix[instrumentId].volume.toFixed(3),
      pattern.mix[instrumentId].pan.toFixed(3),
    ]),
    pattern.tabs.triangle.steps.map((value) => value ?? '-').join(','),
    pattern.tabs.triangle.ties.map((value) => (value ? '1' : '0')).join(''),
    `sources:${pattern.sourcePhraseIds.triangle.join(',')}`,
    pattern.tabs.saw.steps.map((value) => value ?? '-').join(','),
    pattern.tabs.saw.ties.map((value) => (value ? '1' : '0')).join(''),
    `sources:${pattern.sourcePhraseIds.saw.join(',')}`,
    pattern.tabs.square.steps.map((value) => value ?? '-').join(','),
    pattern.tabs.square.ties.map((value) => (value ? '1' : '0')).join(''),
    `sources:${pattern.sourcePhraseIds.square.join(',')}`,
    `sources:${pattern.sourcePhraseIds.drums.join(',')}`,
    ...ROOM_PATTERN_DRUM_ROWS.map((row) => `${row.id}:${pattern.tabs.drums[row.id].join(',')}`),
  ];
  return parts.join('|');
}
