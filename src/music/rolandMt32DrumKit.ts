import type { RoomPatternDrumRowId } from './pattern';

type RolandMt32DrumSampleConfig = {
  assetPath: string;
  variant?: 'default' | 'tight-kick';
};

const ROLAND_MT32_SAMPLE_CONFIG: Record<RoomPatternDrumRowId, RolandMt32DrumSampleConfig> = {
  'fx-click': {
    assetPath: 'assets/music/roland-mt32/fx-click.wav',
  },
  tambourine: {
    assetPath: 'assets/music/roland-mt32/tambourine.wav',
  },
  shaker: {
    assetPath: 'assets/music/roland-mt32/shaker.wav',
  },
  cowbell: {
    assetPath: 'assets/music/roland-mt32/cowbell.wav',
  },
  crash: {
    assetPath: 'assets/music/roland-mt32/crash.wav',
  },
  ride: {
    assetPath: 'assets/music/roland-mt32/ride.wav',
  },
  'open-hat': {
    assetPath: 'assets/music/roland-mt32/hat-open.wav',
  },
  'closed-hat': {
    assetPath: 'assets/music/roland-mt32/hat-closed.wav',
  },
  'high-tom': {
    assetPath: 'assets/music/roland-mt32/tom-high.wav',
  },
  'mid-tom': {
    assetPath: 'assets/music/roland-mt32/tom-mid.wav',
  },
  'low-tom': {
    assetPath: 'assets/music/roland-mt32/tom-low.wav',
  },
  rim: {
    assetPath: 'assets/music/roland-mt32/rimshot.wav',
  },
  clap: {
    assetPath: 'assets/music/roland-mt32/clap.wav',
  },
  snare: {
    assetPath: 'assets/music/roland-mt32/snare-02.wav',
  },
  'kick-2': {
    assetPath: 'assets/music/roland-mt32/bassdrum.wav',
    variant: 'tight-kick',
  },
  'kick-1': {
    assetPath: 'assets/music/roland-mt32/bassdrum.wav',
  },
};

const samplePromiseCache = new Map<string, Promise<Float32Array | null>>();

function resolveAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedPath = path.replace(/^\/+/, '');
  const baseUrl = new URL(base, window.location.href);
  return new URL(normalizedPath, baseUrl).toString();
}

function mixAudioBufferToMono(buffer: AudioBuffer): Float32Array {
  const channelCount = Math.max(1, buffer.numberOfChannels);
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      mono[index] += channelData[index] / channelCount;
    }
  }
  return mono;
}

function trimSilence(
  source: Float32Array,
  options?: {
    threshold?: number;
    paddingSamples?: number;
  },
): Float32Array {
  const threshold = options?.threshold ?? 0.0025;
  const paddingSamples = Math.max(0, Math.floor(options?.paddingSamples ?? 48));

  let start = 0;
  while (start < source.length && Math.abs(source[start]) < threshold) {
    start += 1;
  }

  let end = source.length - 1;
  while (end > start && Math.abs(source[end]) < threshold) {
    end -= 1;
  }

  const trimmedStart = Math.max(0, start - paddingSamples);
  const trimmedEnd = Math.min(source.length, end + paddingSamples + 1);
  return source.slice(trimmedStart, Math.max(trimmedStart + 1, trimmedEnd));
}

function normalizePeak(source: Float32Array, targetPeak = 0.92): Float32Array {
  let peak = 0;
  for (let index = 0; index < source.length; index += 1) {
    peak = Math.max(peak, Math.abs(source[index]));
  }

  if (peak <= 0.0001) {
    return source.slice();
  }

  const gain = targetPeak / peak;
  const normalized = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    normalized[index] = source[index] * gain;
  }
  return normalized;
}

function resampleLinear(source: Float32Array, playbackRate: number): Float32Array {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0 || Math.abs(playbackRate - 1) < 0.0001) {
    return source.slice();
  }

  const targetLength = Math.max(1, Math.floor(source.length / playbackRate));
  const target = new Float32Array(targetLength);
  for (let index = 0; index < targetLength; index += 1) {
    const position = index * playbackRate;
    const leftIndex = Math.max(0, Math.min(source.length - 1, Math.floor(position)));
    const rightIndex = Math.max(0, Math.min(source.length - 1, leftIndex + 1));
    const mix = position - leftIndex;
    target[index] = source[leftIndex] * (1 - mix) + source[rightIndex] * mix;
  }
  return target;
}

function applyVariant(
  source: Float32Array,
  variant: RolandMt32DrumSampleConfig['variant'],
): Float32Array {
  switch (variant) {
    case 'tight-kick':
      return resampleLinear(source, 1.08);
    case 'default':
    default:
      return source.slice();
  }
}

export async function loadRolandMt32DrumSample(
  audioContext: AudioContext,
  rowId: RoomPatternDrumRowId,
): Promise<Float32Array | null> {
  const config = ROLAND_MT32_SAMPLE_CONFIG[rowId];
  const cacheKey = `${audioContext.sampleRate}:${config.assetPath}:${config.variant ?? 'default'}`;
  const cached = samplePromiseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const samplePromise = fetch(resolveAssetUrl(config.assetPath))
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${config.assetPath}: ${response.status}`);
      }
      const audioData = await response.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(audioData.slice(0));
      const mono = mixAudioBufferToMono(decoded);
      const trimmed = trimSilence(mono);
      const normalized = normalizePeak(trimmed);
      return applyVariant(normalized, config.variant);
    })
    .catch(() => null);

  samplePromiseCache.set(cacheKey, samplePromise);
  return samplePromise;
}
