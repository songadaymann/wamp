import { getPatternDrumSamples } from './patternKit';
import {
  ROOM_PATTERN_DRUM_ROWS,
  ROOM_PATTERN_TONAL_INSTRUMENT_IDS,
  getPatternRowNote,
  getRoomPatternLoopDurationSec,
  type RoomPatternMusic,
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
  pattern: RoomPatternMusic,
  instrumentId: RoomPatternTonalInstrumentId,
  sampleRate: number,
  stepDurationSec: number,
): void {
  const settings = TONAL_RENDER_SETTINGS[instrumentId];
  const track = pattern.tabs[instrumentId];
  const steps = track.steps;
  const ties = track.ties;
  const releaseSamples = Math.max(1, Math.round(settings.releaseSec * sampleRate));

  let stepIndex = 0;
  while (stepIndex < pattern.stepCount) {
    const rowIndex = steps[stepIndex];
    if (rowIndex === null) {
      stepIndex += 1;
      continue;
    }

    let endStepIndex = stepIndex + 1;
    while (
      endStepIndex < pattern.stepCount &&
      steps[endStepIndex] === rowIndex &&
      ties[endStepIndex] === true
    ) {
      endStepIndex += 1;
    }

    const note = getPatternRowNote(
      instrumentId,
      rowIndex,
      pattern.pitchMode,
      pattern.octaveShift[instrumentId],
    );
    if (!note) {
      stepIndex = endStepIndex;
      continue;
    }

    const startSample = Math.max(0, Math.round(stepIndex * stepDurationSec * sampleRate));
    const noteSamples = Math.max(1, Math.round((endStepIndex - stepIndex) * stepDurationSec * sampleRate));
    const totalSamples = Math.min(target.length - startSample, noteSamples + releaseSamples);
    if (totalSamples <= 0) {
      break;
    }

    let phase = 0;
    const phaseStep = note.frequencyHz / sampleRate;
    for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
      const envelope = envelopeAt(sampleIndex, noteSamples, releaseSamples, settings, sampleRate);
      if (envelope <= 0) {
        continue;
      }

      phase += phaseStep;
      const voice = waveformSample(settings.waveform, phase) * settings.amplitude * envelope;
      target[startSample + sampleIndex] += voice;
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

function renderDrumTrack(
  target: Float32Array,
  pattern: RoomPatternMusic,
  sampleRate: number,
  stepDurationSec: number,
): void {
  const drumSamples = getPatternDrumSamples(sampleRate);
  for (const row of ROOM_PATTERN_DRUM_ROWS) {
    const sample = drumSamples.get(row.id);
    if (!sample) {
      continue;
    }

    for (const stepIndex of pattern.tabs.drums[row.id]) {
      const startSample = Math.max(0, Math.round(stepIndex * stepDurationSec * sampleRate));
      const copyLength = Math.min(sample.length, target.length - startSample);
      for (let sampleIndex = 0; sampleIndex < copyLength; sampleIndex += 1) {
        target[startSample + sampleIndex] += sample[sampleIndex] * row.defaultGain;
      }
    }
  }
}

function finalizeBuffer(target: Float32Array): void {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = Math.tanh(target[index] * 0.86);
  }
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
  right: Float32Array,
  volume: number,
  pan: number,
  busGain: number,
): void {
  const { left: leftGain, right: rightGain } = getPanGains(pan);
  const gain = Math.max(0, Math.min(1, volume)) * busGain;
  for (let index = 0; index < mono.length; index += 1) {
    const sample = mono[index] * gain;
    left[index] += sample * leftGain;
    right[index] += sample * rightGain;
  }
}

export function renderRoomPatternLoopBuffer(
  audioContext: AudioContext,
  pattern: RoomPatternMusic,
): AudioBuffer {
  const sampleRate = audioContext.sampleRate;
  const loopDurationSec = getRoomPatternLoopDurationSec(pattern);
  const totalSamples = Math.max(1, Math.round(loopDurationSec * sampleRate));
  const stepDurationSec = loopDurationSec / pattern.stepCount;
  const leftMixdown = new Float32Array(totalSamples);
  const rightMixdown = new Float32Array(totalSamples);

  for (const instrumentId of ROOM_PATTERN_TONAL_INSTRUMENT_IDS) {
    const instrumentMixdown = new Float32Array(totalSamples);
    renderTonalTrack(instrumentMixdown, pattern, instrumentId, sampleRate, stepDurationSec);
    if (instrumentId === 'triangle') {
      applySoftDrive(instrumentMixdown, 1.75, 1.08);
    }
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

  const drumMixdown = new Float32Array(totalSamples);
  renderDrumTrack(drumMixdown, pattern, sampleRate, stepDurationSec);
  applySoftDrive(drumMixdown, 2.1, 1.06);
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
  finalizeBuffer(rightMixdown);

  const buffer = audioContext.createBuffer(2, totalSamples, sampleRate);
  buffer.getChannelData(0).set(leftMixdown);
  buffer.getChannelData(1).set(rightMixdown);
  return buffer;
}
