import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldTileManifestEntry } from './types';

vi.mock('phaser', () => ({
  default: {
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}));

import { WorldTilePhaserLayer } from './phaserLayer';

describe('world tile Phaser layer transitions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not let a stale fade callback destroy an image reselected during reversal', () => {
    const scene = createScene();
    const layer = new WorldTilePhaserLayer(scene.value, 32_000_000);
    const first = entry(0);
    const second = entry(1);
    layer.installDecoded(first, source());
    layer.installDecoded(second, source());

    layer.syncDisplay(new Map([
      [key(first), first],
      [key(second), second],
    ]), [key(first)], { blend: true, staleRoomIds: [] });
    const firstImage = scene.images[0];
    layer.syncDisplay(new Map([
      [key(first), first],
      [key(second), second],
    ]), [key(second)], { blend: true, staleRoomIds: [] });
    const staleFadeOut = scene.tweens.find((tween) => tween.onComplete);
    expect(staleFadeOut).toBeDefined();

    firstImage.alpha = 0.25;
    layer.syncDisplay(new Map([
      [key(first), first],
      [key(second), second],
    ]), [key(first)], { blend: true, staleRoomIds: [] });
    staleFadeOut?.onComplete?.();

    expect(layer.getAttachedAddressKeys()).toEqual([key(first)]);
    expect(firstImage.alpha).toBe(1);
    expect(firstImage.destroyed).toBe(false);
    expect(scene.killTweensOf).toHaveBeenCalledWith(firstImage);
  });
});

function createScene() {
  const textureRecords = new Map<string, {
    frames: Set<string>;
    has: (frame: string) => boolean;
    add: (frame: string) => void;
    setFilter: () => void;
  }>();
  const images: FakeImage[] = [];
  const tweens: Array<{ onComplete?: () => void }> = [];
  const killTweensOf = vi.fn();
  const value = {
    textures: {
      exists: (textureKey: string) => textureRecords.has(textureKey),
      addImage: (textureKey: string) => {
        const frames = new Set<string>();
        const texture = {
          frames,
          has: (frame: string) => frames.has(frame),
          add: (frame: string) => { frames.add(frame); },
          setFilter: () => {},
        };
        textureRecords.set(textureKey, texture);
        return texture;
      },
      get: (textureKey: string) => textureRecords.get(textureKey)!,
      remove: (textureKey: string) => { textureRecords.delete(textureKey); },
    },
    add: {
      image: (_x: number, _y: number, textureKey: string) => {
        const image = new FakeImage(textureKey);
        images.push(image);
        return image;
      },
      rectangle: () => new FakeImage('mask'),
    },
    tweens: {
      add: (config: { onComplete?: () => void }) => {
        tweens.push(config);
        return config;
      },
      killTweensOf,
    },
  };
  return { value: value as never, images, tweens, killTweensOf };
}

class FakeImage {
  alpha = 1;
  destroyed = false;
  texture: { key: string };

  constructor(textureKey: string) {
    this.texture = { key: textureKey };
  }

  setOrigin() { return this; }
  setDepth() { return this; }
  setDisplaySize() { return this; }
  setTexture(textureKey: string) { this.texture.key = textureKey; return this; }
  setAlpha(alpha: number) { this.alpha = alpha; return this; }
  destroy() { this.destroyed = true; }
}

function entry(x: number): WorldTileManifestEntry {
  return {
    address: { rendererVersion: 'renderer-v1', level: 4, x, y: 0 },
    desiredGeneration: 1,
    desiredEmpty: false,
    readyEmptyGeneration: null,
    ready: {
      generation: 1,
      contentHash: String(x + 1).repeat(64),
      url: `https://tiles.example.test/${x}.png`,
      width: 642,
      height: 354,
      overlap: 1,
      byteLength: 1,
    },
    staleRoomIds: [],
  };
}

function source() {
  return { width: 642, height: 354 } as HTMLImageElement;
}

function key(value: WorldTileManifestEntry): string {
  const address = value.address;
  return `${address.rendererVersion}:${address.level}:${address.x}:${address.y}`;
}
