import Phaser from 'phaser';

export const STARFIELD_TEXTURE_KEY = '__retro_starfield';

export const RETRO_COLORS = {
  background: '#050505',
  backgroundNumber: 0x050505,
  text: '#f3eee2',
  grid: 0xf3eee2,
  gridSoft: 0x3b372f,
  published: 0xd9d1c3,
  draft: 0x7de5ff,
  frontier: 0xffb04a,
  selected: 0xffffff,
  danger: 0xff6b6b,
} as const;

const STARFIELD_TILE_SIZE = 256;
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

export function updateStarfieldTileSprite(
  sprite: Phaser.GameObjects.TileSprite,
  camera: Phaser.Cameras.Scene2D.Camera,
  parallax: number,
  tileScale: number
): void {
  sprite.setPosition(0, 0);
  sprite.setSize(camera.width, camera.height);
  sprite.setTileScale(tileScale, tileScale);
  sprite.tilePositionX = (camera.scrollX * parallax) / tileScale;
  sprite.tilePositionY = (camera.scrollY * parallax) / tileScale;
}
