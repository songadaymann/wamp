import { ensureBackgroundGroupLoaded } from '../assets/sceneArt';
import Phaser from 'phaser';
import { BACKGROUND_GROUPS } from '../config/backgrounds';
import { getBackgroundImageUrl } from './client';
import type { CustomBackgroundFit } from './model';
import { animateBackgroundTexture, decodeBackground, isBackgroundAnimation, observeAnimatedBackground, releaseBackgroundImage, type BackgroundDecodedImage } from './animation';
import { addStaticCanvasTexture } from '../visuals/staticCanvasTexture';

// Cloudflare Images converts backgrounds to WebP or AVIF when the request accepts them. fetch()
// and Phaser's loader otherwise send */* and get the original upload (one GIF background is
// 8.3 MB; its WebP is 2.8 MB). <img> elements already ask for these formats.
const BACKGROUND_IMAGE_ACCEPT = 'image/avif,image/webp,*/*';

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

type CustomBackgroundDecodedImage = BackgroundDecodedImage;
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
    observeAnimatedBackground(sprite, scene.textures.get(layer.key));
    return sprite;
  }

  const image = scene.add.image(x, y, layer.key);
  image.setDepth(depth);
  image.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  syncCustomBackgroundObject(image, layer, x, y, width, height, 0);
  observeAnimatedBackground(image, scene.textures.get(layer.key));
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
  const ready = scene.textures.exists(layer.key);
  const key = ready ? layer.key : '__DEFAULT';
  const object = layer.repeat === false
    ? scene.add.image(x, y, key)
    : scene.add.tileSprite(x, y, width, height, key);

  object.setOrigin(0, 0);
  object.setDepth(depth);
  object.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  syncBuiltInBackgroundObject(object, layer, x, y, width, height, 0, 0);
  if (!ready) {
    object.setAlpha(0);
    const group = BACKGROUND_GROUPS.find(group => group.layers.some(entry => entry.key === layer.key));
    void ensureBackgroundGroupLoaded(scene, group?.id ?? 'none').then(() => {
      if (!object.scene) return;
      object.setTexture(layer.key);
      object.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      object.setAlpha(1);
    }).catch(error => console.warn('Failed to load background art.', layer.key, error));
  }
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

  const preparation = new CustomBackgroundTexturePreparation(id);
  const promise = preparation.prepare().then(() => {
    if (!scene.sys.isActive()) {
      preparation.cancel();
      throw new Error('Custom background scene was closed.');
    }
    return preparation.commit(scene);
  }).finally(() => customBackgroundLoadPromises.delete(key));

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
    private readonly decodeImage: CustomBackgroundImageDecoder = decodeBackground,
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
    if (isBackgroundAnimation(bitmap)) {
      context.drawImage(bitmap.frames[0], 0, 0);
      // Animation frames are drawn into this canvas later, so it stays a CanvasTexture.
      const texture = this.requireRegistered(scene, scene.textures.addCanvas(this.key, canvas));
      animateBackgroundTexture(scene, texture, bitmap);
      this.bitmap = null; // The texture owns frames until removal or game teardown.
    } else {
      context.drawImage(bitmap, 0, 0);
      // A still is never redrawn, so it skips CanvasTexture's pixel read-back copy (F304).
      this.requireRegistered(scene, addStaticCanvasTexture(scene.textures, this.key, canvas));
      this.releaseBitmap();
    }
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
      headers: { Accept: BACKGROUND_IMAGE_ACCEPT },
      signal: this.abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`Custom background image failed to load (${response.status}).`);
    }
    const blob = await response.blob();
    if (this.cancelled) return;
    const bitmap = await this.decodeImage(blob);
    if (this.cancelled) {
      releaseBackgroundImage(bitmap);
      return;
    }
    this.bitmap = bitmap;
  }

  private requireRegistered<T extends Phaser.Textures.Texture>(scene: Phaser.Scene, texture: T | null): T {
    if (!texture || !scene.textures.exists(this.key)) {
      throw new Error(`Custom background texture ${this.key} was not registered.`);
    }
    return texture;
  }

  private releaseBitmap(): void {
    if (this.bitmap) releaseBackgroundImage(this.bitmap);
    this.bitmap = null;
  }
}

function getDecodedImageWidth(image: CustomBackgroundDecodedImage): number {
  return 'naturalWidth' in image ? image.naturalWidth : image.width;
}

function getDecodedImageHeight(image: CustomBackgroundDecodedImage): number {
  return 'naturalHeight' in image ? image.naturalHeight : image.height;
}

function isTileSprite(object: CustomBackgroundObject): object is Phaser.GameObjects.TileSprite {
  return 'setTileScale' in object;
}
