import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    },
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}));

import { ROOM_HEIGHT, ROOM_WIDTH } from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { RoomTexturePreparation } from './roomTexturePreparation';

function createCanvas() {
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

function createRoom(): RoomSnapshot {
  const layer = () => Array.from({ length: ROOM_HEIGHT }, () => Array(ROOM_WIDTH).fill(-1));
  return {
    id: '5,7',
    tileData: { background: layer(), terrain: layer(), foreground: layer() },
    customTiles: [],
  } as unknown as RoomSnapshot;
}

describe('RoomTexturePreparation', () => {
  it('draws bounded row batches across all layers before committing once', () => {
    const addCanvas = vi.fn();
    const scene = {
      textures: {
        exists: vi.fn(() => false),
        addCanvas,
        get: vi.fn(() => ({ getSourceImage: () => null })),
      },
    };
    const createCanvasForPreparation = vi.fn(createCanvas);
    const preparation = new RoomTexturePreparation(
      scene as never,
      createRoom(),
      createCanvasForPreparation,
    );

    expect(createCanvasForPreparation).not.toHaveBeenCalled();
    expect(preparation.runNextBatch(ROOM_HEIGHT)).toBe(false);
    expect(createCanvasForPreparation).toHaveBeenCalledOnce();
    expect(preparation.getSnapshot()).toMatchObject({ layer: 'terrain', nextRow: 0 });
    expect(preparation.runNextBatch(ROOM_HEIGHT * 2)).toBe(true);
    expect(createCanvasForPreparation).toHaveBeenCalledTimes(2);

    expect(preparation.commitNext('terrain-key', 'foreground-key')).toEqual({
      resourceKey: 'terrain-key',
      complete: false,
    });
    expect(addCanvas).toHaveBeenCalledTimes(1);
    expect(preparation.commit('terrain-key', 'foreground-key')).toEqual([
      'terrain-key',
      'foreground-key',
    ]);
    expect(addCanvas).toHaveBeenCalledTimes(2);
    preparation.commit('terrain-key', 'foreground-key');
    expect(addCanvas).toHaveBeenCalledTimes(2);
  });

  it('cancels detached canvases before upload', () => {
    const canvases = [createCanvas(), createCanvas()];
    const scene = {
      textures: {
        exists: vi.fn(() => false),
        addCanvas: vi.fn(),
        get: vi.fn(() => ({ getSourceImage: () => null })),
      },
    };
    const createCanvasForPreparation = vi.fn(() => canvases.shift() ?? createCanvas());
    const preparation = new RoomTexturePreparation(
      scene as never,
      createRoom(),
      createCanvasForPreparation,
    );

    preparation.cancel();

    expect(createCanvasForPreparation).not.toHaveBeenCalled();
    expect(preparation.getSnapshot()).toMatchObject({ cancelled: true, complete: false });
    expect(scene.textures.addCanvas).not.toHaveBeenCalled();
    expect(() => preparation.commit('terrain', 'foreground')).toThrow();
  });
});
