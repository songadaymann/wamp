import Phaser from 'phaser';
import { getBackgroundImageUrl } from './client';
import type { CustomBackgroundFit } from './model';

const customBackgroundLoadPromises = new Map<string, Promise<string>>();
const MAX_TILED_PHOTO_WIDTH = 128;
const MAX_TILED_PHOTO_HEIGHT = 96;

export interface CustomBackgroundLayer {
  key: string;
  path: string;
  width: number;
  height: number;
  scrollFactor: number;
  fit: CustomBackgroundFit;
}

export interface CustomBackgroundDrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CustomBackgroundObject = Phaser.GameObjects.TileSprite | Phaser.GameObjects.Image;

export function getCustomBackgroundTextureKey(id: string): string {
  return `custom_background_${id.replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
}

export function getCustomBackgroundTileScale(
  size: Pick<CustomBackgroundLayer, 'width' | 'height'>,
): number {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  return Math.min(1, MAX_TILED_PHOTO_WIDTH / width, MAX_TILED_PHOTO_HEIGHT / height);
}

export function getCustomBackgroundCenterRect(
  source: Pick<CustomBackgroundLayer, 'width' | 'height'>,
  target: { width: number; height: number },
): CustomBackgroundDrawRect {
  const sourceWidth = Math.max(1, Math.round(source.width));
  const sourceHeight = Math.max(1, Math.round(source.height));
  return {
    x: Math.floor((target.width - sourceWidth) / 2),
    y: Math.floor((target.height - sourceHeight) / 2),
    width: sourceWidth,
    height: sourceHeight,
  };
}

export function createCustomBackgroundLayer(
  scene: Phaser.Scene,
  id: string,
  fit: CustomBackgroundFit,
): CustomBackgroundLayer {
  const key = getCustomBackgroundTextureKey(id);
  const texture = scene.textures.exists(key) ? scene.textures.get(key) : null;
  const source = texture?.getSourceImage() as { width?: number; height?: number } | null;
  return {
    key,
    path: getBackgroundImageUrl(id),
    width: Math.max(1, Math.round(source?.width ?? 640)),
    height: Math.max(1, Math.round(source?.height ?? 352)),
    scrollFactor: 0,
    fit,
  };
}

export function createCustomBackgroundObject(
  scene: Phaser.Scene,
  layer: CustomBackgroundLayer,
  x: number,
  y: number,
  width: number,
  height: number,
  depth: number,
): CustomBackgroundObject {
  if (layer.fit === 'tile') {
    const sprite = scene.add.tileSprite(x, y, width, height, layer.key);
    sprite.setOrigin(0, 0);
    sprite.setDepth(depth);
    sprite.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    syncCustomBackgroundObject(sprite, layer, x, y, width, height, 0);
    return sprite;
  }

  const image = scene.add.image(x, y, layer.key);
  image.setDepth(depth);
  image.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  syncCustomBackgroundObject(image, layer, x, y, width, height, 0);
  return image;
}

export function syncCustomBackgroundObject(
  object: CustomBackgroundObject,
  layer: CustomBackgroundLayer,
  x: number,
  y: number,
  width: number,
  height: number,
  cameraScrollX: number,
): void {
  if (isTileSprite(object)) {
    object.setPosition(x, y);
    object.setSize(width, height);
    const scale = getCustomBackgroundTileScale(layer);
    object.setTileScale(scale, scale);
    object.tilePositionX = (cameraScrollX * layer.scrollFactor) / scale;
    object.tilePositionY = 0;
    return;
  }

  if (layer.fit === 'stretch') {
    object.setOrigin(0, 0);
    object.setPosition(x, y);
    object.setCrop();
    object.setDisplaySize(width, height);
    return;
  }

  const rect = getCustomBackgroundCenterRect(layer, { width, height });
  object.setOrigin(0.5, 0.5);
  object.setPosition(x + rect.x + rect.width / 2, y + rect.y + rect.height / 2);
  object.setCrop();
  object.setDisplaySize(rect.width, rect.height);
}

export function ensureCustomBackgroundTexture(
  scene: Phaser.Scene,
  id: string,
): Promise<string> {
  const key = getCustomBackgroundTextureKey(id);
  if (scene.textures.exists(key)) {
    return Promise.resolve(key);
  }

  const existing = customBackgroundLoadPromises.get(key);
  if (existing) {
    return existing;
  }

  const promise = new Promise<string>((resolve, reject) => {
    const completeEvent = `filecomplete-image-${key}`;
    const cleanup = () => {
      scene.load.off(completeEvent, handleComplete);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, handleError);
      customBackgroundLoadPromises.delete(key);
    };
    const handleComplete = () => {
      cleanup();
      resolve(key);
    };
    const handleError = (file: { key?: string }) => {
      if (file.key !== key) {
        return;
      }
      cleanup();
      reject(new Error('Custom background image failed to load.'));
    };

    scene.load.once(completeEvent, handleComplete);
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, handleError);
    scene.load.image(key, getBackgroundImageUrl(id));
    if (!scene.load.isLoading()) {
      scene.load.start();
    }
  });

  customBackgroundLoadPromises.set(key, promise);
  return promise;
}

function isTileSprite(object: CustomBackgroundObject): object is Phaser.GameObjects.TileSprite {
  return 'setTileScale' in object;
}
