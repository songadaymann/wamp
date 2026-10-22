import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    },
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}));

import { ROOM_HEIGHT, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, ROOM_WIDTH, TILE_FLIP_X_FLAG } from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { RoomTexturePreparation, roomLayerHasTiles } from './roomTexturePreparation';

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

function createRoom({ foreground = true } = {}): RoomSnapshot {
  const layer = () => Array.from({ length: ROOM_HEIGHT }, () => Array(ROOM_WIDTH).fill(-1));
  const tileData = { background: layer(), terrain: layer(), foreground: layer() };
  if (foreground) tileData.foreground[3][4] = 2;
  return {
    id: '5,7',
    tileData,
    customTiles: [],
  } as unknown as RoomSnapshot;
}

describe('RoomTexturePreparation', () => {
  it('draws bounded row batches across all layers before committing once', () => {
    const addImage = vi.fn();
    const scene = {
      textures: {
        exists: vi.fn(() => false),
        addImage,
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
    expect(addImage).toHaveBeenCalledTimes(1);
    expect(preparation.commit('terrain-key', 'foreground-key')).toEqual([
      'terrain-key',
      'foreground-key',
    ]);
    expect(addImage).toHaveBeenCalledTimes(2);
    preparation.commit('terrain-key', 'foreground-key');
    expect(addImage).toHaveBeenCalledTimes(2);
  });

  it('skips the foreground canvas and upload for a room without foreground tiles', () => {
    const addImage = vi.fn();
    const scene = {
      textures: {
        exists: vi.fn(() => false),
        addImage,
        get: vi.fn(() => ({ getSourceImage: () => null })),
      },
    };
    const createCanvasForPreparation = vi.fn(createCanvas);
    const preparation = new RoomTexturePreparation(
      scene as never,
      createRoom({ foreground: false }),
      createCanvasForPreparation,
    );

    expect(preparation.includesForeground()).toBe(false);
    expect(preparation.runNextBatch(ROOM_HEIGHT * 3)).toBe(true);
    expect(createCanvasForPreparation).toHaveBeenCalledOnce();
    expect(preparation.getSnapshot()).toMatchObject({
      layer: null,
      complete: true,
      byteSize: ROOM_PX_WIDTH * ROOM_PX_HEIGHT * 4,
    });
    expect(preparation.commitNext('terrain-key', null)).toEqual({
      resourceKey: 'terrain-key',
      complete: true,
    });
    expect(preparation.commit('terrain-key', null)).toEqual(['terrain-key']);
    expect(addImage).toHaveBeenCalledOnce();
    expect(addImage).toHaveBeenCalledWith('terrain-key', expect.anything());
  });

  it('counts only drawn tiles, flipped ones included, as layer content', () => {
    const room = createRoom({ foreground: false });
    expect(roomLayerHasTiles(room, 'foreground')).toBe(false);
    room.tileData.foreground[0][0] = 0;
    room.tileData.foreground[0][1] = TILE_FLIP_X_FLAG;
    expect(roomLayerHasTiles(room, 'foreground')).toBe(false);
    room.tileData.foreground[21][39] = 7 + TILE_FLIP_X_FLAG;
    expect(roomLayerHasTiles(room, 'foreground')).toBe(true);
    expect(roomLayerHasTiles({ tileData: {} } as never, 'foreground')).toBe(false);
  });

  it('cancels detached canvases before upload', () => {
    const canvases = [createCanvas(), createCanvas()];
    const scene = {
      textures: {
        exists: vi.fn(() => false),
        addImage: vi.fn(),
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
    expect(scene.textures.addImage).not.toHaveBeenCalled();
    expect(() => preparation.commit('terrain', 'foreground')).toThrow();
  });
});
