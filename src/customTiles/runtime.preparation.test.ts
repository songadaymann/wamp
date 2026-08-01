import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { TILE_SIZE } from '../config/room';
import {
  CUSTOM_ROOM_TILE_ATLAS_COLUMNS,
  CUSTOM_ROOM_TILE_ATLAS_ROWS,
  type CustomRoomTileDefinition,
} from './model';
import {
  CustomRoomTileTexturePreparation,
  ensureCustomRoomTileTexture,
} from './runtime';

interface FakeCanvasHarness {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fills: Array<{ color: string; x: number; y: number; width: number; height: number }>;
}

function createCanvasHarness(): FakeCanvasHarness {
  const fills: FakeCanvasHarness['fills'] = [];
  const clearRect = vi.fn();
  const fillRect = vi.fn((x: number, y: number, width: number, height: number) => {
    fills.push({
      color: context.fillStyle as string,
      x,
      y,
      width,
      height,
    });
  });
  const context = {
    imageSmoothingEnabled: true,
    fillStyle: '#000000',
    clearRect,
    fillRect,
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  return { canvas, context, clearRect, fillRect, fills };
}

function createScene(initialTextureKeys: readonly string[] = []) {
  const textureKeys = new Set(initialTextureKeys);
  const addCanvas = vi.fn((textureKey: string) => {
    textureKeys.add(textureKey);
    return {};
  });
  return {
    scene: {
      textures: {
        exists: vi.fn((textureKey: string) => textureKeys.has(textureKey)),
        addCanvas,
      },
    },
    addCanvas,
  };
}

function createTile(id: string, color: string): CustomRoomTileDefinition {
  return {
    id,
    name: id,
    pixels: [color, ...Array.from<string | null>({ length: TILE_SIZE * TILE_SIZE - 1 }).fill(null)],
    collision: 'solid',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

describe('CustomRoomTileTexturePreparation', () => {
  it('normalizes ingress once and draws only the requested number of tiles per batch', () => {
    const sourceTiles = [
      createTile('first', '#AABBCC'),
      createTile('second', '#112233'),
      createTile('third', '#445566'),
    ];
    const { scene } = createScene();
    const canvasHarness = createCanvasHarness();
    const createCanvas = vi.fn(() => canvasHarness.canvas);
    const preparation = new CustomRoomTileTexturePreparation(
      scene as never,
      sourceTiles,
      createCanvas,
    );

    sourceTiles[0].pixels[0] = '#FFFFFF';
    expect(preparation.getSnapshot()).toMatchObject({
      tileCount: 3,
      nextTileIndex: 0,
      complete: false,
      cancelled: false,
      committed: false,
    });
    expect(createCanvas).not.toHaveBeenCalled();

    expect(preparation.runNextBatch(2)).toBe(false);
    expect(canvasHarness.fills).toEqual([
      { color: '#aabbcc', x: 0, y: 0, width: 1, height: 1 },
      { color: '#112233', x: TILE_SIZE, y: 0, width: 1, height: 1 },
    ]);
    expect(preparation.getSnapshot()).toMatchObject({
      nextTileIndex: 2,
      complete: false,
    });

    expect(preparation.runNextBatch(2)).toBe(true);
    expect(canvasHarness.fills.at(-1)).toEqual({
      color: '#445566',
      x: TILE_SIZE * 2,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(preparation.getSnapshot()).toEqual({
      tileCount: 3,
      nextTileIndex: 3,
      complete: true,
      cancelled: false,
      committed: false,
      committedTextureKey: null,
      byteSize:
        CUSTOM_ROOM_TILE_ATLAS_COLUMNS
        * CUSTOM_ROOM_TILE_ATLAS_ROWS
        * TILE_SIZE
        * TILE_SIZE
        * 4,
    });

    expect(preparation.runNextBatch(1)).toBe(true);
    expect(canvasHarness.fillRect).toHaveBeenCalledTimes(3);
    expect(createCanvas).toHaveBeenCalledOnce();
  });

  it('performs one explicit Phaser texture commit after all batches complete', () => {
    const { scene, addCanvas } = createScene();
    const canvasHarness = createCanvasHarness();
    const preparation = new CustomRoomTileTexturePreparation(
      scene as never,
      [createTile('only', '#abcdef')],
      () => canvasHarness.canvas,
    );

    expect(() => preparation.commit('atlas')).toThrow(/before preparation completes/i);
    expect(preparation.runNextBatch(1)).toBe(true);
    expect(preparation.commit('atlas')).toBe('atlas');
    expect(addCanvas).toHaveBeenCalledOnce();
    expect(addCanvas).toHaveBeenCalledWith('atlas', canvasHarness.canvas);
    expect(preparation.getSnapshot()).toMatchObject({
      complete: true,
      cancelled: false,
      committed: true,
      committedTextureKey: 'atlas',
    });

    expect(preparation.commit('atlas')).toBe('atlas');
    expect(addCanvas).toHaveBeenCalledOnce();
    expect(() => preparation.commit('different-atlas')).toThrow(/two texture keys/i);
    preparation.cancel();
    expect(canvasHarness.canvas.width).toBe(
      CUSTOM_ROOM_TILE_ATLAS_COLUMNS * TILE_SIZE,
    );
    expect(preparation.getSnapshot().cancelled).toBe(false);
  });

  it('cancels incomplete work, releases its detached canvas, and prevents upload', () => {
    const { scene, addCanvas } = createScene();
    const canvasHarness = createCanvasHarness();
    const createCanvas = vi.fn(() => canvasHarness.canvas);
    const preparation = new CustomRoomTileTexturePreparation(
      scene as never,
      [createTile('first', '#111111'), createTile('second', '#222222')],
      createCanvas,
    );

    expect(preparation.runNextBatch(1)).toBe(false);
    preparation.cancel();

    expect(preparation.getSnapshot()).toMatchObject({
      tileCount: 2,
      nextTileIndex: 1,
      complete: false,
      cancelled: true,
      committed: false,
    });
    expect(canvasHarness.canvas.width).toBe(0);
    expect(canvasHarness.canvas.height).toBe(0);
    expect(preparation.runNextBatch(1)).toBe(false);
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(canvasHarness.fillRect).toHaveBeenCalledOnce();
    expect(() => preparation.commit('cancelled-atlas')).toThrow(/cancelled/i);
    expect(addCanvas).not.toHaveBeenCalled();
  });

  it('validates batch sizes before allocating a canvas', () => {
    const { scene } = createScene();
    const createCanvas = vi.fn(() => createCanvasHarness().canvas);
    const preparation = new CustomRoomTileTexturePreparation(
      scene as never,
      [createTile('only', '#abcdef')],
      createCanvas,
    );

    expect(() => preparation.runNextBatch(0)).toThrow(/positive finite/i);
    expect(() => preparation.runNextBatch(Number.NaN)).toThrow(/positive finite/i);
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it('discards detached work without uploading when an equivalent texture won a race', () => {
    const { scene, addCanvas } = createScene(['existing-atlas']);
    const canvasHarness = createCanvasHarness();
    const preparation = new CustomRoomTileTexturePreparation(
      scene as never,
      [createTile('only', '#abcdef')],
      () => canvasHarness.canvas,
    );
    preparation.runNextBatch(1);

    expect(preparation.commit('existing-atlas')).toBe('existing-atlas');
    expect(addCanvas).not.toHaveBeenCalled();
    expect(canvasHarness.canvas.width).toBe(0);
    expect(canvasHarness.canvas.height).toBe(0);
    expect(preparation.getSnapshot()).toMatchObject({
      committed: true,
      committedTextureKey: 'existing-atlas',
    });
  });
});

describe('ensureCustomRoomTileTexture compatibility', () => {
  it('retains the synchronous editor texture creation and refresh path', () => {
    const canvasHarness = createCanvasHarness();
    const refresh = vi.fn();
    const setSize = vi.fn();
    const texture = {
      getSourceImage: vi.fn(() => canvasHarness.canvas),
      refresh,
      setSize,
    };
    const createCanvas = vi.fn(() => texture);
    const scene = {
      textures: {
        exists: vi.fn(() => false),
        createCanvas,
        get: vi.fn(),
      },
    };

    ensureCustomRoomTileTexture(
      scene as never,
      'editor-atlas',
      [createTile('editor-tile', '#abcdef')],
    );

    expect(createCanvas).toHaveBeenCalledWith(
      'editor-atlas',
      CUSTOM_ROOM_TILE_ATLAS_COLUMNS * TILE_SIZE,
      CUSTOM_ROOM_TILE_ATLAS_ROWS * TILE_SIZE,
    );
    expect(setSize).toHaveBeenCalledWith(
      CUSTOM_ROOM_TILE_ATLAS_COLUMNS * TILE_SIZE,
      CUSTOM_ROOM_TILE_ATLAS_ROWS * TILE_SIZE,
    );
    expect(canvasHarness.fills).toEqual([
      { color: '#abcdef', x: 0, y: 0, width: 1, height: 1 },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
