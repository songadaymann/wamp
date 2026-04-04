import {
  ROOM_PATTERN_DRUM_ROWS,
  type RoomPatternDrumRowDefinition,
  type RoomPatternDrumRowId,
} from './pattern';

const drumSampleCache = new Map<string, Map<RoomPatternDrumRowId, Float32Array>>();

function createBuffer(length: number): Float32Array {
  return new Float32Array(Math.max(1, Math.floor(length)));
}

function mixIn(target: Float32Array, source: Float32Array, gain = 1, offset = 0): void {
  const normalizedOffset = Math.max(0, Math.floor(offset));
  const length = Math.min(source.length, target.length - normalizedOffset);
  for (let index = 0; index < length; index += 1) {
    target[normalizedOffset + index] += source[index] * gain;
  }
}

function applySoftClip(buffer: Float32Array, drive = 1): void {
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = Math.tanh(buffer[index] * drive);
  }
}

function renderDroppedSine(
  sampleRate: number,
  durationSec: number,
  options: {
    startFreqHz: number;
    endFreqHz: number;
    amplitude: number;
    decaySec: number;
    clickAmount?: number;
    noiseAmount?: number;
  },
): Float32Array {
  const length = Math.max(1, Math.round(durationSec * sampleRate));
  const buffer = createBuffer(length);
  let phase = 0;
  let lastNoise = 0;
  const clickAmount = options.clickAmount ?? 0;
  const noiseAmount = options.noiseAmount ?? 0;
  for (let index = 0; index < length; index += 1) {
    const progress = length <= 1 ? 1 : index / (length - 1);
    const freq = options.startFreqHz * Math.pow(options.endFreqHz / options.startFreqHz, progress);
    phase += (Math.PI * 2 * freq) / sampleRate;
    const env = Math.exp(-index / Math.max(1, options.decaySec * sampleRate));
    const noise = (Math.random() * 2 - 1) - lastNoise * 0.84;
    lastNoise = noise;
    buffer[index] =
      Math.sin(phase) * options.amplitude * env
      + noise * noiseAmount * env
      + (index < sampleRate * 0.008 ? (1 - index / Math.max(1, sampleRate * 0.008)) * clickAmount : 0);
  }
  return buffer;
}

function renderHighNoise(
  sampleRate: number,
  durationSec: number,
  options: {
    amplitude: number;
    decaySec: number;
    brightness?: number;
    pulseCount?: number;
    pulseSpacingSec?: number;
  },
): Float32Array {
  const length = Math.max(1, Math.round(durationSec * sampleRate));
  const buffer = createBuffer(length);
  const pulses = Math.max(1, options.pulseCount ?? 1);
  const pulseSpacing = Math.max(0, Math.round((options.pulseSpacingSec ?? 0.018) * sampleRate));
  for (let pulseIndex = 0; pulseIndex < pulses; pulseIndex += 1) {
    const pulseOffset = pulseIndex * pulseSpacing;
    let previousNoise = 0;
    for (let index = pulseOffset; index < length; index += 1) {
      const localIndex = index - pulseOffset;
      const env = Math.exp(-localIndex / Math.max(1, options.decaySec * sampleRate));
      if (env < 0.0008) {
        break;
      }
      const noise = Math.random() * 2 - 1;
      const highPassed = noise - previousNoise * (options.brightness ?? 0.92);
      previousNoise = noise;
      buffer[index] += highPassed * options.amplitude * env;
    }
  }
  return buffer;
}

function renderMetallic(
  sampleRate: number,
  durationSec: number,
  options: {
    amplitude: number;
    decaySec: number;
    frequenciesHz: number[];
  },
): Float32Array {
  const length = Math.max(1, Math.round(durationSec * sampleRate));
  const buffer = createBuffer(length);
  const phases = options.frequenciesHz.map(() => 0);
  for (let index = 0; index < length; index += 1) {
    const env = Math.exp(-index / Math.max(1, options.decaySec * sampleRate));
    let sample = 0;
    for (let partialIndex = 0; partialIndex < options.frequenciesHz.length; partialIndex += 1) {
      phases[partialIndex] += (Math.PI * 2 * options.frequenciesHz[partialIndex]) / sampleRate;
      sample += Math.sign(Math.sin(phases[partialIndex]));
    }
    buffer[index] = (sample / options.frequenciesHz.length) * options.amplitude * env;
  }
  return buffer;
}

function renderClap(sampleRate: number): Float32Array {
  const bursts = renderHighNoise(sampleRate, 0.22, {
    amplitude: 0.56,
    decaySec: 0.05,
    brightness: 0.96,
    pulseCount: 3,
    pulseSpacingSec: 0.022,
  });
  applySoftClip(bursts, 1.2);
  return bursts;
}

function renderShaker(sampleRate: number): Float32Array {
  const buffer = renderHighNoise(sampleRate, 0.17, {
    amplitude: 0.24,
    decaySec: 0.028,
    brightness: 0.98,
    pulseCount: 6,
    pulseSpacingSec: 0.01,
  });
  applySoftClip(buffer, 1.1);
  return buffer;
}

function renderTambourine(sampleRate: number): Float32Array {
  const noise = renderHighNoise(sampleRate, 0.24, {
    amplitude: 0.22,
    decaySec: 0.06,
    brightness: 0.97,
    pulseCount: 4,
    pulseSpacingSec: 0.016,
  });
  const metallic = renderMetallic(sampleRate, 0.24, {
    amplitude: 0.22,
    decaySec: 0.08,
    frequenciesHz: [1280, 1880, 2420],
  });
  mixIn(noise, metallic, 0.7);
  applySoftClip(noise, 1.15);
  return noise;
}

function renderDrumSample(rowId: RoomPatternDrumRowId, sampleRate: number): Float32Array {
  switch (rowId) {
    case 'kick-1':
      return renderDroppedSine(sampleRate, 0.42, {
        startFreqHz: 132,
        endFreqHz: 42,
        amplitude: 1.0,
        decaySec: 0.22,
        clickAmount: 0.32,
        noiseAmount: 0.04,
      });
    case 'kick-2':
      return renderDroppedSine(sampleRate, 0.32, {
        startFreqHz: 176,
        endFreqHz: 58,
        amplitude: 0.84,
        decaySec: 0.18,
        clickAmount: 0.28,
        noiseAmount: 0.05,
      });
    case 'snare': {
      const body = renderDroppedSine(sampleRate, 0.24, {
        startFreqHz: 220,
        endFreqHz: 132,
        amplitude: 0.22,
        decaySec: 0.08,
      });
      mixIn(
        body,
        renderHighNoise(sampleRate, 0.24, {
          amplitude: 0.66,
          decaySec: 0.09,
          brightness: 0.93,
        }),
      );
      applySoftClip(body, 1.2);
      return body;
    }
    case 'clap':
      return renderClap(sampleRate);
    case 'rim':
      return renderMetallic(sampleRate, 0.08, {
        amplitude: 0.28,
        decaySec: 0.028,
        frequenciesHz: [1320, 1780],
      });
    case 'low-tom':
      return renderDroppedSine(sampleRate, 0.24, {
        startFreqHz: 184,
        endFreqHz: 98,
        amplitude: 0.58,
        decaySec: 0.12,
      });
    case 'mid-tom':
      return renderDroppedSine(sampleRate, 0.22, {
        startFreqHz: 232,
        endFreqHz: 132,
        amplitude: 0.52,
        decaySec: 0.11,
      });
    case 'high-tom':
      return renderDroppedSine(sampleRate, 0.18, {
        startFreqHz: 324,
        endFreqHz: 178,
        amplitude: 0.46,
        decaySec: 0.09,
      });
    case 'closed-hat':
      return renderHighNoise(sampleRate, 0.08, {
        amplitude: 0.36,
        decaySec: 0.018,
        brightness: 0.98,
      });
    case 'open-hat':
      return renderHighNoise(sampleRate, 0.24, {
        amplitude: 0.34,
        decaySec: 0.07,
        brightness: 0.98,
      });
    case 'ride': {
      const noise = renderHighNoise(sampleRate, 0.34, {
        amplitude: 0.22,
        decaySec: 0.11,
        brightness: 0.985,
      });
      mixIn(
        noise,
        renderMetallic(sampleRate, 0.34, {
          amplitude: 0.18,
          decaySec: 0.16,
          frequenciesHz: [860, 1440, 2010],
        }),
      );
      applySoftClip(noise, 1.1);
      return noise;
    }
    case 'crash': {
      const noise = renderHighNoise(sampleRate, 0.62, {
        amplitude: 0.32,
        decaySec: 0.22,
        brightness: 0.982,
      });
      mixIn(
        noise,
        renderMetallic(sampleRate, 0.62, {
          amplitude: 0.18,
          decaySec: 0.24,
          frequenciesHz: [720, 1170, 1630, 2440],
        }),
      );
      applySoftClip(noise, 1.1);
      return noise;
    }
    case 'cowbell':
      return renderMetallic(sampleRate, 0.16, {
        amplitude: 0.3,
        decaySec: 0.055,
        frequenciesHz: [560, 845, 1120],
      });
    case 'shaker':
      return renderShaker(sampleRate);
    case 'tambourine':
      return renderTambourine(sampleRate);
    case 'fx-click':
    default:
      return renderHighNoise(sampleRate, 0.05, {
        amplitude: 0.26,
        decaySec: 0.01,
        brightness: 0.99,
      });
  }
}

export function getPatternDrumSamples(sampleRate: number): Map<RoomPatternDrumRowId, Float32Array> {
  const cacheKey = String(Math.max(1, Math.floor(sampleRate)));
  const cached = drumSampleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const samples = new Map<RoomPatternDrumRowId, Float32Array>();
  for (const row of ROOM_PATTERN_DRUM_ROWS) {
    samples.set(row.id, renderDrumSample(row.id, sampleRate));
  }
  drumSampleCache.set(cacheKey, samples);
  return samples;
}

export function getPatternDrumRowDefinition(rowId: RoomPatternDrumRowId): RoomPatternDrumRowDefinition | null {
  return ROOM_PATTERN_DRUM_ROWS.find((row) => row.id === rowId) ?? null;
}
