import {
  DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX,
  DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT,
  ROOM_PATTERN_BAR_COUNT,
  ROOM_PATTERN_BEATS_PER_BAR,
  ROOM_PATTERN_BPM,
  ROOM_PATTERN_INSTRUMENT_IDS,
  ROOM_PATTERN_STEP_COUNT,
  ROOM_PATTERN_STEPS_PER_BEAT,
  ROOM_PATTERN_SWING_PERCENT,
  ROOM_PATTERN_TONAL_INSTRUMENT_IDS,
  cloneRoomPatternInstrumentMix,
  createEmptyRoomPatternDrumTrack,
  createEmptyRoomPatternPhraseSources,
  normalizeRoomPatternBpm,
  normalizeRoomPatternSwingPercent,
  type RoomPatternInstrumentId,
  type RoomPatternInstrumentMix,
  type RoomPatternPitchMode,
  type RoomPatternPlaybackSequence,
  type RoomPatternTonalInstrumentId,
} from './pattern';
import {
  DEFAULT_ROOM_MUSIC_KEY_MODE,
  DEFAULT_ROOM_MUSIC_KEY_TONIC,
  normalizeRoomMusicKeyMode,
  normalizeRoomMusicKeyTonic,
  type RoomMusicKeyMode,
  type RoomMusicKeyTonic,
} from './key';
import {
  materializeMusicPhraseDrumTrack,
  materializeMusicPhraseTonalTrack,
  type MusicPhraseRecord,
} from './library';

export const ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT = 8;
export const ROOM_PHRASE_ARRANGEMENT_SEGMENT_BAR_COUNT = ROOM_PATTERN_BAR_COUNT;
export const ROOM_PHRASE_ARRANGEMENT_SEGMENT_STEP_COUNT = ROOM_PATTERN_STEP_COUNT;
export const ROOM_PHRASE_ARRANGEMENT_BAR_COUNT =
  ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT * ROOM_PHRASE_ARRANGEMENT_SEGMENT_BAR_COUNT;
export const ROOM_PHRASE_ARRANGEMENT_STEP_COUNT =
  ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT * ROOM_PHRASE_ARRANGEMENT_SEGMENT_STEP_COUNT;

export type RoomPhraseArrangementLaneSlots = (string | null)[];
export type RoomPhraseArrangementSlots = Record<RoomPatternInstrumentId, RoomPhraseArrangementLaneSlots>;

export interface RoomPhraseArrangementMusic {
  kind: 'phraseArrangement';
  bpm: number;
  swingPercent: number;
  beatsPerBar: number;
  stepsPerBeat: number;
  stepCount: number;
  barCount: number;
  slotCount: number;
  segmentBarCount: number;
  segmentStepCount: number;
  pitchMode: RoomPatternPitchMode;
  keyTonic: RoomMusicKeyTonic;
  keyMode: RoomMusicKeyMode;
  octaveShift: Record<RoomPatternTonalInstrumentId, number>;
  mix: RoomPatternInstrumentMix;
  slots: RoomPhraseArrangementSlots;
}

export function createEmptyRoomPhraseArrangementSlots(): RoomPhraseArrangementSlots {
  return {
    drums: Array.from({ length: ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT }, () => null),
    triangle: Array.from({ length: ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT }, () => null),
    saw: Array.from({ length: ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT }, () => null),
    square: Array.from({ length: ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT }, () => null),
  };
}

export function createDefaultRoomPhraseArrangementMusic(): RoomPhraseArrangementMusic {
  return {
    kind: 'phraseArrangement',
    bpm: ROOM_PATTERN_BPM,
    swingPercent: ROOM_PATTERN_SWING_PERCENT,
    beatsPerBar: ROOM_PATTERN_BEATS_PER_BAR,
    stepsPerBeat: ROOM_PATTERN_STEPS_PER_BEAT,
    stepCount: ROOM_PHRASE_ARRANGEMENT_STEP_COUNT,
    barCount: ROOM_PHRASE_ARRANGEMENT_BAR_COUNT,
    slotCount: ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT,
    segmentBarCount: ROOM_PHRASE_ARRANGEMENT_SEGMENT_BAR_COUNT,
    segmentStepCount: ROOM_PHRASE_ARRANGEMENT_SEGMENT_STEP_COUNT,
    pitchMode: 'scale',
    keyTonic: DEFAULT_ROOM_MUSIC_KEY_TONIC,
    keyMode: DEFAULT_ROOM_MUSIC_KEY_MODE,
    octaveShift: {
      triangle: DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.triangle,
      saw: DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.saw,
      square: DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.square,
    },
    mix: cloneRoomPatternInstrumentMix(DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX),
    slots: createEmptyRoomPhraseArrangementSlots(),
  };
}

function normalizeSlotId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLaneSlots(value: unknown): RoomPhraseArrangementLaneSlots {
  const next = Array.from({ length: ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT }, () => null) as RoomPhraseArrangementLaneSlots;
  if (!Array.isArray(value)) {
    return next;
  }

  for (let index = 0; index < ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT; index += 1) {
    next[index] = normalizeSlotId(value[index]);
  }

  return next;
}

export function cloneRoomPhraseArrangementMusic(
  value: RoomPhraseArrangementMusic | null | undefined,
): RoomPhraseArrangementMusic | null {
  if (!value) {
    return null;
  }

  return {
    kind: 'phraseArrangement',
    bpm: normalizeRoomPatternBpm(value.bpm),
    swingPercent: normalizeRoomPatternSwingPercent(value.swingPercent),
    beatsPerBar: ROOM_PATTERN_BEATS_PER_BAR,
    stepsPerBeat: ROOM_PATTERN_STEPS_PER_BEAT,
    stepCount: ROOM_PHRASE_ARRANGEMENT_STEP_COUNT,
    barCount: ROOM_PHRASE_ARRANGEMENT_BAR_COUNT,
    slotCount: ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT,
    segmentBarCount: ROOM_PHRASE_ARRANGEMENT_SEGMENT_BAR_COUNT,
    segmentStepCount: ROOM_PHRASE_ARRANGEMENT_SEGMENT_STEP_COUNT,
    pitchMode: value.pitchMode === 'chromatic' ? 'chromatic' : 'scale',
    keyTonic: normalizeRoomMusicKeyTonic(value.keyTonic),
    keyMode: normalizeRoomMusicKeyMode(value.keyMode),
    octaveShift: {
      triangle: Math.max(-2, Math.min(2, Math.round(value.octaveShift?.triangle ?? DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.triangle))),
      saw: Math.max(-2, Math.min(2, Math.round(value.octaveShift?.saw ?? DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.saw))),
      square: Math.max(-2, Math.min(2, Math.round(value.octaveShift?.square ?? DEFAULT_ROOM_PATTERN_OCTAVE_SHIFT.square))),
    },
    mix: cloneRoomPatternInstrumentMix(value.mix),
    slots: {
      drums: normalizeLaneSlots(value.slots?.drums),
      triangle: normalizeLaneSlots(value.slots?.triangle),
      saw: normalizeLaneSlots(value.slots?.saw),
      square: normalizeLaneSlots(value.slots?.square),
    },
  };
}

export function normalizeRoomPhraseArrangementMusic(value: unknown): RoomPhraseArrangementMusic | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return cloneRoomPhraseArrangementMusic(value as RoomPhraseArrangementMusic);
}

export function isRoomPhraseArrangementEmpty(
  value: RoomPhraseArrangementMusic | null | undefined,
): boolean {
  if (!value) {
    return true;
  }

  const defaults = createDefaultRoomPhraseArrangementMusic();
  if (
    value.bpm !== defaults.bpm
    || value.swingPercent !== defaults.swingPercent
    || value.pitchMode !== defaults.pitchMode
    || value.keyTonic !== defaults.keyTonic
    || value.keyMode !== defaults.keyMode
  ) {
    return false;
  }

  for (const instrumentId of ROOM_PATTERN_TONAL_INSTRUMENT_IDS) {
    if (value.octaveShift[instrumentId] !== defaults.octaveShift[instrumentId]) {
      return false;
    }
  }

  for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
    if (
      value.mix[instrumentId].volume !== defaults.mix[instrumentId].volume
      || value.mix[instrumentId].pan !== defaults.mix[instrumentId].pan
    ) {
      return false;
    }
  }

  return ROOM_PATTERN_INSTRUMENT_IDS.every((instrumentId) =>
    value.slots[instrumentId].every((phraseId) => phraseId === null),
  );
}

export function getRoomPhraseArrangementKey(
  value: RoomPhraseArrangementMusic,
): string {
  return [
    value.kind,
    `bpm:${value.bpm}`,
    `swing:${value.swingPercent}`,
    value.pitchMode,
    value.keyTonic,
    value.keyMode,
    String(value.octaveShift.triangle),
    String(value.octaveShift.saw),
    String(value.octaveShift.square),
    ...ROOM_PATTERN_INSTRUMENT_IDS.flatMap((instrumentId) => [
      instrumentId,
      value.mix[instrumentId].volume.toFixed(3),
      value.mix[instrumentId].pan.toFixed(3),
      value.slots[instrumentId].map((phraseId) => phraseId ?? '-').join(','),
    ]),
  ].join('|');
}

export function collectRoomPhraseArrangementPhraseIds(
  value: RoomPhraseArrangementMusic | null | undefined,
): string[] {
  if (!value) {
    return [];
  }

  const phraseIds = new Set<string>();
  for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
    for (const phraseId of value.slots[instrumentId]) {
      if (phraseId) {
        phraseIds.add(phraseId);
      }
    }
  }
  return [...phraseIds];
}

export function getRoomPhraseArrangementActiveSlotCount(
  value: RoomPhraseArrangementMusic | null | undefined,
): number {
  if (!value) {
    return 1;
  }

  let highestFilledSlotIndex = -1;
  for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
    for (let slotIndex = 0; slotIndex < value.slotCount; slotIndex += 1) {
      if (value.slots[instrumentId][slotIndex] !== null) {
        highestFilledSlotIndex = Math.max(highestFilledSlotIndex, slotIndex);
      }
    }
  }

  return highestFilledSlotIndex >= 0 ? highestFilledSlotIndex + 1 : 1;
}

export function getRoomPhraseArrangementActiveStepCount(
  value: RoomPhraseArrangementMusic | null | undefined,
): number {
  return getRoomPhraseArrangementActiveSlotCount(value) * ROOM_PHRASE_ARRANGEMENT_SEGMENT_STEP_COUNT;
}

export function getRoomPhraseArrangementActiveBarCount(
  value: RoomPhraseArrangementMusic | null | undefined,
): number {
  return getRoomPhraseArrangementActiveSlotCount(value) * ROOM_PHRASE_ARRANGEMENT_SEGMENT_BAR_COUNT;
}

function createDynamicTonalTrack(stepCount: number): { steps: (number | null)[]; ties: boolean[] } {
  return {
    steps: Array.from({ length: stepCount }, () => null),
    ties: Array.from({ length: stepCount }, () => false),
  };
}

function copyTonalPhraseIntoSequence(
  target: RoomPatternPlaybackSequence,
  instrumentId: RoomPatternTonalInstrumentId,
  phrase: MusicPhraseRecord,
  slotIndex: number,
): void {
  const targetTrack = target.tabs[instrumentId];
  const materialized = materializeMusicPhraseTonalTrack(
    phrase,
    target.pitchMode,
    target.keyTonic,
    target.keyMode,
    target.octaveShift[instrumentId],
  );
  const offset = slotIndex * ROOM_PHRASE_ARRANGEMENT_SEGMENT_STEP_COUNT;

  for (let stepIndex = 0; stepIndex < ROOM_PHRASE_ARRANGEMENT_SEGMENT_STEP_COUNT; stepIndex += 1) {
    const destinationIndex = offset + stepIndex;
    targetTrack.steps[destinationIndex] = materialized.steps[stepIndex] ?? null;
    targetTrack.ties[destinationIndex] =
      materialized.ties[stepIndex] === true &&
      destinationIndex > 0 &&
      targetTrack.steps[destinationIndex] !== null &&
      targetTrack.steps[destinationIndex - 1] !== null &&
      targetTrack.steps[destinationIndex] === targetTrack.steps[destinationIndex - 1];
  }
}

function copyDrumPhraseIntoSequence(
  target: RoomPatternPlaybackSequence,
  phrase: MusicPhraseRecord,
  slotIndex: number,
): void {
  const offset = slotIndex * ROOM_PHRASE_ARRANGEMENT_SEGMENT_STEP_COUNT;
  const track = materializeMusicPhraseDrumTrack(phrase);
  for (const rowId of Object.keys(track) as Array<keyof typeof track>) {
    const destinationTrack = target.tabs.drums[rowId];
    for (const stepIndex of track[rowId]) {
      destinationTrack.push(offset + stepIndex);
    }
    destinationTrack.sort((left, right) => left - right);
  }
}

export function buildPlaybackSequenceFromPhraseArrangement(
  arrangement: RoomPhraseArrangementMusic,
  phraseById: ReadonlyMap<string, MusicPhraseRecord>,
): RoomPatternPlaybackSequence {
  const activeSlotCount = getRoomPhraseArrangementActiveSlotCount(arrangement);
  const activeStepCount = getRoomPhraseArrangementActiveStepCount(arrangement);
  const activeBarCount = getRoomPhraseArrangementActiveBarCount(arrangement);
  const sequence: RoomPatternPlaybackSequence = {
    bpm: arrangement.bpm,
    swingPercent: arrangement.swingPercent,
    beatsPerBar: arrangement.beatsPerBar,
    stepsPerBeat: arrangement.stepsPerBeat,
    stepCount: activeStepCount,
    barCount: activeBarCount,
    pitchMode: arrangement.pitchMode,
    keyTonic: arrangement.keyTonic,
    keyMode: arrangement.keyMode,
    octaveShift: {
      triangle: arrangement.octaveShift.triangle,
      saw: arrangement.octaveShift.saw,
      square: arrangement.octaveShift.square,
    },
    mix: cloneRoomPatternInstrumentMix(arrangement.mix),
    tabs: {
      drums: createEmptyRoomPatternDrumTrack(),
      triangle: createDynamicTonalTrack(activeStepCount),
      saw: createDynamicTonalTrack(activeStepCount),
      square: createDynamicTonalTrack(activeStepCount),
    },
  };

  for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
    for (let slotIndex = 0; slotIndex < activeSlotCount; slotIndex += 1) {
      const phraseId = arrangement.slots[instrumentId][slotIndex] ?? null;
      if (!phraseId) {
        continue;
      }

      const phrase = phraseById.get(phraseId);
      if (!phrase || phrase.instrumentId !== instrumentId) {
        continue;
      }

      if (instrumentId === 'drums') {
        copyDrumPhraseIntoSequence(sequence, phrase, slotIndex);
        continue;
      }

      copyTonalPhraseIntoSequence(sequence, instrumentId as RoomPatternTonalInstrumentId, phrase, slotIndex);
    }
  }

  return sequence;
}
