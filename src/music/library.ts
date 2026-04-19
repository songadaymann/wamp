import {
  cloneRoomPatternDrumTrack,
  createEmptyRoomPatternDrumTrack,
  cloneRoomPatternTonalTrack,
  findClosestPatternRowIndexForMidi,
  getPatternInstrumentLabel,
  getPatternStepMidi,
  isRoomPatternMusicEmpty,
  normalizeRoomPatternBpm,
  normalizeRoomPatternSwingPercent,
  ROOM_PATTERN_BPM,
  ROOM_PATTERN_SWING_PERCENT,
  type RoomPatternDrumTrack,
  type RoomPatternInstrumentId,
  type RoomPatternMusic,
  type RoomPatternPitchMode,
  type RoomPatternPlaybackSequence,
  type RoomPatternTonalInstrumentId,
  type RoomPatternTonalTrack,
} from './pattern';
import {
  normalizeRoomMusicKeyMode,
  normalizeRoomMusicKeyTonic,
  type RoomMusicKeyMode,
  type RoomMusicKeyTonic,
} from './key';

export type MusicPhraseCreatorPrincipalKind = 'user' | 'agent';

export interface MusicPhraseBatchRecord {
  id: string;
  roomId: string;
  roomVersion: number;
  roomTitle: string | null;
  roomX: number;
  roomY: number;
  creatorUserId: string | null;
  creatorPrincipalKind: MusicPhraseCreatorPrincipalKind | null;
  creatorAgentId: string | null;
  creatorDisplayName: string;
  createdAt: string;
}

export interface MusicPhraseDrumPayload {
  kind: 'drums';
  instrumentId: 'drums';
  bpm: number;
  swingPercent: number;
  barCount: number;
  stepCount: number;
  stepsPerBeat: number;
  track: RoomPatternDrumTrack;
}

export interface MusicPhraseTonalPayload {
  kind: 'tonal';
  instrumentId: RoomPatternTonalInstrumentId;
  bpm: number;
  swingPercent: number;
  barCount: number;
  stepCount: number;
  stepsPerBeat: number;
  pitchMode: RoomPatternPitchMode;
  keyTonic: RoomMusicKeyTonic;
  keyMode: RoomMusicKeyMode;
  octaveShift: number;
  track: RoomPatternTonalTrack;
}

export type MusicPhrasePayload = MusicPhraseDrumPayload | MusicPhraseTonalPayload;

export interface MusicPhraseRecord {
  id: string;
  batchId: string;
  roomId: string;
  roomVersion: number;
  roomTitle: string | null;
  roomX: number;
  roomY: number;
  creatorUserId: string | null;
  creatorPrincipalKind: MusicPhraseCreatorPrincipalKind | null;
  creatorAgentId: string | null;
  creatorDisplayName: string;
  instrumentId: RoomPatternInstrumentId;
  ordinal: number;
  label: string;
  fingerprint: string;
  payload: MusicPhrasePayload;
  sourceKeyTonic: RoomMusicKeyTonic | null;
  sourceKeyMode: RoomMusicKeyMode | null;
  sourcePhraseIds: string[];
  createdAt: string;
}

export interface MusicPhraseListResponse {
  items: MusicPhraseRecord[];
  nextCursor: string | null;
}

export interface MusicPhraseSaveResponse {
  items: MusicPhraseRecord[];
}

export function cloneMusicPhraseSourceIds(value: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    seen.add(trimmed);
  }

  return [...seen];
}

export function cloneMusicPhrasePayload(
  value: MusicPhrasePayload | null | undefined,
): MusicPhrasePayload | null {
  if (!value) {
    return null;
  }

  if (value.kind === 'drums') {
    return {
      kind: 'drums',
      instrumentId: 'drums',
      bpm: normalizeRoomPatternBpm(value.bpm ?? ROOM_PATTERN_BPM),
      swingPercent: normalizeRoomPatternSwingPercent(value.swingPercent ?? ROOM_PATTERN_SWING_PERCENT),
      barCount: Math.max(1, Math.floor(value.barCount) || 1),
      stepCount: Math.max(1, Math.floor(value.stepCount) || 1),
      stepsPerBeat: Math.max(1, Math.floor(value.stepsPerBeat) || 1),
      track: cloneRoomPatternDrumTrack(value.track),
    };
  }

  return {
    kind: 'tonal',
    instrumentId: value.instrumentId,
    bpm: normalizeRoomPatternBpm(value.bpm ?? ROOM_PATTERN_BPM),
    swingPercent: normalizeRoomPatternSwingPercent(value.swingPercent ?? ROOM_PATTERN_SWING_PERCENT),
    barCount: Math.max(1, Math.floor(value.barCount) || 1),
    stepCount: Math.max(1, Math.floor(value.stepCount) || 1),
    stepsPerBeat: Math.max(1, Math.floor(value.stepsPerBeat) || 1),
    pitchMode: value.pitchMode === 'chromatic' ? 'chromatic' : 'scale',
    keyTonic: normalizeRoomMusicKeyTonic(value.keyTonic),
    keyMode: normalizeRoomMusicKeyMode(value.keyMode),
    octaveShift: Math.max(-2, Math.min(2, Math.round(value.octaveShift) || 0)),
    track: cloneRoomPatternTonalTrack(value.track, {
      instrumentId: value.instrumentId,
      pitchMode: value.pitchMode === 'chromatic' ? 'chromatic' : 'scale',
      octaveShift: Math.max(-2, Math.min(2, Math.round(value.octaveShift) || 0)),
      keyTonic: normalizeRoomMusicKeyTonic(value.keyTonic),
      keyMode: normalizeRoomMusicKeyMode(value.keyMode),
    }),
  };
}

export function cloneMusicPhraseRecord(
  value: MusicPhraseRecord | null | undefined,
): MusicPhraseRecord | null {
  if (!value) {
    return null;
  }

  const payload = cloneMusicPhrasePayload(value.payload);
  if (!payload) {
    return null;
  }

  return {
    id: String(value.id),
    batchId: String(value.batchId),
    roomId: String(value.roomId),
    roomVersion: Math.max(1, Math.floor(value.roomVersion) || 1),
    roomTitle: typeof value.roomTitle === 'string' && value.roomTitle.trim() ? value.roomTitle.trim() : null,
    roomX: Number.isFinite(value.roomX) ? Math.round(value.roomX) : 0,
    roomY: Number.isFinite(value.roomY) ? Math.round(value.roomY) : 0,
    creatorUserId: typeof value.creatorUserId === 'string' && value.creatorUserId.trim() ? value.creatorUserId : null,
    creatorPrincipalKind:
      value.creatorPrincipalKind === 'agent' || value.creatorPrincipalKind === 'user'
        ? value.creatorPrincipalKind
        : null,
    creatorAgentId: typeof value.creatorAgentId === 'string' && value.creatorAgentId.trim() ? value.creatorAgentId : null,
    creatorDisplayName:
      typeof value.creatorDisplayName === 'string' && value.creatorDisplayName.trim()
        ? value.creatorDisplayName.trim()
        : 'Unknown',
    instrumentId: payload.instrumentId,
    ordinal: Math.max(0, Math.floor(value.ordinal) || 0),
    label:
      typeof value.label === 'string' && value.label.trim()
        ? value.label.trim()
        : createMusicPhraseLabel(
            typeof value.creatorDisplayName === 'string' && value.creatorDisplayName.trim()
              ? value.creatorDisplayName.trim()
              : 'Unknown',
            typeof value.roomTitle === 'string' && value.roomTitle.trim() ? value.roomTitle.trim() : null,
            { x: Number.isFinite(value.roomX) ? Math.round(value.roomX) : 0, y: Number.isFinite(value.roomY) ? Math.round(value.roomY) : 0 },
            payload.instrumentId,
            Math.max(0, Math.floor(value.ordinal) || 0),
          ),
    fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : '',
    payload,
    sourceKeyTonic: payload.kind === 'tonal' ? normalizeRoomMusicKeyTonic(value.sourceKeyTonic ?? payload.keyTonic) : null,
    sourceKeyMode: payload.kind === 'tonal' ? normalizeRoomMusicKeyMode(value.sourceKeyMode ?? payload.keyMode) : null,
    sourcePhraseIds: cloneMusicPhraseSourceIds(value.sourcePhraseIds),
    createdAt:
      typeof value.createdAt === 'string' && value.createdAt.trim()
        ? value.createdAt
        : new Date(0).toISOString(),
  };
}

export function createMusicPhraseLabel(
  creatorDisplayName: string,
  roomTitle: string | null,
  coordinates: { x: number; y: number },
  instrumentId: RoomPatternInstrumentId,
  ordinal: number,
  nameSuffix?: string | null,
): string {
  const roomLabel = roomTitle && roomTitle.trim() ? roomTitle.trim() : `${coordinates.x},${coordinates.y}`;
  const sampleName = createMusicPhraseSampleName(instrumentId, ordinal, nameSuffix);
  return `${creatorDisplayName} · ${roomLabel} · ${sampleName}`;
}

export function createMusicPhraseSampleName(
  instrumentId: RoomPatternInstrumentId,
  ordinal: number,
  nameSuffix?: string | null,
): string {
  const trimmedName = typeof nameSuffix === 'string' ? nameSuffix.trim() : '';
  if (trimmedName) {
    return trimmedName;
  }

  return `${getPatternInstrumentLabel(instrumentId)} ${Math.max(1, Math.floor(ordinal) + 1)}`;
}

export function getMusicPhraseSampleName(phrase: Pick<MusicPhraseRecord, 'label'>): string {
  const parts = phrase.label.split('·').map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? phrase.label;
}

export function getMusicPhraseFingerprint(payload: MusicPhrasePayload): string {
  const normalized = cloneMusicPhrasePayload(payload);
  if (!normalized) {
    return '';
  }

  return JSON.stringify({
    ...normalized,
    bpm: undefined,
    swingPercent: undefined,
  });
}

export function isMusicPhrasePayloadEmpty(payload: MusicPhrasePayload | null | undefined): boolean {
  if (!payload) {
    return true;
  }

  if (payload.kind === 'drums') {
    return Object.values(payload.track).every((steps) => steps.length === 0);
  }

  return payload.track.steps.every((rowIndex) => rowIndex === null)
    && (!Array.isArray(payload.track.midis) || payload.track.midis.every((midi) => midi === null));
}

export function isMusicPhraseRecordTonal(
  phrase: MusicPhraseRecord | null | undefined,
): phrase is MusicPhraseRecord & { payload: MusicPhraseTonalPayload } {
  return Boolean(phrase && phrase.payload.kind === 'tonal');
}

export function isMusicPhraseRecordDrum(
  phrase: MusicPhraseRecord | null | undefined,
): phrase is MusicPhraseRecord & { payload: MusicPhraseDrumPayload } {
  return Boolean(phrase && phrase.payload.kind === 'drums');
}

export function extractMusicPhrasePayloadFromPattern(
  pattern: RoomPatternMusic | null | undefined,
  instrumentId: RoomPatternInstrumentId,
): MusicPhrasePayload | null {
  if (!pattern || isRoomPatternMusicEmpty(pattern)) {
    return null;
  }

  if (instrumentId === 'drums') {
    const payload: MusicPhraseDrumPayload = {
      kind: 'drums',
      instrumentId: 'drums',
      bpm: pattern.bpm,
      swingPercent: pattern.swingPercent,
      barCount: pattern.barCount,
      stepCount: pattern.stepCount,
      stepsPerBeat: pattern.stepsPerBeat,
      track: cloneRoomPatternDrumTrack(pattern.tabs.drums),
    };
    return isMusicPhrasePayloadEmpty(payload) ? null : payload;
  }

  const tonalInstrumentId = instrumentId as RoomPatternTonalInstrumentId;
  const payload: MusicPhraseTonalPayload = {
    kind: 'tonal',
    instrumentId: tonalInstrumentId,
    bpm: pattern.bpm,
    swingPercent: pattern.swingPercent,
    barCount: pattern.barCount,
    stepCount: pattern.stepCount,
    stepsPerBeat: pattern.stepsPerBeat,
    pitchMode: pattern.pitchMode,
    keyTonic: pattern.keyTonic,
    keyMode: pattern.keyMode,
    octaveShift: pattern.octaveShift[tonalInstrumentId],
    track: cloneRoomPatternTonalTrack(pattern.tabs[tonalInstrumentId], {
      instrumentId: tonalInstrumentId,
      pitchMode: pattern.pitchMode,
      octaveShift: pattern.octaveShift[tonalInstrumentId],
      keyTonic: pattern.keyTonic,
      keyMode: pattern.keyMode,
    }),
  };
  return isMusicPhrasePayloadEmpty(payload) ? null : payload;
}

function createDynamicTonalTrack(stepCount: number): RoomPatternTonalTrack {
  return {
    steps: Array.from({ length: Math.max(1, stepCount) }, () => null),
    ties: Array.from({ length: Math.max(1, stepCount) }, () => false),
    midis: Array.from({ length: Math.max(1, stepCount) }, () => null),
  };
}

function createPlaybackSequenceForTonalPhrasePayload(
  payload: MusicPhraseTonalPayload,
): Pick<RoomPatternPlaybackSequence, 'pitchMode' | 'keyTonic' | 'keyMode' | 'octaveShift' | 'tabs'> {
  const emptyTrack = () => createDynamicTonalTrack(payload.stepCount);
  return {
    pitchMode: payload.pitchMode,
    keyTonic: payload.keyTonic,
    keyMode: payload.keyMode,
    octaveShift: {
      triangle: payload.instrumentId === 'triangle' ? payload.octaveShift : 0,
      saw: payload.instrumentId === 'saw' ? payload.octaveShift : 0,
      square: payload.instrumentId === 'square' ? payload.octaveShift : 0,
    },
    tabs: {
      drums: createEmptyRoomPatternDrumTrack(),
      triangle: payload.instrumentId === 'triangle' ? payload.track : emptyTrack(),
      saw: payload.instrumentId === 'saw' ? payload.track : emptyTrack(),
      square: payload.instrumentId === 'square' ? payload.track : emptyTrack(),
    },
  };
}

export function materializeMusicPhraseDrumTrack(
  phrase: MusicPhraseRecord,
): RoomPatternDrumTrack {
  if (phrase.payload.kind !== 'drums') {
    return createEmptyRoomPatternDrumTrack();
  }

  return cloneRoomPatternDrumTrack(phrase.payload.track);
}

export function materializeMusicPhraseTonalTrack(
  phrase: MusicPhraseRecord,
  targetPitchMode: RoomPatternPitchMode,
  targetKeyTonic: RoomMusicKeyTonic,
  targetKeyMode: RoomMusicKeyMode,
  targetOctaveShift: number,
): RoomPatternTonalTrack {
  if (phrase.payload.kind !== 'tonal') {
    return createDynamicTonalTrack(phrase.payload.stepCount);
  }

  const track = createDynamicTonalTrack(phrase.payload.stepCount);
  const sourcePlayback = createPlaybackSequenceForTonalPhrasePayload(phrase.payload);
  for (let stepIndex = 0; stepIndex < phrase.payload.stepCount; stepIndex += 1) {
    const rowIndex = phrase.payload.track.steps[stepIndex] ?? null;
    if (rowIndex === null) {
      continue;
    }

    const sourceMidi = getPatternStepMidi(sourcePlayback, phrase.payload.instrumentId, stepIndex);
    if (sourceMidi === null) {
      continue;
    }

    track.steps[stepIndex] = findClosestPatternRowIndexForMidi(
      phrase.payload.instrumentId,
      sourceMidi,
      targetPitchMode,
      targetOctaveShift,
      targetKeyTonic,
      targetKeyMode,
    );
    track.midis[stepIndex] = sourceMidi;
  }

  for (let stepIndex = 1; stepIndex < phrase.payload.stepCount; stepIndex += 1) {
    track.ties[stepIndex] =
      phrase.payload.track.ties[stepIndex] === true &&
      track.steps[stepIndex] !== null &&
      track.steps[stepIndex - 1] !== null &&
      track.midis[stepIndex] !== null &&
      track.midis[stepIndex] === track.midis[stepIndex - 1];
  }

  return track;
}
