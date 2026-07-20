import { describe, expect, it, vi } from 'vitest';
import { OverworldWorldStreamingController } from './worldStreaming';

vi.mock('phaser', () => ({ default: {} }));

interface DynamicOverlayFallbackHarness {
  loadGeneration: number;
  destroyed: boolean;
  compactWorldActive: boolean;
  chunkWindowRequestInFlight: boolean;
  startupDynamicOverlayGeneration: number;
  fullPreviewUpgradeGeneration: number;
  legacyCompactRefreshGeneration: number;
  legacyCompactRefreshScheduled: boolean;
  worldTileController: { isBrowseCutoverActive: () => boolean };
  refreshAround: ReturnType<typeof vi.fn>;
  getFocusCoordinates: () => { x: number; y: number };
  handleDynamicOverlayReadinessStopped: (generation: number) => void;
  maybeStartLegacyCompactRefresh: () => void;
}

interface DynamicSnapshotGateHarness {
  loadGeneration: number;
  destroyed: boolean;
  compactWorldActive: boolean;
  startupDynamicOverlayGeneration: number;
  fullPreviewUpgradeGeneration: number;
  dynamicOverlayRetryAttempt: number;
  worldTileController: { isBrowseCutoverActive: () => boolean };
  waitForDynamicOverlayTargetLod: ReturnType<typeof vi.fn>;
  handleDynamicOverlayReadinessStopped: ReturnType<typeof vi.fn>;
  getFocusCoordinates: () => { x: number; y: number };
  getNearestPreviewRoomIds: ReturnType<typeof vi.fn>;
  getRenderedPreviewRoomIds: ReturnType<typeof vi.fn>;
  getPreviewSnapshotDetail: () => 'full';
  previewCache: {
    ensureRoomSnapshotsBatch: ReturnType<typeof vi.fn>;
    collectRenderableRooms: ReturnType<typeof vi.fn>;
  };
  previewRenderer: { mergeChunkPreviews: ReturnType<typeof vi.fn> };
  collectPreviewRooms: ReturnType<typeof vi.fn>;
  loadDistantPreviewsProgressively: (
    generation: number,
    roomCandidates: Map<string, unknown>,
    previewRoomIds: Set<string>,
    fullRoomIds: Set<string>,
    detail: 'full',
    requireTiledCutover?: boolean,
  ) => Promise<void>;
  requestFullPreviewUpgradeIfNeeded: (
    roomCandidates: Map<string, unknown>,
    previewRoomIds: Set<string>,
    fullRoomIds: Set<string>,
  ) => void;
}

interface ChangedCompactChunkHarness {
  loadGeneration: number;
  destroyed: boolean;
  compactWorldActive: boolean;
  chunkWindowRequestInFlight: boolean;
  loadedChunkBounds: {
    minChunkX: number;
    maxChunkX: number;
    minChunkY: number;
    maxChunkY: number;
  };
  chunkWindow: object;
  dynamicOverlayReadinessGeneration: number;
  dynamicOverlayReadinessAbortController: AbortController | null;
  legacyCompactRefreshGeneration: number;
  options: {
    worldRepository: {
      loadCompactWorldChunkWindow: ReturnType<typeof vi.fn>;
    };
  };
  getDesiredChunkBounds: ReturnType<typeof vi.fn>;
  haveChunkPreviewHashesChanged: ReturnType<typeof vi.fn>;
  applyChunkWindow: ReturnType<typeof vi.fn>;
  refreshVisibleRoomsFromCache: ReturnType<typeof vi.fn>;
  refreshLoadedChunksIfChanged: (coordinates: { x: number; y: number }) => Promise<string>;
}

function deferredBoolean(): {
  promise: Promise<boolean>;
  resolve: (value: boolean) => void;
} {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('world streaming dynamic-overlay fallback', () => {
  it('re-enters the real compact refresh path once the current request releases', async () => {
    const refreshAround = vi.fn(async () => 'success');
    const controller = Object.create(
      OverworldWorldStreamingController.prototype,
    ) as DynamicOverlayFallbackHarness;
    Object.assign(controller, {
      loadGeneration: 7,
      destroyed: false,
      compactWorldActive: true,
      chunkWindowRequestInFlight: true,
      startupDynamicOverlayGeneration: 7,
      fullPreviewUpgradeGeneration: 7,
      legacyCompactRefreshGeneration: -1,
      legacyCompactRefreshScheduled: false,
      worldTileController: { isBrowseCutoverActive: () => false },
      refreshAround,
      getFocusCoordinates: () => ({ x: 3, y: -2 }),
    });

    controller.handleDynamicOverlayReadinessStopped(7);
    expect(controller.startupDynamicOverlayGeneration).toBe(-1);
    expect(controller.fullPreviewUpgradeGeneration).toBe(-1);
    expect(controller.legacyCompactRefreshGeneration).toBe(7);
    expect(refreshAround).not.toHaveBeenCalled();

    controller.chunkWindowRequestInFlight = false;
    controller.maybeStartLegacyCompactRefresh();
    await Promise.resolve();

    expect(controller.legacyCompactRefreshGeneration).toBe(-1);
    expect(refreshAround).toHaveBeenCalledOnce();
    expect(refreshAround).toHaveBeenCalledWith({ x: 3, y: -2 });

    controller.maybeStartLegacyCompactRefresh();
    await Promise.resolve();
    expect(refreshAround).toHaveBeenCalledOnce();
  });

  it('does not clear or restart an obsolete streaming generation', async () => {
    const refreshAround = vi.fn(async () => 'success');
    const controller = Object.create(
      OverworldWorldStreamingController.prototype,
    ) as DynamicOverlayFallbackHarness;
    Object.assign(controller, {
      loadGeneration: 8,
      destroyed: false,
      compactWorldActive: true,
      chunkWindowRequestInFlight: false,
      startupDynamicOverlayGeneration: 8,
      fullPreviewUpgradeGeneration: 8,
      legacyCompactRefreshGeneration: -1,
      legacyCompactRefreshScheduled: false,
      worldTileController: { isBrowseCutoverActive: () => false },
      refreshAround,
      getFocusCoordinates: () => ({ x: 0, y: 0 }),
    });

    controller.handleDynamicOverlayReadinessStopped(7);
    await Promise.resolve();

    expect(controller.startupDynamicOverlayGeneration).toBe(8);
    expect(controller.fullPreviewUpgradeGeneration).toBe(8);
    expect(refreshAround).not.toHaveBeenCalled();
  });

  it('keeps distant tiled snapshot batches dormant until target LOD is sharp', async () => {
    const sharp = deferredBoolean();
    const ensureRoomSnapshotsBatch = vi.fn(async () => {});
    const controller = Object.create(
      OverworldWorldStreamingController.prototype,
    ) as DynamicSnapshotGateHarness;
    Object.assign(controller, {
      loadGeneration: 7,
      destroyed: false,
      compactWorldActive: true,
      startupDynamicOverlayGeneration: 7,
      fullPreviewUpgradeGeneration: 7,
      dynamicOverlayRetryAttempt: 0,
      worldTileController: { isBrowseCutoverActive: () => true },
      waitForDynamicOverlayTargetLod: vi.fn(() => sharp.promise),
      handleDynamicOverlayReadinessStopped: vi.fn(),
      getFocusCoordinates: () => ({ x: 0, y: 0 }),
      getNearestPreviewRoomIds: vi.fn(() => new Set<string>()),
      getRenderedPreviewRoomIds: vi.fn((_rooms, ids: Set<string>) => new Set(ids)),
      previewCache: {
        ensureRoomSnapshotsBatch,
        collectRenderableRooms: vi.fn(async () => new Map()),
      },
      previewRenderer: { mergeChunkPreviews: vi.fn() },
      collectPreviewRooms: vi.fn(() => []),
    });
    const roomCandidates = new Map<string, unknown>([
      ['far', { coordinates: { x: 12, y: 0 } }],
    ]);

    const loadPromise = controller.loadDistantPreviewsProgressively(
      7,
      roomCandidates,
      new Set(['far']),
      new Set(),
      'full',
    );
    await Promise.resolve();
    expect(ensureRoomSnapshotsBatch).not.toHaveBeenCalled();

    sharp.resolve(true);
    await loadPromise;
    expect(ensureRoomSnapshotsBatch).toHaveBeenCalledOnce();

    controller.worldTileController = { isBrowseCutoverActive: () => false };
    ensureRoomSnapshotsBatch.mockClear();
    controller.handleDynamicOverlayReadinessStopped.mockClear();
    await controller.loadDistantPreviewsProgressively(
      7,
      roomCandidates,
      new Set(['far']),
      new Set(),
      'full',
      true,
    );
    expect(ensureRoomSnapshotsBatch).not.toHaveBeenCalled();
    expect(controller.handleDynamicOverlayReadinessStopped).toHaveBeenCalledWith(7);

    await controller.loadDistantPreviewsProgressively(
      7,
      roomCandidates,
      new Set(['far']),
      new Set(),
      'full',
      false,
    );
    expect(ensureRoomSnapshotsBatch).toHaveBeenCalledOnce();
  });

  it('keeps full-detail upgrade snapshots dormant until target LOD is sharp', async () => {
    const sharp = deferredBoolean();
    const ensureRoomSnapshotsBatch = vi.fn(async () => {});
    const loadDistantPreviewsProgressively = vi.fn(async () => {});
    const controller = Object.create(
      OverworldWorldStreamingController.prototype,
    ) as DynamicSnapshotGateHarness;
    Object.assign(controller, {
      loadGeneration: 7,
      destroyed: false,
      compactWorldActive: true,
      startupDynamicOverlayGeneration: -1,
      fullPreviewUpgradeGeneration: -1,
      dynamicOverlayRetryAttempt: 0,
      worldTileController: { isBrowseCutoverActive: () => true },
      waitForDynamicOverlayTargetLod: vi.fn(() => sharp.promise),
      handleDynamicOverlayReadinessStopped: vi.fn(),
      getFocusCoordinates: () => ({ x: 0, y: 0 }),
      getNearestPreviewRoomIds: vi.fn(() => new Set(['near'])),
      getRenderedPreviewRoomIds: vi.fn((_rooms, ids: Set<string>) => new Set(ids)),
      getPreviewSnapshotDetail: () => 'full',
      previewCache: {
        ensureRoomSnapshotsBatch,
        collectRenderableRooms: vi.fn(async () => new Map()),
      },
      previewRenderer: { mergeChunkPreviews: vi.fn() },
      collectPreviewRooms: vi.fn(() => []),
      loadDistantPreviewsProgressively,
      cancelDynamicOverlayRetry: vi.fn(),
    });
    const roomCandidates = new Map<string, unknown>([
      ['near', { coordinates: { x: 1, y: 0 } }],
    ]);

    controller.requestFullPreviewUpgradeIfNeeded(
      roomCandidates,
      new Set(['near']),
      new Set(),
    );
    await Promise.resolve();
    expect(ensureRoomSnapshotsBatch).not.toHaveBeenCalled();

    sharp.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(ensureRoomSnapshotsBatch).toHaveBeenCalledOnce();
    expect(loadDistantPreviewsProgressively).toHaveBeenCalledOnce();
  });

  it('starts a fresh readiness generation before applying changed compact chunks', async () => {
    const chunkBounds = {
      minChunkX: 0,
      maxChunkX: 0,
      minChunkY: 0,
      maxChunkY: 0,
    };
    const roomBounds = { minX: 0, maxX: 7, minY: 0, maxY: 7 };
    const compactWindow = {
      chunkBounds,
      roomBounds,
      chunks: [{
        id: '0,0',
        coordinates: { x: 0, y: 0 },
        roomBounds,
        chunkPreviewHash: 'changed',
        rooms: [{
          id: '1,1',
          coordinates: { x: 1, y: 1 },
          title: null,
          state: 'claimed_unpublished',
          background: null,
          goalType: null,
          version: null,
          publishedAt: null,
          previewUpdatedAt: '2026-07-19T00:00:00.000Z',
          creatorUserId: 'builder',
          creatorDisplayName: 'Builder',
          publishedByUserId: null,
          publishedByDisplayName: null,
          course: null,
          expandedRoom: null,
        }],
      }],
    };
    const refreshVisibleRoomsFromCache = vi.fn();
    const controller = Object.create(
      OverworldWorldStreamingController.prototype,
    ) as ChangedCompactChunkHarness;
    Object.assign(controller, {
      loadGeneration: 7,
      destroyed: false,
      compactWorldActive: true,
      chunkWindowRequestInFlight: false,
      loadedChunkBounds: chunkBounds,
      chunkWindow: {},
      dynamicOverlayReadinessGeneration: 7,
      dynamicOverlayReadinessAbortController: new AbortController(),
      legacyCompactRefreshGeneration: -1,
      options: {
        worldRepository: {
          loadCompactWorldChunkWindow: vi.fn(async () => compactWindow),
        },
      },
      getDesiredChunkBounds: vi.fn(() => chunkBounds),
      haveChunkPreviewHashesChanged: vi.fn(() => true),
      applyChunkWindow: vi.fn(),
      refreshVisibleRoomsFromCache,
    });

    await expect(controller.refreshLoadedChunksIfChanged({ x: 1, y: 1 }))
      .resolves.toBe('updated');

    expect(controller.loadGeneration).toBe(8);
    expect(controller.dynamicOverlayReadinessGeneration).toBe(8);
    expect(controller.dynamicOverlayReadinessAbortController).not.toBeNull();
    expect(controller.dynamicOverlayReadinessAbortController?.signal.aborted).toBe(false);
    expect(refreshVisibleRoomsFromCache).toHaveBeenCalledOnce();
  });
});
