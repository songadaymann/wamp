import { getPatternDrumSamples } from './patternKit';
import {
  ROOM_PATTERN_SWING_PERCENT,
  ROOM_PATTERN_DRUM_ROWS,
  ROOM_PATTERN_INSTRUMENT_IDS,
  ROOM_PATTERN_TONAL_INSTRUMENT_IDS,
  getPatternStepMidi,
  getRoomPatternLoopDurationSec,
  type RoomPatternInstrumentId,
  type RoomPatternPlaybackSequence,
  type RoomPatternTonalInstrumentId,
} from './pattern';

type TonalRenderSettings = {
  waveform: 'triangle' | 'sawtooth' | 'square';
  amplitude: number;
  attackSec: number;
  decaySec: number;
  sustainLevel: number;
  releaseSec: number;
};

const PATTERN_TONAL_BUS_GAINS: Record<RoomPatternTonalInstrumentId, number> = {
  triangle: 1.12,
  saw: 0.58,
  square: 0.48,
};
const PATTERN_DRUM_BUS_GAIN = 0.78;
/** Final soft clip of the summed mix: tanh(sample * drive). */
export const ROOM_PATTERN_OUTPUT_DRIVE = 0.86;
/** Per-lane saturation applied before mixing: tanh(x * drive) / tanh(drive) * outputGain. */
export const ROOM_PATTERN_LANE_DRIVE: Partial<Record<RoomPatternInstrumentId, { drive: number; outputGain: number }>> = {
  triangle: { drive: 1.75, outputGain: 1.08 },
  drums: { drive: 2.1, outputGain: 1.06 },
};
/** Longest tonal release, so a lane segment holds every tail. */
const TONAL_TAIL_SEC = 0.05;
/** An open hat is choked by the next hat with a 10 ms linear fade. */
export const ROOM_PATTERN_HAT_CHOKE_FADE_SEC = 0.01;

const TONAL_RENDER_SETTINGS: Record<RoomPatternTonalInstrumentId, TonalRenderSettings> = {
  triangle: {
    waveform: 'triangle',
    amplitude: 0.28,
    attackSec: 0.005,
    decaySec: 0.05,
    sustainLevel: 0.74,
    releaseSec: 0.045,
  },
  saw: {
    waveform: 'sawtooth',
    amplitude: 0.2,
    attackSec: 0.004,
    decaySec: 0.045,
    sustainLevel: 0.66,
    releaseSec: 0.035,
  },
  square: {
    waveform: 'square',
    amplitude: 0.17,
    attackSec: 0.003,
    decaySec: 0.04,
    sustainLevel: 0.62,
    releaseSec: 0.03,
  },
};

function waveformSample(type: TonalRenderSettings['waveform'], phase: number): number {
  const normalizedPhase = phase - Math.floor(phase);
  switch (type) {
    case 'triangle':
      return 1 - 4 * Math.abs(normalizedPhase - 0.5);
    case 'square':
      return normalizedPhase < 0.5 ? 1 : -1;
    case 'sawtooth':
    default:
      return normalizedPhase * 2 - 1;
  }
}

function envelopeAt(
  sampleIndex: number,
  noteSamples: number,
  releaseSamples: number,
  settings: TonalRenderSettings,
  sampleRate: number,
): number {
  const attackSamples = Math.max(1, Math.round(settings.attackSec * sampleRate));
  const decaySamples = Math.max(1, Math.round(settings.decaySec * sampleRate));
  if (sampleIndex < attackSamples) {
    return sampleIndex / attackSamples;
  }

  if (sampleIndex < attackSamples + decaySamples) {
    const decayProgress = (sampleIndex - attackSamples) / decaySamples;
    return 1 - (1 - settings.sustainLevel) * decayProgress;
  }

  if (sampleIndex < noteSamples) {
    return settings.sustainLevel;
  }

  const releaseProgress = (sampleIndex - noteSamples) / Math.max(1, releaseSamples);
  return settings.sustainLevel * Math.max(0, 1 - releaseProgress);
}

function renderTonalTrack(
  target: Float32Array,
  pattern: RoomPatternPlaybackSequence,
  instrumentId: RoomPatternTonalInstrumentId,
  sampleRate: number,
  stepStartTimesSec: readonly number[],
  loopDurationSec: number,
): void {
  const settings = TONAL_RENDER_SETTINGS[instrumentId];
  const track = pattern.tabs[instrumentId];
  const steps = track.steps;
  const ties = track.ties;
  const releaseSamples = Math.max(1, Math.round(settings.releaseSec * sampleRate));

  let stepIndex = 0;
  while (stepIndex < pattern.stepCount) {
    const rowIndex = steps[stepIndex];
    const midi = getPatternStepMidi(pattern, instrumentId, stepIndex);
    if (rowIndex === null || midi === null) {
      stepIndex += 1;
      continue;
    }

    let endStepIndex = stepIndex + 1;
    while (
      endStepIndex < pattern.stepCount &&
      getPatternStepMidi(pattern, instrumentId, endStepIndex) === midi &&
      ties[endStepIndex] === true
    ) {
      endStepIndex += 1;
    }

    const startSample = Math.max(0, Math.round(stepStartTimesSec[stepIndex] * sampleRate));
    const noteEndTimeSec = endStepIndex < pattern.stepCount
      ? stepStartTimesSec[endStepIndex]
      : loopDurationSec;
    const noteSamples = Math.max(1, Math.round((noteEndTimeSec - stepStartTimesSec[stepIndex]) * sampleRate));
    const totalSamples = noteSamples + releaseSamples;
    if (totalSamples <= 0) {
      break;
    }

    let phase = 0;
    const phaseStep = (440 * Math.pow(2, (midi - 69) / 12)) / sampleRate;
    for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
      const envelope = envelopeAt(sampleIndex, noteSamples, releaseSamples, settings, sampleRate);
      if (envelope <= 0) {
        continue;
      }

      phase += phaseStep;
      const voice = waveformSample(settings.waveform, phase) * settings.amplitude * envelope;
      // Fold release tails before drive/mixing, preserving the periodic voice.
      target[(startSample + sampleIndex) % target.length] += voice;
    }

    stepIndex = endStepIndex;
  }
}

function applySoftDrive(
  target: Float32Array,
  drive: number,
  outputGain: number,
): void {
  if (drive <= 1 || outputGain <= 0) {
    return;
  }

  const normalizer = Math.tanh(drive);
  for (let index = 0; index < target.length; index += 1) {
    const shaped = Math.tanh(target[index] * drive) / normalizer;
    target[index] = shaped * outputGain;
  }
}

async function renderDrumTrack(
  target: Float32Array,
  audioContext: AudioContext,
  pattern: RoomPatternPlaybackSequence,
  stepStartTimesSec: readonly number[],
  options?: { skipTrailingOpenHat?: boolean },
): Promise<void> {
  const sampleRate = audioContext.sampleRate;
  const drumSamples = await getPatternDrumSamples(audioContext);
  const hatStarts = [...new Set([
    ...pattern.tabs.drums['open-hat'], ...pattern.tabs.drums['closed-hat'],
  ].map(step => Math.round(stepStartTimesSec[step] * sampleRate)))].sort((a, b) => a - b);
  const nextHatStart = new Map(hatStarts.map((start, index) => [
    start, hatStarts[index + 1] ?? hatStarts[0] + target.length,
  ]));
  const closedHatStarts = new Set(pattern.tabs.drums['closed-hat'].map(step => Math.round(stepStartTimesSec[step] * sampleRate)));
  const chokeFadeSamples = Math.max(1, Math.round(ROOM_PATTERN_HAT_CHOKE_FADE_SEC * sampleRate));
  const lastHatStart = hatStarts.at(-1);
  const skippedOpenHatStart = options?.skipTrailingOpenHat && lastHatStart !== undefined && !closedHatStarts.has(lastHatStart)
    ? lastHatStart
    : null;
  for (const row of ROOM_PATTERN_DRUM_ROWS) {
    const sample = drumSamples.get(row.id);
    if (!sample) {
      continue;
    }

    for (const stepIndex of pattern.tabs.drums[row.id]) {
      const startSample = Math.max(0, Math.round(stepStartTimesSec[stepIndex] * sampleRate));
      // A closed hat on the same step wins; otherwise the next hat chokes the
      // open voice, including a hit in the following repetition of the loop.
      if (row.id === 'open-hat' && closedHatStarts.has(startSample)) continue;
      // Its choke depends on the following slot, so the arrangement scheduler plays it.
      if (row.id === 'open-hat' && startSample === skippedOpenHatStart) continue;
      const chokeAt = row.id === 'open-hat'
        ? (nextHatStart.get(startSample) ?? startSample + target.length) - startSample
        : sample.length;
      const copyLength = row.id === 'open-hat'
        ? Math.min(sample.length, chokeAt + chokeFadeSamples)
        : sample.length;
      for (let sampleIndex = 0; sampleIndex < copyLength; sampleIndex += 1) {
        const chokeGain = sampleIndex < chokeAt ? 1 : Math.max(0, 1 - (sampleIndex - chokeAt) / chokeFadeSamples);
        target[(startSample + sampleIndex) % target.length] += sample[sampleIndex] * row.defaultGain * chokeGain;
      }
    }
  }
}

function getStepTimingSec(
  pattern: Pick<RoomPatternPlaybackSequence, 'stepCount' | 'bpm' | 'stepsPerBeat'> & { swingPercent?: number },
): { startTimesSec: number[]; durationsSec: number[] } {
  const loopDurationSec = getRoomPatternLoopDurationSec(pattern);
  const baseStepDurationSec = loopDurationSec / pattern.stepCount;
  const startTimesSec = Array.from({ length: pattern.stepCount }, () => 0);
  const durationsSec = Array.from({ length: pattern.stepCount }, () => baseStepDurationSec);
  const swingRatio = Math.max(0.5, Math.min(0.95, (pattern.swingPercent ?? ROOM_PATTERN_SWING_PERCENT) / 100));

  let stepIndex = 0;
  let currentTimeSec = 0;
  while (stepIndex < pattern.stepCount) {
    if (stepIndex + 1 >= pattern.stepCount) {
      startTimesSec[stepIndex] = currentTimeSec;
      durationsSec[stepIndex] = baseStepDurationSec;
      currentTimeSec += baseStepDurationSec;
      stepIndex += 1;
      continue;
    }

    const pairDurationSec = baseStepDurationSec * 2;
    const firstStepDurationSec = pairDurationSec * swingRatio;
    const secondStepDurationSec = pairDurationSec - firstStepDurationSec;
    startTimesSec[stepIndex] = currentTimeSec;
    durationsSec[stepIndex] = firstStepDurationSec;
    currentTimeSec += firstStepDurationSec;
    startTimesSec[stepIndex + 1] = currentTimeSec;
    durationsSec[stepIndex + 1] = secondStepDurationSec;
    currentTimeSec += secondStepDurationSec;
    stepIndex += 2;
  }

  return { startTimesSec, durationsSec };
}

function finalizeBuffer(target: Float32Array): void {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = Math.tanh(target[index] * ROOM_PATTERN_OUTPUT_DRIVE);
  }
}

/** Mixer gain for a lane at a volume: the same gain the mixdown applies before panning. */
export function getRoomPatternLaneGain(instrumentId: RoomPatternInstrumentId, volume: number): number {
  const busGain = instrumentId === 'drums' ? PATTERN_DRUM_BUS_GAIN : PATTERN_TONAL_BUS_GAINS[instrumentId];
  return Math.max(0, Math.min(1, volume)) * busGain;
}

/** Lanes with any notes or hits, in stem channel order. */
export function getRoomPatternStemLanes(pattern: RoomPatternPlaybackSequence): RoomPatternInstrumentId[] {
  return ROOM_PATTERN_INSTRUMENT_IDS.filter((instrumentId) => instrumentId === 'drums'
    ? ROOM_PATTERN_DRUM_ROWS.some((row) => pattern.tabs.drums[row.id].length > 0)
    : pattern.tabs[instrumentId].steps.some((step) => step !== null));
}

/** One lane's loop after its own drive, before volume, pan, bus gain and the final soft clip. */
async function renderLaneLoop(
  audioContext: AudioContext,
  pattern: RoomPatternPlaybackSequence,
  instrumentId: RoomPatternInstrumentId,
  startTimesSec: readonly number[],
  loopDurationSec: number,
  totalSamples: number,
): Promise<Float32Array> {
  const lane = new Float32Array(totalSamples);
  if (instrumentId === 'drums') {
    await renderDrumTrack(lane, audioContext, pattern, startTimesSec);
  } else {
    renderTonalTrack(lane, pattern, instrumentId, audioContext.sampleRate, startTimesSec, loopDurationSec);
  }
  const laneDrive = ROOM_PATTERN_LANE_DRIVE[instrumentId];
  if (laneDrive) {
    applySoftDrive(lane, laneDrive.drive, laneDrive.outputGain);
  }
  return lane;
}

/** Drum hat timing for one slot: every hat onset, and a final open hat whose choke comes from the next slot. */
export function getRoomPatternHatTiming(
  pattern: RoomPatternPlaybackSequence,
  sampleRate: number,
): { hatTimesSec: number[]; trailingOpenHatSec: number | null } {
  const { startTimesSec } = getStepTimingSec(pattern);
  const toSample = (step: number) => Math.round(startTimesSec[step] * sampleRate);
  const hatStarts = [...new Set([
    ...pattern.tabs.drums['open-hat'], ...pattern.tabs.drums['closed-hat'],
  ].map(toSample))].sort((a, b) => a - b);
  const closedHatStarts = new Set(pattern.tabs.drums['closed-hat'].map(toSample));
  const last = hatStarts.at(-1);
  return {
    hatTimesSec: hatStarts.map((start) => start / sampleRate),
    trailingOpenHatSec: last !== undefined && !closedHatStarts.has(last) ? last / sampleRate : null,
  };
}

/**
 * One lane of a single-slot sequence before its drive, unfolded: from the slot's
 * first step through every release and drum tail. Arrange plays these per slot and
 * sums them, so the mix matches rendering the whole arrangement at once. A trailing
 * open hat is omitted (see getRoomPatternHatTiming and renderRoomPatternOpenHatVoice).
 */
export async function renderRoomPatternLaneSegment(
  audioContext: AudioContext,
  pattern: RoomPatternPlaybackSequence,
  instrumentId: RoomPatternInstrumentId,
): Promise<AudioBuffer> {
  const sampleRate = audioContext.sampleRate;
  const slotDurationSec = getRoomPatternLoopDurationSec(pattern);
  const { startTimesSec } = getStepTimingSec(pattern);
  let tailSamples = Math.ceil(TONAL_TAIL_SEC * sampleRate);
  let drumSamples: Map<string, Float32Array> | null = null;
  if (instrumentId === 'drums') {
    drumSamples = await getPatternDrumSamples(audioContext);
    for (const row of ROOM_PATTERN_DRUM_ROWS) {
      if (pattern.tabs.drums[row.id].length > 0) {
        tailSamples = Math.max(tailSamples, drumSamples.get(row.id)?.length ?? 0);
      }
    }
  }
  const segment = new Float32Array(Math.max(1, Math.round(slotDurationSec * sampleRate)) + tailSamples);
  if (instrumentId === 'drums') {
    await renderDrumTrack(segment, audioContext, pattern, startTimesSec, { skipTrailingOpenHat: true });
  } else {
    renderTonalTrack(segment, pattern, instrumentId, sampleRate, startTimesSec, slotDurationSec);
  }
  const buffer = audioContext.createBuffer(1, segment.length, sampleRate);
  buffer.getChannelData(0).set(segment);
  return buffer;
}

/** The open hat voice at its mix level, for the scheduler to choke at the next slot's hat. */
export async function renderRoomPatternOpenHatVoice(audioContext: AudioContext): Promise<AudioBuffer | null> {
  const sample = (await getPatternDrumSamples(audioContext)).get('open-hat');
  const row = ROOM_PATTERN_DRUM_ROWS.find((candidate) => candidate.id === 'open-hat');
  if (!sample || !row || sample.length === 0) {
    return null;
  }
  const buffer = audioContext.createBuffer(1, sample.length, audioContext.sampleRate);
  buffer.getChannelData(0).set(sample.map((value) => value * row.defaultGain));
  return buffer;
}

/**
 * Renders each sounding lane as its own channel (see getRoomPatternStemLanes) so
 * playback can mix volume and pan live. Mixing channel c of lane i with
 * getRoomPatternLaneGain, an equal-power pan and tanh(sum * ROOM_PATTERN_OUTPUT_DRIVE)
 * reproduces renderRoomPatternLoopBuffer.
 */
export async function renderRoomPatternStemBuffer(
  audioContext: AudioContext,
  pattern: RoomPatternPlaybackSequence,
): Promise<AudioBuffer> {
  const sampleRate = audioContext.sampleRate;
  const loopDurationSec = getRoomPatternLoopDurationSec(pattern);
  const totalSamples = Math.max(1, Math.round(loopDurationSec * sampleRate));
  const { startTimesSec } = getStepTimingSec(pattern);
  const lanes = getRoomPatternStemLanes(pattern);
  const buffer = audioContext.createBuffer(Math.max(1, lanes.length), totalSamples, sampleRate);
  for (const [channel, instrumentId] of lanes.entries()) {
    buffer.getChannelData(channel).set(
      await renderLaneLoop(audioContext, pattern, instrumentId, startTimesSec, loopDurationSec, totalSamples),
    );
  }
  return buffer;
}

function getPanGains(pan: number): { left: number; right: number } {
  const clampedPan = Math.max(-1, Math.min(1, pan));
  const angle = (clampedPan + 1) * (Math.PI * 0.25);
  return {
    left: Math.cos(angle),
    right: Math.sin(angle),
  };
}

function mixMonoTrackIntoStereo(
  mono: Float32Array,
  left: Float32Array,
  right: Float32Array | null,
  volume: number,
  pan: number,
  busGain: number,
): void {
  const { left: leftGain, right: rightGain } = getPanGains(pan);
  const gain = Math.max(0, Math.min(1, volume)) * busGain;
  for (let index = 0; index < mono.length; index += 1) {
    const sample = mono[index] * gain;
    left[index] += sample * leftGain;
    if (right) right[index] += sample * rightGain;
  }
}

export async function renderRoomPatternLoopBuffer(
  audioContext: AudioContext,
  pattern: RoomPatternPlaybackSequence,
): Promise<AudioBuffer> {
  const sampleRate = audioContext.sampleRate;
  const loopDurationSec = getRoomPatternLoopDurationSec(pattern);
  const totalSamples = Math.max(1, Math.round(loopDurationSec * sampleRate));
  const { startTimesSec } = getStepTimingSec(pattern);
  const leftMixdown = new Float32Array(totalSamples);
  const centered = [pattern.mix.drums, ...ROOM_PATTERN_TONAL_INSTRUMENT_IDS.map(id => pattern.mix[id])]
    .every(mix => mix.pan === 0);
  const rightMixdown = centered ? null : new Float32Array(totalSamples);

  for (const instrumentId of ROOM_PATTERN_TONAL_INSTRUMENT_IDS) {
    const instrumentMixdown = await renderLaneLoop(
      audioContext,
      pattern,
      instrumentId,
      startTimesSec,
      loopDurationSec,
      totalSamples,
    );
    const mix = pattern.mix[instrumentId];
    mixMonoTrackIntoStereo(
      instrumentMixdown,
      leftMixdown,
      rightMixdown,
      mix.volume,
      mix.pan,
      PATTERN_TONAL_BUS_GAINS[instrumentId],
    );
  }

  const drumMixdown = await renderLaneLoop(audioContext, pattern, 'drums', startTimesSec, loopDurationSec, totalSamples);
  const drumMix = pattern.mix.drums;
  mixMonoTrackIntoStereo(
    drumMixdown,
    leftMixdown,
    rightMixdown,
    drumMix.volume,
    drumMix.pan,
    PATTERN_DRUM_BUS_GAIN,
  );

  finalizeBuffer(leftMixdown);
  if (rightMixdown) finalizeBuffer(rightMixdown);

  const buffer = audioContext.createBuffer(rightMixdown ? 2 : 1, totalSamples, sampleRate);
  buffer.getChannelData(0).set(leftMixdown);
  if (rightMixdown) buffer.getChannelData(1).set(rightMixdown);
  return buffer;
}
