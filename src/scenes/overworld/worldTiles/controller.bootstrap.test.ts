import type Phaser from 'phaser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldRepository } from '../../../persistence/worldRepository';
import { WorldTileClientController } from './controller';
import { WORLD_TILE_COVERAGE_TIMEOUT_MS } from './retryFallback';
import type {
  WorldTileBounds,
  WorldTileConfig,
  WorldTileLevel,
  WorldTileManifest,
} from './types';

vi.mock('./phaserLayer', () => ({
  decodeWorldTileBlob: vi.fn(),
  WorldTilePhaserLayer: class MockWorldTilePhaserLayer {
    installDecoded(): boolean { return true; }
    hasGpuTexture(): boolean { return false; }
    syncDisplay(): void {}
    getImages(): never[] { return []; }
    getBackdropIgnoredObjects(): never[] { return []; }
    getAttachedAddressKeys(): string[] { return []; }
    clearDisplay(): void {}
    discardGpuTexturesForContextRestore(): void {}
    destroy(): void {}
  },
}));

const rendererVersion = 'renderer-bootstrap-v1';
const config: WorldTileConfig = {
  schemaVersion: 1,
  available: true,
  rolloutPercentage: 100,
  activeRendererVersion: rendererVersion,
};

describe('world tile controller bootstrap ownership', () => {
  beforeEach(() => {
    installBrowserGlobals('?worldTiles=force', async () => ({ quota: 512 * 1_024 * 1_024 }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives ensureInitialCoverage sole ownership of L0 across the prepare handoff and reset', async () => {
    let resolveConfig!: (value: WorldTileConfig) => void;
    let resolveQuota!: (value: StorageEstimate) => void;
    const loadWorldTileConfig = vi.fn(() => new Promise<WorldTileConfig>((resolve) => {
      resolveConfig = resolve;
    }));
    const estimate = vi.fn(() => new Promise<StorageEstimate>((resolve) => {
      resolveQuota = resolve;
    }));
    installBrowserGlobals('?worldTiles=force', estimate);
    const loadWorldTileManifest = vi.fn<WorldRepository['loadWorldTileManifest']>(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => readyEmptyManifest(level, bounds));
    const controller = createController({ loadWorldTileConfig, loadWorldTileManifest });
    const camera = createCamera();

    const preparePromise = controller.prepare();
    controller.update(camera);
    expect(loadWorldTileManifest).not.toHaveBeenCalled();

    resolveConfig(config);
    await flushMicrotasks();
    expect(estimate).toHaveBeenCalledOnce();
    controller.update(camera);
    expect(loadWorldTileManifest).not.toHaveBeenCalled();

    resolveQuota({ quota: 512 * 1_024 * 1_024 });
    await expect(preparePromise).resolves.toBe(true);

    // This is the real race window: prepare is resolved, renderer/cache state is
    // ready, but the startup coordinator has not called ensure yet.
    controller.update(camera);
    controller.prefetchRoom({ x: 0, y: 0 }, 'selection');
    expect(loadWorldTileManifest).not.toHaveBeenCalled();

    await expect(controller.ensureInitialCoverage(camera)).resolves.toBe(true);
    expect(levelCalls(loadWorldTileManifest, 0)).toHaveLength(1);
    expect(levelCalls(loadWorldTileManifest, 0)[0]?.[2]).toMatchObject({
      includeRooms: false,
      signal: expect.any(AbortSignal),
    });

    controller.update(camera);
    await flushMicrotasks();
    expect(levelCalls(loadWorldTileManifest, 4).length).toBeGreaterThan(0);

    loadWorldTileManifest.mockClear();
    loadWorldTileConfig.mockResolvedValue(config);
    estimate.mockResolvedValue({ quota: 512 * 1_024 * 1_024 });
    controller.reset();
    await expect(controller.prepare()).resolves.toBe(true);
    controller.update(camera);
    expect(loadWorldTileManifest).not.toHaveBeenCalled();

    await expect(controller.ensureInitialCoverage(camera)).resolves.toBe(true);
    expect(levelCalls(loadWorldTileManifest, 0)).toHaveLength(1);
    controller.destroy();
  });

  it('awaits and consumes the validated early L0 handoff without issuing a second manifest', async () => {
    let resolveEarlyReady!: (value: unknown) => void;
    const earlyReady = new Promise<unknown>((resolve) => {
      resolveEarlyReady = resolve;
    });
    const early = installEarlyCoverageHandle(earlyReady);
    const loadWorldTileManifest = vi.fn<WorldRepository['loadWorldTileManifest']>(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => readyEmptyManifest(level, bounds));
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });
    const camera = createCamera();

    await expect(controller.prepare()).resolves.toBe(true);
    const coveragePromise = controller.ensureInitialCoverage(camera);
    await flushMicrotasks();
    expect(loadWorldTileManifest).not.toHaveBeenCalled();
    expect(early.consumeCoverage).not.toHaveBeenCalled();

    resolveEarlyReady(earlyBootstrapState('visible', rendererVersion));
    await expect(coveragePromise).resolves.toBe(true);
    expect(loadWorldTileManifest).not.toHaveBeenCalled();
    expect(early.consumeCoverage).toHaveBeenCalledOnce();
    expect(early.consumeCoverage.mock.calls[0]?.[0]).toMatchObject({
      schemaVersion: 1,
      consumerGeneration: 0,
      rendererVersion,
      level: 0,
      targetBounds: { minTileX: 0, maxTileX: 0, minTileY: 0, maxTileY: 0 },
    });
    expect(early.release).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('does not let an aborted lifecycle consume a late early handoff', async () => {
    let resolveEarlyReady!: (value: unknown) => void;
    const earlyReady = new Promise<unknown>((resolve) => {
      resolveEarlyReady = resolve;
    });
    const early = installEarlyCoverageHandle(earlyReady);
    const loadWorldTileManifest = vi.fn<WorldRepository['loadWorldTileManifest']>(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => readyEmptyManifest(level, bounds));
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });
    const camera = createCamera();

    await controller.prepare();
    const staleCoverage = controller.ensureInitialCoverage(camera);
    await flushMicrotasks();
    controller.reset();
    await expect(staleCoverage).resolves.toBe(false);
    expect(early.consumeCoverage).not.toHaveBeenCalled();
    expect(loadWorldTileManifest).not.toHaveBeenCalled();

    await controller.prepare();
    const currentCoverage = controller.ensureInitialCoverage(camera);
    resolveEarlyReady(earlyBootstrapState('visible', rendererVersion));
    await expect(currentCoverage).resolves.toBe(true);
    expect(early.consumeCoverage).toHaveBeenCalledOnce();
    expect(early.consumeCoverage.mock.calls[0]?.[0].consumerGeneration).toBe(1);
    expect(loadWorldTileManifest).not.toHaveBeenCalled();
    controller.destroy();
  });

  it.each([
    ['failed bootstrap', earlyBootstrapState('failed', rendererVersion), false],
    ['renderer mismatch', earlyBootstrapState('visible', 'old-renderer'), false],
    ['invalid returned bounds', earlyBootstrapState('visible', rendererVersion), true],
  ])('falls back to the normal L0 request for %s', async (_label, state, returnInvalid) => {
    const early = installEarlyCoverageHandle(Promise.resolve(state), returnInvalid
      ? (request) => ({
          schemaVersion: 1,
          bootstrapGeneration: 1,
          consumerGeneration: request.consumerGeneration,
          manifest: readyEmptyManifest(0, { ...request.targetBounds, maxTileX: request.targetBounds.maxTileX + 1 }),
        })
      : undefined);
    const loadWorldTileManifest = vi.fn<WorldRepository['loadWorldTileManifest']>(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => readyEmptyManifest(level, bounds));
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });

    await controller.prepare();
    await expect(controller.ensureInitialCoverage(createCamera())).resolves.toBe(true);
    expect(levelCalls(loadWorldTileManifest, 0)).toHaveLength(1);
    expect(levelCalls(loadWorldTileManifest, 0)[0]?.[2]).toMatchObject({
      includeRooms: false,
      signal: expect.any(AbortSignal),
    });
    if (returnInvalid) expect(early.consumeCoverage).toHaveBeenCalledOnce();
    else expect(early.consumeCoverage).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('falls back to the normal L0 request when early bootstrap readiness rejects', async () => {
    const early = installEarlyCoverageHandle(Promise.reject(new Error('early-bootstrap-failed')));
    const loadWorldTileManifest = vi.fn<WorldRepository['loadWorldTileManifest']>(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => readyEmptyManifest(level, bounds));
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });

    await controller.prepare();
    await expect(controller.ensureInitialCoverage(createCamera())).resolves.toBe(true);
    expect(levelCalls(loadWorldTileManifest, 0)).toHaveLength(1);
    expect(early.consumeCoverage).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('activates sticky coverage fallback when early bootstrap readiness never settles', async () => {
    vi.useFakeTimers();
    const early = installEarlyCoverageHandle(new Promise(() => {}));
    const loadWorldTileManifest = vi.fn<WorldRepository['loadWorldTileManifest']>(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => readyEmptyManifest(level, bounds));
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });

    await controller.prepare();
    const camera = createCamera();
    const coveragePromise = controller.ensureInitialCoverage(camera);
    await flushMicrotasks();
    expect(loadWorldTileManifest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WORLD_TILE_COVERAGE_TIMEOUT_MS);
    await expect(coveragePromise).resolves.toBe(false);
    expect(early.consumeCoverage).not.toHaveBeenCalled();
    expect(loadWorldTileManifest).not.toHaveBeenCalled();
    controller.update(camera);
    expect(controller.getDebugSnapshot().fallbackReason).toBe('coverage-timeout');
    controller.destroy();
  });

  it('holds refinement during shadow bootstrap and resumes only after L0 settles', async () => {
    let resolveInitialManifest!: (manifest: WorldTileManifest) => void;
    installBrowserGlobals('?worldTiles=shadow', async () => ({ quota: 512 * 1_024 * 1_024 }));
    const loadWorldTileManifest = vi.fn((level: WorldTileLevel, bounds: WorldTileBounds) => {
      if (level !== 0) return Promise.resolve(readyEmptyManifest(level, bounds));
      return new Promise<WorldTileManifest>((resolve) => {
        resolveInitialManifest = resolve;
      });
    });
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });
    const camera = createCamera();

    await expect(controller.prepare()).resolves.toBe(true);
    expect(controller.isShadowMode()).toBe(true);
    const coveragePromise = controller.ensureInitialCoverage(camera);
    await flushMicrotasks();
    expect(levelCalls(loadWorldTileManifest, 0)).toHaveLength(1);

    controller.update(camera);
    controller.prefetchRoom({ x: 0, y: 0 }, 'selection');
    expect(loadWorldTileManifest).toHaveBeenCalledOnce();

    resolveInitialManifest(readyEmptyManifest(0, manifestBounds(loadWorldTileManifest, 0)));
    await expect(coveragePromise).resolves.toBe(true);
    controller.update(camera);
    await flushMicrotasks();
    expect(levelCalls(loadWorldTileManifest, 4).length).toBeGreaterThan(0);
    controller.destroy();
  });

  it('retains room summaries for targeted L4 mutation convergence', async () => {
    const loadWorldTileManifest = vi.fn<WorldRepository['loadWorldTileManifest']>(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => readyEmptyManifest(level, bounds));
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });
    const camera = createCamera();

    await controller.prepare();
    await controller.ensureInitialCoverage(camera);
    loadWorldTileManifest.mockClear();
    controller.prefetchRoom({ x: 3, y: -2 }, 'mutation');
    await flushMicrotasks();

    expect(loadWorldTileManifest).toHaveBeenCalledOnce();
    expect(loadWorldTileManifest.mock.calls[0]).toMatchObject([
      4,
      { minTileX: 3, maxTileX: 3, minTileY: -2, maxTileY: -2 },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(loadWorldTileManifest.mock.calls[0]?.[2]?.includeRooms).toBeUndefined();
    controller.destroy();
  });

  it('does not resolve target readiness from coarse L0 when the camera requires sharp L1', async () => {
    let nowMs = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const loadWorldTileManifest = vi.fn(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => readyEmptyManifest(level, bounds));
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });
    const camera = createCamera();
    camera.zoom = 0.18;

    await expect(controller.prepare()).resolves.toBe(true);
    await expect(controller.ensureInitialCoverage(camera)).resolves.toBe(true);
    expect(levelCalls(loadWorldTileManifest, 0)).toHaveLength(1);

    let sharpReady = false;
    const sharpPromise = controller.waitForTargetLodReady(camera);
    void sharpPromise.then(() => { sharpReady = true; });
    await flushMicrotasks();
    expect(sharpReady).toBe(false);

    controller.update(camera);
    await flushMicrotasks();
    expect(levelCalls(loadWorldTileManifest, 1)).toHaveLength(1);
    expect(levelCalls(loadWorldTileManifest, 1)[0]?.[2]).toMatchObject({
      includeRooms: false,
      signal: expect.any(AbortSignal),
    });
    expect(sharpReady).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    nowMs += 81;
    controller.update(camera);
    await flushMicrotasks();
    const sharpSnapshot = controller.getDebugSnapshot();
    expect(sharpSnapshot).toMatchObject({
      committedLevel: 1,
      targetCoveragePercentage: 100,
    });
    expect(sharpReady).toBe(true);
    await expect(sharpPromise).resolves.toBe(true);
    controller.destroy();
  });

  it('settles pending target readiness false on abort, reset, and destroy without leaks', async () => {
    const loadWorldTileManifest = vi.fn(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => readyEmptyManifest(level, bounds));
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });
    const camera = createCamera();
    camera.zoom = 0.18;

    await controller.prepare();
    await controller.ensureInitialCoverage(camera);
    const abortController = new AbortController();
    const abortedWait = controller.waitForTargetLodReady(camera, abortController.signal);
    abortController.abort();
    await expect(abortedWait).resolves.toBe(false);
    expect(getTargetLodWaiterCount(controller)).toBe(0);

    const resetWait = controller.waitForTargetLodReady(camera);
    controller.reset();
    await expect(resetWait).resolves.toBe(false);
    expect(getTargetLodWaiterCount(controller)).toBe(0);

    const destroyWait = controller.waitForTargetLodReady(camera);
    controller.destroy();
    await expect(destroyWait).resolves.toBe(false);
    expect(getTargetLodWaiterCount(controller)).toBe(0);
  });

  it('settles pending target readiness false when manifest fallback becomes sticky', async () => {
    const loadWorldTileManifest = vi.fn(async (
      level: WorldTileLevel,
      bounds: WorldTileBounds,
    ) => level === 0 ? readyEmptyManifest(level, bounds) : null);
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });
    const camera = createCamera();
    camera.zoom = 0.18;

    await controller.prepare();
    await controller.ensureInitialCoverage(camera);
    const sharpPromise = controller.waitForTargetLodReady(camera);
    controller.update(camera);
    await flushMicrotasks();

    await expect(sharpPromise).resolves.toBe(false);
    controller.update(camera);
    expect(controller.getDebugSnapshot().fallbackReason).toBe('manifest-incompatible');
    controller.destroy();
  });

  it('does not reopen refinement after an initial-coverage timeout activates fallback', async () => {
    vi.useFakeTimers();
    const loadWorldTileManifest = vi.fn((
      _level: WorldTileLevel,
      _bounds: WorldTileBounds,
      options?: Parameters<WorldRepository['loadWorldTileManifest']>[2],
    ) => new Promise<WorldTileManifest>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    }));
    const controller = createController({
      loadWorldTileConfig: vi.fn(async () => config),
      loadWorldTileManifest,
    });
    const camera = createCamera();

    await expect(controller.prepare()).resolves.toBe(true);
    const coveragePromise = controller.ensureInitialCoverage(camera);
    await flushMicrotasks();
    expect(levelCalls(loadWorldTileManifest, 0)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(WORLD_TILE_COVERAGE_TIMEOUT_MS);
    await expect(coveragePromise).resolves.toBe(false);

    controller.update(camera);
    controller.prefetchRoom({ x: 0, y: 0 }, 'selection');
    expect(loadWorldTileManifest).toHaveBeenCalledOnce();
    expect(controller.getDebugSnapshot().fallbackReason).toBe('coverage-timeout');
    controller.destroy();
  });
});

function createController(input: {
  loadWorldTileConfig: WorldRepository['loadWorldTileConfig'];
  loadWorldTileManifest: WorldRepository['loadWorldTileManifest'];
}): WorldTileClientController {
  const repository = {
    loadWorldTileConfig: input.loadWorldTileConfig,
    loadWorldTileManifest: input.loadWorldTileManifest,
  } as unknown as WorldRepository;
  const scene = {
    sys: { game: { canvas: null } },
    cameras: { main: createCamera() },
  } as unknown as Phaser.Scene;
  return new WorldTileClientController({
    scene,
    repository,
    getMode: () => 'browse',
    getPerformanceProfile: () => 'default',
    getSelectedCoordinates: () => ({ x: 0, y: 0 }),
  });
}

function createCamera(): Phaser.Cameras.Scene2D.Camera {
  return {
    zoom: 1,
    width: 640,
    height: 352,
    scrollX: 0,
    scrollY: 0,
    originX: 0.5,
    originY: 0.5,
  } as Phaser.Cameras.Scene2D.Camera;
}

function getTargetLodWaiterCount(controller: WorldTileClientController): number {
  return (controller as unknown as {
    targetLodReadyWaiters: ReadonlySet<unknown>;
  }).targetLodReadyWaiters.size;
}

function readyEmptyManifest(level: WorldTileLevel, bounds: WorldTileBounds): WorldTileManifest {
  const entries: WorldTileManifest['entries'] = [];
  const entryBounds = level === 0 ? bounds : {
    minTileX: Math.floor(bounds.minTileX / 2) * 2,
    maxTileX: Math.floor(bounds.maxTileX / 2) * 2 + 1,
    minTileY: Math.floor(bounds.minTileY / 2) * 2,
    maxTileY: Math.floor(bounds.maxTileY / 2) * 2 + 1,
  };
  for (let y = entryBounds.minTileY; y <= entryBounds.maxTileY; y += 1) {
    for (let x = entryBounds.minTileX; x <= entryBounds.maxTileX; x += 1) {
      entries.push({
        address: { rendererVersion, level, x, y },
        desiredGeneration: 1,
        desiredEmpty: true,
        readyEmptyGeneration: 1,
        ready: null,
        staleRoomIds: [],
      });
    }
  }
  return {
    schemaVersion: 1,
    rendererVersion,
    level,
    targetBounds: { ...bounds },
    entries,
    rooms: [],
  };
}

function manifestBounds(
  load: ReturnType<typeof vi.fn<WorldRepository['loadWorldTileManifest']>>,
  level: WorldTileLevel,
): WorldTileBounds {
  const call = levelCalls(load, level)[0];
  if (!call) throw new Error(`Expected a level ${level} manifest call.`);
  return call[1];
}

function levelCalls(
  load: ReturnType<typeof vi.fn<WorldRepository['loadWorldTileManifest']>>,
  level: WorldTileLevel,
): Parameters<WorldRepository['loadWorldTileManifest']>[] {
  return load.mock.calls.filter((call) => call[0] === level);
}

interface EarlyCoverageRequestForTest {
  schemaVersion: 1;
  consumerGeneration: number;
  rendererVersion: string;
  level: 0;
  targetBounds: WorldTileBounds;
}

function installEarlyCoverageHandle(
  ready: Promise<unknown>,
  createHandoff?: (request: EarlyCoverageRequestForTest) => unknown,
): {
  consumeCoverage: ReturnType<typeof vi.fn<(request: EarlyCoverageRequestForTest) => unknown>>;
  release: ReturnType<typeof vi.fn>;
} {
  let consumed = false;
  const consumeCoverage = vi.fn((request: EarlyCoverageRequestForTest) => {
    if (consumed) return null;
    const handoff = createHandoff?.(request) ?? {
      schemaVersion: 1,
      bootstrapGeneration: 1,
      consumerGeneration: request.consumerGeneration,
      manifest: readyEmptyManifest(0, request.targetBounds),
    };
    if (handoff) consumed = true;
    return handoff;
  });
  const release = vi.fn();
  (window as Window).__wampEarlyWorldTiles = {
    schemaVersion: 1,
    ready,
    getState: vi.fn(),
    consumeCoverage,
    alignToGameContainer: vi.fn(),
    release,
  } as unknown as NonNullable<Window['__wampEarlyWorldTiles']>;
  return { consumeCoverage, release };
}

function earlyBootstrapState(status: 'visible' | 'ready-shadow' | 'failed', version: string): unknown {
  return { status, rendererVersion: version };
}

function installBrowserGlobals(
  search: string,
  estimate: () => Promise<StorageEstimate>,
): void {
  const storage = {
    getItem: () => 'controller-bootstrap-cohort',
    setItem: () => {},
  };
  vi.stubGlobal('window', {
    location: { search },
    localStorage: storage,
  });
  vi.stubGlobal('navigator', { storage: { estimate } });
  vi.stubGlobal('document', { hidden: false });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
