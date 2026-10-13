import { resolveAudioAssetUrl } from '../audio/assetUrl';
import type { RoomPatternDrumRowId } from './pattern';

type RolandMt32DrumSampleConfig = {
  assetPath: string;
  variant?: 'default' | 'tight-kick';
};

const ROLAND_MT32_SAMPLE_CONFIG: Record<RoomPatternDrumRowId, RolandMt32DrumSampleConfig> = {
  'fx-click': {
    assetPath: 'assets/music/roland-mt32/fx-click.mp3',
  },
  tambourine: {
    assetPath: 'assets/music/roland-mt32/tambourine.mp3',
  },
  shaker: {
    assetPath: 'assets/music/roland-mt32/shaker.mp3',
  },
  cowbell: {
    assetPath: 'assets/music/roland-mt32/cowbell.mp3',
  },
  crash: {
    assetPath: 'assets/music/roland-mt32/crash.mp3',
  },
  ride: {
    assetPath: 'assets/music/roland-mt32/ride.mp3',
  },
  'open-hat': {
    assetPath: 'assets/music/roland-mt32/hat-open.mp3',
  },
  'closed-hat': {
    assetPath: 'assets/music/roland-mt32/hat-closed.mp3',
  },
  'high-tom': {
    assetPath: 'assets/music/roland-mt32/tom-high.mp3',
  },
  'mid-tom': {
    assetPath: 'assets/music/roland-mt32/tom-mid.mp3',
  },
  'low-tom': {
    assetPath: 'assets/music/roland-mt32/tom-low.mp3',
  },
  rim: {
    assetPath: 'assets/music/roland-mt32/rimshot.mp3',
  },
  clap: {
    assetPath: 'assets/music/roland-mt32/clap.mp3',
  },
  snare: {
    assetPath: 'assets/music/roland-mt32/snare-02.mp3',
  },
  'kick-2': {
    assetPath: 'assets/music/roland-mt32/bassdrum.mp3',
    variant: 'tight-kick',
  },
  'kick-1': {
    assetPath: 'assets/music/roland-mt32/bassdrum.mp3',
  },
};

const samplePromiseCache = new Map<string, Promise<Float32Array | null>>();

function resolveAssetUrl(path: string): string {
  return resolveAudioAssetUrl(path, import.meta.env.BASE_URL, window.location.href);
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

// Rows that share a file (two kick variants) download it once, even when requested together.
const sampleBytesCache = new Map<string, Promise<ArrayBuffer>>();

function loadSampleBytes(assetPath: string): Promise<ArrayBuffer> {
  let bytes = sampleBytesCache.get(assetPath);
  if (!bytes) {
    bytes = fetch(resolveAssetUrl(assetPath)).then((response) => {
      if (!response.ok) throw new Error(`Failed to load ${assetPath}: ${response.status}`);
      return response.arrayBuffer();
    });
    bytes.catch(() => sampleBytesCache.delete(assetPath));
    sampleBytesCache.set(assetPath, bytes);
  }
  return bytes;
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

  const samplePromise = loadSampleBytes(config.assetPath)
    .then(async (audioData) => {
      const decoded = await audioContext.decodeAudioData(audioData.slice(0));
      // Mono, silence trim and peak normalization are baked into the MP3.
      return applyVariant(decoded.getChannelData(0), config.variant);
    })
    .catch(() => null);

  samplePromiseCache.set(cacheKey, samplePromise);
  return samplePromise;
}
