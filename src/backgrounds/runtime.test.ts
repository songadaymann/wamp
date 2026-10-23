import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Loader: { Events: { FILE_LOAD_ERROR: 'loaderror' } },
    Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } },
  },
}));

import { animateBackgroundTexture, type BackgroundAnimation } from './animation';
import {
  CustomBackgroundTexturePreparation,
  createCustomBackgroundObject,
  getCustomBackgroundTextureKey,
  getCustomBackgroundTileTextureKey,
  getCustomBackgroundTileTextureSize,
  syncCustomBackgroundObject,
  type CustomBackgroundLayer,
} from './runtime';

function createBitmap(width = 320, height = 176): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function createCanvasHarness() {
  const context = {
    imageSmoothingEnabled: false,
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

describe('CustomBackgroundTexturePreparation', () => {
  it('binds the default fetch receiver, decodes, and defers upload until commit', async () => {
    const receivers: unknown[] = [];
    const bitmap = createBitmap();
    const blob = new Blob(['cold-background']);
    const decodeImage = vi.fn(async () => bitmap);
    const { canvas, context } = createCanvasHarness();
    let registered = false;
    const scene = {
      textures: {
        exists: vi.fn(() => registered),
        addImage: vi.fn(() => {
          registered = true;
          return {};
        }),
      },
    } as unknown as Phaser.Scene;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(function (
      this: unknown,
      _url: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      receivers.push(this);
      if (this !== globalThis) {
        return Promise.reject(new TypeError('Illegal invocation'));
      }
      expect(init).toMatchObject({ credentials: 'include' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: async () => blob,
      } as Response);
    });

    try {
      const preparation = new CustomBackgroundTexturePreparation(
        'receiver-safe',
        undefined,
        decodeImage as typeof createImageBitmap,
        () => canvas,
      );

      await preparation.prepare();

      expect(receivers).toEqual([globalThis]);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/background-images/receiver-safe/image'),
        expect.objectContaining({
          credentials: 'include',
          signal: expect.any(AbortSignal),
        }),
      );
      expect(decodeImage).toHaveBeenCalledWith(blob);
      expect(scene.textures.addImage).not.toHaveBeenCalled();
      expect(preparation.getSnapshot()).toMatchObject({
        prepared: true,
        committed: false,
        cancelled: false,
      });

      expect(preparation.commit(scene)).toBe(getCustomBackgroundTextureKey('receiver-safe'));
      expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(scene.textures.addImage).toHaveBeenCalledOnce();
      expect(bitmap.close).toHaveBeenCalledOnce();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('binds the default fetch receiver and still aborts an in-flight request', async () => {
    const receivers: unknown[] = [];
    let capturedSignal: AbortSignal | null = null;
    const decodeImage = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(function (
      this: unknown,
      _url: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      receivers.push(this);
      if (this !== globalThis) {
        return Promise.reject(new TypeError('Illegal invocation'));
      }
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        return Promise.reject(new Error('Missing custom-background abort signal.'));
      }
      capturedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('cancelled', 'AbortError'));
        }, { once: true });
      });
    });

    try {
      const preparation = new CustomBackgroundTexturePreparation(
        'receiver-safe-cancel',
        undefined,
        decodeImage as typeof createImageBitmap,
      );
      const preparing = preparation.prepare();

      preparation.cancel();

      await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
      expect(receivers).toEqual([globalThis]);
      expect(capturedSignal).toMatchObject({ aborted: true });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/background-images/receiver-safe-cancel/image'),
        expect.objectContaining({
          credentials: 'include',
          signal: capturedSignal,
        }),
      );
      expect(decodeImage).not.toHaveBeenCalled();
      expect(preparation.getSnapshot()).toMatchObject({
        prepared: false,
        committed: false,
        cancelled: true,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('decodes off-cache and defers the Phaser texture upload until commit', async () => {
    const bitmap = createBitmap();
    const blob = new Blob(['background']);
    const fetchImage = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => blob,
    }) as Response);
    const decodeImage = vi.fn(async () => bitmap);
    const { canvas, context } = createCanvasHarness();
    let registered = false;
    const scene = {
      textures: {
        exists: vi.fn(() => registered),
        addImage: vi.fn(() => {
          registered = true;
          return {};
        }),
      },
    } as unknown as Phaser.Scene;
    const preparation = new CustomBackgroundTexturePreparation(
      'heavy/photo',
      fetchImage as typeof fetch,
      decodeImage as typeof createImageBitmap,
      () => canvas,
    );

    await preparation.prepare();
    // Asks for WebP/AVIF so Cloudflare Images doesn't send the original upload (F094).
    expect(fetchImage).toHaveBeenCalledWith(expect.stringContaining('/api/background-images/heavy%2Fphoto/image'), expect.objectContaining({
      headers: { Accept: 'image/avif,image/webp,*/*' },
    }));

    expect(scene.textures.addImage).not.toHaveBeenCalled();
    expect(preparation.getSnapshot()).toMatchObject({
      key: getCustomBackgroundTextureKey('heavy/photo'),
      prepared: true,
      committed: false,
      cancelled: false,
      width: 320,
      height: 176,
    });

    expect(preparation.commit(scene)).toBe(getCustomBackgroundTextureKey('heavy/photo'));
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(176);
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(scene.textures.addImage).toHaveBeenCalledOnce();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(preparation.getSnapshot()).toMatchObject({ committed: true, prepared: true });
  });

  it('keeps an animated background on a redrawable canvas texture', async () => {
    const frame = { width: 240, height: 135 } as HTMLCanvasElement;
    const animation = {
      width: 240,
      height: 135,
      frames: [frame],
      durations: [100],
      loops: 0,
      close: vi.fn(),
    };
    const fetchImage = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['animated']),
    }) as Response);
    const { canvas, context } = createCanvasHarness();
    let registered = false;
    const scene = {
      textures: {
        exists: vi.fn(() => registered),
        addImage: vi.fn(),
        addCanvas: vi.fn(() => {
          registered = true;
          return { key: getCustomBackgroundTextureKey('animated') };
        }),
        once: vi.fn(),
      },
      game: { events: { on: vi.fn(), once: vi.fn() } },
    } as unknown as Phaser.Scene;
    const preparation = new CustomBackgroundTexturePreparation(
      'animated',
      fetchImage as typeof fetch,
      vi.fn(async () => animation),
      () => canvas,
    );

    await preparation.prepare();
    preparation.commit(scene);

    expect(context.drawImage).toHaveBeenCalledWith(frame, 0, 0);
    expect(scene.textures.addCanvas).toHaveBeenCalledWith(getCustomBackgroundTextureKey('animated'), canvas);
    expect(scene.textures.addImage).not.toHaveBeenCalled();
    expect(animation.close).not.toHaveBeenCalled();
  });

  it('aborts an in-flight fetch and never starts decode or upload after cancellation', async () => {
    const capturedSignals: AbortSignal[] = [];
    const fetchImage = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      capturedSignals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('cancelled', 'AbortError'));
        }, { once: true });
      });
    });
    const decodeImage = vi.fn();
    const preparation = new CustomBackgroundTexturePreparation(
      'cancel-me',
      fetchImage as typeof fetch,
      decodeImage as typeof createImageBitmap,
    );
    const preparing = preparation.prepare();

    preparation.cancel();

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    expect(capturedSignals[0]?.aborted).toBe(true);
    expect(decodeImage).not.toHaveBeenCalled();
    expect(preparation.getSnapshot()).toMatchObject({
      prepared: false,
      committed: false,
      cancelled: true,
    });
  });

  it('releases a decoded bitmap when cancelled before the coordinated commit', async () => {
    const bitmap = createBitmap();
    const fetchImage = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['background']),
    }) as Response);
    const preparation = new CustomBackgroundTexturePreparation(
      'reverse-room',
      fetchImage as typeof fetch,
      vi.fn(async () => bitmap) as typeof createImageBitmap,
    );

    await preparation.prepare();
    preparation.cancel();

    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(() => preparation.commit({} as Phaser.Scene)).toThrow(/Cancelled/);
  });
});

describe('tiled custom backgrounds', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sizes the tile copy at four texels per displayed pixel and skips small sources', () => {
    expect(getCustomBackgroundTileTextureSize({ width: 1280, height: 768 })).toEqual({ width: 512, height: 307 });
    expect(getCustomBackgroundTileTextureSize({ width: 1024, height: 768 })).toEqual({ width: 512, height: 384 });
    expect(getCustomBackgroundTileTextureSize({ width: 576, height: 768 })).toEqual({ width: 288, height: 384 });
    // Animations are at most 240 px, already within four texels per displayed pixel.
    expect(getCustomBackgroundTileTextureSize({ width: 240, height: 135 })).toBeNull();
    expect(getCustomBackgroundTileTextureSize({ width: 400, height: 300 })).toBeNull();
  });

  function tiledScene(sourceWidth: number, sourceHeight: number) {
    const key = getCustomBackgroundTextureKey('photo');
    const source = { width: sourceWidth, height: sourceHeight };
    const textures = new Map<string, unknown>([[key, { getSourceImage: () => source }]]);
    const removeListeners = new Map<string, () => void>();
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      drawImage: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    const sprite = {
      texture: { setFilter: vi.fn() },
      setOrigin: vi.fn(),
      setDepth: vi.fn(),
      setPosition: vi.fn(),
      setSize: vi.fn(),
      setTileScale: vi.fn(),
      once: vi.fn(),
      tilePositionX: 0,
      tilePositionY: 0,
    };
    const scene = {
      textures: {
        exists: vi.fn((textureKey: string) => textures.has(textureKey)),
        get: vi.fn((textureKey: string) => textures.get(textureKey)),
        addImage: vi.fn((textureKey: string, registered: unknown) => {
          const texture = { getSourceImage: () => registered };
          textures.set(textureKey, texture);
          return texture;
        }),
        remove: vi.fn((textureKey: string) => {
          textures.delete(textureKey);
          removeListeners.get(`removetexture-${textureKey}`)?.();
        }),
        once: vi.fn((event: string, listener: () => void) => removeListeners.set(event, listener)),
      },
      add: { tileSprite: vi.fn(() => sprite) },
    };
    const layer: CustomBackgroundLayer = {
      key,
      path: '/photo',
      width: sourceWidth,
      height: sourceHeight,
      scrollFactor: 0,
      fit: 'tile',
    };
    return { key, source, scene, sprite, canvas, context, layer };
  }

  it('draws a tiled photo from one smoothed tile copy at the same on-screen tile size', () => {
    const f = tiledScene(1280, 768);
    const tileKey = getCustomBackgroundTileTextureKey(f.key);

    createCustomBackgroundObject(f.scene as unknown as Phaser.Scene, f.layer, 0, 0, 640, 352, 9);
    createCustomBackgroundObject(f.scene as unknown as Phaser.Scene, f.layer, 640, 0, 640, 352, 9);

    expect(f.scene.textures.addImage).toHaveBeenCalledOnce();
    expect(f.scene.textures.addImage).toHaveBeenCalledWith(tileKey, f.canvas);
    expect(f.canvas).toMatchObject({ width: 512, height: 307 });
    expect(f.context).toMatchObject({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
    expect(f.context.drawImage).toHaveBeenCalledWith(f.source, 0, 0, 512, 307);
    expect(f.scene.add.tileSprite).toHaveBeenCalledWith(0, 0, 640, 352, tileKey);
    // 1280x768 at the 0.1 tile scale is a 128x76.8 tile, as when drawn from the original.
    const [scaleX, scaleY] = f.sprite.setTileScale.mock.calls[0] as [number, number];
    expect(512 * scaleX).toBeCloseTo(128);
    expect(307 * scaleY).toBeCloseTo(76.8);

    f.scene.textures.remove(f.key);
    expect(f.scene.textures.exists(tileKey)).toBe(false);
  });

  it('keeps an animated tiled background on its own texture, even a large one', () => {
    const f = tiledScene(1280, 768);
    const texture = f.scene.textures.get(f.key) as unknown as Phaser.Textures.CanvasTexture;
    const animationScene = {
      game: { events: { on: vi.fn(), once: vi.fn() } },
      textures: { once: vi.fn() },
    } as unknown as Phaser.Scene;
    animateBackgroundTexture(animationScene, texture, {
      width: 1280,
      height: 768,
      frames: [],
      durations: [100],
      loops: 0,
      close: vi.fn(),
    } as BackgroundAnimation);

    createCustomBackgroundObject(f.scene as unknown as Phaser.Scene, f.layer, 0, 0, 640, 352, 9);

    // Frames are redrawn into the original, so a one-off tile copy would freeze the animation.
    expect(f.scene.textures.addImage).not.toHaveBeenCalled();
    expect(f.scene.add.tileSprite).toHaveBeenCalledWith(0, 0, 640, 352, f.key);
    expect(f.sprite.setTileScale).toHaveBeenCalledWith(0.1, 0.1);
  });

  it('keeps small tiled backgrounds on their own texture', () => {
    const f = tiledScene(240, 135);

    createCustomBackgroundObject(f.scene as unknown as Phaser.Scene, f.layer, 0, 0, 640, 352, 9);

    expect(f.scene.textures.addImage).not.toHaveBeenCalled();
    expect(f.scene.add.tileSprite).toHaveBeenCalledWith(0, 0, 640, 352, f.key);
    const scale = 128 / 240;
    expect(f.sprite.setTileScale).toHaveBeenCalledWith(scale, scale);

    syncCustomBackgroundObject(f.sprite as never, f.layer, 0, 0, 640, 352, 50);
    expect(f.sprite.setTileScale).toHaveBeenLastCalledWith(scale, scale);
  });
});
