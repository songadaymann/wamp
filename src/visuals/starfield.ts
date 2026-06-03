import Phaser from 'phaser';

export const STARFIELD_TEXTURE_KEY = '__retro_starfield';

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

const STARFIELD_TILE_SIZE = 256;
const DEFAULT_STARFIELD_SEED = 0x05260527;

export interface StarfieldLayerConfig {
  parallax: number;
  tileScale: number;
  alpha?: number;
}

export const STARFIELD_LAYER_CONFIGS: readonly StarfieldLayerConfig[] = [
  { parallax: 0.035, tileScale: 1 },
  { parallax: 0.12, tileScale: 0.58, alpha: 0.28 },
] as const;

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
  seed: number = DEFAULT_STARFIELD_SEED
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

export function ensureStarfieldTexture(scene: Phaser.Scene, textureKey: string = STARFIELD_TEXTURE_KEY): string {
  if (scene.textures.exists(textureKey)) {
    return textureKey;
  }

  const canvasTexture = scene.textures.createCanvas(textureKey, STARFIELD_TILE_SIZE, STARFIELD_TILE_SIZE);
  if (!canvasTexture) {
    return textureKey;
  }

  const canvas = canvasTexture.getSourceImage() as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) {
    return textureKey;
  }

  context.clearRect(0, 0, STARFIELD_TILE_SIZE, STARFIELD_TILE_SIZE);
  context.imageSmoothingEnabled = false;
  drawStarfieldToContext(context, STARFIELD_TILE_SIZE, STARFIELD_TILE_SIZE, DEFAULT_STARFIELD_SEED);
  canvasTexture.refresh();
  return textureKey;
}

export function getStarfieldLayerConfig(index: number, parallaxMultiplier = 1): StarfieldLayerConfig {
  const config = STARFIELD_LAYER_CONFIGS[Math.min(index, STARFIELD_LAYER_CONFIGS.length - 1)];
  return {
    ...config,
    parallax: config.parallax * parallaxMultiplier,
  };
}

export function createStarfieldTileSprite(
  scene: Phaser.Scene,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
    alpha?: number;
    textureKey?: string;
  },
): Phaser.GameObjects.TileSprite {
  const sprite = scene.add.tileSprite(
    options.x,
    options.y,
    options.width,
    options.height,
    options.textureKey ?? ensureStarfieldTexture(scene),
  );
  sprite.setOrigin(0, 0);
  sprite.setDepth(options.depth);
  if (typeof options.alpha === 'number') {
    sprite.setAlpha(options.alpha);
  }
  sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return sprite;
}

export function syncStarfieldTileSprite(
  sprite: Phaser.GameObjects.TileSprite,
  camera: Phaser.Cameras.Scene2D.Camera,
  config: StarfieldLayerConfig,
  options: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    useVerticalParallax?: boolean;
  } = {},
): void {
  const tileScale = config.tileScale;
  sprite.setPosition(options.x ?? 0, options.y ?? 0);
  sprite.setSize(options.width ?? camera.width, options.height ?? camera.height);
  sprite.setTileScale(tileScale, tileScale);
  sprite.tilePositionX = (camera.scrollX * config.parallax) / tileScale;
  sprite.tilePositionY = options.useVerticalParallax === false
    ? 0
    : (camera.scrollY * config.parallax) / tileScale;
}

export function updateStarfieldTileSprite(
  sprite: Phaser.GameObjects.TileSprite,
  camera: Phaser.Cameras.Scene2D.Camera,
  parallax: number,
  tileScale: number
): void {
  syncStarfieldTileSprite(sprite, camera, { parallax, tileScale });
}
