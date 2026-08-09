import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_HEIGHT, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, ROOM_WIDTH } from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';

const mocks = vi.hoisted(() => ({
  drawRoomSnapshotToContext: vi.fn(),
  drawRoomBackground: vi.fn(),
  drawRoomTileLayerRowsToContext: vi.fn(),
  drawRoomObjectRangeForLayerToContext: vi.fn(),
  drawConstructionOverlay: vi.fn(),
  ensureCustomBackgroundTexture: vi.fn(() => new Promise<string>(() => undefined)),
}));

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../visuals/roomSnapshotTexture', () => ({
  drawRoomSnapshotToContext: mocks.drawRoomSnapshotToContext,
  drawRoomBackground: mocks.drawRoomBackground,
  drawRoomTileLayerRowsToContext: mocks.drawRoomTileLayerRowsToContext,
  drawRoomObjectRangeForLayerToContext: mocks.drawRoomObjectRangeForLayerToContext,
  drawConstructionOverlay: mocks.drawConstructionOverlay,
}));
vi.mock('../../backgrounds/runtime', () => ({
  ensureCustomBackgroundTexture: mocks.ensureCustomBackgroundTexture,
  getCustomBackgroundTextureKey: (id: string) => `custom_background_${id}`,
}));

import { OverworldChunkPreviewRenderer } from './chunkPreviewRenderer';
import { FrameWorkCoordinator } from './frameWorkCoordinator';

describe('sparse overworld chunk preview textures', () => {
  beforeEach(() => {
    mocks.drawRoomSnapshotToContext.mockReset();
    mocks.drawRoomBackground.mockReset();
    mocks.drawRoomTileLayerRowsToContext.mockReset();
    mocks.drawRoomObjectRangeForLayerToContext.mockReset();
    mocks.drawConstructionOverlay.mockReset();
    mocks.ensureCustomBackgroundTexture.mockClear();
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
      createCanvas: scene.createDetachedCanvas,
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

  it('does not execute scheduled preview work without critical frame headroom', () => {
    const scene = createScene();
    const coordinator = new FrameWorkCoordinator();
    const renderer = new OverworldChunkPreviewRenderer({
      scene: scene.value,
      getPreviewTileSize: () => 2,
      getRoomOrigin: (coordinates) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      isFullRoomLoaded: () => false,
      workScheduler: coordinator,
      shouldScheduleWork: () => true,
      createCanvas: scene.createDetachedCanvas,
    });

    renderer.renderChunkPreviews([room(5, 3)]);

    expect(renderer.getPendingTextureBuildCount()).toBe(1);
    expect(scene.canvasBuilds).toHaveLength(0);
    expect(mocks.drawRoomSnapshotToContext).not.toHaveBeenCalled();

    const paused = coordinator.runFrame({
      profile: 'normal',
      criticalHeadroomMs: 0,
    });
    expect(paused.executed).toHaveLength(0);
    expect(paused.stopReason).toBe('critical-headroom-exhausted');
    expect(scene.canvasBuilds).toHaveLength(0);
    expect(mocks.drawRoomSnapshotToContext).not.toHaveBeenCalled();

    const firstBudgetedFrame = coordinator.runFrame({
      profile: 'normal',
      criticalHeadroomMs: 4,
    });
    expect(firstBudgetedFrame.executed.length).toBeGreaterThan(0);
    expect(firstBudgetedFrame.executed.every(
      (job) => job.priority === 'preview-cosmetic' && job.estimatedCostMs <= 0.5,
    )).toBe(true);
    expect(scene.canvasBuilds).toHaveLength(0);
    expect(scene.detachedCanvasBuilds).toHaveLength(1);
    expect(scene.images).toHaveLength(0);

    drainCoordinator(coordinator);

    expect(scene.registeredCanvasUploads).toHaveLength(1);
    expect(scene.images).toHaveLength(1);
    expect(renderer.getPendingTextureBuildCount()).toBe(0);
    expect(coordinator.getDiagnostics().currentGenerations).toEqual({});
  });

  it('cancels a superseded preview generation before any stale drawing executes', () => {
    const scene = createScene();
    const coordinator = new FrameWorkCoordinator();
    const renderer = new OverworldChunkPreviewRenderer({
      scene: scene.value,
      getPreviewTileSize: () => 2,
      getRoomOrigin: (coordinates) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      isFullRoomLoaded: () => false,
      workScheduler: coordinator,
      shouldScheduleWork: () => true,
      createCanvas: scene.createDetachedCanvas,
    });

    renderer.renderChunkPreviews([room(5, 3, 1)]);
    renderer.renderChunkPreviews([room(5, 3, 2)]);

    expect(coordinator.getDiagnostics()).toMatchObject({
      queueDepth: 1,
      cancelledJobs: 1,
    });
    drainCoordinator(coordinator);

    expect(scene.canvasBuilds).toHaveLength(0);
    expect(scene.detachedCanvasBuilds).toHaveLength(1);
    expect(mocks.drawRoomBackground).toHaveBeenCalledOnce();
    expect(mocks.drawRoomBackground).toHaveBeenCalledWith(
      scene.value,
      scene.detachedCanvasBuilds[0].context,
      expect.objectContaining({ version: 2 }),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      false,
    );
    expect(renderer.getPendingTextureBuildCount()).toBe(0);
    expect(coordinator.getDiagnostics().currentGenerations).toEqual({});
  });

  it('keeps Browse on the immediate and timer fallback when scheduling is disabled', () => {
    const scene = createScene();
    const coordinator = new FrameWorkCoordinator();
    const renderer = new OverworldChunkPreviewRenderer({
      scene: scene.value,
      getPreviewTileSize: () => 2,
      getRoomOrigin: (coordinates) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      isFullRoomLoaded: () => false,
      workScheduler: coordinator,
      shouldScheduleWork: () => false,
      createCanvas: scene.createDetachedCanvas,
    });

    renderer.renderChunkPreviews([room(5, 3)]);

    expect(scene.canvasBuilds).toHaveLength(1);
    expect(coordinator.getDiagnostics().queueDepth).toBe(0);

    renderer.renderChunkPreviews([room(2, 3), room(5, 3)]);
    expect(scene.canvasBuilds).toHaveLength(1);
    expect(window.setTimeout).toHaveBeenCalledOnce();
    expect(coordinator.getDiagnostics().queueDepth).toBe(0);
    expect(renderer.getPendingTextureBuildCount()).toBe(1);
  });

  it('keeps the displayed texture stable through detached drawing, resync, upload, and cancellation', () => {
    const scene = createScene();
    const coordinator = new FrameWorkCoordinator();
    let scheduleWork = false;
    const renderer = new OverworldChunkPreviewRenderer({
      scene: scene.value,
      getPreviewTileSize: () => 2,
      getRoomOrigin: (coordinates) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      isFullRoomLoaded: () => false,
      workScheduler: coordinator,
      shouldScheduleWork: () => scheduleWork,
      createCanvas: scene.createDetachedCanvas,
    });

    renderer.renderChunkPreviews([room(5, 3, 1)]);
    const image = scene.images[0];
    const stableTextureKey = image.textureKey;
    expect(scene.hasTexture(stableTextureKey)).toBe(true);

    scheduleWork = true;
    renderer.renderChunkPreviews([room(5, 3, 2)]);
    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 0.25 });

    expect(scene.detachedCanvasBuilds).toHaveLength(1);
    expect(scene.registeredCanvasUploads).toHaveLength(0);
    renderer.syncPreviewVisibility();
    expect(image.textureKey).toBe(stableTextureKey);

    let uploadedTextureKey: string | null = null;
    for (let frame = 0; frame < 200 && !uploadedTextureKey; frame += 1) {
      const result = coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 0.5 });
      if (result.executed.some((job) => job.label.includes('upload-texture'))) {
        uploadedTextureKey = scene.registeredCanvasUploads.at(-1)?.key ?? null;
      }
    }
    expect(uploadedTextureKey).not.toBeNull();
    expect(renderer.getPendingTextureBuildCount()).toBe(1);
    renderer.syncPreviewVisibility();
    expect(image.textureKey).toBe(stableTextureKey);

    renderer.renderChunkPreviews([room(5, 3, 3)]);

    expect(image.textureKey).toBe(stableTextureKey);
    expect(scene.hasTexture(stableTextureKey)).toBe(true);
    expect(scene.hasTexture(uploadedTextureKey!)).toBe(false);
  });

  it('batches heavy scheduled rooms and uses only resident custom preview assets', () => {
    const scene = createScene();
    const coordinator = new FrameWorkCoordinator();
    const renderer = new OverworldChunkPreviewRenderer({
      scene: scene.value,
      getPreviewTileSize: () => 4,
      getRoomOrigin: (coordinates) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      isFullRoomLoaded: () => false,
      workScheduler: coordinator,
      shouldScheduleWork: () => true,
      createCanvas: scene.createDetachedCanvas,
    });
    const heavyRoom = room(5, 3);
    heavyRoom.background = 'custom:abcdefgh';
    heavyRoom.placedObjects = Array.from({ length: 17 }, (_, index) => ({
      id: index === 0 ? 'custom_sprite:missing-preview-art' : 'coin',
      x: 16 + index,
      y: 16,
      layer: 'terrain',
    })) as never;
    heavyRoom.customSprites = [{ id: 'missing-preview-art' }] as never;

    renderer.renderChunkPreviews([heavyRoom]);

    expect(mocks.ensureCustomBackgroundTexture).not.toHaveBeenCalled();
    expect(scene.canvasBuilds).toHaveLength(0);
    const labels = drainCoordinator(coordinator);

    expect(labels.some((label) => label.includes('draw-room-'))).toBe(false);
    expect(labels.some((label) => label.includes('upload-texture'))).toBe(true);
    expect(scene.detachedCanvasBuilds).toHaveLength(1);
    expect(scene.registeredCanvasUploads).toHaveLength(1);
    expect(mocks.drawRoomTileLayerRowsToContext).toHaveBeenCalled();
    for (const call of mocks.drawRoomTileLayerRowsToContext.mock.calls) {
      expect((call[6] as number) - (call[5] as number)).toBeLessThanOrEqual(1);
    }
    expect(mocks.drawRoomObjectRangeForLayerToContext).toHaveBeenCalled();
    for (const call of mocks.drawRoomObjectRangeForLayerToContext.mock.calls) {
      expect((call[6] as number) - (call[5] as number)).toBeLessThanOrEqual(8);
      expect(call[9]).toEqual({ ensureCustomSpriteTextures: false });
    }
  });

  it('keeps sparse overview snapshots on lightweight scheduled preview layers', () => {
    const scene = createScene();
    const coordinator = new FrameWorkCoordinator();
    const renderer = new OverworldChunkPreviewRenderer({
      scene: scene.value,
      getPreviewTileSize: () => 4,
      getRoomOrigin: (coordinates) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      isFullRoomLoaded: () => false,
      workScheduler: coordinator,
      shouldScheduleWork: () => true,
      createCanvas: scene.createDetachedCanvas,
    });
    const overviewRoom = room(5, 3);
    overviewRoom.tileData.foreground = [];

    renderer.renderChunkPreviews([overviewRoom]);
    drainCoordinator(coordinator);

    expect(mocks.drawRoomTileLayerRowsToContext).toHaveBeenCalled();
    expect(new Set(
      mocks.drawRoomTileLayerRowsToContext.mock.calls.map((call) => call[4]),
    )).toEqual(new Set(['background', 'terrain']));
    expect(mocks.drawRoomObjectRangeForLayerToContext).not.toHaveBeenCalled();
    expect(scene.registeredCanvasUploads).toHaveLength(1);
    expect(renderer.getPendingTextureBuildCount()).toBe(0);
  });

  it('supersedes a prepared overview build when matching full preview data arrives', () => {
    const scene = createScene();
    const coordinator = new FrameWorkCoordinator();
    const renderer = new OverworldChunkPreviewRenderer({
      scene: scene.value,
      getPreviewTileSize: () => 4,
      getRoomOrigin: (coordinates) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      isFullRoomLoaded: () => false,
      workScheduler: coordinator,
      shouldScheduleWork: () => true,
      createCanvas: scene.createDetachedCanvas,
    });
    const stableRoom = room(2, 3);
    const overviewRoom = room(5, 3);
    overviewRoom.tileData.foreground = [];
    const fullRoom = room(5, 3);

    renderer.renderChunkPreviews([stableRoom, overviewRoom]);
    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 0.25 });
    const overviewCanvas = scene.detachedCanvasBuilds[0].canvas;

    renderer.mergeChunkPreviews([fullRoom]);

    expect(coordinator.getDiagnostics().cancelledJobs).toBeGreaterThan(0);
    expect(overviewCanvas).toMatchObject({ width: 0, height: 0 });
    drainCoordinator(coordinator);

    const foregroundCalls = mocks.drawRoomTileLayerRowsToContext.mock.calls.filter(
      (call) => call[4] === 'foreground',
    );
    expect(foregroundCalls.some((call) => call[2] === fullRoom)).toBe(true);
    expect(foregroundCalls.some((call) => call[2] === overviewRoom)).toBe(false);
    expect(scene.registeredCanvasUploads).toHaveLength(1);
    expect(renderer.getPendingTextureBuildCount()).toBe(0);
  });

  it('preserves custom-background loading for immediate Browse previews', () => {
    const scene = createScene();
    const renderer = new OverworldChunkPreviewRenderer({
      scene: scene.value,
      getPreviewTileSize: () => 4,
      getRoomOrigin: (coordinates) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      isFullRoomLoaded: () => false,
      createCanvas: scene.createDetachedCanvas,
    });
    const customRoom = room(5, 3);
    customRoom.background = 'custom:abcdefgh';

    renderer.renderChunkPreviews([customRoom]);

    expect(mocks.ensureCustomBackgroundTexture).toHaveBeenCalledOnce();
    expect(scene.canvasBuilds).toHaveLength(1);
  });
});

function createScene(): {
  value: never;
  canvasBuilds: Array<{
    width: number;
    height: number;
    context: CanvasRenderingContext2D;
  }>;
  detachedCanvasBuilds: Array<{
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
  }>;
  registeredCanvasUploads: Array<{ key: string; canvas: HTMLCanvasElement }>;
  createDetachedCanvas: () => HTMLCanvasElement;
  hasTexture: (key: string) => boolean;
  images: FakeImage[];
} {
  const textures = new Map<string, unknown>();
  const canvasBuilds: Array<{
    width: number;
    height: number;
    context: CanvasRenderingContext2D;
  }> = [];
  const detachedCanvasBuilds: Array<{
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
  }> = [];
  const registeredCanvasUploads: Array<{ key: string; canvas: HTMLCanvasElement }> = [];
  const images: FakeImage[] = [];
  const createCanvas = (width = 0, height = 0): {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
  } => {
    const context = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width,
      height,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    return { canvas, context };
  };
  const createDetachedCanvas = () => {
    const created = createCanvas();
    detachedCanvasBuilds.push(created);
    return created.canvas;
  };
  const value = {
    sys: { settings: { key: 'chunk-preview-test' } },
    textures: {
      exists: (key: string) => textures.has(key),
      createCanvas: (key: string, width: number, height: number) => {
        const { canvas, context } = createCanvas(width, height);
        const texture = {
          getSourceImage: () => canvas,
          refresh: vi.fn(),
        };
        textures.set(key, texture);
        canvasBuilds.push({ width, height, context });
        return texture;
      },
      addCanvas: (key: string, canvas: HTMLCanvasElement) => {
        const texture = {
          getSourceImage: () => canvas,
          refresh: vi.fn(),
        };
        textures.set(key, texture);
        registeredCanvasUploads.push({ key, canvas });
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
  return {
    value: value as never,
    canvasBuilds,
    detachedCanvasBuilds,
    registeredCanvasUploads,
    createDetachedCanvas,
    hasTexture: (key: string) => textures.has(key),
    images,
  };
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

function room(x: number, y: number, version = 1): RoomSnapshot {
  const layer = () => Array.from(
    { length: ROOM_HEIGHT },
    () => Array(ROOM_WIDTH).fill(-1),
  );
  return {
    id: `${x},${y}`,
    coordinates: { x, y },
    version,
    updatedAt: '2026-07-19T00:00:00.000Z',
    status: 'claimed_unpublished',
    background: 'none',
    tileData: {
      background: layer(),
      terrain: layer(),
      foreground: layer(),
    },
    placedObjects: [],
    customSprites: [],
  } as unknown as RoomSnapshot;
}

function drainCoordinator(coordinator: FrameWorkCoordinator): string[] {
  const labels: string[] = [];
  for (let frame = 0; frame < 1_000; frame += 1) {
    const diagnostics = coordinator.getDiagnostics();
    if (diagnostics.queueDepth === 0) return labels;
    const result = coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    labels.push(...result.executed.map((job) => job.label));
  }
  throw new Error('Scheduled preview work did not drain.');
}
