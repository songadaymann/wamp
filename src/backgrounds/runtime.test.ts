import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Loader: { Events: { FILE_LOAD_ERROR: 'loaderror' } },
    Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } },
  },
}));

import {
  CustomBackgroundTexturePreparation,
  getCustomBackgroundTextureKey,
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
        addCanvas: vi.fn(() => {
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

    expect(scene.textures.addCanvas).not.toHaveBeenCalled();
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
    expect(scene.textures.addCanvas).toHaveBeenCalledOnce();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(preparation.getSnapshot()).toMatchObject({ committed: true, prepared: true });
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
