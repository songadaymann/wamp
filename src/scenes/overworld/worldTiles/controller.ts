import type Phaser from 'phaser';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { WorldRepository } from '../../../persistence/worldRepository';
import type { PerformanceProfile } from '../../../ui/deviceLayout';
import type { OverworldMode } from '../../sceneData';
import {
  shouldScheduleWorldTileRequest,
  type WorldTileRequestKind,
} from './bootstrapPriority';
import { WorldTileByteCache } from './byteCache';
import { type WorldTileAvailability } from './coverage';
import {
  isWorldTileTargetReplacementComplete,
  resolveWorldTileDisplayPlan,
  shouldUseWorldTileBrowseCutover,
} from './displayPlan';
import {
  enumerateWorldTileBounds,
  roomToWorldTileCoordinate,
  worldRectToTileBounds,
} from './geometry';
import {
  getWorldTileManifestRendererRole,
  parseWorldTileManifest,
  WorldTileManifestCompatibilityError,
} from './manifest';
import { WorldTileManifestLoader } from './manifestLoader';
import { WorldTileDebugMetricsTracker, type WorldTileDebugMetrics } from './metrics';
import { decodeWorldTileBlob, type DecodedWorldTileSource, WorldTilePhaserLayer } from './phaserLayer';
import { WorldTileRoomManifestPrefetcher } from './roomPrefetcher';
import {
  CorruptWorldTileRetryTracker,
  getWorldTileRetryDelayMs,
  WORLD_TILE_COVERAGE_TIMEOUT_MS,
  WorldTileFallbackController,
} from './retryFallback';
import { decideWorldTileRollout, getOrCreateWorldTileCohortId, type WorldTileRolloutDecision } from './rollout';
import {
  getGpuWorldTileByteBudget,
  getPersistentWorldTileByteBudget,
  getWorldTileStreamingBudgets,
  ManifestRefreshSchedule,
  rankWorldTileRequests,
  reconcileWorldTileQueuedTasks,
  type WorldTileRequestCandidate,
} from './scheduler';
import { selectWorldTileDisplayLevel, selectWorldTileLevel } from './lod';
import type {
  WorldRect,
  WorldTileAddress,
  WorldTileBounds,
  WorldTileLevel,
  WorldTileManifest,
  WorldTileManifestEntry,
} from './types';
import { worldTileAddressKey } from './types';
import {
  calculateDirectionalGuardRect,
  clampWorldTileManifestBounds,
  getWorldTileAncestorClosure,
  getWorldTileSiblingClosure,
} from './viewport';
import { orderWorldTilesForContextRestoration } from './restoration';

interface WorldTileClientControllerOptions {
  scene: Phaser.Scene;
  repository: WorldRepository;
  getMode: () => OverworldMode;
  getPerformanceProfile: () => PerformanceProfile;
  getSelectedCoordinates: () => RoomCoordinates;
  onObjectsChanged?: () => void;
  onCoverageChanged?: () => void;
  onCanonicalRoomReady?: (roomId: string) => void;
}

interface FetchTask {
  entry: WorldTileManifestEntry;
  forceNetwork: boolean;
  taskKey: string;
  retainAcrossCoverage: boolean;
  lifecycleEpoch: number;
}

interface DecodeTask {
  entry: WorldTileManifestEntry;
  blob: Blob;
  taskKey: string;
  retainAcrossCoverage: boolean;
  lifecycleEpoch: number;
}

interface UploadTask {
  entry: WorldTileManifestEntry;
  source: DecodedWorldTileSource;
  taskKey: string;
  retainAcrossCoverage: boolean;
  lifecycleEpoch: number;
}

interface RetryState {
  failures: number;
  retryAtMs: number;
}

interface TargetLodReadyWaiter {
  camera: Phaser.Cameras.Scene2D.Camera;
  lifecycleEpoch: number;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (ready: boolean) => void;
}

export interface WorldTileClientDebugSnapshot extends WorldTileDebugMetrics {
  enabled: boolean;
  cutoverActive: boolean;
  shadow: boolean;
  forced: boolean;
  rendererVersion: string | null;
  previousRendererVersion: string | null;
  committedLevel: WorldTileLevel;
  cohortBucket: number | null;
  attachedTileCount: number;
  byteCacheHits: number;
  byteCacheMisses: number;
  byteCacheEvictions: number;
  contextRestorePending: boolean;
  targetReadyCount: number;
  targetCoveragePercentage: number;
}

const CAMERA_EPSILON = 0.5;
const WORLD_TILE_CONFIG_REFRESH_MS = 20_000;

export class WorldTileClientController {
  private readonly layer: WorldTilePhaserLayer;
  private readonly manifestLoader: WorldTileManifestLoader;
  private readonly roomManifestPrefetcher: WorldTileRoomManifestPrefetcher;
  private readonly manifestSchedule = new ManifestRefreshSchedule(10);
  private readonly fallback = new WorldTileFallbackController();
  private readonly corruptRetry = new CorruptWorldTileRetryTracker();
  private readonly metrics = new WorldTileDebugMetricsTracker();
  private byteCache: WorldTileByteCache | null = null;
  private preparePromise: Promise<boolean> | null = null;
  private prepareAbortController: AbortController | null = null;
  private initialCoveragePromise: Promise<boolean> | null = null;
  private initialCoverageAbortController: AbortController | null = null;
  // The initial L0 request owns cold-start scheduling from construction through
  // prepare and the prepare/ensure handoff. A promise alone cannot represent
  // that handoff because prepare may resolve one microtask before the startup
  // coordinator calls ensureInitialCoverage().
  private initialCoveragePending = true;
  private requestSchedulingReady = false;
  private rollout: WorldTileRolloutDecision | null = null;
  private activeRendererVersion: string | null = null;
  private previousRendererVersion: string | null = null;
  private entriesByKey = new Map<string, WorldTileManifestEntry>();
  private availabilityByKey = new Map<string, WorldTileAvailability>();
  private fetchQueue: FetchTask[] = [];
  private decodeQueue: DecodeTask[] = [];
  private uploadQueue: UploadTask[] = [];
  private queuedFetchKeys = new Set<string>();
  private queuedDecodeKeys = new Set<string>();
  private activeTaskKeys = new Set<string>();
  private stickyTaskKeys = new Set<string>();
  private currentCoverageTaskKeys = new Set<string>();
  private fetchAbortControllersByTaskKey = new Map<string, AbortController>();
  private decodeInFlightTaskKeys = new Map<string, number>();
  private fetchInFlight = 0;
  private decodeInFlight = 0;
  private retriesByKey = new Map<string, RetryState>();
  private committedLevel: WorldTileLevel = 0;
  private desiredLevel: WorldTileLevel = 0;
  private lastZoom: number | null = null;
  private lastGestureAtMs = 0;
  private lastCameraMovementAtMs = 0;
  private lastCameraSample: { x: number; y: number; atMs: number } | null = null;
  private smoothedVelocity = { x: 0, y: 0 };
  private lastCameraSignature = '';
  private pendingManifestRequest: { level: WorldTileLevel; bounds: WorldTileBounds } | null = null;
  private nextManifestRetryAtMs = Number.POSITIVE_INFINITY;
  private manifestFailureCount = 0;
  private nextConfigRefreshAtMs = 0;
  private destroyed = false;
  private lifecycleEpoch = 0;
  private coarseCoverageComplete = false;
  private lastCoverageComplete = false;
  private lastFallbackReason: string | null = null;
  private visibleTargets: WorldTileAddress[] = [];
  private guardTargets: WorldTileAddress[] = [];
  private desiredVisibleTargets: WorldTileAddress[] = [];
  private desiredGuardTargets: WorldTileAddress[] = [];
  private fallbackAncestors: WorldTileAddress[] = [];
  private optimisticRoomVersions = new Map<string, number>();
  private immediateMaskedRoomIds = new Set<string>();
  private selectedPrefetchRoomId: string | null = null;
  private contextRestorePending = false;
  private nextMutationConvergencePollAtMs = 0;
  private targetReadyCount = 0;
  private readonly targetLodReadyWaiters = new Set<TargetLodReadyWaiter>();
  private contextCanvas: HTMLCanvasElement | null = null;
  private readonly handleContextRestored = () => {
    if (this.isRefinementStopped()) return;
    this.contextRestorePending = true;
    this.layer.discardGpuTexturesForContextRestore();
    this.refreshAvailability();
    if (!this.shouldScheduleRequest('context-restoration')) return;
    const addresses = orderWorldTilesForContextRestoration({
      visible: this.visibleTargets,
      fallbackAncestors: this.fallbackAncestors,
      guards: this.guardTargets,
    });
    this.queueAddresses(addresses, true);
  };

  constructor(private readonly options: WorldTileClientControllerOptions) {
    const profile = toTileProfile(options.getPerformanceProfile());
    this.layer = new WorldTilePhaserLayer(
      options.scene,
      getGpuWorldTileByteBudget(profile),
      options.onObjectsChanged,
    );
    this.manifestLoader = new WorldTileManifestLoader(options.repository);
    this.roomManifestPrefetcher = new WorldTileRoomManifestPrefetcher({
      load: (coordinates, signal) => options.repository.loadWorldTileManifest(4, {
        minTileX: coordinates.x,
        maxTileX: coordinates.x,
        minTileY: coordinates.y,
        maxTileY: coordinates.y,
      }, { signal }),
      onManifest: (coordinates, manifest) => this.acceptRoomPrefetchManifest(coordinates, manifest),
      onFailure: (error) => this.handleManifestFailure(error, performance.now()),
      shouldContinue: () => !this.isRefinementStopped(),
      timeoutMs: WORLD_TILE_COVERAGE_TIMEOUT_MS,
    });
  }

  async prepare(): Promise<boolean> {
    if (this.preparePromise) return this.preparePromise;
    this.preparePromise = this.prepareInternal();
    return this.preparePromise;
  }

  async ensureInitialCoverage(camera: Phaser.Cameras.Scene2D.Camera): Promise<boolean> {
    if (this.initialCoveragePromise) return this.initialCoveragePromise;
    const lifecycleEpoch = this.lifecycleEpoch;
    const promise = this.ensureInitialCoverageInternal(camera);
    this.initialCoveragePromise = promise;
    try {
      return await promise;
    } finally {
      if (this.initialCoveragePromise === promise) {
        this.initialCoveragePromise = null;
        this.initialCoverageAbortController = null;
        if (lifecycleEpoch === this.lifecycleEpoch) this.initialCoveragePending = false;
      }
    }
  }

  private async ensureInitialCoverageInternal(camera: Phaser.Cameras.Scene2D.Camera): Promise<boolean> {
    const lifecycleEpoch = this.lifecycleEpoch;
    if (
      !(await this.prepare())
      || lifecycleEpoch !== this.lifecycleEpoch
      || !this.activeRendererVersion
    ) return false;
    if (this.coarseCoverageComplete) return true;
    const startedAtMs = performance.now();
    this.fallback.markCoverageIncomplete(startedAtMs);
    const viewport = getCameraWorldRect(camera);
    const bounds = worldRectToTileBounds(0, viewport);
    const abortController = new AbortController();
    this.initialCoverageAbortController = abortController;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const coverageTimeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        abortController.abort();
        reject(new Error('Initial world tile coverage timed out.'));
      }, WORLD_TILE_COVERAGE_TIMEOUT_MS);
    });
    try {
      const manifest = await Promise.race([
        this.loadInitialCoverageManifest(bounds, lifecycleEpoch, abortController.signal),
        coverageTimeout,
      ]);
      if (
        !manifest
        || abortController.signal.aborted
        || lifecycleEpoch !== this.lifecycleEpoch
        || this.destroyed
      ) return false;
      if (!this.ingestManifest(manifest)) return false;
      const targets = enumerateWorldTileBounds(manifest.rendererVersion, 0, bounds);
      this.visibleTargets = targets;
      this.guardTargets = targets;
      this.desiredVisibleTargets = targets;
      this.desiredGuardTargets = targets;
      this.fallbackAncestors = [];
      this.syncCoverage(startedAtMs);
      await this.loadEntriesImmediately(targets, abortController.signal);
      this.syncCoverage(performance.now());
      return this.coarseCoverageComplete;
    } catch (error) {
      const nowMs = performance.now();
      if (abortController.signal.aborted) {
        this.fallback.evaluate(nowMs);
        this.notifyFallbackChanged();
      } else {
        this.handleManifestFailure(error, nowMs);
      }
      return false;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  private async loadInitialCoverageManifest(
    bounds: WorldTileBounds,
    lifecycleEpoch: number,
    signal: AbortSignal,
  ): Promise<WorldTileManifest | null> {
    const handedOff = hasConsumableEarlyWorldTileCoverage()
      ? await consumeEarlyWorldTileCoverage({
          rendererVersion: this.activeRendererVersion,
          bounds,
          lifecycleEpoch,
          signal,
        })
      : null;
    signal.throwIfAborted();
    if (handedOff) return handedOff;
    return this.options.repository.loadWorldTileManifest(0, bounds, {
      signal,
      includeRooms: false,
    });
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    const nowMs = performance.now();
    if (this.isRefinementStopped()) {
      this.stopRefinementWork();
      this.recordStoppedMetrics();
      this.metrics.recordFrame();
      return;
    }
    if (!this.activeRendererVersion) {
      this.metrics.recordFrame();
      return;
    }
    if (typeof document !== 'undefined' && document.hidden) {
      this.metrics.recordFrame();
      return;
    }
    this.maybePollMutationConvergence(nowMs);
    if (!this.shouldScheduleRequest('viewport-refinement')) {
      this.metrics.recordFrame();
      return;
    }

    const viewport = getCameraWorldRect(camera);
    this.updateCameraMotion(viewport, camera.zoom, nowMs);
    const lod = selectWorldTileLevel(camera.zoom, this.desiredLevel);
    this.desiredLevel = lod.level;
    const desiredCoverage = this.calculateCoverage(viewport, this.desiredLevel);
    const displayCoverage = this.desiredLevel === this.committedLevel
      ? desiredCoverage
      : this.calculateCoverage(viewport, this.committedLevel);
    this.desiredVisibleTargets = desiredCoverage.visible;
    this.desiredGuardTargets = desiredCoverage.guard;
    this.visibleTargets = displayCoverage.visible;
    this.guardTargets = displayCoverage.guard;
    this.fallbackAncestors = getWorldTileAncestorClosure(displayCoverage.visible);
    const request = { level: this.desiredLevel, bounds: desiredCoverage.manifestBounds };
    const cameraSignature = buildRequestSignature(request.level, request.bounds);
    const retryDue = nowMs >= this.nextManifestRetryAtMs;
    if (cameraSignature !== this.lastCameraSignature || retryDue) {
      this.lastCameraSignature = cameraSignature;
      if (retryDue) this.nextManifestRetryAtMs = Number.POSITIVE_INFINITY;
      this.pendingManifestRequest = request;
      const decision = this.manifestSchedule.schedule(nowMs);
      if (decision.issueNow) this.issuePendingManifestRequest();
    }
    if (this.manifestSchedule.flush(nowMs)?.issueNow) this.issuePendingManifestRequest();

    this.maybePrefetchSelectedRoom();
    this.queueCoverageImages(
      desiredCoverage.visible,
      desiredCoverage.guard,
      displayCoverage.visible,
      displayCoverage.guard,
    );
    this.processGpuUploads(nowMs);
    this.queueDueRetries(nowMs);
    this.processFetchQueue();
    this.processDecodeQueue();
    this.syncCoverage(nowMs);
    this.maybeRefreshConfig(nowMs);
    this.metrics.recordFrame();
  }

  isBrowseCutoverActive(): boolean {
    return shouldUseWorldTileBrowseCutover({
      rolloutEnabled: this.rollout?.enabled === true,
      shadow: this.rollout?.shadow === true,
      browse: this.options.getMode() === 'browse',
      coarseCoverageComplete: this.coarseCoverageComplete,
      fallbackActive: this.fallback.snapshot().active,
    });
  }

  isShadowMode(): boolean {
    return this.rollout?.enabled === true && this.rollout.shadow;
  }

  /**
   * Wait until the camera's current target LOD has replaced every visible
   * fallback with exact target-level entries and those images are GPU-ready.
   * Lifecycle changes, an explicit abort, or the sticky compact fallback all
   * resolve false so startup callers cannot retain a stale waiter.
   */
  waitForTargetLodReady(
    camera: Phaser.Cameras.Scene2D.Camera,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (
      signal?.aborted
      || !this.activeRendererVersion
      || this.isRefinementStopped()
    ) return Promise.resolve(false);
    if (this.isCameraTargetLodReady(camera)) return Promise.resolve(true);

    const lifecycleEpoch = this.lifecycleEpoch;
    return new Promise<boolean>((resolve) => {
      const waiter: TargetLodReadyWaiter = {
        camera,
        lifecycleEpoch,
        signal,
        resolve,
      };
      if (signal) {
        waiter.onAbort = () => this.settleTargetLodReadyWaiter(waiter, false);
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.targetLodReadyWaiters.add(waiter);

      // Keep the check after registration so a synchronously aborted signal
      // cannot strand the waiter between the first check and listener setup.
      if (signal?.aborted) {
        this.settleTargetLodReadyWaiter(waiter, false);
      } else if (this.isCameraTargetLodReady(camera)) {
        this.settleTargetLodReadyWaiter(waiter, true);
      }
    });
  }

  getImages(): Phaser.GameObjects.Image[] {
    return this.layer.getImages();
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return this.layer.getBackdropIgnoredObjects();
  }

  trackOptimisticPublishedRoom(roomId: string, version: number): void {
    this.optimisticRoomVersions.set(roomId, version);
    this.immediateMaskedRoomIds.delete(roomId);
    this.prefetchRoom(parseRoomCoordinates(roomId), 'mutation');
    this.nextMutationConvergencePollAtMs = 0;
  }

  maskRoomUntilConverged(roomId: string): void {
    this.optimisticRoomVersions.delete(roomId);
    this.immediateMaskedRoomIds.add(roomId);
    this.prefetchRoom(parseRoomCoordinates(roomId), 'mutation');
    this.nextMutationConvergencePollAtMs = 0;
    this.syncCoverage(performance.now());
  }

  isRoomTileDisplayable(coordinates: RoomCoordinates): boolean {
    if (!this.activeRendererVersion) return false;
    const target = {
      rendererVersion: this.activeRendererVersion,
      ...roomToWorldTileCoordinate(this.committedLevel, coordinates.x, coordinates.y),
    };
    return resolveWorldTileDisplayPlan({
      targets: [target],
      availabilityByKey: this.availabilityByKey,
      previousRendererVersion: this.previousRendererVersion,
    }).uncoveredTargetKeys.length === 0;
  }

  prefetchRoom(
    coordinates: RoomCoordinates | null,
    owner: 'selection' | 'mutation' = 'selection',
  ): void {
    if (
      !coordinates
      || this.isRefinementStopped()
      || !this.shouldScheduleRequest(
        owner === 'selection' ? 'selection-prefetch' : 'mutation-prefetch',
      )
    ) return;
    void this.roomManifestPrefetcher.prefetch(coordinates, owner);
  }

  getDebugSnapshot(): WorldTileClientDebugSnapshot {
    const base = this.metrics.snapshot();
    const byteCache = this.byteCache?.getDiagnostics() ?? {
      hits: 0,
      misses: 0,
      evictions: 0,
      memoryBytes: 0,
    };
    return {
      ...base,
      enabled: this.rollout?.enabled ?? false,
      cutoverActive: this.isBrowseCutoverActive(),
      shadow: this.isShadowMode(),
      forced: this.rollout?.forced ?? false,
      rendererVersion: this.activeRendererVersion,
      previousRendererVersion: this.previousRendererVersion,
      committedLevel: this.committedLevel,
      cohortBucket: this.rollout?.bucket ?? null,
      attachedTileCount: this.layer.getAttachedAddressKeys().length,
      byteCacheHits: byteCache.hits,
      byteCacheMisses: byteCache.misses,
      byteCacheEvictions: byteCache.evictions,
      contextRestorePending: this.contextRestorePending,
      targetReadyCount: this.targetReadyCount,
      targetCoveragePercentage: base.visibleCount === 0
        ? 100
        : this.targetReadyCount / base.visibleCount * 100,
    };
  }

  reset(): void {
    this.lifecycleEpoch += 1;
    this.settleAllTargetLodReadyWaiters(false);
    this.destroyed = false;
    this.prepareAbortController?.abort();
    this.prepareAbortController = null;
    this.preparePromise = null;
    this.initialCoverageAbortController?.abort();
    this.initialCoverageAbortController = null;
    this.initialCoveragePromise = null;
    this.initialCoveragePending = true;
    this.requestSchedulingReady = false;
    this.roomManifestPrefetcher.cancelAll();
    this.manifestLoader.cancel();
    this.manifestSchedule.reset();
    this.layer.clearDisplay();
    this.fetchQueue = [];
    this.decodeQueue = [];
    for (const task of this.uploadQueue) closeDecodedSource(task.source);
    this.uploadQueue = [];
    this.queuedFetchKeys.clear();
    this.queuedDecodeKeys.clear();
    this.activeTaskKeys.clear();
    this.stickyTaskKeys.clear();
    this.currentCoverageTaskKeys.clear();
    for (const abortController of this.fetchAbortControllersByTaskKey.values()) abortController.abort();
    this.fetchAbortControllersByTaskKey.clear();
    this.byteCache?.detachPendingRequests();
    this.decodeInFlightTaskKeys.clear();
    this.fetchInFlight = 0;
    this.decodeInFlight = 0;
    this.retriesByKey.clear();
    this.visibleTargets = [];
    this.guardTargets = [];
    this.desiredVisibleTargets = [];
    this.desiredGuardTargets = [];
    this.fallbackAncestors = [];
    this.lastCameraSignature = '';
    this.pendingManifestRequest = null;
    this.nextManifestRetryAtMs = Number.POSITIVE_INFINITY;
    this.manifestFailureCount = 0;
    this.coarseCoverageComplete = false;
    this.lastCoverageComplete = false;
    this.lastFallbackReason = null;
    this.targetReadyCount = 0;
    this.committedLevel = 0;
    this.desiredLevel = 0;
    this.lastZoom = null;
    this.lastGestureAtMs = 0;
    this.lastCameraMovementAtMs = 0;
    this.lastCameraSample = null;
    this.smoothedVelocity = { x: 0, y: 0 };
    this.optimisticRoomVersions.clear();
    this.immediateMaskedRoomIds.clear();
    this.selectedPrefetchRoomId = null;
    this.nextMutationConvergencePollAtMs = 0;
    this.contextRestorePending = false;
  }

  destroy(): void {
    this.lifecycleEpoch += 1;
    this.settleAllTargetLodReadyWaiters(false);
    this.destroyed = true;
    this.prepareAbortController?.abort();
    this.prepareAbortController = null;
    this.initialCoverageAbortController?.abort();
    this.initialCoverageAbortController = null;
    this.initialCoveragePending = true;
    this.requestSchedulingReady = false;
    this.roomManifestPrefetcher.cancelAll();
    this.manifestLoader.cancel();
    this.contextCanvas?.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.contextCanvas = null;
    for (const task of this.uploadQueue) closeDecodedSource(task.source);
    this.uploadQueue = [];
    for (const abortController of this.fetchAbortControllersByTaskKey.values()) abortController.abort();
    this.fetchAbortControllersByTaskKey.clear();
    this.byteCache?.detachPendingRequests();
    this.decodeInFlightTaskKeys.clear();
    this.fetchInFlight = 0;
    this.decodeInFlight = 0;
    this.activeTaskKeys.clear();
    this.layer.destroy();
  }

  private async prepareInternal(): Promise<boolean> {
    this.requestSchedulingReady = false;
    this.installContextRestoreListener();
    const abortController = new AbortController();
    this.prepareAbortController = abortController;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const configTimeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        abortController.abort();
        reject(new Error('World tile config timed out.'));
      }, WORLD_TILE_COVERAGE_TIMEOUT_MS);
    });
    try {
      const config = await Promise.race([
        this.options.repository.loadWorldTileConfig(abortController.signal),
        configTimeout,
      ]);
      if (abortController.signal.aborted || this.destroyed) return false;
      if (!config) return false;
      const cohortId = getOrCreateWorldTileCohortId(window.localStorage);
      this.rollout = decideWorldTileRollout({
        config,
        cohortId,
        search: window.location.search,
      });
      if (!this.rollout.enabled) return false;
      const preparedRendererVersion = config.activeRendererVersion;
      const quota = await getStorageQuota();
      if (abortController.signal.aborted || this.destroyed) return false;
      this.byteCache = new WorldTileByteCache(getPersistentWorldTileByteBudget(
        toTileProfile(this.options.getPerformanceProfile()),
        quota,
      ));
      this.nextConfigRefreshAtMs = performance.now() + WORLD_TILE_CONFIG_REFRESH_MS;
      this.activeRendererVersion = preparedRendererVersion;
      this.requestSchedulingReady = preparedRendererVersion !== null;
      return this.requestSchedulingReady;
    } catch (error) {
      if (abortController.signal.aborted) return false;
      if (error instanceof WorldTileManifestCompatibilityError) {
        this.fallback.recordPermanentManifestIncompatibility();
      }
      console.warn('Tiled overworld unavailable for this session.', error);
      return false;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (this.prepareAbortController === abortController) this.prepareAbortController = null;
    }
  }

  private installContextRestoreListener(): void {
    if (this.contextCanvas) return;
    const canvas = this.options.scene.sys.game?.canvas ?? null;
    if (!canvas) return;
    this.contextCanvas = canvas;
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  private isRefinementStopped(): boolean {
    return this.destroyed
      || this.rollout?.enabled !== true
      || this.fallback.snapshot().active;
  }

  private shouldScheduleRequest(requestKind: WorldTileRequestKind): boolean {
    return shouldScheduleWorldTileRequest(requestKind, {
      requestSchedulingReady: this.requestSchedulingReady && this.activeRendererVersion !== null,
      initialCoveragePending: this.initialCoveragePending,
    });
  }

  private stopRefinementWork(): void {
    this.settleAllTargetLodReadyWaiters(false);
    this.initialCoverageAbortController?.abort();
    this.initialCoverageAbortController = null;
    this.roomManifestPrefetcher.cancelAll();
    this.manifestLoader.cancel();
    this.pendingManifestRequest = null;
    this.manifestSchedule.reset();
    this.nextManifestRetryAtMs = Number.POSITIVE_INFINITY;
    this.fetchQueue = [];
    this.decodeQueue = [];
    for (const task of this.uploadQueue) closeDecodedSource(task.source);
    this.uploadQueue = [];
    this.queuedFetchKeys.clear();
    this.queuedDecodeKeys.clear();
    for (const abortController of this.fetchAbortControllersByTaskKey.values()) abortController.abort();
    this.fetchAbortControllersByTaskKey.clear();
    this.byteCache?.detachPendingRequests();
    this.decodeInFlightTaskKeys.clear();
    this.activeTaskKeys.clear();
    this.stickyTaskKeys.clear();
    this.currentCoverageTaskKeys.clear();
    this.retriesByKey.clear();
  }

  private recordStoppedMetrics(): void {
    this.metrics.update({
      queueDepths: {
        manifest: 0,
        fetch: this.fetchInFlight,
        decode: this.decodeInFlight,
        gpuUpload: 0,
        replacementGroups: 0,
      },
      fallbackReason: this.fallback.snapshot().reason,
    });
  }

  private calculateCoverage(viewport: WorldRect, level: WorldTileLevel): {
    visible: WorldTileAddress[];
    guard: WorldTileAddress[];
    manifestBounds: WorldTileBounds;
  } {
    const rendererVersion = this.activeRendererVersion!;
    const visibleBounds = worldRectToTileBounds(level, viewport);
    const guardRect = calculateDirectionalGuardRect({
      viewport,
      velocity: this.smoothedVelocity,
    });
    const unclampedGuardBounds = worldRectToTileBounds(level, guardRect);
    const manifestBounds = clampWorldTileManifestBounds({
      visible: visibleBounds,
      guard: unclampedGuardBounds,
    });
    return {
      visible: enumerateWorldTileBounds(rendererVersion, level, visibleBounds),
      guard: enumerateWorldTileBounds(rendererVersion, level, manifestBounds),
      manifestBounds,
    };
  }

  private issuePendingManifestRequest(): void {
    if (this.isRefinementStopped()) return;
    const request = this.pendingManifestRequest;
    if (!request) return;
    this.pendingManifestRequest = null;
    void this.manifestLoader.load(request.level, request.bounds).then((result) => {
      if (result.obsolete || this.isRefinementStopped()) return;
      if (!result.manifest) {
        this.fallback.recordPermanentManifestIncompatibility();
        this.notifyFallbackChanged();
        return;
      }
      if (!this.ingestManifest(result.manifest)) return;
      this.nextManifestRetryAtMs = Number.POSITIVE_INFINITY;
      this.manifestFailureCount = 0;
    }).catch((error) => this.handleManifestFailure(error, performance.now()));
  }

  private ingestManifest(manifest: WorldTileManifest): boolean {
    const rendererRole = getWorldTileManifestRendererRole({
      activeRendererVersion: this.activeRendererVersion,
      previousRendererVersion: this.previousRendererVersion,
      manifestRendererVersion: manifest.rendererVersion,
    });
    if (rendererRole === 'reject') return false;
    for (const entry of manifest.entries) {
      const key = worldTileAddressKey(entry.address);
      const existing = this.entriesByKey.get(key);
      if (existing && existing.desiredGeneration > entry.desiredGeneration) continue;
      this.entriesByKey.set(key, entry);
    }
    this.refreshAvailability();
    if (rendererRole === 'active') this.resolveOptimisticRooms(manifest);
    return true;
  }

  private acceptRoomPrefetchManifest(
    _coordinates: RoomCoordinates,
    manifest: WorldTileManifest,
  ): void {
    if (!this.ingestManifest(manifest) || this.isRefinementStopped()) return;
    this.queueCoverageImages(
      this.desiredVisibleTargets,
      this.desiredGuardTargets,
      this.visibleTargets,
      this.guardTargets,
    );
    this.processFetchQueue();
  }

  private refreshAvailability(): void {
    for (const [key, entry] of this.entriesByKey) {
      if (entry.ready) {
        const gpuReady = this.layer.hasGpuTexture(key, entry.ready.contentHash);
        this.availabilityByKey.set(key, {
          state: 'ready-image',
          decoded: gpuReady,
          gpuReady,
          stale: entry.ready.generation < entry.desiredGeneration || entry.staleRoomIds.length > 0,
        });
      } else if (entry.readyEmptyGeneration !== null) {
        this.availabilityByKey.set(key, { state: 'ready-empty' });
      } else {
        this.availabilityByKey.set(key, { state: 'pending' });
      }
    }
  }

  private queueCoverageImages(
    desiredVisible: WorldTileAddress[],
    desiredGuards: WorldTileAddress[],
    displayVisible: WorldTileAddress[],
    displayGuards: WorldTileAddress[],
  ): void {
    const visibleKeys = new Set([
      ...desiredVisible.map(worldTileAddressKey),
      ...displayVisible.map(worldTileAddressKey),
    ]);
    const siblings = getWorldTileSiblingClosure([...desiredVisible, ...displayVisible]);
    const siblingKeys = new Set(siblings.map(worldTileAddressKey));
    const ancestors = getWorldTileAncestorClosure([...desiredVisible, ...displayVisible, ...siblings]);
    const ancestorKeys = new Set(ancestors.map(worldTileAddressKey));
    const guardKeys = new Set([
      ...desiredGuards.map(worldTileAddressKey),
      ...displayGuards.map(worldTileAddressKey),
    ]);
    const selected = this.options.getSelectedCoordinates();
    const selectedKey = this.activeRendererVersion
      ? worldTileAddressKey({
          rendererVersion: this.activeRendererVersion,
          level: 4,
          x: selected.x,
          y: selected.y,
        })
      : null;
    const center = getRectCenter(getCameraWorldRect(this.options.scene.cameras.main));
    const candidates: WorldTileRequestCandidate[] = [...this.entriesByKey.values()].flatMap((entry) => {
      const key = worldTileAddressKey(entry.address);
      const selectedTarget = key === selectedKey;
      if (
        !selectedTarget
        && !visibleKeys.has(key)
        && !siblingKeys.has(key)
        && !ancestorKeys.has(key)
        && !guardKeys.has(key)
      ) {
        return [];
      }
      const distance = getAddressDistance(entry.address, center);
      return [{
        address: entry.address,
        uncoveredVisibleAncestor: ancestorKeys.has(key) && !this.isEntryGpuReady(entry),
        visibleTarget: visibleKeys.has(key),
        siblingClosure: siblingKeys.has(key),
        guard: guardKeys.has(key) && !visibleKeys.has(key),
        predictedMovement: guardKeys.has(key) && !visibleKeys.has(key),
        pointerDistance: selectedTarget ? 0 : null,
        centerDistance: distance,
        predictedDistance: distance,
      }];
    });
    const rankedEntries = rankWorldTileRequests(candidates).flatMap((candidate) => {
      const entry = this.entriesByKey.get(worldTileAddressKey(candidate.address));
      return entry?.ready ? [entry] : [];
    });
    this.reconcileCoverageTasks(rankedEntries);
  }

  private queueAddresses(addresses: readonly WorldTileAddress[], restoration = false): void {
    if (this.isRefinementStopped()) return;
    const tasks: FetchTask[] = [];
    for (const address of addresses) {
      const entry = this.entriesByKey.get(worldTileAddressKey(address));
      if (!entry?.ready || this.isEntryGpuReady(entry)) continue;
      const taskKey = taskIdentity(entry);
      if (restoration) this.markTaskSticky(taskKey);
      if (this.activeTaskKeys.has(taskKey)) continue;
      const retry = this.retriesByKey.get(taskKey);
      if (retry && retry.retryAtMs > performance.now() && !restoration) continue;
      this.activeTaskKeys.add(taskKey);
      this.queuedFetchKeys.add(taskKey);
      tasks.push({
        entry,
        forceNetwork: false,
        taskKey,
        retainAcrossCoverage: restoration,
        lifecycleEpoch: this.lifecycleEpoch,
      });
    }
    if (restoration) this.fetchQueue.unshift(...tasks);
    else this.fetchQueue.push(...tasks);
  }

  private reconcileCoverageTasks(rankedEntries: readonly WorldTileManifestEntry[]): void {
    const entryByTaskKey = new Map(rankedEntries.map((entry) => [taskIdentity(entry), entry]));
    const orderedTaskKeys = [...entryByTaskKey.keys()];
    this.currentCoverageTaskKeys = new Set(orderedTaskKeys);

    for (const [taskKey, abortController] of this.fetchAbortControllersByTaskKey) {
      if (!this.isTaskWanted(taskKey)) abortController.abort();
    }
    for (const taskKey of this.retriesByKey.keys()) {
      if (!this.isTaskWanted(taskKey)) this.retriesByKey.delete(taskKey);
    }

    const fetchResult = reconcileWorldTileQueuedTasks(this.fetchQueue, orderedTaskKeys);
    const decodeResult = reconcileWorldTileQueuedTasks(this.decodeQueue, orderedTaskKeys);
    const uploadResult = reconcileWorldTileQueuedTasks(this.uploadQueue, orderedTaskKeys);
    this.fetchQueue = fetchResult.queue;
    this.decodeQueue = decodeResult.queue;
    this.uploadQueue = uploadResult.queue;
    for (const task of uploadResult.removed) closeDecodedSource(task.source);

    const retainedKeys = new Set([
      ...this.fetchQueue.map((task) => task.taskKey),
      ...this.decodeQueue.map((task) => task.taskKey),
      ...this.uploadQueue.map((task) => task.taskKey),
      ...this.fetchAbortControllersByTaskKey.keys(),
      ...this.decodeInFlightTaskKeys.keys(),
    ]);
    for (const task of [...fetchResult.removed, ...decodeResult.removed, ...uploadResult.removed]) {
      if (!retainedKeys.has(task.taskKey)) {
        this.releaseActiveTask(task.taskKey, false, task.lifecycleEpoch);
      }
    }

    for (const taskKey of orderedTaskKeys) {
      const entry = entryByTaskKey.get(taskKey)!;
      if (
        this.activeTaskKeys.has(taskKey)
        || this.isEntryGpuReady(entry)
        || (this.retriesByKey.get(taskKey)?.retryAtMs ?? 0) > performance.now()
      ) continue;
      this.activeTaskKeys.add(taskKey);
      this.fetchQueue.push({
        entry,
        forceNetwork: false,
        taskKey,
        retainAcrossCoverage: false,
        lifecycleEpoch: this.lifecycleEpoch,
      });
    }

    this.fetchQueue = reconcileWorldTileQueuedTasks(this.fetchQueue, orderedTaskKeys).queue;
    this.queuedFetchKeys = new Set(this.fetchQueue.map((task) => task.taskKey));
    this.queuedDecodeKeys = new Set(this.decodeQueue.map((task) => task.taskKey));
  }

  private markTaskSticky(taskKey: string): void {
    this.stickyTaskKeys.add(taskKey);
    for (const task of [...this.fetchQueue, ...this.decodeQueue, ...this.uploadQueue]) {
      if (task.taskKey === taskKey) task.retainAcrossCoverage = true;
    }
  }

  private isTaskWanted(taskKey: string): boolean {
    return this.stickyTaskKeys.has(taskKey) || this.currentCoverageTaskKeys.has(taskKey);
  }

  private releaseActiveTask(
    taskKey: string,
    clearSticky = false,
    lifecycleEpoch = this.lifecycleEpoch,
  ): void {
    if (lifecycleEpoch !== this.lifecycleEpoch) return;
    this.activeTaskKeys.delete(taskKey);
    this.queuedFetchKeys.delete(taskKey);
    this.queuedDecodeKeys.delete(taskKey);
    if (clearSticky) this.stickyTaskKeys.delete(taskKey);
  }

  private async loadEntriesImmediately(
    addresses: readonly WorldTileAddress[],
    signal?: AbortSignal,
  ): Promise<void> {
    const lifecycleEpoch = this.lifecycleEpoch;
    const entries = addresses.flatMap((address) => {
      const entry = this.entriesByKey.get(worldTileAddressKey(address));
      if (!entry?.ready || this.isEntryGpuReady(entry)) return [];
      const taskKey = taskIdentity(entry);
      if (this.activeTaskKeys.has(taskKey)) return [];
      this.activeTaskKeys.add(taskKey);
      this.stickyTaskKeys.add(taskKey);
      return [entry];
    });
    const concurrency = getWorldTileStreamingBudgets(
      toTileProfile(this.options.getPerformanceProfile()),
    ).fetchConcurrency;
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < entries.length) {
        if (this.isRefinementStopped()) break;
        const entry = entries[index++];
        const taskKey = taskIdentity(entry);
        try {
          const source = await this.fetchAndDecodeEntry(entry, signal);
          if (
            lifecycleEpoch === this.lifecycleEpoch
            && this.isEntryCurrent(entry)
            && !this.isRefinementStopped()
          ) {
            this.layer.installDecoded(entry, source);
          } else {
            closeDecodedSource(source);
          }
        } catch (error) {
          if (lifecycleEpoch !== this.lifecycleEpoch) break;
          if (isAbortError(error)) break;
          this.recordTileFailure(entry, error, performance.now());
        } finally {
          this.releaseActiveTask(taskKey, true, lifecycleEpoch);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
    for (const entry of entries) this.releaseActiveTask(taskIdentity(entry), true, lifecycleEpoch);
    if (lifecycleEpoch === this.lifecycleEpoch) this.refreshAvailability();
  }

  private processFetchQueue(): void {
    if (this.isRefinementStopped()) return;
    const budgets = getWorldTileStreamingBudgets(toTileProfile(this.options.getPerformanceProfile()));
    while (this.fetchInFlight < budgets.fetchConcurrency && this.fetchQueue.length > 0) {
      const task = this.fetchQueue.shift()!;
      const taskKey = task.taskKey;
      this.queuedFetchKeys.delete(taskKey);
      if (
        task.lifecycleEpoch !== this.lifecycleEpoch
        ||
        !this.isTaskWanted(taskKey)
        || !this.isEntryCurrent(task.entry)
        || this.isEntryGpuReady(task.entry)
      ) {
        this.releaseActiveTask(taskKey, false, task.lifecycleEpoch);
        continue;
      }
      this.fetchInFlight += 1;
      const abortController = new AbortController();
      this.fetchAbortControllersByTaskKey.set(taskKey, abortController);
      void this.byteCache!.getOrFetch(task.entry.ready!, abortController.signal, task.forceNetwork)
        .then((result) => {
          if (
            task.lifecycleEpoch !== this.lifecycleEpoch
            ||
            this.isRefinementStopped()
            || !this.isTaskWanted(taskKey)
            || !this.isEntryCurrent(task.entry)
          ) {
            this.releaseActiveTask(taskKey, false, task.lifecycleEpoch);
            return;
          }
          this.queuedDecodeKeys.add(taskKey);
          this.decodeQueue.push({
            entry: task.entry,
            blob: result.blob,
            taskKey,
            retainAcrossCoverage: this.stickyTaskKeys.has(taskKey),
            lifecycleEpoch: task.lifecycleEpoch,
          });
        })
        .catch((error) => {
          this.releaseActiveTask(taskKey, false, task.lifecycleEpoch);
          if (
            task.lifecycleEpoch !== this.lifecycleEpoch
            || this.isRefinementStopped()
            || !this.isTaskWanted(taskKey)
          ) return;
          this.recordTileFailure(task.entry, error, performance.now());
        })
        .finally(() => {
          if (this.fetchAbortControllersByTaskKey.get(taskKey) === abortController) {
            this.fetchAbortControllersByTaskKey.delete(taskKey);
          }
          if (task.lifecycleEpoch === this.lifecycleEpoch) {
            this.fetchInFlight -= 1;
            this.processFetchQueue();
            this.processDecodeQueue();
          }
        });
    }
  }

  private processDecodeQueue(): void {
    if (this.isRefinementStopped()) return;
    const budgets = getWorldTileStreamingBudgets(toTileProfile(this.options.getPerformanceProfile()));
    while (this.decodeInFlight < budgets.decodeConcurrency && this.decodeQueue.length > 0) {
      const task = this.decodeQueue.shift()!;
      const taskKey = task.taskKey;
      this.queuedDecodeKeys.delete(taskKey);
      if (
        task.lifecycleEpoch !== this.lifecycleEpoch
        ||
        !this.isTaskWanted(taskKey)
        || !this.isEntryCurrent(task.entry)
        || this.isEntryGpuReady(task.entry)
      ) {
        this.releaseActiveTask(taskKey, false, task.lifecycleEpoch);
        continue;
      }
      this.decodeInFlight += 1;
      this.decodeInFlightTaskKeys.set(taskKey, task.lifecycleEpoch);
      void decodeWorldTileBlob(task.blob)
        .then((source) => {
          assertDecodedDimensions(source, task.entry);
          if (
            task.lifecycleEpoch !== this.lifecycleEpoch
            ||
            this.isRefinementStopped()
            || !this.isTaskWanted(taskKey)
            || !this.isEntryCurrent(task.entry)
          ) {
            closeDecodedSource(source);
            this.releaseActiveTask(taskKey, false, task.lifecycleEpoch);
          } else {
            this.uploadQueue.push({
              entry: task.entry,
              source,
              taskKey,
              retainAcrossCoverage: this.stickyTaskKeys.has(taskKey),
              lifecycleEpoch: task.lifecycleEpoch,
            });
          }
        })
        .catch(async (error) => {
          const ready = task.entry.ready!;
          if (
            task.lifecycleEpoch !== this.lifecycleEpoch
            || this.isRefinementStopped()
            || !this.isTaskWanted(taskKey)
          ) {
            this.releaseActiveTask(taskKey, false, task.lifecycleEpoch);
            return;
          }
          if (
            this.corruptRetry.shouldEvictAndRetry(taskKey)
          ) {
            await this.byteCache!.delete(ready);
            if (
              task.lifecycleEpoch !== this.lifecycleEpoch
              || this.isRefinementStopped()
              || !this.isTaskWanted(taskKey)
            ) {
              this.releaseActiveTask(taskKey, false, task.lifecycleEpoch);
              return;
            }
            this.queuedFetchKeys.add(taskKey);
            this.fetchQueue.unshift({
              entry: task.entry,
              forceNetwork: true,
              taskKey,
              retainAcrossCoverage: this.stickyTaskKeys.has(taskKey),
              lifecycleEpoch: task.lifecycleEpoch,
            });
          } else {
            this.releaseActiveTask(taskKey, false, task.lifecycleEpoch);
            this.recordTileFailure(task.entry, error, performance.now());
          }
        })
        .finally(() => {
          if (this.decodeInFlightTaskKeys.get(taskKey) === task.lifecycleEpoch) {
            this.decodeInFlightTaskKeys.delete(taskKey);
          }
          if (task.lifecycleEpoch === this.lifecycleEpoch) {
            this.decodeInFlight -= 1;
            this.processDecodeQueue();
            this.processFetchQueue();
          }
        });
    }
  }

  private processGpuUploads(startedAtMs: number): void {
    const budgets = getWorldTileStreamingBudgets(toTileProfile(this.options.getPerformanceProfile()));
    let uploaded = 0;
    while (
      uploaded < budgets.gpuUploadsPerFrame
      && this.uploadQueue.length > 0
      && performance.now() - startedAtMs <= budgets.gpuUploadBudgetMs
    ) {
      const task = this.uploadQueue.shift()!;
      if (
        task.lifecycleEpoch === this.lifecycleEpoch
        && this.isTaskWanted(task.taskKey)
        && this.isEntryCurrent(task.entry)
      ) {
        this.layer.installDecoded(task.entry, task.source);
        this.corruptRetry.markSuccessful(task.taskKey);
        this.retriesByKey.delete(task.taskKey);
      } else {
        closeDecodedSource(task.source);
      }
      this.releaseActiveTask(task.taskKey, true, task.lifecycleEpoch);
      uploaded += 1;
    }
    if (uploaded > 0) {
      this.refreshAvailability();
      if (this.contextRestorePending && this.visibleTargets.every((address) => (
        this.isAddressDisplayable(address)
      ))) {
        this.contextRestorePending = false;
      }
    }
  }

  private syncCoverage(nowMs: number): void {
    if (!this.activeRendererVersion || this.desiredVisibleTargets.length === 0) return;
    const desiredPlan = resolveWorldTileDisplayPlan({
      targets: this.desiredVisibleTargets,
      availabilityByKey: this.availabilityByKey,
      previousRendererVersion: this.previousRendererVersion,
    });
    const replacementCoverageComplete = isWorldTileTargetReplacementComplete(desiredPlan);
    const levelDecision = selectWorldTileDisplayLevel({
      committedLevel: this.committedLevel,
      desiredLevel: this.desiredLevel,
      nowMs,
      lastGestureAtMs: this.lastGestureAtMs,
      replacementCoverageComplete,
    });
    if (levelDecision.committed) {
      this.committedLevel = levelDecision.committedLevel;
      this.visibleTargets = this.desiredVisibleTargets;
      this.guardTargets = this.desiredGuardTargets;
      this.fallbackAncestors = getWorldTileAncestorClosure(this.visibleTargets);
    }

    const displayPlan = levelDecision.displayLevel === this.desiredLevel
      ? desiredPlan
      : resolveWorldTileDisplayPlan({
          targets: this.visibleTargets,
          availabilityByKey: this.availabilityByKey,
          previousRendererVersion: this.previousRendererVersion,
        });
    const displayGuardPlan = resolveWorldTileDisplayPlan({
      targets: this.guardTargets,
      availabilityByKey: this.availabilityByKey,
      previousRendererVersion: this.previousRendererVersion,
    });
    const coverageComplete = displayPlan.uncoveredTargetKeys.length === 0;
    this.targetReadyCount = this.desiredVisibleTargets.filter((target) => (
      isWorldTileTargetReplacementComplete(resolveWorldTileDisplayPlan({
        targets: [target],
        availabilityByKey: this.availabilityByKey,
        previousRendererVersion: this.previousRendererVersion,
      }))
    )).length;
    if (coverageComplete) {
      this.fallback.markCoverageComplete();
      this.coarseCoverageComplete = true;
    } else {
      this.fallback.markCoverageIncomplete(nowMs);
      this.fallback.evaluate(nowMs);
    }
    const fallbackSnapshot = this.fallback.snapshot();
    const displayKeys = [...new Set([
      ...displayPlan.displayImageKeys,
      ...displayGuardPlan.displayImageKeys,
    ])];
    const staleRoomIds = new Set(this.immediateMaskedRoomIds);
    for (const key of displayKeys) {
      for (const roomId of this.entriesByKey.get(key)?.staleRoomIds ?? []) staleRoomIds.add(roomId);
    }
    if (!this.rollout?.shadow) {
      this.layer.syncDisplay(this.entriesByKey, displayKeys, {
        blend: this.options.getMode() === 'browse'
          && this.options.getPerformanceProfile() !== 'reduced'
          && nowMs - this.lastCameraMovementAtMs >= 80,
        staleRoomIds,
      });
    }
    this.metrics.update({
      targetLevel: this.desiredLevel,
      visibleCount: this.desiredVisibleTargets.length,
      readyCount: desiredPlan.coveredTargetKeys.length,
      staleCount: displayPlan.staleCount,
      queueDepths: {
        manifest: this.manifestLoader.pendingCount + (this.manifestSchedule.hasTrailingRefresh() ? 1 : 0),
        fetch: this.fetchQueue.length + this.fetchInFlight,
        decode: this.decodeQueue.length + this.decodeInFlight,
        gpuUpload: this.uploadQueue.length,
        replacementGroups: desiredPlan.fallbackKeys.length,
      },
      fallbackReason: fallbackSnapshot.reason,
    });
    if (
      coverageComplete !== this.lastCoverageComplete
      || fallbackSnapshot.reason !== this.lastFallbackReason
    ) {
      this.lastCoverageComplete = coverageComplete;
      this.lastFallbackReason = fallbackSnapshot.reason;
      this.options.onCoverageChanged?.();
    }
    if (fallbackSnapshot.active) this.settleAllTargetLodReadyWaiters(false);
    else this.resolveReadyTargetLodWaiters();
  }

  private updateCameraMotion(viewport: WorldRect, zoom: number, nowMs: number): void {
    const center = getRectCenter(viewport);
    const previous = this.lastCameraSample;
    if (previous) {
      const elapsedSeconds = Math.max(0.001, (nowMs - previous.atMs) / 1_000);
      const width = viewport.right - viewport.left;
      const height = viewport.bottom - viewport.top;
      const rawX = clamp((center.x - previous.x) / elapsedSeconds, -width * 8, width * 8);
      const rawY = clamp((center.y - previous.y) / elapsedSeconds, -height * 8, height * 8);
      this.smoothedVelocity.x = this.smoothedVelocity.x * 0.75 + rawX * 0.25;
      this.smoothedVelocity.y = this.smoothedVelocity.y * 0.75 + rawY * 0.25;
      if (Math.abs(center.x - previous.x) > CAMERA_EPSILON || Math.abs(center.y - previous.y) > CAMERA_EPSILON) {
        this.lastCameraMovementAtMs = nowMs;
      }
    }
    if (this.lastZoom === null || Math.abs(zoom - this.lastZoom) > 0.0001) {
      this.lastGestureAtMs = nowMs;
      this.lastCameraMovementAtMs = nowMs;
      this.lastZoom = zoom;
    }
    this.lastCameraSample = { ...center, atMs: nowMs };
  }

  private queueDueRetries(nowMs: number): void {
    for (const [taskKey, retry] of this.retriesByKey) {
      if (!this.isTaskWanted(taskKey)) {
        this.retriesByKey.delete(taskKey);
        continue;
      }
      if (retry.retryAtMs > nowMs || this.activeTaskKeys.has(taskKey)) continue;
      const entry = [...this.entriesByKey.values()].find((candidate) => taskIdentity(candidate) === taskKey);
      if (!entry?.ready || this.isEntryGpuReady(entry)) continue;
      this.activeTaskKeys.add(taskKey);
      this.queuedFetchKeys.add(taskKey);
      this.fetchQueue.push({
        entry,
        forceNetwork: false,
        taskKey,
        retainAcrossCoverage: this.stickyTaskKeys.has(taskKey),
        lifecycleEpoch: this.lifecycleEpoch,
      });
    }
  }

  private recordTileFailure(entry: WorldTileManifestEntry, error: unknown, nowMs: number): void {
    const key = taskIdentity(entry);
    const failures = (this.retriesByKey.get(key)?.failures ?? 0) + 1;
    this.retriesByKey.set(key, {
      failures,
      retryAtMs: nowMs + getWorldTileRetryDelayMs(failures),
    });
    if (!this.lastCoverageComplete) this.fallback.recordCriticalFailure(nowMs);
    this.notifyFallbackChanged();
    console.warn('World tile refinement failed; retaining current imagery.', entry.address, error);
  }

  private handleManifestFailure(error: unknown, nowMs: number): void {
    if (isAbortError(error)) return;
    if (error instanceof WorldTileManifestCompatibilityError) {
      this.fallback.recordPermanentManifestIncompatibility();
      this.notifyFallbackChanged();
      return;
    }
    this.fallback.recordCriticalFailure(nowMs);
    this.manifestFailureCount += 1;
    this.nextManifestRetryAtMs = nowMs + getWorldTileRetryDelayMs(this.manifestFailureCount);
    this.notifyFallbackChanged();
    console.warn('World tile manifest refresh failed; retaining current imagery.', error);
  }

  private isEntryCurrent(entry: WorldTileManifestEntry): boolean {
    const current = this.entriesByKey.get(worldTileAddressKey(entry.address));
    return current?.ready?.contentHash === entry.ready?.contentHash;
  }

  private isEntryGpuReady(entry: WorldTileManifestEntry): boolean {
    return Boolean(entry.ready && this.layer.hasGpuTexture(
      worldTileAddressKey(entry.address),
      entry.ready.contentHash,
    ));
  }

  private isAddressDisplayable(address: WorldTileAddress): boolean {
    return resolveWorldTileDisplayPlan({
      targets: [address],
      availabilityByKey: this.availabilityByKey,
      previousRendererVersion: this.previousRendererVersion,
    }).uncoveredTargetKeys.length === 0;
  }

  private async fetchAndDecodeEntry(
    entry: WorldTileManifestEntry,
    signal?: AbortSignal,
  ): Promise<DecodedWorldTileSource> {
    const byteCache = this.byteCache!;
    signal?.throwIfAborted();
    const result = await byteCache.getOrFetch(entry.ready!, signal);
    try {
      const source = await decodeWorldTileBlob(result.blob);
      if (signal?.aborted) {
        closeDecodedSource(source);
        signal.throwIfAborted();
      }
      assertDecodedDimensions(source, entry);
      return source;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!this.corruptRetry.shouldEvictAndRetry(taskIdentity(entry))) throw error;
      await byteCache.delete(entry.ready!);
      const retry = await byteCache.getOrFetch(entry.ready!, signal, true);
      const source = await decodeWorldTileBlob(retry.blob);
      if (signal?.aborted) {
        closeDecodedSource(source);
        signal.throwIfAborted();
      }
      assertDecodedDimensions(source, entry);
      return source;
    }
  }

  private maybePrefetchSelectedRoom(): void {
    const selected = this.options.getSelectedCoordinates();
    const roomId = `${selected.x},${selected.y}`;
    if (roomId === this.selectedPrefetchRoomId) return;
    this.selectedPrefetchRoomId = roomId;
    this.roomManifestPrefetcher.cancelOwner('selection', roomId);
    this.prefetchRoom(selected, 'selection');
  }

  private maybePollMutationConvergence(nowMs: number): void {
    if (
      nowMs < this.nextMutationConvergencePollAtMs
      || (this.optimisticRoomVersions.size === 0 && this.immediateMaskedRoomIds.size === 0)
    ) return;
    this.nextMutationConvergencePollAtMs = nowMs + 1_000;
    for (const roomId of new Set([
      ...this.optimisticRoomVersions.keys(),
      ...this.immediateMaskedRoomIds,
    ])) {
      this.prefetchRoom(parseRoomCoordinates(roomId), 'mutation');
    }
  }

  private maybeRefreshConfig(nowMs: number): void {
    if (
      nowMs < this.nextConfigRefreshAtMs
      || !this.shouldScheduleRequest('config-refresh')
    ) return;
    this.nextConfigRefreshAtMs = nowMs + WORLD_TILE_CONFIG_REFRESH_MS;
    void this.options.repository.loadWorldTileConfig().then((config) => {
      const currentRollout = this.rollout;
      if (!config || !currentRollout || this.destroyed) return;
      const nextRollout = decideWorldTileRollout({
        config,
        cohortId: currentRollout.cohortId,
        search: window.location.search,
      });
      this.rollout = nextRollout;
      if (!nextRollout.enabled) {
        this.activeRendererVersion = config.activeRendererVersion;
        this.coarseCoverageComplete = false;
        this.lastCoverageComplete = false;
        this.stopRefinementWork();
        this.options.onCoverageChanged?.();
        return;
      }
      if (
        config.activeRendererVersion
        && config.activeRendererVersion !== this.activeRendererVersion
      ) {
        this.previousRendererVersion = this.activeRendererVersion;
        this.activeRendererVersion = config.activeRendererVersion;
        this.lastCameraSignature = '';
      }
    }).catch(() => {});
  }

  private notifyFallbackChanged(): void {
    const fallback = this.fallback.snapshot();
    if (fallback.active) this.settleAllTargetLodReadyWaiters(false);
    const reason = fallback.reason;
    if (reason === this.lastFallbackReason) return;
    this.lastFallbackReason = reason;
    this.options.onCoverageChanged?.();
  }

  private isCameraTargetLodReady(camera: Phaser.Cameras.Scene2D.Camera): boolean {
    if (!this.activeRendererVersion || this.desiredVisibleTargets.length === 0) return false;
    const requiredLevel = selectWorldTileLevel(camera.zoom, this.desiredLevel).level;
    if (this.desiredLevel !== requiredLevel || this.committedLevel !== requiredLevel) return false;

    const expectedTargets = enumerateWorldTileBounds(
      this.activeRendererVersion,
      requiredLevel,
      worldRectToTileBounds(requiredLevel, getCameraWorldRect(camera)),
    );
    if (!sameWorldTileAddresses(expectedTargets, this.desiredVisibleTargets)) return false;
    return isWorldTileTargetReplacementComplete(resolveWorldTileDisplayPlan({
      targets: expectedTargets,
      availabilityByKey: this.availabilityByKey,
      previousRendererVersion: this.previousRendererVersion,
    }));
  }

  private resolveReadyTargetLodWaiters(): void {
    for (const waiter of [...this.targetLodReadyWaiters]) {
      if (waiter.lifecycleEpoch !== this.lifecycleEpoch || waiter.signal?.aborted) {
        this.settleTargetLodReadyWaiter(waiter, false);
      } else if (this.isCameraTargetLodReady(waiter.camera)) {
        this.settleTargetLodReadyWaiter(waiter, true);
      }
    }
  }

  private settleAllTargetLodReadyWaiters(ready: boolean): void {
    for (const waiter of [...this.targetLodReadyWaiters]) {
      this.settleTargetLodReadyWaiter(waiter, ready);
    }
  }

  private settleTargetLodReadyWaiter(
    waiter: TargetLodReadyWaiter,
    ready: boolean,
  ): void {
    if (!this.targetLodReadyWaiters.delete(waiter)) return;
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
    waiter.resolve(ready);
  }

  private resolveOptimisticRooms(manifest: WorldTileManifest): void {
    const summariesById = new Map(manifest.rooms.map((room) => [room.id, room]));
    for (const [roomId, expectedVersion] of this.optimisticRoomVersions) {
      const summary = summariesById.get(roomId);
      const coordinates = parseRoomCoordinates(roomId);
      if (!summary || !coordinates || summary.version < expectedVersion) continue;
      const key = worldTileAddressKey({
        rendererVersion: manifest.rendererVersion,
        level: 4,
        x: coordinates.x,
        y: coordinates.y,
      });
      const entry = this.entriesByKey.get(key);
      if (!entry?.ready || entry.ready.generation !== entry.desiredGeneration || entry.staleRoomIds.includes(roomId)) {
        continue;
      }
      this.optimisticRoomVersions.delete(roomId);
      this.options.onCanonicalRoomReady?.(roomId);
    }
    for (const roomId of [...this.immediateMaskedRoomIds]) {
      const coordinates = parseRoomCoordinates(roomId);
      if (!coordinates || summariesById.has(roomId)) continue;
      const key = worldTileAddressKey({
        rendererVersion: manifest.rendererVersion,
        level: 4,
        x: coordinates.x,
        y: coordinates.y,
      });
      const entry = this.entriesByKey.get(key);
      if (entry?.readyEmptyGeneration === entry?.desiredGeneration) {
        this.immediateMaskedRoomIds.delete(roomId);
      }
    }
  }
}

interface EarlyWorldTileCoverageConsumerInput {
  rendererVersion: string | null;
  bounds: WorldTileBounds;
  lifecycleEpoch: number;
  signal: AbortSignal;
}

function hasConsumableEarlyWorldTileCoverage(): boolean {
  if (typeof window === 'undefined') return false;
  const handle = window.__wampEarlyWorldTiles;
  return handle?.schemaVersion === 1
    && typeof handle.consumeCoverage === 'function'
    && Boolean(handle.ready);
}

async function consumeEarlyWorldTileCoverage(
  input: EarlyWorldTileCoverageConsumerInput,
): Promise<WorldTileManifest | null> {
  if (!input.rendererVersion || typeof window === 'undefined') return null;
  try {
    const handle = window.__wampEarlyWorldTiles;
    if (
      handle?.schemaVersion !== 1
      || typeof handle.consumeCoverage !== 'function'
      || !handle.ready
    ) return null;
    const state = await waitForEarlyWorldTileBootstrap(handle.ready, input.signal);
    input.signal.throwIfAborted();
    if (
      (state.status !== 'visible' && state.status !== 'ready-shadow')
      || state.rendererVersion !== input.rendererVersion
    ) return null;
    const handoff = handle.consumeCoverage({
      schemaVersion: 1,
      consumerGeneration: input.lifecycleEpoch,
      rendererVersion: input.rendererVersion,
      level: 0,
      targetBounds: { ...input.bounds },
    });
    if (
      !handoff
      || handoff.schemaVersion !== 1
      || !Number.isSafeInteger(handoff.bootstrapGeneration)
      || handoff.bootstrapGeneration <= 0
      || handoff.consumerGeneration !== input.lifecycleEpoch
    ) return null;
    const manifest = parseWorldTileManifest(handoff.manifest);
    if (!isCompatibleEarlyWorldTileCoverage(manifest, input.rendererVersion, input.bounds)) {
      return null;
    }
    return manifest;
  } catch (error) {
    if (input.signal.aborted) throw error;
    return null;
  }
}

function waitForEarlyWorldTileBootstrap<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      cleanup();
      reject(new DOMException('Early world tile handoff aborted.', 'AbortError'));
    };
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    signal.addEventListener('abort', handleAbort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function isCompatibleEarlyWorldTileCoverage(
  manifest: WorldTileManifest,
  rendererVersion: string,
  bounds: WorldTileBounds,
): boolean {
  if (
    manifest.level !== 0
    || manifest.rendererVersion !== rendererVersion
    || manifest.rooms.length !== 0
    || !equalWorldTileBounds(manifest.targetBounds, bounds)
  ) return false;
  const expectedCount = (bounds.maxTileX - bounds.minTileX + 1)
    * (bounds.maxTileY - bounds.minTileY + 1);
  if (manifest.entries.length !== expectedCount) return false;
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    if (
      entry.address.level !== 0
      || entry.address.rendererVersion !== rendererVersion
      || entry.address.x < bounds.minTileX
      || entry.address.x > bounds.maxTileX
      || entry.address.y < bounds.minTileY
      || entry.address.y > bounds.maxTileY
      || (!entry.ready && !(
        entry.desiredEmpty
        && entry.readyEmptyGeneration !== null
        && entry.readyEmptyGeneration >= entry.desiredGeneration
      ))
    ) return false;
    const key = `${entry.address.x},${entry.address.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function equalWorldTileBounds(left: WorldTileBounds, right: WorldTileBounds): boolean {
  return left.minTileX === right.minTileX
    && left.maxTileX === right.maxTileX
    && left.minTileY === right.minTileY
    && left.maxTileY === right.maxTileY;
}

function sameWorldTileAddresses(
  left: readonly WorldTileAddress[],
  right: readonly WorldTileAddress[],
): boolean {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map(worldTileAddressKey));
  return left.every((address) => rightKeys.has(worldTileAddressKey(address)));
}

function getCameraWorldRect(camera: Phaser.Cameras.Scene2D.Camera): WorldRect {
  const zoom = Math.max(camera.zoom, 0.001);
  const width = camera.width / zoom;
  const height = camera.height / zoom;
  const left = camera.scrollX + camera.width * camera.originX - width * 0.5;
  const top = camera.scrollY + camera.height * camera.originY - height * 0.5;
  return { left, top, right: left + width, bottom: top + height };
}

function getRectCenter(rect: WorldRect): { x: number; y: number } {
  return { x: (rect.left + rect.right) * 0.5, y: (rect.top + rect.bottom) * 0.5 };
}

function buildRequestSignature(level: WorldTileLevel, bounds: WorldTileBounds): string {
  return [
    level,
    bounds.minTileX,
    bounds.maxTileX,
    bounds.minTileY,
    bounds.maxTileY,
  ].join(':');
}

function getAddressDistance(address: WorldTileAddress, center: { x: number; y: number }): number {
  const bounds = worldRectToTileBounds(address.level, {
    left: center.x,
    top: center.y,
    right: center.x + 0.001,
    bottom: center.y + 0.001,
  });
  return Math.abs(address.x - bounds.minTileX) + Math.abs(address.y - bounds.minTileY);
}

function taskIdentity(entry: WorldTileManifestEntry): string {
  return `${worldTileAddressKey(entry.address)}:${entry.ready?.contentHash ?? 'empty'}`;
}

function assertDecodedDimensions(source: DecodedWorldTileSource, entry: WorldTileManifestEntry): void {
  if (!entry.ready) throw new Error('Cannot decode an empty world tile.');
  if (source.width !== entry.ready.width || source.height !== entry.ready.height) {
    closeDecodedSource(source);
    throw new Error(`World tile dimensions must be ${entry.ready.width}x${entry.ready.height}.`);
  }
}

function closeDecodedSource(source: DecodedWorldTileSource): void {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function parseRoomCoordinates(roomId: string): RoomCoordinates | null {
  const [x, y, ...rest] = roomId.split(',').map(Number);
  return rest.length === 0 && Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null;
}

function toTileProfile(profile: PerformanceProfile): 'normal' | 'reduced' {
  return profile === 'reduced' ? 'reduced' : 'normal';
}

async function getStorageQuota(): Promise<number | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    return (await navigator.storage.estimate()).quota ?? null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
