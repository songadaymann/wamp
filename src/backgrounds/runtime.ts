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
export type BuiltInBackgroundObject = Phaser.GameObjects.TileSprite | Phaser.GameObjects.Image;

export interface CustomBackgroundTexturePreparationSnapshot {
  key: string;
  prepared: boolean;
  committed: boolean;
  cancelled: boolean;
  width: number;
  height: number;
}

type CustomBackgroundDecodedImage = ImageBitmap | HTMLImageElement;
type CustomBackgroundImageDecoder = (blob: Blob) => Promise<CustomBackgroundDecodedImage>;

interface BuiltInBackgroundLayer {
  key: string;
  width: number;
  height: number;
  repeat?: boolean;
}

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
  const scale = Math.min(1, target.width / sourceWidth, target.height / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.floor((target.width - width) / 2),
    y: Math.floor((target.height - height) / 2),
    width,
    height,
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

export function createBuiltInBackgroundObject(
  scene: Phaser.Scene,
  layer: BuiltInBackgroundLayer,
  x: number,
  y: number,
  width: number,
  height: number,
  depth: number,
): BuiltInBackgroundObject {
  const object = layer.repeat === false
    ? scene.add.image(x, y, layer.key)
    : scene.add.tileSprite(x, y, width, height, layer.key);

  object.setOrigin(0, 0);
  object.setDepth(depth);
  object.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  syncBuiltInBackgroundObject(object, layer, x, y, width, height, 0, 0);
  return object;
}

export function syncBuiltInBackgroundObject(
  object: BuiltInBackgroundObject,
  layer: Pick<BuiltInBackgroundLayer, 'height' | 'repeat'>,
  x: number,
  y: number,
  width: number,
  height: number,
  tilePositionX: number,
  tilePositionY: number,
): void {
  object.setPosition(x, y);

  if (!isTileSprite(object)) {
    object.setCrop();
    object.setDisplaySize(width, height);
    return;
  }

  object.setSize(width, height);
  const scale = getBuiltInBackgroundTileScale(layer, height);
  object.setTileScale(scale, scale);
  object.tilePositionX = tilePositionX;
  object.tilePositionY = tilePositionY;
}

export function getBuiltInBackgroundTileScale(
  layer: Pick<BuiltInBackgroundLayer, 'height'>,
  targetHeight: number,
): number {
  return targetHeight / Math.max(1, layer.height);
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

/**
 * Fetches and decodes a custom background without publishing it to Phaser.
 * The caller chooses when to perform the final canvas draw / texture upload,
 * which lets gameplay route that atomic work through its frame coordinator.
 */
export class CustomBackgroundTexturePreparation {
  readonly key: string;
  private readonly abortController = new AbortController();
  private bitmap: CustomBackgroundDecodedImage | null = null;
  private preparePromise: Promise<void> | null = null;
  private committed = false;
  private cancelled = false;

  constructor(
    private readonly id: string,
    private readonly fetchImage: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly decodeImage: CustomBackgroundImageDecoder = decodeCustomBackgroundBlob,
    private readonly createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
  ) {
    this.key = getCustomBackgroundTextureKey(id);
  }

  prepare(): Promise<void> {
    if (this.cancelled) {
      return Promise.reject(new DOMException('Custom background preparation was cancelled.', 'AbortError'));
    }
    if (this.bitmap || this.committed) return Promise.resolve();
    if (this.preparePromise) return this.preparePromise;
    this.preparePromise = this.fetchAndDecode();
    return this.preparePromise;
  }

  commit(scene: Phaser.Scene): string {
    if (this.cancelled) {
      throw new Error('Cancelled custom background preparation cannot be committed.');
    }
    if (scene.textures.exists(this.key)) {
      this.releaseBitmap();
      this.committed = true;
      return this.key;
    }
    const bitmap = this.bitmap;
    if (!bitmap) {
      throw new Error('Custom background texture cannot be committed before decode completes.');
    }
    const canvas = this.createCanvas();
    canvas.width = Math.max(1, getDecodedImageWidth(bitmap));
    canvas.height = Math.max(1, getDecodedImageHeight(bitmap));
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not create a custom background staging canvas.');
    }
    context.imageSmoothingEnabled = true;
    context.drawImage(bitmap, 0, 0);
    const texture = scene.textures.addCanvas(this.key, canvas);
    if (!texture || !scene.textures.exists(this.key)) {
      throw new Error(`Custom background texture ${this.key} was not registered.`);
    }
    this.releaseBitmap();
    this.committed = true;
    return this.key;
  }

  cancel(): void {
    if (this.committed || this.cancelled) return;
    this.cancelled = true;
    this.abortController.abort();
    this.releaseBitmap();
  }

  isPrepared(): boolean {
    return Boolean(this.bitmap) || this.committed;
  }

  getSnapshot(): CustomBackgroundTexturePreparationSnapshot {
    return {
      key: this.key,
      prepared: this.isPrepared(),
      committed: this.committed,
      cancelled: this.cancelled,
      width: this.bitmap ? getDecodedImageWidth(this.bitmap) : 0,
      height: this.bitmap ? getDecodedImageHeight(this.bitmap) : 0,
    };
  }

  private async fetchAndDecode(): Promise<void> {
    const response = await this.fetchImage(getBackgroundImageUrl(this.id), {
      credentials: 'include',
      signal: this.abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`Custom background image failed to load (${response.status}).`);
    }
    const blob = await response.blob();
    if (this.cancelled) return;
    const bitmap = await this.decodeImage(blob);
    if (this.cancelled) {
      releaseDecodedImage(bitmap);
      return;
    }
    this.bitmap = bitmap;
  }

  private releaseBitmap(): void {
    if (this.bitmap) releaseDecodedImage(this.bitmap);
    this.bitmap = null;
  }
}

async function decodeCustomBackgroundBlob(blob: Blob): Promise<CustomBackgroundDecodedImage> {
  if (typeof globalThis.createImageBitmap === 'function') {
    return globalThis.createImageBitmap(blob);
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = objectUrl;
    await image.decode();
    return image;
  } catch (error) {
    image.src = '';
    throw error;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getDecodedImageWidth(image: CustomBackgroundDecodedImage): number {
  return 'naturalWidth' in image ? image.naturalWidth : image.width;
}

function getDecodedImageHeight(image: CustomBackgroundDecodedImage): number {
  return 'naturalHeight' in image ? image.naturalHeight : image.height;
}

function releaseDecodedImage(image: CustomBackgroundDecodedImage): void {
  const closable = image as { close?: () => void };
  if (typeof closable.close === 'function') {
    closable.close();
    return;
  }
  (image as HTMLImageElement).src = '';
}

function isTileSprite(object: CustomBackgroundObject): object is Phaser.GameObjects.TileSprite {
  return 'setTileScale' in object;
}
