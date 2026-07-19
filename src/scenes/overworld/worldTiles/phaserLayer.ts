import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../../config';
import { parseRoomId } from '../../../persistence/roomModel';
import { WeightedPinnedLruCache } from './lru';
import {
  getWorldTileCorePlacement,
  WORLD_TILE_CONTENT_HEIGHT,
  WORLD_TILE_CONTENT_WIDTH,
  WORLD_TILE_OVERLAP,
} from './geometry';
import { worldTileAddressKey, type WorldTileManifestEntry } from './types';

export type DecodedWorldTileSource = ImageBitmap | HTMLImageElement;

interface InstalledWorldTileTexture {
  addressKey: string;
  contentHash: string;
  textureKey: string;
  source: DecodedWorldTileSource;
}

export interface WorldTileLayerSyncOptions {
  blend: boolean;
  staleRoomIds: Iterable<string>;
}

const WORLD_TILE_IMAGE_DEPTH = -0.5;
const WORLD_TILE_STALE_MASK_DEPTH = -0.25;
const WORLD_TILE_BLEND_MS = 75;
const WORLD_TILE_STALE_MASK_COLOR = 0x080d18;
const WORLD_TILE_CONTENT_FRAME = 'content';

export class WorldTilePhaserLayer {
  private readonly textureCache: WeightedPinnedLruCache<string, InstalledWorldTileTexture>;
  private readonly textureByAddressKey = new Map<string, InstalledWorldTileTexture>();
  private readonly imagesByAddressKey = new Map<string, Phaser.GameObjects.Image>();
  private readonly staleMasksByRoomId = new Map<string, Phaser.GameObjects.Rectangle>();
  private readonly transitionTokenByImage = new WeakMap<Phaser.GameObjects.Image, number>();
  private pinnedTextureKeys = new Set<string>();
  private currentDesiredKeys = new Set<string>();
  private displaySignature = '';
  private nextTransitionToken = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    textureByteBudget: number,
    private readonly onObjectsChanged?: () => void,
  ) {
    this.textureCache = new WeightedPinnedLruCache(textureByteBudget);
  }

  installDecoded(entry: WorldTileManifestEntry, source: DecodedWorldTileSource): boolean {
    if (!entry.ready) return false;
    const addressKey = worldTileAddressKey(entry.address);
    const existing = this.textureByAddressKey.get(addressKey);
    if (existing?.contentHash === entry.ready.contentHash && this.scene.textures.exists(existing.textureKey)) {
      closeDecodedSource(source);
      this.textureCache.get(existing.textureKey);
      return true;
    }

    const textureKey = buildTextureKey(entry);
    if (!this.scene.textures.exists(textureKey)) {
      const addedTexture = this.scene.textures.addImage(textureKey, source as HTMLImageElement);
      if (!addedTexture) {
        closeDecodedSource(source);
        return false;
      }
    }
    const texture = this.scene.textures.get(textureKey);
    if (!texture.has(WORLD_TILE_CONTENT_FRAME)) {
      texture.add(
        WORLD_TILE_CONTENT_FRAME,
        0,
        WORLD_TILE_OVERLAP,
        WORLD_TILE_OVERLAP,
        WORLD_TILE_CONTENT_WIDTH,
        WORLD_TILE_CONTENT_HEIGHT,
      );
    }
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const installed: InstalledWorldTileTexture = {
      addressKey,
      contentHash: entry.ready.contentHash,
      textureKey,
      source,
    };
    this.textureByAddressKey.set(addressKey, installed);
    const result = this.textureCache.set(
      textureKey,
      installed,
      entry.ready.width * entry.ready.height * 4,
      { pinned: this.pinnedTextureKeys.has(textureKey) },
    );
    for (const eviction of result.evicted) this.destroyInstalledTexture(eviction.value);
    return this.scene.textures.exists(textureKey);
  }

  hasGpuTexture(addressKey: string, contentHash?: string): boolean {
    const installed = this.textureByAddressKey.get(addressKey);
    return Boolean(
      installed
      && (contentHash === undefined || installed.contentHash === contentHash)
      && this.scene.textures.exists(installed.textureKey)
    );
  }

  syncDisplay(
    entriesByKey: ReadonlyMap<string, WorldTileManifestEntry>,
    desiredAddressKeys: readonly string[],
    options: WorldTileLayerSyncOptions,
  ): void {
    const displayableKeys = desiredAddressKeys.filter((key) => {
      const installed = this.textureByAddressKey.get(key);
      return Boolean(installed && this.scene.textures.exists(installed.textureKey));
    });
    const signature = displayableKeys.map((key) => (
      `${key}@${this.textureByAddressKey.get(key)?.textureKey ?? 'missing'}`
    )).join('|');
    this.currentDesiredKeys = new Set(displayableKeys);
    this.syncPinnedTextures(displayableKeys);
    const masksChanged = this.syncStaleMasks(options.staleRoomIds);
    if (masksChanged) this.onObjectsChanged?.();
    if (signature === this.displaySignature) return;
    this.displaySignature = signature;

    const desired = new Set(displayableKeys);
    const entering: Phaser.GameObjects.Image[] = [];
    for (const addressKey of displayableKeys) {
      const installed = this.textureByAddressKey.get(addressKey);
      const entry = entriesByKey.get(addressKey);
      if (!installed || !entry) continue;
      let image = this.imagesByAddressKey.get(addressKey);
      if (!image) {
        image = this.createImage(entry, installed.textureKey);
        this.imagesByAddressKey.set(addressKey, image);
        entering.push(image);
      } else {
        this.cancelImageTransition(image);
        image.setAlpha(1);
        if (image.texture.key !== installed.textureKey) {
          image.setTexture(installed.textureKey, WORLD_TILE_CONTENT_FRAME);
        }
      }
    }

    const leaving = [...this.imagesByAddressKey.entries()]
      .filter(([key]) => !desired.has(key));
    if (options.blend && entering.length > 0 && leaving.length > 0) {
      for (const image of entering) {
        this.beginImageTransition(image);
        image.setAlpha(0);
      }
      this.scene.tweens.add({
        targets: entering,
        alpha: 1,
        duration: WORLD_TILE_BLEND_MS,
        ease: 'Linear',
      });
      const leavingTransitions = leaving.map(([key, image]) => ({
        key,
        image,
        token: this.beginImageTransition(image),
      }));
      this.scene.tweens.add({
        targets: leavingTransitions.map(({ image }) => image),
        alpha: 0,
        duration: WORLD_TILE_BLEND_MS,
        ease: 'Linear',
        onComplete: () => {
          for (const { key, image, token } of leavingTransitions) {
            if (!shouldFinalizeWorldTileImageRemoval({
              desired: this.currentDesiredKeys.has(key),
              mappedImageIsSame: this.imagesByAddressKey.get(key) === image,
              transitionTokenIsCurrent: this.transitionTokenByImage.get(image) === token,
            })) continue;
            image.destroy();
            this.imagesByAddressKey.delete(key);
          }
          this.onObjectsChanged?.();
        },
      });
    } else {
      for (const [key, image] of leaving) {
        this.cancelImageTransition(image);
        image.destroy();
        this.imagesByAddressKey.delete(key);
      }
    }
    this.onObjectsChanged?.();
  }

  getImages(): Phaser.GameObjects.Image[] {
    return [...this.imagesByAddressKey.values()];
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.imagesByAddressKey.values(), ...this.staleMasksByRoomId.values()];
  }

  getAttachedAddressKeys(): string[] {
    return [...this.imagesByAddressKey.keys()].sort();
  }

  clearDisplay(): void {
    this.displaySignature = '';
    this.currentDesiredKeys.clear();
    for (const image of this.imagesByAddressKey.values()) {
      this.cancelImageTransition(image);
      image.destroy();
    }
    for (const mask of this.staleMasksByRoomId.values()) mask.destroy();
    this.imagesByAddressKey.clear();
    this.staleMasksByRoomId.clear();
    for (const textureKey of this.pinnedTextureKeys) {
      for (const eviction of this.textureCache.unpin(textureKey)) this.destroyInstalledTexture(eviction.value);
    }
    this.pinnedTextureKeys.clear();
    this.onObjectsChanged?.();
  }

  discardGpuTexturesForContextRestore(): void {
    this.clearDisplay();
    for (const eviction of this.textureCache.clear()) this.destroyInstalledTexture(eviction.value);
    this.textureByAddressKey.clear();
  }

  destroy(): void {
    this.discardGpuTexturesForContextRestore();
  }

  private createImage(entry: WorldTileManifestEntry, textureKey: string): Phaser.GameObjects.Image {
    const placement = getWorldTileCorePlacement(entry.address);
    const image = this.scene.add.image(
      placement.x,
      placement.y,
      textureKey,
      WORLD_TILE_CONTENT_FRAME,
    );
    image.setOrigin(0, 0);
    image.setDepth(WORLD_TILE_IMAGE_DEPTH);
    image.setDisplaySize(placement.width, placement.height);
    return image;
  }

  private beginImageTransition(image: Phaser.GameObjects.Image): number {
    this.scene.tweens.killTweensOf(image);
    const token = ++this.nextTransitionToken;
    this.transitionTokenByImage.set(image, token);
    return token;
  }

  private cancelImageTransition(image: Phaser.GameObjects.Image): void {
    this.beginImageTransition(image);
  }

  private syncPinnedTextures(displayableKeys: readonly string[]): void {
    const nextPinned = new Set(
      displayableKeys.flatMap((key) => {
        const textureKey = this.textureByAddressKey.get(key)?.textureKey;
        return textureKey ? [textureKey] : [];
      }),
    );
    for (const textureKey of this.pinnedTextureKeys) {
      if (!nextPinned.has(textureKey)) {
        for (const eviction of this.textureCache.unpin(textureKey)) this.destroyInstalledTexture(eviction.value);
      }
    }
    for (const textureKey of nextPinned) this.textureCache.pin(textureKey);
    this.pinnedTextureKeys = nextPinned;
  }

  private syncStaleMasks(staleRoomIds: Iterable<string>): boolean {
    const next = new Set(staleRoomIds);
    let changed = false;
    for (const [roomId, mask] of this.staleMasksByRoomId) {
      if (next.has(roomId)) continue;
      mask.destroy();
      this.staleMasksByRoomId.delete(roomId);
      changed = true;
    }
    for (const roomId of next) {
      if (this.staleMasksByRoomId.has(roomId)) continue;
      const coordinates = parseRoomId(roomId);
      if (!coordinates) continue;
      const mask = this.scene.add.rectangle(
        coordinates.x * ROOM_PX_WIDTH,
        coordinates.y * ROOM_PX_HEIGHT,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        WORLD_TILE_STALE_MASK_COLOR,
        1,
      );
      mask.setOrigin(0, 0);
      mask.setDepth(WORLD_TILE_STALE_MASK_DEPTH);
      this.staleMasksByRoomId.set(roomId, mask);
      changed = true;
    }
    return changed;
  }

  private destroyInstalledTexture(installed: InstalledWorldTileTexture): void {
    if (this.textureCache.isPinned(installed.textureKey)) return;
    if (this.textureByAddressKey.get(installed.addressKey) === installed) {
      this.textureByAddressKey.delete(installed.addressKey);
    }
    if (this.scene.textures.exists(installed.textureKey)) this.scene.textures.remove(installed.textureKey);
    closeDecodedSource(installed.source);
  }
}

export function shouldFinalizeWorldTileImageRemoval(input: {
  desired: boolean;
  mappedImageIsSame: boolean;
  transitionTokenIsCurrent: boolean;
}): boolean {
  return !input.desired && input.mappedImageIsSame && input.transitionTokenIsCurrent;
}

export async function decodeWorldTileBlob(blob: Blob): Promise<DecodedWorldTileSource> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob, {
      imageOrientation: 'none',
      premultiplyAlpha: 'default',
      colorSpaceConversion: 'default',
    });
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function buildTextureKey(entry: WorldTileManifestEntry): string {
  const ready = entry.ready;
  if (!ready) throw new Error('Cannot build a texture key for an empty tile.');
  return `world-tile-${entry.address.rendererVersion}-${entry.address.level}-${entry.address.x}-${entry.address.y}-${ready.contentHash}`
    .replace(/[^a-zA-Z0-9_-]/g, '_');
}

function closeDecodedSource(source: DecodedWorldTileSource): void {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
}
