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

  it('repairs a desired image left transparent after an interrupted blend', () => {
    const scene = createScene();
    const layer = new WorldTilePhaserLayer(scene.value, 32_000_000);
    const first = entry(0);
    layer.installDecoded(first, source());
    layer.syncDisplay(new Map([[key(first), first]]), [key(first)], {
      blend: true,
      staleRoomIds: [],
    });

    const image = scene.images[0];
    image.alpha = 0;
    layer.syncDisplay(new Map([[key(first), first]]), [key(first)], {
      blend: true,
      staleRoomIds: [],
    });

    expect(image.alpha).toBe(1);
    expect(layer.getHealthSnapshot()).toMatchObject({
      desiredImageCount: 1,
      healthyDesiredImageCount: 1,
      unhealthyDesiredImageCount: 0,
      repairCount: 1,
      lastRepairReasons: ['restored-alpha'],
    });
  });

  it('recreates a desired image destroyed without changing the coverage signature', () => {
    const scene = createScene();
    const layer = new WorldTilePhaserLayer(scene.value, 32_000_000);
    const first = entry(0);
    layer.installDecoded(first, source());
    layer.syncDisplay(new Map([[key(first), first]]), [key(first)], {
      blend: false,
      staleRoomIds: [],
    });

    const destroyedImage = scene.images[0];
    destroyedImage.destroy();
    expect(layer.getHealthSnapshot()).toMatchObject({
      destroyedDesiredImageCount: 1,
      unhealthyDesiredImageCount: 1,
    });

    layer.syncDisplay(new Map([[key(first), first]]), [key(first)], {
      blend: false,
      staleRoomIds: [],
    });
    const replacement = scene.images[1];
    expect(replacement).toBeDefined();
    expect(replacement.destroyed).toBe(false);
    expect(layer.getHealthSnapshot()).toMatchObject({
      healthyDesiredImageCount: 1,
      unhealthyDesiredImageCount: 0,
      repairCount: 1,
      lastRepairReasons: ['recreated-destroyed-image'],
    });
  });

  it('does not interrupt a healthy blend that is still tweening', () => {
    const scene = createScene();
    const layer = new WorldTilePhaserLayer(scene.value, 32_000_000);
    const first = entry(0);
    const second = entry(1);
    layer.installDecoded(first, source());
    layer.installDecoded(second, source());
    const entries = new Map([
      [key(first), first],
      [key(second), second],
    ]);
    layer.syncDisplay(entries, [key(first)], { blend: true, staleRoomIds: [] });
    layer.syncDisplay(entries, [key(second)], { blend: true, staleRoomIds: [] });
    const enteringImage = scene.images[1];
    expect(enteringImage.alpha).toBe(0);

    layer.syncDisplay(entries, [key(second)], { blend: true, staleRoomIds: [] });

    expect(enteringImage.alpha).toBe(0);
    expect(layer.getHealthSnapshot().repairCount).toBe(0);
  });

  it('keeps an outgoing image texture alive until its fade completes', () => {
    const tileBytes = 642 * 354 * 4;
    const scene = createScene();
    const layer = new WorldTilePhaserLayer(scene.value, tileBytes * 2);
    const first = entry(0);
    const second = entry(1);
    const third = entry(2);
    const entries = new Map([
      [key(first), first],
      [key(second), second],
      [key(third), third],
    ]);
    layer.installDecoded(first, source());
    layer.installDecoded(second, source());
    layer.syncDisplay(entries, [key(first)], { blend: true, staleRoomIds: [] });
    const firstImage = scene.images[0];
    const firstTextureKey = firstImage.texture.key;

    layer.syncDisplay(entries, [key(second)], { blend: true, staleRoomIds: [] });
    const fadeOut = scene.tweens.find((tween) => tween.onComplete);
    expect(fadeOut).toBeDefined();

    expect(layer.installDecoded(third, source())).toBe(false);
    expect(scene.removedTextureKeys).not.toContain(firstTextureKey);
    expect(firstImage.destroyed).toBe(false);

    fadeOut?.onComplete?.();
    expect(firstImage.destroyed).toBe(true);
    expect(layer.installDecoded(third, source())).toBe(true);
    expect(scene.removedTextureKeys).toContain(firstTextureKey);
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
  const removedTextureKeys: string[] = [];
  const tweens: Array<{ onComplete?: () => void; targets?: FakeImage[] }> = [];
  const activeTweenTargets = new Set<FakeImage>();
  const killTweensOf = vi.fn((target: FakeImage) => {
    activeTweenTargets.delete(target);
  });
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
      remove: (textureKey: string) => {
        removedTextureKeys.push(textureKey);
        textureRecords.delete(textureKey);
      },
    },
    add: {
      image: (_x: number, _y: number, textureKey: string) => {
        const image = new FakeImage(value as never, textureKey);
        images.push(image);
        return image;
      },
      rectangle: () => new FakeImage(value as never, 'mask'),
    },
    tweens: {
      add: (config: { onComplete?: () => void; targets?: FakeImage[] }) => {
        tweens.push(config);
        for (const target of config.targets ?? []) activeTweenTargets.add(target);
        return config;
      },
      killTweensOf,
      isTweening: (target: FakeImage) => activeTweenTargets.has(target),
    },
  };
  return { value: value as never, images, tweens, killTweensOf, removedTextureKeys };
}

class FakeImage {
  alpha = 1;
  active = true;
  visible = true;
  cameraFilter = 0;
  displayList: object | null = {};
  parentContainer: object | null = null;
  scene: object | undefined;
  destroyed = false;
  texture: { key: string };

  constructor(scene: object, textureKey: string) {
    this.scene = scene;
    this.texture = { key: textureKey };
  }

  setOrigin() { return this; }
  setDepth() { return this; }
  setDisplaySize() { return this; }
  setTexture(textureKey: string) { this.texture.key = textureKey; return this; }
  setAlpha(alpha: number) { this.alpha = alpha; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setActive(active: boolean) { this.active = active; return this; }
  destroy() {
    this.destroyed = true;
    this.active = false;
    this.visible = false;
    this.displayList = null;
    this.scene = undefined;
  }
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
