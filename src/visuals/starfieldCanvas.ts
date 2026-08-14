export const RETRO_COLORS = {
  background: '#050505',
  backgroundNumber: 0x050505,
  text: '#f3eee2',
  grid: 0xf3eee2,
  gridSoft: 0x3b372f,
  published: 0xd9d1c3,
  claimedUnpublished: 0x95c3c3,
  draft: 0x7de5ff,
  frontier: 0xffb04a,
  selected: 0xffffff,
  danger: 0xff6b6b,
} as const;

const DEFAULT_STARFIELD_SEED = 0x05260527;

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

export function hashStringToSeed(value: string): number {
  let hash = 2166136261 >>> 0;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0 || 1;
}

export function drawStarfieldToContext(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number = DEFAULT_STARFIELD_SEED,
): void {
  context.fillStyle = RETRO_COLORS.background;
  context.fillRect(0, 0, width, height);

  let localSeed = seed >>> 0 || DEFAULT_STARFIELD_SEED;
  const starCount = Math.max(18, Math.round((width * height) / 2200));

  for (let index = 0; index < starCount; index++) {
    localSeed = nextSeed(localSeed);
    const x = localSeed % width;

    localSeed = nextSeed(localSeed);
    const y = localSeed % height;

    localSeed = nextSeed(localSeed);
    const brightness = localSeed & 0xff;
    const size = brightness > 232 ? 2 : 1;

    context.globalAlpha = brightness > 210 ? 0.95 : brightness > 120 ? 0.65 : 0.35;
    if (brightness > 242) {
      context.fillStyle = '#ffd79a';
    } else if (brightness < 18) {
      context.fillStyle = '#7de5ff';
    } else {
      context.fillStyle = RETRO_COLORS.text;
    }

    context.fillRect(x, y, size, size);
  }

  context.globalAlpha = 1;
}
