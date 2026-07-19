import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_HEIGHT, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, ROOM_WIDTH } from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';

const mocks = vi.hoisted(() => ({
  drawRoomSnapshotToContext: vi.fn(),
}));

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../visuals/roomSnapshotTexture', () => ({
  drawRoomSnapshotToContext: mocks.drawRoomSnapshotToContext,
}));

import { OverworldChunkPreviewRenderer } from './chunkPreviewRenderer';

describe('sparse overworld chunk preview textures', () => {
  beforeEach(() => {
    mocks.drawRoomSnapshotToContext.mockReset();
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('crops canvas pixels and retains the displayed crop until a deferred replacement is ready', () => {
    const scene = createScene();
    const renderer = new OverworldChunkPreviewRenderer({
      scene: scene.value,
      getPreviewTileSize: () => 2,
      getRoomOrigin: (coordinates) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      isFullRoomLoaded: () => false,
    });

    renderer.renderChunkPreviews([room(5, 3)]);

    expect(scene.canvasBuilds).toHaveLength(1);
    expect(scene.canvasBuilds[0]).toMatchObject({
      width: ROOM_WIDTH * 2,
      height: ROOM_HEIGHT * 2,
    });
    expect(mocks.drawRoomSnapshotToContext).toHaveBeenCalledWith(
      scene.value,
      scene.canvasBuilds[0].context,
      expect.objectContaining({ id: '5,3' }),
      2,
      expect.objectContaining({ offsetX: 0, offsetY: 0 }),
    );
    const image = scene.images[0];
    expect(image).toMatchObject({
      x: 5 * ROOM_PX_WIDTH,
      y: 3 * ROOM_PX_HEIGHT,
      width: ROOM_PX_WIDTH,
      height: ROOM_PX_HEIGHT,
    });

    mocks.drawRoomSnapshotToContext.mockClear();
    renderer.renderChunkPreviews([room(2, 3), room(5, 3)]);

    expect(renderer.getPendingTextureBuildCount()).toBe(1);
    expect(scene.canvasBuilds).toHaveLength(1);
    expect(image).toMatchObject({
      x: 5 * ROOM_PX_WIDTH,
      y: 3 * ROOM_PX_HEIGHT,
      width: ROOM_PX_WIDTH,
      height: ROOM_PX_HEIGHT,
    });

    expect(renderer.flushPendingTextureBuilds()).toBe(1);
    expect(scene.canvasBuilds[1]).toMatchObject({
      width: ROOM_WIDTH * 2 * 4,
      height: ROOM_HEIGHT * 2,
    });
    expect(mocks.drawRoomSnapshotToContext.mock.calls.map((call) => call[4])).toEqual([
      expect.objectContaining({ offsetX: 0, offsetY: 0 }),
      expect.objectContaining({ offsetX: ROOM_WIDTH * 2 * 3, offsetY: 0 }),
    ]);
    expect(image).toMatchObject({
      x: 2 * ROOM_PX_WIDTH,
      y: 3 * ROOM_PX_HEIGHT,
      width: ROOM_PX_WIDTH * 4,
      height: ROOM_PX_HEIGHT,
    });
    expect(renderer.getApproximatePreviewTexturePixels()).toBe(
      ROOM_WIDTH * 2 * 4 * ROOM_HEIGHT * 2,
    );
  });
});

function createScene(): {
  value: never;
  canvasBuilds: Array<{
    width: number;
    height: number;
    context: CanvasRenderingContext2D;
  }>;
  images: FakeImage[];
} {
  const textures = new Map<string, unknown>();
  const canvasBuilds: Array<{
    width: number;
    height: number;
    context: CanvasRenderingContext2D;
  }> = [];
  const images: FakeImage[] = [];
  const value = {
    sys: { settings: { key: 'chunk-preview-test' } },
    textures: {
      exists: (key: string) => textures.has(key),
      createCanvas: (key: string, width: number, height: number) => {
        const context = {
          clearRect: vi.fn(),
          imageSmoothingEnabled: true,
        } as unknown as CanvasRenderingContext2D;
        const canvas = {
          width,
          height,
          getContext: () => context,
        } as unknown as HTMLCanvasElement;
        const texture = {
          getSourceImage: () => canvas,
          refresh: vi.fn(),
        };
        textures.set(key, texture);
        canvasBuilds.push({ width, height, context });
        return texture;
      },
      remove: (key: string) => textures.delete(key),
    },
    add: {
      image: (_x: number, _y: number, textureKey: string) => {
        const image = new FakeImage(textureKey);
        images.push(image);
        return image;
      },
    },
  };
  return { value: value as never, canvasBuilds, images };
}

class FakeImage {
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  visible = false;
  destroyed = false;

  constructor(public textureKey: string) {}

  setOrigin() { return this; }
  setDepth() { return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setDisplaySize(width: number, height: number) { this.width = width; this.height = height; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setTexture(textureKey: string) { this.textureKey = textureKey; return this; }
  destroy() { this.destroyed = true; }
}

function room(x: number, y: number): RoomSnapshot {
  return {
    id: `${x},${y}`,
    coordinates: { x, y },
    version: 1,
    updatedAt: '2026-07-19T00:00:00.000Z',
    status: 'claimed_unpublished',
  } as unknown as RoomSnapshot;
}
