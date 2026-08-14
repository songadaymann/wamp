import Phaser from 'phaser';
import { drawStarfieldToContext } from './starfieldCanvas';

export {
  RETRO_COLORS,
  drawStarfieldToContext,
  hashStringToSeed,
} from './starfieldCanvas';

export const STARFIELD_TEXTURE_KEY = '__retro_starfield';

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
