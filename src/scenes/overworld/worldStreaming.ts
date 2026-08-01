import Phaser from 'phaser';
import {
  decodeTileDataValue,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
} from '../../config';
import { resolveRoomBackground } from '../../backgrounds/model';
import {
  CustomBackgroundTexturePreparation,
  createBuiltInBackgroundObject,
  createCustomBackgroundLayer,
  createCustomBackgroundObject,
  ensureCustomBackgroundTexture,
  getCustomBackgroundTextureKey,
  getBuiltInBackgroundTileScale,
  syncBuiltInBackgroundObject,
  syncCustomBackgroundObject,
  type BuiltInBackgroundObject,
  type CustomBackgroundLayer,
  type CustomBackgroundObject,
} from '../../backgrounds/runtime';
import {
  cloneRoomSnapshot,
  getRoomSnapshotCloneCount as getGlobalRoomSnapshotCloneCount,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
  type RoomSnapshotView,
  type RoomSnapshotQueryDetail,
} from '../../persistence/roomModel';
import type { WorldRepository } from '../../persistence/worldRepository';
import {
  computeWorldChunkPreviewHash,
  computeWorldSummariesFromOccupancySummariesInBounds,
  containsWorldChunkBounds,
  createPublishedRoomSummary,
  createWorldWindowFromRoomBounds,
  isWithinRoomBounds,
  roomToChunkCoordinates,
  type WorldChunkBounds,
  type CompactWorldChunkWindow,
  type WorldChunkWindow,
  type WorldRoomBounds,
  type WorldRoomSummary,
  type WorldWindow,
} from '../../persistence/worldModel';
import {
  RETRO_COLORS,
  createStarfieldTileSprite,
  getStarfieldLayerConfig,
  syncStarfieldTileSprite,
} from '../../visuals/starfield';
import { buildRoomSnapshotTexture, buildRoomTextureKey } from '../../visuals/roomSnapshotTexture';
import { registerCustomSpritesFromSnapshot } from '../../customSprites/registry';
import {
  buildCustomRoomTileTextureKey,
  CustomRoomTileTexturePreparation,
  ensureCustomRoomTileTexture,
  ensureCustomRoomTilesetForMap,
} from '../../customTiles/runtime';
import {
  CUSTOM_ROOM_TILE_ATLAS_COLUMNS,
  CUSTOM_ROOM_TILE_ATLAS_ROWS,
} from '../../customTiles/model';
import {
  extractRoomStaticLightingEmitters,
  type RoomStaticLightingEmitters,
} from '../../lighting/emissiveSources';
import type { OverworldMode } from '../sceneData';
import { OverworldChunkPreviewRenderer } from './chunkPreviewRenderer';
import {
  OverworldPreviewCache,
  isRoomSnapshotReferenceChangedError,
  isStreamingRoomCandidateRenderable,
  type PlayableRoomSource,
  type RenderableRoom,
  type StreamingRoomCandidate,
} from './previewCache';
import {
  computeOverworldPreviewSelection,
  getChunkPreviewTileSize,
  getDesiredChunkBounds,
  type OverworldPreviewSelection,
  type PreviewSelectionCandidate,
} from './previewStreaming';
import type { PerformanceProfile } from '../../ui/deviceLayout';
import {
  getTerrainTileCollisionProfile,
  terrainTileDisablesTilemapCollision,
  terrainTileNeedsInsetBody,
} from './terrainCollision';
import {
  computeLocalPlayPressureMetrics,
  createDefaultLocalPlayPressureMetrics,
  type LocalPlayPressureMetrics,
} from './playPressure';
import { logBootPhase, startBootStallWatch } from '../../main/bootDiagnostics';
import {
  clearWorldReplacementCoverage,
  publishWorldReplacementCoverageReady,
  type WorldReplacementCoverageSource,
} from '../../main/worldReplacementCoverage';
import { WorldTileClientController } from './worldTiles/controller';
import {
  SelectedExactPrefetchLifecycle,
  type SelectedExactPrefetchRequest,
} from './selectedExactPrefetch';
import { shouldRenderLegacyWorldTileOverlay } from './worldTiles/dynamicOverlays';
import { processProgressivePreviewBatch } from './worldTiles/progressivePreviewBatch';
import { resolveWorldTileInitialCoverage } from './worldTiles/startup';
import {
  loadStartupDynamicOverlaySnapshots,
  stopStartupDynamicOverlayGeneration,
} from './worldTiles/dynamicOverlayStartup';
import {
  FRAME_WORK_PRIORITIES,
  FrameWorkCoordinator,
  type FrameWorkGeneration,
  type FrameWorkJobHandle,
  type FrameWorkPriority,
} from './frameWorkCoordinator';
import { RoomArtifactCache } from './roomArtifactCache';
import { RoomTexturePreparation } from './roomTexturePreparation';

const PLAY_ROOM_PARALLAX_MULTIPLIER = 0.2;
const FULL_ROOM_RELEASE_GRACE_MS = 300;
const TRANSITION_PREPARED_FULL_ROOM_RETAIN_MS = 1_500;
const PREDICTED_DESTINATION_INTENT_TTL_MS = 1_500;
const PLAYABLE_ROOM_PREFETCH_RETRY_DELAY_MS = 1_000;
const DEFERRED_PREVIEW_RENDER_DELAY_MS = 32;
const DYNAMIC_OVERLAY_RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;
const NORMAL_ROOM_ARTIFACT_CACHE_BYTES = 24 * 1024 * 1024;
const REDUCED_ROOM_ARTIFACT_CACHE_BYTES = 8 * 1024 * 1024;
const FRAME_TARGET_MS = 1_000 / 60;
const PREPARED_TEXTURE_ROWS_PER_JOB = 2;
const PREPARED_CUSTOM_TILES_PER_JOB = 4;
const PREPARED_TERRAIN_ROWS_PER_JOB = 4;
const PREPARED_LIVE_OBJECTS_PER_JOB = 4;
const TEARDOWN_LIVE_OBJECTS_PER_JOB = 4;
const TEARDOWN_INSET_BODIES_PER_JOB = 32;
const TEARDOWN_BACKGROUND_SPRITES_PER_JOB = 2;
const PREDICTED_SEAM_LOCK_DISTANCE_PX = 72;
const PREDICTED_VELOCITY_EPSILON = 1;
const PREDICTED_FALLBACK_SPEED_PX_PER_SEC = 150;
const PREDICTED_DESTINATION_SWITCH_HYSTERESIS_MS = 8;

export interface LoadedFullRoom<TLiveObject = unknown, TEdgeWall = unknown> {
  room: RoomSnapshot;
  source: PlayableRoomSource;
  staticLighting: RoomStaticLightingEmitters;
  backgroundColorRect: Phaser.GameObjects.Rectangle | null;
  backgroundSprites: LoadedRoomBackgroundSprite[];
  image: Phaser.GameObjects.Image;
  textureKey: string;
  foregroundImage: Phaser.GameObjects.Image | null;
  foregroundTextureKey: string | null;
  map: Phaser.Tilemaps.Tilemap;
  terrainLayer: Phaser.Tilemaps.TilemapLayer;
  terrainCollider: Phaser.Physics.Arcade.Collider | null;
  terrainInsetBodies: Phaser.Physics.Arcade.StaticGroup | null;
  terrainInsetCollider: Phaser.Physics.Arcade.Collider | null;
  edgeWalls: TEdgeWall[];
  liveObjects: TLiveObject[];
  artifactKey?: string;
  customRoomTileTextureKey?: string | null;
  collisionReady?: boolean;
  runtimeSuspended?: boolean;
}

type FullRoomPreparationPhase =
  | 'textures'
  | 'uploads'
  | 'custom-tiles'
  | 'custom-background'
  | 'runtime-shell'
  | 'terrain'
  | 'terrain-collision'
  | 'terrain-insets'
  | 'lighting'
  | 'objects'
  | 'ready'
  | 'commit'
  | 'waiting-for-teardown'
  | 'committed'
  | 'cancelled'
  | 'failed';

interface PendingFullRoomPreparation<TLiveObject, TEdgeWall> {
  identity: string;
  artifactKey: string;
  room: RoomSnapshot;
  source: PlayableRoomSource;
  generation: FrameWorkGeneration;
  priority: FrameWorkPriority;
  queuedJob: FrameWorkJobHandle | null;
  activationRequested: boolean;
  standardActivationRequested: boolean;
  portalActivationRequested: boolean;
  phase: FullRoomPreparationPhase;
  texturePreparation: RoomTexturePreparation | null;
  customTilePreparation: CustomRoomTileTexturePreparation | null;
  textureKey: string;
  foregroundTextureKey: string;
  committedTextureKeys: string[];
  loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall> | null;
  replacementRoom: LoadedFullRoom<TLiveObject, TEdgeWall> | null;
  disposedReplacementRoom: LoadedFullRoom<TLiveObject, TEdgeWall> | null;
  nextTerrainRow: number;
  nextInsetRow: number;
  insetBodyCount: number;
  nextLiveObjectIndex: number;
  customBackgroundReady: boolean;
  customBackgroundPreparation: CustomBackgroundTexturePreparation | null;
  backgroundPrepared: boolean;
}

interface PendingFullRoomTeardown<TLiveObject, TEdgeWall> {
  loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>;
  restoreCollisionReady: boolean;
  restoreRuntime: (() => void) | null;
  liveObjectReconciliationGeneration: number | null;
  phase: 'queued' | 'objects' | 'collision' | 'insets' | 'terrain' | 'backgrounds' | 'display' | 'finalize';
  destructionStarted: boolean;
  liveObjectRoomStateCleared: boolean;
  retainedAfterDestruction: boolean;
  commitAfterTeardown: PendingFullRoomPreparation<TLiveObject, TEdgeWall> | null;
  job: FrameWorkJobHandle | null;
}

interface PlayableRoomSnapshotPreparationRequest {
  priority: FrameWorkPriority;
  activationRequested: boolean;
  standardActivationRequested: boolean;
  portalActivationRequested: boolean;
  independentOfPredictedIntent: boolean;
}

interface PlayableRoomSummaryRecovery {
  summaryIdentity: string;
  refreshPromise: Promise<void> | null;
  retryAt: number;
}

interface LoadedRoomBackgroundSprite {
  sprite: BuiltInBackgroundObject | CustomBackgroundObject;
  parallax: number;
  tileScale: number;
  useVerticalParallax: boolean;
  builtInLayer?: { height: number; repeat?: boolean };
  customLayer?: CustomBackgroundLayer;
}

interface OverworldWorldStreamingControllerOptions<TLiveObject, TEdgeWall> {
  scene: Phaser.Scene;
  worldRepository: WorldRepository;
  getMode: () => OverworldMode;
  getPerformanceProfile: () => PerformanceProfile;
  getSelectedCoordinates: () => RoomCoordinates;
  getCurrentRoomCoordinates: () => RoomCoordinates;
  refreshRoomSummariesForTransition?: (centerCoordinates: RoomCoordinates) => Promise<boolean>;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  getPlayer: () => Phaser.GameObjects.GameObject | null;
  shouldCollidePlayerWithTerrainTile?: (tile: Phaser.Tilemaps.Tile) => boolean;
  createLiveObjects: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  createLiveObjectsBatch?: (
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    startIndex: number,
    endIndex: number,
    dormant: boolean,
  ) => number;
  finalizeLiveObjectCreation?: (
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    dormant: boolean,
  ) => void;
  onPreparedLiveObjectsReady?: (
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ) => void;
  setLiveObjectsDormant?: (
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    dormant: boolean,
  ) => void;
  destroyLiveObjects: (
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    options?: { preserveTriggerState?: boolean },
  ) => void;
  destroyLiveObjectsBatch?: (
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    maxObjectCount: number,
    options?: {
      preserveTriggerState?: boolean;
      clearRoomTriggerState?: boolean;
    },
  ) => boolean;
  destroyEdgeWalls: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  syncLiveObjectWorldColliders?: (
    loadedRooms: Iterable<LoadedFullRoom<TLiveObject, TEdgeWall>>,
  ) => void;
  setLiveObjectWorldCollisionTargetDormant?: (
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    dormant: boolean,
  ) => void;
  getLiveObjectPhysicsReconciliationGeneration?: () => number;
  syncLiveObjectInteractions?: (
    loadedRooms: Iterable<LoadedFullRoom<TLiveObject, TEdgeWall>>,
  ) => void;
  getProtectedFullRoomIds?: (targetFullRoomIds: ReadonlySet<string>) => Iterable<string>;
  onBackdropObjectsChanged?: () => void;
  onFullRoomVisibilityChanged?: () => void;
  onFullRoomSetChanged?: (coordinates: readonly RoomCoordinates[]) => void;
  onFullRoomCollisionReady?: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  onFullRoomDestroyed?: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  onFullRoomReplaced?: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  onSelectedExactRoomSnapshotReady?: (room: RoomSnapshot) => void;
  measurePerformance?: <T>(label: string, callback: () => T) => T;
}

export type WorldRefreshResult = 'success' | 'cancelled' | 'error';
export type ChunkWindowRefreshResult = 'updated' | 'unchanged' | 'cancelled' | 'error';

interface OptimisticWorldMutation {
  draftRoom?: RoomSnapshot | null;
  publishedRoom?: RoomSnapshot | null;
  clearDraftRoomId?: string | null;
  invalidateRoomId?: string | null;
}

export class OverworldWorldStreamingController<TLiveObject = unknown, TEdgeWall = unknown> {
  private destroyed = false;
  private loadGeneration = 0;
  private worldWindow: WorldWindow | null = null;
  private chunkWindow: WorldChunkWindow | null = null;
  private loadedRoomBounds: WorldRoomBounds | null = null;
  private loadedChunkBounds: WorldChunkBounds | null = null;
  private chunkPreviewHashesById = new Map<string, string>();
  private roomSummariesById = new Map<string, WorldRoomSummary>();
  private draftRoomsById = new Map<string, RoomSnapshot>();
  private transientRoomOverridesById = new Map<string, RoomSnapshot>();
  private presencePreviewRoomsById = new Map<string, RoomSnapshot>();
  private presencePreviewOwnedBySource = new WeakMap<RoomSnapshot, RoomSnapshot>();
  private optimisticPublishedRoomsById = new Map<string, RoomSnapshot>();
  private readonly previewCache: OverworldPreviewCache;
  private readonly previewRenderer: OverworldChunkPreviewRenderer;
  private readonly worldTileController: WorldTileClientController;
  private loadedFullRoomsById = new Map<string, LoadedFullRoom<TLiveObject, TEdgeWall>>();
  private fullRoomReleaseAtById = new Map<string, number>();
  private nearLodRoomIds = new Set<string>();
  private midLodRoomIds = new Set<string>();
  private farLodRoomIds = new Set<string>();
  private protectedVisiblePreviewRoomCount = 0;
  private visibleRoomIds = new Set<string>();
  private previewRoomBudget = 0;
  private fullRoomBudget = 0;
  private activeChunkRadius = 0;
  private localPlayPressure = createDefaultLocalPlayPressureMetrics();
  private chunkWindowRequestInFlight = false;
  private playableRoomSnapshotRequestsById = new Map<string, Promise<void>>();
  private playableRoomSnapshotRequestIntentGenerationById = new Map<string, number>();
  private playableRoomSnapshotPreparationRequestsById = new Map<
    string,
    PlayableRoomSnapshotPreparationRequest
  >();
  private playableRoomSnapshotRetryAtById = new Map<string, number>();
  private playableRoomSummaryRecoveriesById = new Map<string, PlayableRoomSummaryRecovery>();
  private compactWorldActive = false;
  private fullPreviewUpgradeGeneration = -1;
  private startupDynamicOverlayGeneration = -1;
  private dynamicOverlayReadinessGeneration = -1;
  private dynamicOverlayReadinessAbortController: AbortController | null = null;
  private legacyCompactRefreshGeneration = -1;
  private legacyCompactRefreshScheduled = false;
  private dynamicOverlayRetryAttempt = 0;
  private dynamicOverlayRetryTimer: Phaser.Time.TimerEvent | null = null;
  private deferredPreviewRooms: RoomSnapshot[] = [];
  private deferredPreviewRenderTimer: Phaser.Time.TimerEvent | null = null;
  private deferredPreviewRenderGeneration = -1;
  private fullRoomReleaseCleanupTimer: Phaser.Time.TimerEvent | null = null;
  private readonly textureNamespace: string;
  private readonly selectedExactPrefetchLifecycle: SelectedExactPrefetchLifecycle;
  private publishedReplacementCoverageKey: string | null = null;
  private roomSnapshotCloneCountBaseline = getGlobalRoomSnapshotCloneCount();
  private readonly frameWorkCoordinator: FrameWorkCoordinator;
  private readonly roomArtifactCache: RoomArtifactCache;
  private roomArtifactCacheProfile: 'normal' | 'reduced' | null = null;
  private artifactFocusRoomId: string | null = null;
  private pendingFullRoomPreparationsById = new Map<
    string,
    PendingFullRoomPreparation<TLiveObject, TEdgeWall>
  >();
  private previousRoomArtifactKey: string | null = null;
  private previousRoomArtifactRoomId: string | null = null;
  private predictedPreparationRoomId: string | null = null;
  private predictedPreparationCoordinates: RoomCoordinates | null = null;
  private predictedPreparationExpiresAt = 0;
  private predictedPreparationIntentGeneration = 0;
  private predictedPreparationExpiryTimer: Phaser.Time.TimerEvent | null = null;
  private portalPreparationRoomId: string | null = null;
  private pendingFullRoomTeardownsById = new Map<
    string,
    PendingFullRoomTeardown<TLiveObject, TEdgeWall>
  >();
  private pendingFullRoomTeardownReconciliationJob: FrameWorkJobHandle | null = null;
  private fullRoomTeardownReconciliationRequired = false;
  private fullRoomTeardownReconciliationGeneration: number | null = null;
  private retainedFullRoomIds = new Set<string>();

  constructor(private readonly options: OverworldWorldStreamingControllerOptions<TLiveObject, TEdgeWall>) {
    this.textureNamespace = sanitizeTextureNamespace(options.scene.sys.settings.key);
    this.previewCache = new OverworldPreviewCache(options.worldRepository);
    this.frameWorkCoordinator = new FrameWorkCoordinator({
      onJobError: (job, error) => {
        console.error(`Deferred overworld work failed (${job.label}).`, error);
      },
    });
    this.roomArtifactCache = new RoomArtifactCache(
      NORMAL_ROOM_ARTIFACT_CACHE_BYTES,
      (resourceKeys) => this.releaseRoomArtifactResources(resourceKeys),
    );
    const selected = options.getSelectedCoordinates();
    this.artifactFocusRoomId = roomIdFromCoordinates(options.getCurrentRoomCoordinates());
    this.selectedExactPrefetchLifecycle = new SelectedExactPrefetchLifecycle(
      roomIdFromCoordinates(selected),
    );
    this.previewRenderer = new OverworldChunkPreviewRenderer({
      scene: options.scene,
      getPreviewTileSize: () => this.getPreviewTileSize(),
      getFocusCoordinates: () => this.getFocusCoordinates(),
      getRoomOrigin: options.getRoomOrigin,
      isFullRoomLoaded: (roomId) => {
        const loadedRoom = this.loadedFullRoomsById.get(roomId);
        return Boolean(loadedRoom && loadedRoom.runtimeSuspended !== true);
      },
      workScheduler: this.frameWorkCoordinator,
      shouldScheduleWork: () => this.options.getMode() === 'play',
      onBackdropObjectsChanged: options.onBackdropObjectsChanged,
      onFullRoomVisibilityChanged: options.onFullRoomVisibilityChanged,
      measurePerformance: options.measurePerformance,
    });
    this.worldTileController = new WorldTileClientController({
      scene: options.scene,
      repository: options.worldRepository,
      getMode: options.getMode,
      // Local heavy-room pressure participates in the same reduced streaming
      // policy as dormant-room preparation, not only the device-wide profile.
      getPerformanceProfile: () => this.getEffectivePerformanceProfile(),
      getSelectedCoordinates: options.getSelectedCoordinates,
      onObjectsChanged: options.onBackdropObjectsChanged,
      onCoverageChanged: () => {
        if (!this.destroyed && this.loadedRoomBounds) this.refreshVisibleRoomsFromCache();
      },
      onCanonicalRoomReady: (roomId) => {
        if (!this.optimisticPublishedRoomsById.delete(roomId)) return;
        this.previewRenderer.invalidateRoomPreview(roomId);
        this.refreshVisibleRoomsFromCache();
      },
    });
  }

  private measure<T>(label: string, callback: () => T): T {
    return this.options.measurePerformance
      ? this.options.measurePerformance(label, callback)
      : callback();
  }

  private beginLoadGeneration(): number {
    this.clearPublishedReplacementCoverage();
    this.loadGeneration += 1;
    return this.loadGeneration;
  }

  private clearPublishedReplacementCoverage(): void {
    if (!this.publishedReplacementCoverageKey) return;
    clearWorldReplacementCoverage(this.publishedReplacementCoverageKey);
    this.publishedReplacementCoverageKey = null;
  }

  reset(selectionBaseline: RoomCoordinates = this.options.getSelectedCoordinates()): void {
    this.beginLoadGeneration();
    this.destroyed = false;
    this.cancelAllFullRoomPreparations('stream-reset');
    this.cancelPredictedPreparationExpiryTimer();
    this.cancelAllPendingFullRoomTeardowns('stream-reset', false);
    this.clearDisplayState();
    this.roomArtifactCache.clear();
    this.worldWindow = null;
    this.chunkWindow = null;
    this.loadedRoomBounds = null;
    this.loadedChunkBounds = null;
    this.chunkPreviewHashesById = new Map();
    this.roomSummariesById = new Map();
    this.draftRoomsById = new Map();
    this.transientRoomOverridesById = new Map();
    this.presencePreviewRoomsById = new Map();
    this.presencePreviewOwnedBySource = new WeakMap();
    this.optimisticPublishedRoomsById = new Map();
    this.previewCache.reset();
    this.previewRenderer.reset();
    this.loadedFullRoomsById = new Map();
    this.fullRoomReleaseAtById = new Map();
    this.nearLodRoomIds = new Set();
    this.midLodRoomIds = new Set();
    this.farLodRoomIds = new Set();
    this.visibleRoomIds = new Set();
    this.previewRoomBudget = 0;
    this.fullRoomBudget = 0;
    this.activeChunkRadius = 0;
    this.localPlayPressure = createDefaultLocalPlayPressureMetrics();
    this.chunkWindowRequestInFlight = false;
    this.playableRoomSnapshotRequestsById = new Map();
    this.playableRoomSnapshotRequestIntentGenerationById = new Map();
    this.playableRoomSnapshotPreparationRequestsById = new Map();
    this.playableRoomSnapshotRetryAtById = new Map();
    this.playableRoomSummaryRecoveriesById = new Map();
    this.roomSnapshotCloneCountBaseline = getGlobalRoomSnapshotCloneCount();
    this.previousRoomArtifactKey = null;
    this.previousRoomArtifactRoomId = null;
    this.artifactFocusRoomId = roomIdFromCoordinates(this.options.getCurrentRoomCoordinates());
    this.roomArtifactCacheProfile = null;
    this.predictedPreparationCoordinates = null;
    this.predictedPreparationExpiresAt = 0;
    this.predictedPreparationIntentGeneration += 1;
    this.portalPreparationRoomId = null;
    this.retainedFullRoomIds = new Set();
    this.pendingFullRoomTeardownReconciliationJob = null;
    this.fullRoomTeardownReconciliationRequired = false;
    this.fullRoomTeardownReconciliationGeneration = null;
    this.compactWorldActive = false;
    this.fullPreviewUpgradeGeneration = -1;
    this.startupDynamicOverlayGeneration = -1;
    this.cancelDynamicOverlayReadiness();
    this.legacyCompactRefreshGeneration = -1;
    this.cancelDynamicOverlayRetry();
    this.selectedExactPrefetchLifecycle.reset(roomIdFromCoordinates(selectionBaseline));
    this.worldTileController.reset(selectionBaseline);
    this.cancelDeferredFullRoomLoads();
    this.cancelDeferredPreviewRender();
    this.cancelFullRoomReleaseCleanup();
  }

  destroy(): void {
    this.beginLoadGeneration();
    this.destroyed = true;
    this.cancelAllFullRoomPreparations('stream-destroyed');
    this.cancelPredictedPreparationExpiryTimer();
    this.cancelAllPendingFullRoomTeardowns('stream-destroyed', false);
    this.cancelDeferredFullRoomLoads();
    this.cancelDeferredPreviewRender();
    this.cancelFullRoomReleaseCleanup();
    this.clearDisplayState();
    this.roomArtifactCache.clear();
    this.worldWindow = null;
    this.chunkWindow = null;
    this.loadedRoomBounds = null;
    this.loadedChunkBounds = null;
    this.chunkPreviewHashesById = new Map();
    this.roomSummariesById = new Map();
    this.draftRoomsById = new Map();
    this.transientRoomOverridesById = new Map();
    this.presencePreviewRoomsById = new Map();
    this.presencePreviewOwnedBySource = new WeakMap();
    this.optimisticPublishedRoomsById = new Map();
    this.previewCache.reset();
    this.previewRenderer.reset();
    this.loadedFullRoomsById = new Map();
    this.fullRoomReleaseAtById = new Map();
    this.nearLodRoomIds = new Set();
    this.midLodRoomIds = new Set();
    this.farLodRoomIds = new Set();
    this.visibleRoomIds = new Set();
    this.previewRoomBudget = 0;
    this.fullRoomBudget = 0;
    this.activeChunkRadius = 0;
    this.localPlayPressure = createDefaultLocalPlayPressureMetrics();
    this.chunkWindowRequestInFlight = false;
    this.playableRoomSnapshotRequestsById = new Map();
    this.playableRoomSnapshotRequestIntentGenerationById = new Map();
    this.playableRoomSnapshotPreparationRequestsById = new Map();
    this.playableRoomSnapshotRetryAtById = new Map();
    this.playableRoomSummaryRecoveriesById = new Map();
    this.previousRoomArtifactKey = null;
    this.previousRoomArtifactRoomId = null;
    this.artifactFocusRoomId = null;
    this.roomArtifactCacheProfile = null;
    this.predictedPreparationCoordinates = null;
    this.predictedPreparationExpiresAt = 0;
    this.predictedPreparationIntentGeneration += 1;
    this.portalPreparationRoomId = null;
    this.retainedFullRoomIds = new Set();
    this.pendingFullRoomTeardownReconciliationJob = null;
    this.fullRoomTeardownReconciliationRequired = false;
    this.fullRoomTeardownReconciliationGeneration = null;
    this.compactWorldActive = false;
    this.fullPreviewUpgradeGeneration = -1;
    this.startupDynamicOverlayGeneration = -1;
    this.cancelDynamicOverlayReadiness();
    this.legacyCompactRefreshGeneration = -1;
    this.cancelDynamicOverlayRetry();
    this.selectedExactPrefetchLifecycle.reset(
      roomIdFromCoordinates(this.options.getSelectedCoordinates()),
    );
    this.worldTileController.destroy();
  }

  setDraftRoom(room: RoomSnapshot): void {
    this.draftRoomsById.set(room.id, cloneRoomSnapshot(room));
  }

  clearDraftRoom(roomId: string): void {
    this.draftRoomsById.delete(roomId);
  }

  setTransientRoomOverride(room: RoomSnapshot): void {
    this.setTransientRoomOverrides([room]);
  }

  setTransientRoomOverrides(rooms: Iterable<RoomSnapshot>): void {
    const touchedRoomIds = new Set<string>();
    for (const room of rooms) {
      this.transientRoomOverridesById.set(room.id, cloneRoomSnapshot(room));
      this.invalidateRoomArtifacts(room.id, false, true);
      touchedRoomIds.add(room.id);
    }

    if (touchedRoomIds.size === 0) {
      return;
    }

    this.rebuildLoadedSummaryState();
    this.refreshVisibleRoomsFromCache();
  }

  syncPresencePreviewRooms(previews: Iterable<RoomSnapshot>): void {
    const nextPreviewsById = new Map<string, RoomSnapshot>();
    for (const preview of previews) {
      const currentPreview = this.presencePreviewRoomsById.get(preview.id) ?? null;
      nextPreviewsById.set(
        preview.id,
        this.ownChangedPresencePreview(preview, currentPreview),
      );
    }

    if (this.arePresencePreviewMapsIdentical(this.presencePreviewRoomsById, nextPreviewsById)) {
      return;
    }

    this.presencePreviewRoomsById = nextPreviewsById;
    this.refreshVisibleRoomsFromCache();
  }

  clearTransientRoomOverride(roomId: string): void {
    this.clearTransientRoomOverrides([roomId]);
  }

  clearTransientRoomOverrides(roomIds: Iterable<string>): void {
    const touchedRoomIds = new Set<string>();
    for (const roomId of roomIds) {
      if (!this.transientRoomOverridesById.delete(roomId)) {
        continue;
      }

      this.invalidateRoomArtifacts(roomId, false, true);
      touchedRoomIds.add(roomId);
    }

    if (touchedRoomIds.size === 0) {
      return;
    }

    this.rebuildLoadedSummaryState();
    this.refreshVisibleRoomsFromCache();
  }

  applyOptimisticMutation(mutation: OptimisticWorldMutation): void {
    const touchedRoomIds = new Set<string>();
    const nextDraftRoom = mutation.draftRoom ? cloneRoomSnapshot(mutation.draftRoom) : null;
    const nextPublishedRoom = mutation.publishedRoom ? cloneRoomSnapshot(mutation.publishedRoom) : null;

    if (mutation.clearDraftRoomId) {
      this.draftRoomsById.delete(mutation.clearDraftRoomId);
      touchedRoomIds.add(mutation.clearDraftRoomId);
    }

    if (nextDraftRoom) {
      this.draftRoomsById.set(nextDraftRoom.id, nextDraftRoom);
      touchedRoomIds.add(nextDraftRoom.id);
    }

    if (nextPublishedRoom) {
      nextPublishedRoom.status = 'published';
      this.draftRoomsById.delete(nextPublishedRoom.id);
      this.previewCache.setRoomSnapshot(nextPublishedRoom);
      this.roomSummariesById.set(nextPublishedRoom.id, createPublishedRoomSummary(nextPublishedRoom));
      this.optimisticPublishedRoomsById.set(nextPublishedRoom.id, nextPublishedRoom);
      this.worldTileController.trackOptimisticPublishedRoom(nextPublishedRoom.id, nextPublishedRoom.version);
      touchedRoomIds.add(nextPublishedRoom.id);
    }

    if (mutation.invalidateRoomId) {
      const wasPublished = this.roomSummariesById.get(mutation.invalidateRoomId)?.state === 'published';
      const shouldDropPublishedSnapshot = mutation.invalidateRoomId !== nextPublishedRoom?.id;
      this.invalidateRoomArtifacts(
        mutation.invalidateRoomId,
        shouldDropPublishedSnapshot,
        mutation.invalidateRoomId === nextDraftRoom?.id
          || mutation.invalidateRoomId === nextPublishedRoom?.id,
      );
      if (wasPublished && !nextPublishedRoom) {
        this.optimisticPublishedRoomsById.delete(mutation.invalidateRoomId);
        this.worldTileController.maskRoomUntilConverged(mutation.invalidateRoomId);
      }
      touchedRoomIds.add(mutation.invalidateRoomId);
    }

    if (nextDraftRoom) {
      this.invalidateRoomArtifacts(nextDraftRoom.id, false, true);
    }

    if (nextPublishedRoom) {
      this.invalidateRoomArtifacts(nextPublishedRoom.id, false, true);
    }

    if (touchedRoomIds.size === 0) {
      return;
    }

    this.rebuildLoadedSummaryState();
    this.refreshVisibleRoomsFromCache();
  }

  async refreshAround(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean } = {}
  ): Promise<WorldRefreshResult> {
    if (this.chunkWindowRequestInFlight) {
      logBootPhase('world-stream:cancelled-in-flight', {
        center: centerCoordinates,
      });
      return 'cancelled';
    }

    const generation = this.beginLoadGeneration();
    this.legacyCompactRefreshGeneration = -1;
    this.beginDynamicOverlayReadiness(generation);
    this.startupDynamicOverlayGeneration = -1;
    this.cancelDynamicOverlayRetry();
    this.chunkWindowRequestInFlight = true;
    const cancelRefreshStallWatch = startBootStallWatch('world stream refresh', 10000, () => ({
      center: centerCoordinates,
      forceChunkReload: Boolean(options.forceChunkReload),
      generation,
      mode: this.options.getMode(),
      loadedChunkBounds: this.loadedChunkBounds,
    }));
    logBootPhase('world-stream:start', {
      center: centerCoordinates,
      forceChunkReload: Boolean(options.forceChunkReload),
      generation,
      mode: this.options.getMode(),
    });

    try {
      const initialWorldTileCoveragePromise = resolveWorldTileInitialCoverage({
        prepare: () => this.worldTileController.prepare(),
        shouldLoadInitialCoverage: () => (
          !this.destroyed
          && generation === this.loadGeneration
          && this.options.getMode() === 'browse'
        ),
        ensureInitialCoverage: () => (
          this.worldTileController.ensureInitialCoverage(this.options.scene.cameras.main)
        ),
        shouldAwaitInitialCoverage: () => !this.worldTileController.isShadowMode(),
        onError: (error) => console.warn('Initial tiled world coverage stopped.', error),
      });
      if (this.destroyed || generation !== this.loadGeneration) return 'cancelled';
      const desiredChunkBounds = this.getDesiredChunkBounds(centerCoordinates);
      if (
        options.forceChunkReload ||
        !this.chunkWindow ||
        !this.loadedChunkBounds ||
        !containsWorldChunkBounds(this.loadedChunkBounds, desiredChunkBounds)
      ) {
        logBootPhase('world-stream:chunk-window:start', {
          desiredChunkBounds,
        });
        const cancelChunkStallWatch = startBootStallWatch('world chunk window', 8000, () => ({
          desiredChunkBounds,
        }));
        let chunkWindow: WorldChunkWindow;
        let compactWorldActive = false;
        try {
          const compactWindow = await this.options.worldRepository.loadCompactWorldChunkWindow(desiredChunkBounds);
          if (compactWindow) {
            chunkWindow = compactWorldWindowToLegacyShell(compactWindow);
            compactWorldActive = true;
          } else {
            chunkWindow = await this.options.worldRepository.loadWorldChunkWindow(desiredChunkBounds);
          }
        } finally {
          cancelChunkStallWatch();
        }
        if (this.destroyed || generation !== this.loadGeneration) {
          return 'cancelled';
        }
        logBootPhase('world-stream:chunk-window:done', summarizeChunkWindow(chunkWindow));
        this.applyChunkWindow(chunkWindow, compactWorldActive);
      }

      if (this.compactWorldActive) {
        // Suppress coverage callbacks from starting the same full-preview
        // upgrade while the startup path is deciding between tiled cutover and
        // the legacy compact gate.
        this.startupDynamicOverlayGeneration = generation;
        logBootPhase('world-stream:initial-tile-coverage:await-start', {
          generation,
          mode: this.options.getMode(),
        });
        const initialTileCoverageReady = await initialWorldTileCoveragePromise;
        logBootPhase('world-stream:initial-tile-coverage:await-done', {
          generation,
          ready: initialTileCoverageReady,
        });
        if (this.destroyed || generation !== this.loadGeneration) return 'cancelled';
      }

      let roomCandidates = this.collectVisibleRoomCandidates();
      this.visibleRoomIds = new Set(roomCandidates.keys());
      let previewSelection = this.computePreviewSelection(roomCandidates);
      let previewRoomIds = previewSelection.previewRoomIds;
      let fullRoomIds = previewSelection.fullRoomIds;
      let renderedPreviewRoomIds = this.getRenderedPreviewRoomIds(roomCandidates, previewRoomIds);
      let snapshotDetail: RoomSnapshotQueryDetail = 'full';
      let tiledBrowseCutover = false;
      if (this.compactWorldActive) {
        snapshotDetail = this.getPreviewSnapshotDetail();
        tiledBrowseCutover = this.worldTileController.isBrowseCutoverActive();
        if (!tiledBrowseCutover) {
          this.startupDynamicOverlayGeneration = -1;
        }
        const selectedNearRoomIds = this.getNearestPreviewRoomIds(
          roomCandidates,
          renderedPreviewRoomIds,
          fullRoomIds,
          9,
        );
        const nearRoomIds = tiledBrowseCutover
          ? this.getRenderedPreviewRoomIds(roomCandidates, selectedNearRoomIds)
          : selectedNearRoomIds;
        try {
          let snapshotBatchCompleted = false;
          logBootPhase('world-stream:nearest-dynamic-snapshots:start', {
            generation,
            roomCount: nearRoomIds.size,
            detail: snapshotDetail,
            tiledBrowseCutover,
          });
          if (tiledBrowseCutover) {
            this.startupDynamicOverlayGeneration = generation;
            if (snapshotDetail === 'full') {
              this.fullPreviewUpgradeGeneration = generation;
            }
          }
          await loadStartupDynamicOverlaySnapshots({
            awaitBeforeReady: !tiledBrowseCutover,
            waitForDeferredStart: tiledBrowseCutover
              ? () => this.waitForDynamicOverlayTargetLod(generation)
              : undefined,
            onDeferredStartStopped: () => this.handleDynamicOverlayReadinessStopped(
              generation,
            ),
            loadSnapshots: async () => {
              try {
                await this.previewCache.ensureRoomSnapshotsBatch(roomCandidates, nearRoomIds, {
                  priority: 'high',
                  detail: snapshotDetail,
                });
                snapshotBatchCompleted = true;
              } finally {
                logBootPhase('world-stream:nearest-dynamic-snapshots:done', {
                  generation,
                  roomCount: nearRoomIds.size,
                  detail: snapshotDetail,
                  completed: snapshotBatchCompleted,
                  deferred: tiledBrowseCutover,
                });
              }
            },
            isCurrent: () => this.isLoadGenerationCurrent(generation),
            mergeDeferredSnapshots: async () => {
              await this.mergeDeferredDynamicOverlays(
                generation,
                roomCandidates,
                nearRoomIds,
                fullRoomIds,
              );
              if (!this.isLoadGenerationCurrent(generation)) return;
              if (tiledBrowseCutover) {
                await this.loadDistantPreviewsProgressively(
                  generation,
                  roomCandidates,
                  renderedPreviewRoomIds,
                  fullRoomIds,
                  snapshotDetail,
                  true,
                );
              }
              if (!this.isLoadGenerationCurrent(generation)) return;
              this.startupDynamicOverlayGeneration = -1;
              this.dynamicOverlayRetryAttempt = 0;
              this.cancelDynamicOverlayRetry();
            },
            onDeferredError: (error) => this.scheduleDynamicOverlayRetry(
              generation,
              snapshotDetail,
              error,
            ),
          });
        } catch (error) {
          console.warn('Compact snapshot loading failed; retrying with legacy world chunks.', error);
          const fallbackBounds = this.loadedChunkBounds ?? this.getDesiredChunkBounds(centerCoordinates);
          const legacyWindow = await this.options.worldRepository.loadWorldChunkWindow(fallbackBounds);
          if (this.destroyed || generation !== this.loadGeneration) return 'cancelled';
          this.applyChunkWindow(legacyWindow, false);
          roomCandidates = this.collectVisibleRoomCandidates();
          this.visibleRoomIds = new Set(roomCandidates.keys());
          previewSelection = this.computePreviewSelection(roomCandidates);
          previewRoomIds = previewSelection.previewRoomIds;
          fullRoomIds = previewSelection.fullRoomIds;
          renderedPreviewRoomIds = this.getRenderedPreviewRoomIds(roomCandidates, previewRoomIds);
        }
        if (this.destroyed || generation !== this.loadGeneration) return 'cancelled';
      }
      logBootPhase('world-stream:renderables:start', {
        visibleRoomCount: this.visibleRoomIds.size,
        previewRoomCount: previewRoomIds.size,
        fullRoomCount: fullRoomIds.size,
      });
      const cancelRenderableStallWatch = startBootStallWatch('world renderable rooms', 8000, () => ({
        visibleRoomCount: this.visibleRoomIds.size,
        previewRoomCount: previewRoomIds.size,
        fullRoomCount: fullRoomIds.size,
      }));
      let renderableRooms: Map<string, RenderableRoom>;
      try {
        renderableRooms = await this.previewCache.collectRenderableRooms(
          roomCandidates,
          renderedPreviewRoomIds,
          fullRoomIds
        );
      } finally {
        cancelRenderableStallWatch();
      }
      if (this.destroyed || generation !== this.loadGeneration) {
        return 'cancelled';
      }
      logBootPhase('world-stream:renderables:done', {
        renderableRoomCount: renderableRooms.size,
      });

      this.cancelDeferredPreviewRender();
      this.renderChunkPreviewsForGeneration(
        this.collectPreviewRooms(renderableRooms, renderedPreviewRoomIds),
        generation,
      );

      if (this.options.getMode() === 'play') {
        this.syncPlayFullRooms(renderableRooms, fullRoomIds);
      } else {
        this.cancelDeferredFullRoomLoads();
      }

      this.previewRenderer.unloadOutsideWindow(this.visibleRoomIds, renderedPreviewRoomIds);
      this.previewCache.pruneSnapshots(
        this.visibleRoomIds,
        this.getProtectedExactSnapshotRoomIds(),
      );
      this.unloadFullRoomsOutsideStream(
        this.options.getMode() === 'play'
          ? this.getRetainedFullRoomIds(fullRoomIds)
          : this.getRetainedBrowseFullRoomIds(fullRoomIds)
      );
      if (this.compactWorldActive) {
        if (!tiledBrowseCutover) {
          void this.loadDistantPreviewsProgressively(
            generation,
            roomCandidates,
            renderedPreviewRoomIds,
            fullRoomIds,
            snapshotDetail,
          ).catch((error) => console.warn('Progressive world preview loading stopped', error));
        }
        if (
          snapshotDetail === 'full'
          && !this.worldTileController.isBrowseCutoverActive()
        ) {
          this.fullPreviewUpgradeGeneration = generation;
        }
      }
      logBootPhase('world-stream:success', {
        visibleRoomCount: this.visibleRoomIds.size,
        loadedPreviewRoomCount: this.previewRenderer.getLoadedPreviewRoomCount(),
        loadedFullRoomCount: this.loadedFullRoomsById.size,
      });
      return 'success';
    } catch (error) {
      logBootPhase(
        'world-stream:error',
        { message: error instanceof Error ? error.message : String(error) },
        { level: 'error' }
      );
      console.error('[wamp boot] Failed during world stream refresh', error);
      return 'error';
    } finally {
      this.chunkWindowRequestInFlight = false;
      cancelRefreshStallWatch();
      this.maybeStartLegacyCompactRefresh();
    }
  }

  async refreshLoadedChunksIfChanged(
    centerCoordinates: RoomCoordinates
  ): Promise<ChunkWindowRefreshResult> {
    if (this.chunkWindowRequestInFlight || !this.loadedChunkBounds || !this.chunkWindow) {
      return 'cancelled';
    }

    const desiredChunkBounds = this.getDesiredChunkBounds(centerCoordinates);
    if (!containsWorldChunkBounds(this.loadedChunkBounds, desiredChunkBounds)) {
      return 'cancelled';
    }

    const requestGeneration = this.loadGeneration;
    this.legacyCompactRefreshGeneration = -1;
    this.chunkWindowRequestInFlight = true;

    try {
      const compactWindow = this.compactWorldActive
        ? await this.options.worldRepository.loadCompactWorldChunkWindow(this.loadedChunkBounds)
        : null;
      const nextChunkWindow = compactWindow
        ? compactWorldWindowToLegacyShell(compactWindow)
        : await this.options.worldRepository.loadWorldChunkWindow(this.loadedChunkBounds);
      if (this.destroyed || requestGeneration !== this.loadGeneration) {
        return 'cancelled';
      }

      if (!this.haveChunkPreviewHashesChanged(nextChunkWindow)) {
        this.captureChunkPreviewHashes(nextChunkWindow);
        return 'unchanged';
      }

      const generation = this.beginLoadGeneration();
      this.beginDynamicOverlayReadiness(generation);
      this.applyChunkWindow(nextChunkWindow, compactWindow !== null);
      this.refreshVisibleRoomsFromCache();
      return 'updated';
    } catch {
      return 'error';
    } finally {
      this.chunkWindowRequestInFlight = false;
    }
  }

  needsRefreshAround(centerCoordinates: RoomCoordinates): boolean {
    const desiredChunkBounds = this.getDesiredChunkBounds(centerCoordinates);
    return !this.loadedChunkBounds || !containsWorldChunkBounds(this.loadedChunkBounds, desiredChunkBounds);
  }

  refreshVisibleSelectionFromCache(): void {
    this.refreshVisibleRoomsFromCache();
  }

  syncPreviewVisibility(): void {
    this.previewRenderer.syncPreviewVisibility();
  }

  updateWorldTiles(): boolean {
    // Portal/current-destination preparation owns the first claim on the
    // reduced CPU budget. Letting world-tile preview work run first can leave
    // every 1 ms destination stage permanently inadmissible.
    if (
      this.frameWorkCoordinator.hasQueuedWorkAtPriority('portal-current-destination')
    ) {
      return false;
    }
    this.worldTileController.update(this.options.scene.cameras.main);
    if (!this.worldTileController.isBrowseCutoverActive()) {
      this.selectedExactPrefetchLifecycle.pause();
      this.previewCache.cancelSelectionPrefetchesExcept(null);
      return true;
    }
    const selected = this.options.getSelectedCoordinates();
    const roomId = roomIdFromCoordinates(selected);
    this.previewCache.cancelSelectionPrefetchesExcept(roomId);
    const summary = this.roomSummariesById.get(roomId);
    if (!summary) return true;
    if (summary.state !== 'published') {
      this.selectedExactPrefetchLifecycle.markAvailable(roomId);
      return true;
    }
    const cachedPublishedRoom = this.previewCache.getFullRoomSnapshot(roomId);
    const missingAtStart = !cachedPublishedRoom
      || (summary.version !== null && cachedPublishedRoom.version !== summary.version);

    const request = this.selectedExactPrefetchLifecycle.begin({
      roomId,
      targetLodReady: this.worldTileController.isTargetLodReady(
        this.options.scene.cameras.main,
      ),
      missingAtStart,
      nowMs: performance.now(),
    });
    if (!request) return true;
    void this.previewCache.prefetchPublishedRoom(summary).then(
      (room) => this.completeSelectedExactPrefetch(request, room),
      () => this.completeSelectedExactPrefetch(request, null),
    );
    return true;
  }

  runDiscretionaryFrameWork(
    criticalFrameElapsedMs: number,
    sharedBudgetConsumedMs = 0,
  ): void {
    if (this.destroyed || this.options.getMode() !== 'play') {
      return;
    }
    const effectiveProfile = this.getEffectivePerformanceProfile() === 'reduced'
      ? 'reduced'
      : 'normal';
    if (effectiveProfile !== this.roomArtifactCacheProfile) {
      this.syncRoomArtifactCachePolicy();
    }
    const criticalHeadroomMs = Math.max(0, FRAME_TARGET_MS - criticalFrameElapsedMs);
    this.measure('stream.frameWorkCoordinator', () => {
      this.frameWorkCoordinator.runFrame({
        profile: effectiveProfile,
        criticalHeadroomMs,
        sharedBudgetConsumedMs,
        cpuBudgetConsumedMs: sharedBudgetConsumedMs,
      });
    });
  }

  isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean {
    return this.loadedRoomBounds ? isWithinRoomBounds(coordinates, this.loadedRoomBounds) : false;
  }

  getRoomSnapshotViewForCoordinates(coordinates: RoomCoordinates): RoomSnapshotView | null {
    const roomId = roomIdFromCoordinates(coordinates);
    const transientRoom = this.transientRoomOverridesById.get(roomId);
    if (transientRoom) {
      return transientRoom;
    }

    const draftRoom = this.draftRoomsById.get(roomId);
    if (draftRoom) {
      return draftRoom;
    }

    const presencePreviewRoom = this.presencePreviewRoomsById.get(roomId);
    if (presencePreviewRoom) {
      return presencePreviewRoom;
    }

    const optimisticPublishedRoom = this.optimisticPublishedRoomsById.get(roomId);
    if (optimisticPublishedRoom) return optimisticPublishedRoom;

    const loadedFullRoom = this.loadedFullRoomsById.get(roomId);
    if (loadedFullRoom) {
      return loadedFullRoom.room;
    }

    return this.previewCache.getRoomSnapshot(roomId);
  }

  cloneRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null {
    const room = this.getRoomSnapshotViewForCoordinates(coordinates);
    if (!room) return null;
    return cloneRoomSnapshot(room);
  }

  /** @deprecated Runtime readers should use `getRoomSnapshotViewForCoordinates`. */
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null {
    return this.cloneRoomSnapshotForCoordinates(coordinates);
  }

  getPlayableRoomSnapshotViewForCoordinates(
    coordinates: RoomCoordinates,
  ): RoomSnapshotView | null {
    const roomId = roomIdFromCoordinates(coordinates);
    const transientRoom = this.transientRoomOverridesById.get(roomId);
    if (transientRoom) {
      return transientRoom;
    }

    const draftRoom = this.draftRoomsById.get(roomId);
    if (draftRoom) {
      return draftRoom;
    }

    const optimisticPublishedRoom = this.optimisticPublishedRoomsById.get(roomId);
    if (optimisticPublishedRoom) {
      return optimisticPublishedRoom;
    }

    const roomSummary = this.roomSummariesById.get(roomId) ?? null;
    const presencePreviewRoom = this.presencePreviewRoomsById.get(roomId);
    if (presencePreviewRoom && roomSummary?.state !== 'published') {
      return presencePreviewRoom;
    }

    const loadedFullRoom = this.loadedFullRoomsById.get(roomId);
    if (loadedFullRoom) {
      return loadedFullRoom.room;
    }

    return this.getCurrentCachedFullRoomSnapshot(roomSummary);
  }

  /** @deprecated Runtime readers should use `getPlayableRoomSnapshotViewForCoordinates`. */
  getPlayableRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null {
    const room = this.getPlayableRoomSnapshotViewForCoordinates(coordinates);
    if (!room) return null;
    return cloneRoomSnapshot(room);
  }

  getRoomSnapshotCloneCountSinceReset(): number {
    return Math.max(
      0,
      getGlobalRoomSnapshotCloneCount() - this.roomSnapshotCloneCountBaseline,
    );
  }

  isPlayableRoomCollisionReady(coordinates: RoomCoordinates): boolean {
    const loadedRoom = this.loadedFullRoomsById.get(roomIdFromCoordinates(coordinates));
    if (!loadedRoom || loadedRoom.collisionReady !== true) {
      return false;
    }
    return this.isLoadedRoomCollisionInfrastructureReady(loadedRoom);
  }

  private isLoadedRoomCollisionInfrastructureReady(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): boolean {
    const player = this.options.getPlayer?.();
    if (!player) {
      return true;
    }

    return Boolean(
      loadedRoom.terrainCollider?.active
      && (
        !loadedRoom.terrainInsetBodies
        || loadedRoom.terrainInsetCollider?.active
      )
    );
  }

  prefetchPlayableRoomForTransition(coordinates: RoomCoordinates): void {
    const roomId = roomIdFromCoordinates(coordinates);
    if (this.portalPreparationRoomId && this.portalPreparationRoomId !== roomId) {
      return;
    }
    this.requestPlayableRoomSnapshotForTransition(coordinates, {
      priority: this.getTransitionPreparationPriority(coordinates),
      activationRequested: false,
      standardActivationRequested: false,
      portalActivationRequested: false,
      independentOfPredictedIntent: false,
    });
  }

  private requestPlayableRoomSnapshotForTransition(
    coordinates: RoomCoordinates,
    requestedPreparation: PlayableRoomSnapshotPreparationRequest,
  ): void {
    const roomId = roomIdFromCoordinates(coordinates);
    const now = this.options.scene.time.now;

    if (this.waitForPlayableRoomSummaryRecovery(roomId)) {
      return;
    }

    const cachedRenderableRoom = this.resolveTransitionRenderableRoom(coordinates);
    if (cachedRenderableRoom) {
      const preparation = this.beginFullRoomPreparation(
        cachedRenderableRoom,
        requestedPreparation.priority,
        !requestedPreparation.independentOfPredictedIntent,
        false,
      );
      if (requestedPreparation.activationRequested && preparation) {
        this.applySnapshotPreparationActivationOwners(preparation, requestedPreparation);
      }
      return;
    }
    if (
      !requestedPreparation.independentOfPredictedIntent
      && !this.adoptPredictedPreparation(roomId, coordinates)
    ) return;
    if (this.isPlayableRoomCollisionReady(coordinates)) return;
    const intentGeneration = this.predictedPreparationIntentGeneration;
    const existingRequest = this.playableRoomSnapshotRequestsById.get(roomId) ?? null;
    const existingPreparationRequest =
      this.playableRoomSnapshotPreparationRequestsById.get(roomId) ?? null;
    if (
      existingRequest
      && (
        requestedPreparation.independentOfPredictedIntent
        || existingPreparationRequest?.independentOfPredictedIntent
        || this.playableRoomSnapshotRequestIntentGenerationById.get(roomId) === intentGeneration
      )
    ) {
      this.mergePlayableRoomSnapshotPreparationRequest(roomId, requestedPreparation);
      if (!requestedPreparation.independentOfPredictedIntent) {
        this.playableRoomSnapshotRequestIntentGenerationById.set(roomId, intentGeneration);
      }
      return;
    }
    if ((this.playableRoomSnapshotRetryAtById.get(roomId) ?? 0) > now) return;

    const summary = this.roomSummariesById.get(roomId) ?? null;
    let snapshotRequest: Promise<void>;
    if (summary && (summary.state === 'published' || summary.state === 'claimed_unpublished')) {
      const candidate: StreamingRoomCandidate = {
        id: roomId,
        coordinates: { ...coordinates },
        summary,
        draft: null,
        sharedPreview: null,
        allowFullRoomLoad: true,
        source: summary.state === 'published' ? 'published' : 'saved_construction_draft',
      };
      snapshotRequest = this.previewCache.ensureRoomSnapshotsBatch(
        new Map([[roomId, candidate]]),
        [roomId],
        { detail: 'full', priority: 'high' },
      );
    } else if (requestedPreparation.independentOfPredictedIntent) {
      // Distant course/expanded-room portals may legitimately target a room
      // outside the current world-window summaries. Query that published room
      // directly instead of waiting for unrelated camera discovery.
      snapshotRequest = this.previewCache.ensureCurrentPublishedRoomSnapshot(
        roomId,
        coordinates,
        { detail: 'full', priority: 'high' },
      ).then(() => undefined);
    } else {
      return;
    }

    let request: Promise<void>;
    request = snapshotRequest.then(() => {
      const pendingRequest = this.playableRoomSnapshotPreparationRequestsById.get(roomId);
      if (
        this.playableRoomSnapshotRequestsById.get(roomId) === request
        && pendingRequest
        && this.isPlayableRoomSnapshotPreparationRequestCurrent(roomId, pendingRequest)
      ) {
        this.playableRoomSnapshotRetryAtById.delete(roomId);
        const renderableRoom = this.resolveTransitionRenderableRoom(coordinates);
        if (renderableRoom) {
          const preparation = this.beginFullRoomPreparation(
            renderableRoom,
            pendingRequest.priority,
            !pendingRequest.independentOfPredictedIntent,
            false,
          );
          if (pendingRequest.activationRequested && preparation) {
            this.applySnapshotPreparationActivationOwners(preparation, pendingRequest);
          }
        }
      }
    }).catch((error) => {
      const pendingRequest = this.playableRoomSnapshotPreparationRequestsById.get(roomId);
      if (
        this.playableRoomSnapshotRequestsById.get(roomId) === request
        && pendingRequest
        && this.isPlayableRoomSnapshotPreparationRequestCurrent(roomId, pendingRequest)
      ) {
        if (isRoomSnapshotReferenceChangedError(error) && error.roomIds.includes(roomId)) {
          const staleSummary = this.roomSummariesById.get(roomId) ?? null;
          if (staleSummary) {
            this.beginPlayableRoomSummaryRecovery(roomId, staleSummary);
            console.warn(
              `Playable room ${roomId} changed while preparing; refreshing world summaries.`,
              error,
            );
            return;
          }
        }
        this.playableRoomSnapshotRetryAtById.set(
          roomId,
          this.options.scene.time.now + PLAYABLE_ROOM_PREFETCH_RETRY_DELAY_MS,
        );
        console.warn(`Playable room ${roomId} could not be prepared before transition.`, error);
      }
    }).finally(() => {
      if (this.playableRoomSnapshotRequestsById.get(roomId) === request) {
        this.playableRoomSnapshotRequestsById.delete(roomId);
        this.playableRoomSnapshotRequestIntentGenerationById.delete(roomId);
        this.playableRoomSnapshotPreparationRequestsById.delete(roomId);
      }
    });
    this.playableRoomSnapshotRequestsById.set(roomId, request);
    this.playableRoomSnapshotRequestIntentGenerationById.set(roomId, intentGeneration);
    this.playableRoomSnapshotPreparationRequestsById.set(roomId, {
      ...requestedPreparation,
    });
  }

  private beginPlayableRoomSummaryRecovery(
    roomId: string,
    summary: WorldRoomSummary,
  ): void {
    const summaryIdentity = this.buildPlayableRoomSummaryIdentity(summary);
    const existing = this.playableRoomSummaryRecoveriesById.get(roomId);
    if (!existing || existing.summaryIdentity !== summaryIdentity) {
      this.playableRoomSummaryRecoveriesById.set(roomId, {
        summaryIdentity,
        refreshPromise: null,
        retryAt: 0,
      });
    }
    this.playableRoomSnapshotRetryAtById.delete(roomId);
    this.waitForPlayableRoomSummaryRecovery(roomId);
  }

  private waitForPlayableRoomSummaryRecovery(roomId: string): boolean {
    const recovery = this.playableRoomSummaryRecoveriesById.get(roomId) ?? null;
    if (!recovery) return false;

    const currentSummary = this.roomSummariesById.get(roomId) ?? null;
    if (
      !currentSummary
      || this.buildPlayableRoomSummaryIdentity(currentSummary) !== recovery.summaryIdentity
    ) {
      this.playableRoomSummaryRecoveriesById.delete(roomId);
      this.playableRoomSnapshotRetryAtById.delete(roomId);
      return false;
    }

    const now = this.options.scene.time.now;
    if (recovery.refreshPromise || now < recovery.retryAt) return true;

    let refreshRequest: Promise<boolean>;
    try {
      refreshRequest = this.options.refreshRoomSummariesForTransition
        ? this.options.refreshRoomSummariesForTransition({
            ...this.options.getCurrentRoomCoordinates(),
          })
        : this.refreshAround(
            this.options.getCurrentRoomCoordinates(),
            { forceChunkReload: true },
          ).then((result) => result === 'success');
    } catch (error) {
      console.warn(`Could not refresh changed room summary ${roomId}.`, error);
      recovery.retryAt = now + 50;
      return true;
    }

    let refreshSucceeded = false;
    const refreshPromise = refreshRequest
      .then((success) => {
        refreshSucceeded = success;
      })
      .catch((error) => {
        console.warn(`Could not refresh changed room summary ${roomId}.`, error);
      })
      .finally(() => {
        if (this.playableRoomSummaryRecoveriesById.get(roomId) !== recovery) return;
        recovery.refreshPromise = null;
        const refreshedSummary = this.roomSummariesById.get(roomId) ?? null;
        if (
          !refreshedSummary
          || this.buildPlayableRoomSummaryIdentity(refreshedSummary) !== recovery.summaryIdentity
        ) {
          this.playableRoomSummaryRecoveriesById.delete(roomId);
          this.playableRoomSnapshotRetryAtById.delete(roomId);
          return;
        }
        recovery.retryAt = this.options.scene.time.now
          + (refreshSucceeded ? PLAYABLE_ROOM_PREFETCH_RETRY_DELAY_MS : 50);
      });
    recovery.refreshPromise = refreshPromise;
    return true;
  }

  private buildPlayableRoomSummaryIdentity(summary: WorldRoomSummary): string {
    return [
      summary.id,
      summary.state,
      summary.coordinates.x,
      summary.coordinates.y,
      summary.version ?? 'none',
      summary.previewUpdatedAt ?? 'none',
    ].join(':');
  }

  private mergePlayableRoomSnapshotPreparationRequest(
    roomId: string,
    requestedPreparation: PlayableRoomSnapshotPreparationRequest,
  ): void {
    const existing = this.playableRoomSnapshotPreparationRequestsById.get(roomId);
    if (!existing) {
      this.playableRoomSnapshotPreparationRequestsById.set(roomId, {
        ...requestedPreparation,
      });
      return;
    }
    if (this.isHigherFrameWorkPriority(requestedPreparation.priority, existing.priority)) {
      existing.priority = requestedPreparation.priority;
    }
    existing.activationRequested ||= requestedPreparation.activationRequested;
    existing.standardActivationRequested ||=
      requestedPreparation.standardActivationRequested;
    existing.portalActivationRequested ||=
      requestedPreparation.portalActivationRequested;
    existing.activationRequested =
      existing.standardActivationRequested || existing.portalActivationRequested;
    existing.independentOfPredictedIntent ||=
      requestedPreparation.independentOfPredictedIntent;
  }

  private isPredictedPreparationIntentCurrent(roomId: string, generation: number): boolean {
    return this.predictedPreparationRoomId === roomId
      && this.predictedPreparationIntentGeneration === generation;
  }

  private isPlayableRoomSnapshotPreparationRequestCurrent(
    roomId: string,
    request: PlayableRoomSnapshotPreparationRequest,
  ): boolean {
    if (request.independentOfPredictedIntent) return true;
    const generation = this.playableRoomSnapshotRequestIntentGenerationById.get(roomId);
    return generation !== undefined
      && this.isPredictedPreparationIntentCurrent(roomId, generation);
  }

  clearPredictedPlayableRoomForTransition(reason = 'transition-intent-cleared'): void {
    const previousRoomId = this.predictedPreparationRoomId;
    if (!previousRoomId) return;
    const retainedByPortal = previousRoomId === this.portalPreparationRoomId;

    this.predictedPreparationRoomId = null;
    this.predictedPreparationCoordinates = null;
    this.predictedPreparationExpiresAt = 0;
    this.predictedPreparationIntentGeneration += 1;
    this.cancelPredictedPreparationExpiryTimer();
    if (retainedByPortal) {
      const pendingRequest = this.playableRoomSnapshotPreparationRequestsById.get(previousRoomId);
      if (pendingRequest) {
        pendingRequest.standardActivationRequested = false;
        pendingRequest.portalActivationRequested = true;
        pendingRequest.activationRequested = true;
        pendingRequest.independentOfPredictedIntent = true;
      }
      const preparation = this.pendingFullRoomPreparationsById.get(previousRoomId);
      if (preparation) {
        preparation.standardActivationRequested = false;
        preparation.activationRequested = preparation.portalActivationRequested;
        this.clearPreparedRoomActivationIfUnowned(
          preparation,
          'movement-activation-cleared',
        );
      }
      this.playableRoomSnapshotRequestIntentGenerationById.delete(previousRoomId);
    } else {
      this.cancelFullRoomPreparation(previousRoomId, reason);
      this.queueUnretainedPredictedRoomTeardown(previousRoomId);
    }
    this.syncRoomArtifactCachePolicy();
  }

  preparePlayableRoomForTransition(
    coordinates: RoomCoordinates,
    portalDestination = false,
  ): boolean {
    const roomId = roomIdFromCoordinates(coordinates);
    if (
      !portalDestination
      && this.portalPreparationRoomId
      && this.portalPreparationRoomId !== roomId
    ) {
      return false;
    }
    if (this.isPlayableRoomCollisionReady(coordinates)) {
      return true;
    }

    const renderableRoom = this.resolveTransitionRenderableRoom(coordinates);
    if (!renderableRoom) {
      this.requestPlayableRoomSnapshotForTransition(coordinates, {
        priority: this.getTransitionPreparationPriority(coordinates, portalDestination),
        activationRequested: true,
        standardActivationRequested: !portalDestination,
        portalActivationRequested: portalDestination,
        independentOfPredictedIntent: portalDestination,
      });
      return false;
    }

    const preparation = this.beginFullRoomPreparation(
      renderableRoom,
      this.getTransitionPreparationPriority(coordinates, portalDestination),
      !portalDestination,
      false,
    );
    if (preparation) {
      this.requestFullRoomPreparationActivation(preparation, portalDestination);
    }
    return this.isPlayableRoomCollisionReady(coordinates);
  }

  preparePortalTargetRoomForTransition(coordinates: RoomCoordinates): boolean {
    const roomId = roomIdFromCoordinates(coordinates);
    if (this.portalPreparationRoomId && this.portalPreparationRoomId !== roomId) {
      this.clearPortalTargetRoomPreparation(this.portalPreparationRoomId);
    }
    if (this.predictedPreparationRoomId && this.predictedPreparationRoomId !== roomId) {
      this.clearPredictedPlayableRoomForTransition('portal-target-superseded-prediction');
    }
    this.portalPreparationRoomId = roomId;
    return this.preparePlayableRoomForTransition(coordinates, true);
  }

  clearPortalTargetRoomPreparation(roomId = this.portalPreparationRoomId): void {
    if (!roomId || this.portalPreparationRoomId !== roomId) return;
    this.portalPreparationRoomId = null;
    const retainedByPrediction = this.predictedPreparationRoomId === roomId;
    const pendingRequest = this.playableRoomSnapshotPreparationRequestsById.get(roomId);
    const preparation = this.pendingFullRoomPreparationsById.get(roomId);
    const retainedByStandardOwner = Boolean(
      pendingRequest?.standardActivationRequested
      || preparation?.standardActivationRequested,
    );
    const retainedWithoutPortal = retainedByPrediction || retainedByStandardOwner;

    if (retainedWithoutPortal) {
      // Another activation owner still needs this exact request. A movement
      // owner returns it to the ordinary intent generation; a non-predicted
      // standard owner keeps its independent completion semantics.
      if (pendingRequest) {
        if (retainedByPrediction) {
          pendingRequest.independentOfPredictedIntent = false;
        }
        pendingRequest.portalActivationRequested = false;
        pendingRequest.activationRequested = pendingRequest.standardActivationRequested;
      }
      if (preparation) {
        preparation.portalActivationRequested = false;
        preparation.activationRequested = preparation.standardActivationRequested;
        this.clearPreparedRoomActivationIfUnowned(
          preparation,
          'portal-activation-cleared',
        );
      }
      if (retainedByPrediction) {
        this.playableRoomSnapshotRequestIntentGenerationById.set(
          roomId,
          this.predictedPreparationIntentGeneration,
        );
      }
    } else {
      // The underlying transport cannot be aborted here, but removing its
      // ownership record makes completion cache-only after the player leaves.
      this.playableRoomSnapshotRequestsById.delete(roomId);
      this.playableRoomSnapshotRequestIntentGenerationById.delete(roomId);
      this.playableRoomSnapshotPreparationRequestsById.delete(roomId);
      this.playableRoomSnapshotRetryAtById.delete(roomId);
    }

    if (
      !retainedWithoutPortal
      && roomId !== roomIdFromCoordinates(this.options.getCurrentRoomCoordinates())
    ) {
      this.cancelFullRoomPreparation(roomId, 'portal-target-no-longer-requested');
      this.queueUnretainedPredictedRoomTeardown(roomId);
    }
    this.syncRoomArtifactCachePolicy();
  }

  getWorldWindow(): WorldWindow | null {
    return this.worldWindow;
  }

  async waitForBrowseSecondaryStartupReady(signal?: AbortSignal): Promise<boolean> {
    const prepared = await this.worldTileController.prepare();
    if (signal?.aborted) return false;
    if (!prepared) return true;

    const initial = this.worldTileController.getDebugSnapshot();
    if (!initial.enabled || initial.shadow || initial.fallbackReason) return true;
    const ready = await this.worldTileController.waitForTargetLodReady(
      this.options.scene.cameras.main,
      signal,
    );
    if (ready) return true;
    const current = this.worldTileController.getDebugSnapshot();
    return !current.enabled || current.shadow || Boolean(current.fallbackReason);
  }

  async waitForBrowseCommentDiscoveryReady(signal?: AbortSignal): Promise<boolean> {
    return this.waitForBrowseSecondaryStartupReady(signal);
  }

  getChunkWindow(): WorldChunkWindow | null {
    return this.chunkWindow;
  }

  getLoadedRoomBounds(): WorldRoomBounds | null {
    return this.loadedRoomBounds;
  }

  getLoadedChunkBounds(): WorldChunkBounds | null {
    return this.loadedChunkBounds;
  }

  getRoomSummariesById(): Map<string, WorldRoomSummary> {
    return this.roomSummariesById;
  }

  getDraftRoomsById(): Map<string, RoomSnapshot> {
    return this.draftRoomsById;
  }

  getRoomSnapshotsById(): Map<string, RoomSnapshot> {
    return this.previewCache.getRoomSnapshotsById();
  }

  getPreviewImages(): Phaser.GameObjects.Image[] {
    return [
      ...this.previewRenderer.getPreviewImages(),
      ...this.worldTileController.getImages(),
    ];
  }

  getWorldTileBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return this.worldTileController.getBackdropIgnoredObjects();
  }

  hasPreviewForRoom(roomId: string): boolean {
    return this.previewRenderer.hasPreviewForRoom(roomId);
  }

  getPendingPreviewTextureBuildCount(): number {
    return this.previewRenderer.getPendingTextureBuildCount();
  }

  flushPendingPreviewTextureBuilds(): number {
    return this.previewRenderer.flushPendingTextureBuilds();
  }

  getLoadedFullRoomsById(): Map<string, LoadedFullRoom<TLiveObject, TEdgeWall>> {
    return this.loadedFullRoomsById;
  }

  getNearLodRoomIds(): Set<string> {
    return this.nearLodRoomIds;
  }

  getMidLodRoomIds(): Set<string> {
    return this.midLodRoomIds;
  }

  getFarLodRoomIds(): Set<string> {
    return this.farLodRoomIds;
  }

  getFullRoomPreparationProbe(roomId: string): {
    identity: string;
    phase: FullRoomPreparationPhase;
    activationRequested: boolean;
    dormantReady: boolean;
  } | null {
    const preparation = this.pendingFullRoomPreparationsById.get(roomId);
    if (!preparation) return null;
    return {
      identity: preparation.identity,
      phase: preparation.phase,
      activationRequested: preparation.activationRequested,
      dormantReady: Boolean(
        preparation.loadedRoom
        && preparation.backgroundPrepared
        && (preparation.phase === 'ready' || preparation.phase === 'commit')
      ),
    };
  }

  getDebugMetrics(): {
    activeChunkRadius: number;
    effectivePerformanceProfile: PerformanceProfile;
    visibleRoomCount: number;
    previewRoomBudget: number;
    fullRoomBudget: number;
    protectedVisiblePreviewRoomCount: number;
    loadedPreviewRoomCount: number;
    loadedPreviewChunkCount: number;
    previewTileSize: number;
    pendingPreviewTextureBuildCount: number;
    approximatePreviewTexturePixels: number;
    loadedFullRoomCount: number;
    roomSnapshotCloneCount: number;
    pendingFullRoomPreparationCount: number;
    frameWork: ReturnType<FrameWorkCoordinator['getDiagnostics']>;
    roomArtifactCache: ReturnType<RoomArtifactCache['getSnapshot']>;
    localPlayPressureProfile: LocalPlayPressureMetrics['profile'];
    localPlayPressureScore: number;
    localPlayPressureRoomCount: number;
    worldTiles: ReturnType<WorldTileClientController['getDebugSnapshot']>;
  } {
    return {
      activeChunkRadius: this.activeChunkRadius,
      effectivePerformanceProfile: this.getEffectivePerformanceProfile(),
      visibleRoomCount: this.visibleRoomIds.size,
      previewRoomBudget: this.previewRoomBudget,
      fullRoomBudget: this.fullRoomBudget,
      protectedVisiblePreviewRoomCount: this.protectedVisiblePreviewRoomCount,
      loadedPreviewRoomCount: this.previewRenderer.getLoadedPreviewRoomCount(),
      loadedPreviewChunkCount: this.previewRenderer.getLoadedPreviewChunkCount(),
      previewTileSize: this.previewRenderer.getActivePreviewTileSize(),
      pendingPreviewTextureBuildCount: this.previewRenderer.getPendingTextureBuildCount(),
      approximatePreviewTexturePixels: this.previewRenderer.getApproximatePreviewTexturePixels(),
      loadedFullRoomCount: this.loadedFullRoomsById.size,
      roomSnapshotCloneCount: this.getRoomSnapshotCloneCountSinceReset(),
      pendingFullRoomPreparationCount: this.pendingFullRoomPreparationsById.size,
      frameWork: this.frameWorkCoordinator.getDiagnostics(),
      roomArtifactCache: this.roomArtifactCache.getSnapshot(),
      localPlayPressureProfile: this.localPlayPressure.profile,
      localPlayPressureScore: this.localPlayPressure.score,
      localPlayPressureRoomCount: this.localPlayPressure.roomBreakdowns.length,
      worldTiles: this.worldTileController.getDebugSnapshot(),
    };
  }

  updateFullRoomBackgrounds(camera: Phaser.Cameras.Scene2D.Camera): void {
    if (this.options.getMode() === 'play' && this.getEffectivePerformanceProfile() === 'reduced') {
      const currentRoomId = roomIdFromCoordinates(this.options.getCurrentRoomCoordinates());
      const currentLoadedRoom = this.loadedFullRoomsById.get(currentRoomId);
      if (currentLoadedRoom) {
        this.updateFullRoomBackground(currentLoadedRoom, camera);
      }
      return;
    }

    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      this.updateFullRoomBackground(loadedRoom, camera);
    }
  }

  private clearDisplayState(): void {
    for (const roomId of Array.from(this.loadedFullRoomsById.keys())) {
      this.destroyFullRoom(roomId);
    }

    this.previewRenderer.clear();
  }

  private rebuildLoadedSummaryState(): void {
    if (!this.loadedRoomBounds) {
      return;
    }

    const occupiedSummaries = Array.from(this.roomSummariesById.values()).filter(
      (summary) => summary.state === 'published' || summary.state === 'claimed_unpublished'
    );
    const nextSummaries = computeWorldSummariesFromOccupancySummariesInBounds(
      occupiedSummaries,
      this.loadedRoomBounds
    );

    this.roomSummariesById = new Map(nextSummaries.map((summary) => [summary.id, summary]));
    if (this.worldWindow) {
      this.worldWindow.rooms = nextSummaries;
    }
    this.syncChunkWindowFromLocalState();
  }

  private syncChunkWindowFromLocalState(): void {
    if (!this.chunkWindow) {
      return;
    }

    const summaries = Array.from(this.roomSummariesById.values());
    const previewRooms = Array.from(this.previewCache.getRoomSnapshotsById().values())
      .filter((room) => {
        const summary = this.roomSummariesById.get(room.id);
        return summary?.state === 'published' || summary?.state === 'claimed_unpublished';
      });
    for (const chunk of this.chunkWindow.chunks) {
      chunk.rooms = summaries
        .filter((summary) => isWithinRoomBounds(summary.coordinates, chunk.roomBounds))
        .sort((left, right) => {
          if (left.coordinates.y !== right.coordinates.y) {
            return left.coordinates.y - right.coordinates.y;
          }
          return left.coordinates.x - right.coordinates.x;
        });
      chunk.previewRooms = previewRooms
        .filter((room) => isWithinRoomBounds(room.coordinates, chunk.roomBounds))
        .sort((left, right) => {
          if (left.coordinates.y !== right.coordinates.y) {
            return left.coordinates.y - right.coordinates.y;
          }
          return left.coordinates.x - right.coordinates.x;
        });
      chunk.chunkPreviewHash = computeWorldChunkPreviewHash(chunk);
    }

    this.captureChunkPreviewHashes(this.chunkWindow);
  }

  private refreshVisibleRoomsFromCache(): void {
    this.measure('stream.refreshVisibleRoomsFromCache', () => {
    if (!this.loadedRoomBounds) {
      return;
    }

    const roomCandidates = this.measure('stream.collectVisibleRoomCandidates', () =>
      this.collectVisibleRoomCandidates()
    );
    this.visibleRoomIds = new Set(roomCandidates.keys());
    const previewSelection = this.measure('stream.computePreviewSelection', () =>
      this.computePreviewSelection(roomCandidates)
    );
    const previewRoomIds = previewSelection.previewRoomIds;
    const renderedPreviewRoomIds = this.getRenderedPreviewRoomIds(roomCandidates, previewRoomIds);
    const fullRoomIds = previewSelection.fullRoomIds;
    const requestedRoomIds = new Set<string>([...renderedPreviewRoomIds, ...fullRoomIds]);
    const renderableRooms = new Map<string, RenderableRoom>();

    for (const roomId of requestedRoomIds) {
      const candidate = roomCandidates.get(roomId);
      if (!candidate) {
        continue;
      }

      if (candidate.draft) {
        renderableRooms.set(candidate.id, {
          id: candidate.id,
          coordinates: { ...candidate.coordinates },
          room: candidate.draft,
          source: candidate.source,
        });
        continue;
      }

      if (candidate.summary?.state === 'published' && candidate.sharedPreview) {
        const cachedPublishedCandidate = fullRoomIds.has(candidate.summary.id)
          ? this.previewCache.getFullRoomSnapshot(candidate.summary.id)
          : this.previewCache.getRoomSnapshot(candidate.summary.id);
        const cachedPublishedRoom =
          cachedPublishedCandidate
          && this.isRoomSnapshotCurrentForSummary(cachedPublishedCandidate, candidate.summary)
            ? cachedPublishedCandidate
            : null;
        if (cachedPublishedRoom) {
          renderableRooms.set(candidate.id, {
            id: candidate.id,
            coordinates: { ...candidate.coordinates },
            room: cachedPublishedRoom,
            source: 'published',
          });
          continue;
        }
      }

      if (candidate.sharedPreview && candidate.summary?.state !== 'published') {
        renderableRooms.set(candidate.id, {
          id: candidate.id,
          coordinates: { ...candidate.coordinates },
          room: candidate.sharedPreview,
          source: candidate.source,
        });
        continue;
      }

      if (
        !candidate.summary ||
        (candidate.summary.state !== 'published' && candidate.summary.state !== 'claimed_unpublished')
      ) {
        continue;
      }

      const cachedCandidate = fullRoomIds.has(candidate.summary.id)
        ? this.previewCache.getFullRoomSnapshot(candidate.summary.id)
        : this.previewCache.getRoomSnapshot(candidate.summary.id);
      const cachedRoom =
        cachedCandidate
        && this.isRoomSnapshotCurrentForSummary(cachedCandidate, candidate.summary)
          ? cachedCandidate
          : null;
      if (!cachedRoom) {
        continue;
      }

      renderableRooms.set(candidate.id, {
        id: candidate.id,
        coordinates: { ...candidate.coordinates },
        room: cachedRoom,
        source: candidate.summary.state === 'published' ? 'published' : 'saved_construction_draft',
      });
    }

    const previewRooms = this.collectPreviewRooms(renderableRooms, renderedPreviewRoomIds);
    if (this.options.getMode() === 'play') {
      this.queueDeferredPreviewRender(previewRooms, this.loadGeneration);
    } else {
      this.cancelDeferredPreviewRender();
      this.measure('stream.renderChunkPreviews', () => {
        this.renderChunkPreviewsForGeneration(previewRooms, this.loadGeneration);
      });
    }

    this.measure('stream.unloadPreviewOutsideWindow', () => {
      this.previewRenderer.unloadOutsideWindow(this.visibleRoomIds, renderedPreviewRoomIds);
      this.previewCache.pruneSnapshots(
        this.visibleRoomIds,
        this.getProtectedExactSnapshotRoomIds(),
      );
    });

    if (this.options.getMode() === 'play') {
      this.syncPlayFullRooms(renderableRooms, fullRoomIds);
    } else {
      this.cancelDeferredFullRoomLoads();
    }

    this.measure('stream.unloadFullRoomsOutsideStream', () => {
      this.unloadFullRoomsOutsideStream(
        this.options.getMode() === 'play'
          ? this.getRetainedFullRoomIds(fullRoomIds)
          : this.getRetainedBrowseFullRoomIds(fullRoomIds)
      );
    });
    this.requestFullPreviewUpgradeIfNeeded(roomCandidates, renderedPreviewRoomIds, fullRoomIds);
    });
  }

  private syncPlayFullRooms(
    renderableRooms: Map<string, RenderableRoom>,
    fullRoomIds: Set<string>,
  ): void {
    this.measure('stream.syncPlayFullRooms', () => {
      const focusRoomId = roomIdFromCoordinates(this.options.getCurrentRoomCoordinates());
      this.syncArtifactFocusRoom(focusRoomId);
      const deferredRooms: RenderableRoom[] = [];

      for (const renderableRoom of renderableRooms.values()) {
        if (!fullRoomIds.has(renderableRoom.id)) {
          continue;
        }

        const loadedRoom = this.loadedFullRoomsById.get(renderableRoom.id) ?? null;
        if (loadedRoom) {
          if (this.isLoadedFullRoomCurrent(
            loadedRoom,
            renderableRoom.room,
            renderableRoom.source,
          )) {
            this.cancelPendingFullRoomTeardown(
              renderableRoom.id,
              'loaded-room-returned-to-stream',
              true,
              true,
            );
            if (this.pendingFullRoomTeardownsById.has(renderableRoom.id)) {
              // A teardown that already crossed its destructive boundary cannot
              // be restored. Start a replacement from the exact snapshot now so
              // a rapid reversal does not wait for teardown plus a later refresh.
              this.beginFullRoomPreparation(
                renderableRoom,
                renderableRoom.id === focusRoomId
                  ? 'portal-current-destination'
                  : 'predicted-visuals-objects',
                false,
              );
            } else {
              const restoredLoadedRoom = this.loadedFullRoomsById.get(renderableRoom.id) ?? null;
              if (
                restoredLoadedRoom
                && this.isLoadedFullRoomCurrent(
                  restoredLoadedRoom,
                  renderableRoom.room,
                  renderableRoom.source,
                )
              ) {
                this.ensurePlayerTerrainColliders(restoredLoadedRoom);
              } else {
                this.beginFullRoomPreparation(
                  renderableRoom,
                  renderableRoom.id === focusRoomId
                    ? 'portal-current-destination'
                    : 'predicted-visuals-objects',
                  false,
                );
              }
            }
          } else {
            this.beginFullRoomPreparation(
              renderableRoom,
              renderableRoom.id === focusRoomId
                ? 'portal-current-destination'
                : 'predicted-visuals-objects',
              false,
            );
          }
          continue;
        }

        // The first focused room must exist before the play loop can start. All
        // subsequent loads and replacements use the incremental preparation path.
        if (renderableRoom.id === focusRoomId) {
          this.ensureFullRoom(renderableRoom.room, renderableRoom.source);
          continue;
        }

        deferredRooms.push(renderableRoom);
      }

      this.queueDeferredFullRoomLoads(deferredRooms);
    });
  }

  private collectPreviewRooms(
    renderableRooms: Map<string, RenderableRoom>,
    previewRoomIds: Set<string>,
  ): RoomSnapshot[] {
    return Array.from(renderableRooms.values(), (renderableRoom) => renderableRoom.room).filter((room) =>
      previewRoomIds.has(room.id)
    );
  }

  private renderChunkPreviewsForGeneration(
    previewRooms: RoomSnapshot[],
    generation: number,
  ): void {
    if (!this.isLoadGenerationCurrent(generation)) return;
    this.previewRenderer.renderChunkPreviews(previewRooms);
    if (
      !this.isLoadGenerationCurrent(generation)
      || this.worldTileController.isBrowseCutoverActive()
    ) return;

    const source: WorldReplacementCoverageSource = this.compactWorldActive
      ? 'compact'
      : 'legacy';
    const key = `world-stream:${source}:${generation}`;
    if (this.publishedReplacementCoverageKey && this.publishedReplacementCoverageKey !== key) {
      this.clearPublishedReplacementCoverage();
    }
    this.publishedReplacementCoverageKey = key;
    publishWorldReplacementCoverageReady({
      schemaVersion: 1,
      key,
      source,
      generation,
      readyAtMs: performance.now(),
    });
  }

  private getRenderedPreviewRoomIds(
    roomCandidates: Map<string, StreamingRoomCandidate>,
    previewRoomIds: Set<string>,
  ): Set<string> {
    if (!this.worldTileController.isBrowseCutoverActive()) return new Set(previewRoomIds);
    return new Set([...previewRoomIds].filter((roomId) => {
      const candidate = roomCandidates.get(roomId);
      return shouldRenderLegacyWorldTileOverlay(
        candidate,
        this.optimisticPublishedRoomsById.has(roomId),
      );
    }));
  }

  private getRetainedBrowseFullRoomIds(targetRoomIds: Set<string>): Set<string> {
    if (!this.worldTileController.isBrowseCutoverActive()) return targetRoomIds;
    const retained = new Set(targetRoomIds);
    const focusIds = new Set([
      roomIdFromCoordinates(this.options.getCurrentRoomCoordinates()),
      roomIdFromCoordinates(this.options.getSelectedCoordinates()),
    ]);
    for (const roomId of focusIds) {
      const loadedRoom = this.loadedFullRoomsById.get(roomId);
      if (
        loadedRoom
        && !this.worldTileController.isRoomTileDisplayable(loadedRoom.room.coordinates)
      ) {
        retained.add(roomId);
      }
    }
    return retained;
  }

  private queueDeferredPreviewRender(rooms: RoomSnapshot[], generation: number): void {
    this.cancelDeferredPreviewRender();
    this.deferredPreviewRooms = rooms;
    this.deferredPreviewRenderGeneration = generation;
    this.deferredPreviewRenderTimer = this.options.scene.time.delayedCall(
      DEFERRED_PREVIEW_RENDER_DELAY_MS,
      () => {
        this.deferredPreviewRenderTimer = null;
        if (this.destroyed) {
          this.deferredPreviewRooms = [];
          return;
        }

        const previewRooms = this.deferredPreviewRooms;
        const renderGeneration = this.deferredPreviewRenderGeneration;
        this.deferredPreviewRooms = [];
        this.deferredPreviewRenderGeneration = -1;
        this.measure('stream.renderChunkPreviews', () => {
          this.renderChunkPreviewsForGeneration(previewRooms, renderGeneration);
        });
      },
    );
  }

  private cancelDeferredPreviewRender(): void {
    this.deferredPreviewRenderTimer?.remove(false);
    this.deferredPreviewRenderTimer = null;
    this.deferredPreviewRooms = [];
    this.deferredPreviewRenderGeneration = -1;
  }

  private queueDeferredFullRoomLoads(rooms: RenderableRoom[]): void {
    const nextRoomIds = new Set(rooms.map((room) => room.id));
    for (const preparation of Array.from(this.pendingFullRoomPreparationsById.values())) {
      if (
        preparation.priority === 'preview-cosmetic'
        && !nextRoomIds.has(preparation.room.id)
      ) {
        this.cancelFullRoomPreparation(preparation.room.id, 'deferred-room-set-replaced');
      }
    }
    for (const room of rooms) {
      this.beginFullRoomPreparation(room, 'preview-cosmetic', false);
    }
  }

  private cancelDeferredFullRoomLoads(): void {
    for (const preparation of Array.from(this.pendingFullRoomPreparationsById.values())) {
      if (
        preparation.priority === 'preview-cosmetic'
        && preparation.room.id !== this.predictedPreparationRoomId
      ) {
        this.cancelFullRoomPreparation(preparation.room.id, 'deferred-room-set-replaced');
      }
    }
  }

  private resolveTransitionRenderableRoom(
    coordinates: RoomCoordinates,
  ): RenderableRoom | null {
    const roomId = roomIdFromCoordinates(coordinates);
    const transientRoom = this.transientRoomOverridesById.get(roomId);
    if (transientRoom) {
      return {
        id: roomId,
        coordinates: { ...coordinates },
        room: transientRoom,
        source: 'local_draft',
      };
    }

    const draftRoom = this.draftRoomsById.get(roomId);
    if (draftRoom) {
      return {
        id: roomId,
        coordinates: { ...coordinates },
        room: draftRoom,
        source: 'local_draft',
      };
    }

    const optimisticRoom = this.optimisticPublishedRoomsById.get(roomId);
    if (optimisticRoom) {
      return {
        id: roomId,
        coordinates: { ...coordinates },
        room: optimisticRoom,
        source: 'published',
      };
    }

    const summary = this.roomSummariesById.get(roomId) ?? null;
    const presencePreviewRoom = this.presencePreviewRoomsById.get(roomId);
    if (presencePreviewRoom && summary?.state !== 'published') {
      return {
        id: roomId,
        coordinates: { ...coordinates },
        room: presencePreviewRoom,
        source: 'live_construction_preview',
      };
    }

    if (!summary && roomId === this.portalPreparationRoomId) {
      const portalRoom = this.previewCache.getFullRoomSnapshot(roomId);
      if (
        portalRoom
        && portalRoom.coordinates.x === coordinates.x
        && portalRoom.coordinates.y === coordinates.y
      ) {
        return {
          id: roomId,
          coordinates: { ...coordinates },
          room: portalRoom,
          source: 'published',
        };
      }
    }

    const cachedRoom = this.getCurrentCachedFullRoomSnapshot(summary);
    if (!cachedRoom) {
      return null;
    }

    return {
      id: roomId,
      coordinates: { ...coordinates },
      room: cachedRoom,
      source: summary?.state === 'published' ? 'published' : 'saved_construction_draft',
    };
  }

  private getCurrentCachedFullRoomSnapshot(
    summary: WorldRoomSummary | null,
  ): RoomSnapshot | null {
    if (
      !summary
      || (summary.state !== 'published' && summary.state !== 'claimed_unpublished')
    ) {
      return null;
    }

    const cachedRoom = this.previewCache.getFullRoomSnapshot(summary.id);
    return cachedRoom && this.isRoomSnapshotCurrentForSummary(cachedRoom, summary)
      ? cachedRoom
      : null;
  }

  private isRoomSnapshotCurrentForSummary(
    room: RoomSnapshot,
    summary: WorldRoomSummary,
  ): boolean {
    return (
      (summary.version === null || room.version === summary.version)
      && (!summary.previewUpdatedAt || room.updatedAt === summary.previewUpdatedAt)
    );
  }

  private getProtectedExactSnapshotRoomIds(): Set<string> {
    const protectedRoomIds = new Set(this.loadedFullRoomsById.keys());
    for (const roomId of this.pendingFullRoomPreparationsById.keys()) {
      protectedRoomIds.add(roomId);
    }
    for (const roomId of this.playableRoomSnapshotRequestsById.keys()) {
      protectedRoomIds.add(roomId);
    }
    if (this.predictedPreparationRoomId) {
      protectedRoomIds.add(this.predictedPreparationRoomId);
    }
    if (this.portalPreparationRoomId) {
      protectedRoomIds.add(this.portalPreparationRoomId);
    }

    if (this.options.getMode() === 'play') {
      const current = this.options.getCurrentRoomCoordinates();
      for (const [deltaX, deltaY] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        protectedRoomIds.add(roomIdFromCoordinates({
          x: current.x + deltaX,
          y: current.y + deltaY,
        }));
      }
    }
    return protectedRoomIds;
  }

  private retainPreparedTransitionRoom(roomId: string): void {
    if (roomId === roomIdFromCoordinates(this.options.getCurrentRoomCoordinates())) {
      return;
    }

    const now = this.options.scene.time.now;
    this.fullRoomReleaseAtById.set(
      roomId,
      now + TRANSITION_PREPARED_FULL_ROOM_RETAIN_MS,
    );
    let nextReleaseAt: number | null = null;
    for (const releaseAt of this.fullRoomReleaseAtById.values()) {
      nextReleaseAt = nextReleaseAt === null
        ? releaseAt
        : Math.min(nextReleaseAt, releaseAt);
    }
    this.scheduleFullRoomReleaseCleanup(nextReleaseAt, now);
  }

  private syncArtifactFocusRoom(focusRoomId: string): void {
    const previousFocusRoomId = this.artifactFocusRoomId;
    if (!previousFocusRoomId) {
      this.artifactFocusRoomId = focusRoomId;
      return;
    }
    if (previousFocusRoomId === focusRoomId) return;

    const previousFocusRoom = this.loadedFullRoomsById.get(previousFocusRoomId) ?? null;
    const previousArtifactKey = previousFocusRoom?.artifactKey ?? null;
    this.previousRoomArtifactRoomId = previousFocusRoomId;
    this.previousRoomArtifactKey =
      previousArtifactKey && this.roomArtifactCache.has(previousArtifactKey)
        ? previousArtifactKey
        : null;
    if (this.previousRoomArtifactKey) {
      this.roomArtifactCache.touch(this.previousRoomArtifactKey);
    }
    this.artifactFocusRoomId = focusRoomId;
    this.syncRoomArtifactCachePolicy();
  }

  private collectVisibleRoomCandidates(): Map<string, StreamingRoomCandidate> {
    const candidates = new Map<string, StreamingRoomCandidate>();
    const roomBounds = this.loadedRoomBounds;
    if (!roomBounds) {
      return candidates;
    }

    for (const summary of this.roomSummariesById.values()) {
      candidates.set(summary.id, {
        id: summary.id,
        coordinates: { ...summary.coordinates },
        summary,
        draft: null,
        sharedPreview: null,
        allowFullRoomLoad: summary.state === 'published' || summary.state === 'claimed_unpublished',
        source: summary.state === 'published' ? 'published' : 'saved_construction_draft',
      });
    }

    for (const draftRoom of this.draftRoomsById.values()) {
      if (!isWithinRoomBounds(draftRoom.coordinates, roomBounds)) {
        continue;
      }

      const existing = candidates.get(draftRoom.id);
      candidates.set(draftRoom.id, {
        id: draftRoom.id,
        coordinates: { ...draftRoom.coordinates },
        summary: existing?.summary ?? null,
        draft: draftRoom,
        sharedPreview: null,
        allowFullRoomLoad: true,
        source: 'local_draft',
      });
    }

    for (const overrideRoom of this.transientRoomOverridesById.values()) {
      if (!isWithinRoomBounds(overrideRoom.coordinates, roomBounds)) {
        continue;
      }

      const existing = candidates.get(overrideRoom.id);
      candidates.set(overrideRoom.id, {
        id: overrideRoom.id,
        coordinates: { ...overrideRoom.coordinates },
        summary: existing?.summary ?? null,
        draft: overrideRoom,
        sharedPreview: null,
        allowFullRoomLoad: true,
        source: 'local_draft',
      });
    }

    for (const previewRoom of this.presencePreviewRoomsById.values()) {
      if (!isWithinRoomBounds(previewRoom.coordinates, roomBounds)) {
        continue;
      }

      const existing = candidates.get(previewRoom.id);
      if (existing?.draft) {
        continue;
      }

      candidates.set(previewRoom.id, {
        id: previewRoom.id,
        coordinates: { ...previewRoom.coordinates },
        summary: existing?.summary ?? null,
        draft: null,
        sharedPreview: previewRoom,
        allowFullRoomLoad:
          existing?.summary?.state === 'claimed_unpublished' ||
          (!existing?.summary && previewRoom.status === 'draft'),
        source: 'live_construction_preview',
      });
    }

    for (const optimisticRoom of this.optimisticPublishedRoomsById.values()) {
      if (!isWithinRoomBounds(optimisticRoom.coordinates, roomBounds)) continue;
      const existing = candidates.get(optimisticRoom.id);
      if (existing?.draft || existing?.sharedPreview) continue;
      candidates.set(optimisticRoom.id, {
        id: optimisticRoom.id,
        coordinates: { ...optimisticRoom.coordinates },
        summary: existing?.summary ?? createPublishedRoomSummary(optimisticRoom),
        draft: optimisticRoom,
        sharedPreview: null,
        allowFullRoomLoad: true,
        source: 'published',
      });
    }

    return candidates;
  }

  private computePreviewSelection(
    roomCandidates: Map<string, StreamingRoomCandidate>
  ): OverworldPreviewSelection {
    this.localPlayPressure = this.computeLocalPlayPressure(roomCandidates);
    const previewCandidates: PreviewSelectionCandidate[] = Array.from(roomCandidates.values()).map(
      (roomCandidate) => ({
        id: roomCandidate.id,
        coordinates: { ...roomCandidate.coordinates },
        isRenderable: isStreamingRoomCandidateRenderable(roomCandidate),
        allowFullRoomLoad: roomCandidate.allowFullRoomLoad,
      })
    );

    const selection = computeOverworldPreviewSelection({
      mode: this.options.getMode(),
      performanceProfile: this.getEffectivePerformanceProfile(),
      zoom: this.options.scene.cameras.main.zoom,
      focusCoordinates: this.getFocusCoordinates(),
      roomCandidates: previewCandidates,
      visibleRoomBounds: this.getViewportRoomBounds(),
      fullRoomBudgetOverride: this.localPlayPressure.fullRoomBudgetOverride,
    });

    this.previewRoomBudget = selection.previewRoomBudget;
    this.fullRoomBudget = selection.fullRoomBudget;
    this.protectedVisiblePreviewRoomCount = selection.protectedVisiblePreviewRoomCount;
    this.nearLodRoomIds = selection.nearLodRoomIds;
    this.midLodRoomIds = selection.midLodRoomIds;
    this.farLodRoomIds = selection.farLodRoomIds;

    if (
      this.options.getMode() === 'play'
      && this.getEffectivePerformanceProfile() === 'reduced'
    ) {
      this.prefetchExactCardinalRoomSnapshots();
    }

    return selection;
  }

  private prefetchExactCardinalRoomSnapshots(): void {
    const current = this.options.getCurrentRoomCoordinates();
    const candidates = new Map<string, StreamingRoomCandidate>();
    const requestedRoomIds: string[] = [];
    for (const [deltaX, deltaY] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const coordinates = { x: current.x + deltaX, y: current.y + deltaY };
      const roomId = roomIdFromCoordinates(coordinates);
      if (
        this.transientRoomOverridesById.has(roomId)
        || this.draftRoomsById.has(roomId)
        || this.optimisticPublishedRoomsById.has(roomId)
      ) continue;
      const summary = this.roomSummariesById.get(roomId);
      if (
        !summary
        || (summary.state !== 'published' && summary.state !== 'claimed_unpublished')
        || this.getCurrentCachedFullRoomSnapshot(summary)
      ) continue;
      candidates.set(roomId, {
        id: roomId,
        coordinates,
        summary,
        draft: null,
        sharedPreview: null,
        allowFullRoomLoad: true,
        source: summary.state === 'published' ? 'published' : 'saved_construction_draft',
      });
      requestedRoomIds.push(roomId);
    }
    if (requestedRoomIds.length === 0) return;
    void this.previewCache.ensureRoomSnapshotsBatch(candidates, requestedRoomIds, {
      detail: 'full',
      priority: 'high',
    }).catch(() => {
      // Transition-specific requests retain their own visible retry/backoff diagnostics.
    });
  }

  private ownChangedPresencePreview(
    incoming: RoomSnapshot,
    current: RoomSnapshot | null,
  ): RoomSnapshot {
    if (incoming === current) {
      return current;
    }
    const existingOwnedSnapshot = this.presencePreviewOwnedBySource.get(incoming);
    if (existingOwnedSnapshot) {
      return existingOwnedSnapshot;
    }
    const ownedSnapshot = cloneRoomSnapshot(incoming);
    this.presencePreviewOwnedBySource.set(incoming, ownedSnapshot);
    return ownedSnapshot;
  }

  private arePresencePreviewMapsIdentical(
    current: Map<string, RoomSnapshot>,
    next: Map<string, RoomSnapshot>,
  ): boolean {
    if (current.size !== next.size) {
      return false;
    }

    for (const [roomId, currentRoom] of current.entries()) {
      if (next.get(roomId) !== currentRoom) {
        return false;
      }
    }

    return true;
  }

  private mergeRoomSummariesFromChunks(chunkWindow: WorldChunkWindow): WorldRoomSummary[] {
    const summariesById = new Map<string, WorldRoomSummary>();

    for (const chunk of chunkWindow.chunks) {
      for (const room of chunk.rooms) {
        summariesById.set(room.id, room);
      }
    }

    return Array.from(summariesById.values()).sort((left, right) => {
      if (left.coordinates.y !== right.coordinates.y) {
        return left.coordinates.y - right.coordinates.y;
      }

      return left.coordinates.x - right.coordinates.x;
    });
  }

  private applyChunkWindow(chunkWindow: WorldChunkWindow, compactWorldActive = false): void {
    this.chunkWindow = chunkWindow;
    this.compactWorldActive = compactWorldActive;
    this.loadedChunkBounds = { ...chunkWindow.chunkBounds };
    this.loadedRoomBounds = { ...chunkWindow.roomBounds };

    const mergedRoomSummaries = this.mergeRoomSummariesFromChunks(chunkWindow);
    const nextWorldWindow = createWorldWindowFromRoomBounds(chunkWindow.roomBounds);
    nextWorldWindow.rooms = mergedRoomSummaries;
    this.worldWindow = nextWorldWindow;
    this.roomSummariesById = new Map(mergedRoomSummaries.map((summary) => [summary.id, summary]));
    this.previewCache.hydrateChunkWindow(chunkWindow);
    this.captureChunkPreviewHashes(chunkWindow);
    this.activeChunkRadius = this.getChunkRadius(chunkWindow.chunkBounds);
  }

  private getNearestPreviewRoomIds(
    roomCandidates: Map<string, StreamingRoomCandidate>,
    previewRoomIds: Set<string>,
    fullRoomIds: Set<string>,
    previewCount: number,
  ): Set<string> {
    const focus = this.getFocusCoordinates();
    const sortedPreviewIds = [...previewRoomIds].sort((leftId, rightId) => {
      const left = roomCandidates.get(leftId)?.coordinates;
      const right = roomCandidates.get(rightId)?.coordinates;
      const leftDistance = left ? Math.abs(left.x - focus.x) + Math.abs(left.y - focus.y) : Number.MAX_SAFE_INTEGER;
      const rightDistance = right ? Math.abs(right.x - focus.x) + Math.abs(right.y - focus.y) : Number.MAX_SAFE_INTEGER;
      return leftDistance - rightDistance || leftId.localeCompare(rightId);
    });
    return new Set([...fullRoomIds, ...sortedPreviewIds.slice(0, previewCount)]);
  }

  private async loadDistantPreviewsProgressively(
    generation: number,
    roomCandidates: Map<string, StreamingRoomCandidate>,
    previewRoomIds: Set<string>,
    fullRoomIds: Set<string>,
    detail: RoomSnapshotQueryDetail,
    requireTiledCutover = false,
  ): Promise<void> {
    const tiledBrowseCutover = this.worldTileController.isBrowseCutoverActive();
    if (requireTiledCutover && !tiledBrowseCutover) {
      this.handleDynamicOverlayReadinessStopped(generation);
      return;
    }
    if (tiledBrowseCutover) {
      const sharpReady = await this.waitForDynamicOverlayTargetLod(generation);
      if (!sharpReady) {
        this.handleDynamicOverlayReadinessStopped(generation);
        return;
      }
    }
    if (!this.isLoadGenerationCurrent(generation)) return;
    const nearIds = this.getNearestPreviewRoomIds(roomCandidates, previewRoomIds, fullRoomIds, 9);
    const focusChunk = roomToChunkCoordinates(this.getFocusCoordinates());
    const distantIds = [...previewRoomIds]
      .filter((roomId) => !nearIds.has(roomId))
      .sort((leftId, rightId) => {
        const left = roomCandidates.get(leftId)?.coordinates;
        const right = roomCandidates.get(rightId)?.coordinates;
        if (!left || !right) return leftId.localeCompare(rightId);
        const leftChunk = roomToChunkCoordinates(left);
        const rightChunk = roomToChunkCoordinates(right);
        const leftChunkDistance = Math.max(
          Math.abs(leftChunk.x - focusChunk.x),
          Math.abs(leftChunk.y - focusChunk.y),
        );
        const rightChunkDistance = Math.max(
          Math.abs(rightChunk.x - focusChunk.x),
          Math.abs(rightChunk.y - focusChunk.y),
        );
        return (
          leftChunkDistance - rightChunkDistance ||
          leftChunk.y - rightChunk.y ||
          leftChunk.x - rightChunk.x ||
          left.y - right.y ||
          left.x - right.x ||
          leftId.localeCompare(rightId)
        );
      });
    const batches: string[][] = [];
    for (let index = 0; index < distantIds.length; index += 48) {
      batches.push(distantIds.slice(index, index + 48));
    }

    let nextBatchIndex = 0;
    let stopped = false;
    const loadNextBatch = async (): Promise<void> => {
      while (!stopped) {
        const batchIndex = nextBatchIndex;
        nextBatchIndex += 1;
        const batchIds = batches[batchIndex];
        if (!batchIds || this.destroyed || generation !== this.loadGeneration) return;
        try {
          await processProgressivePreviewBatch({
            batchIds,
            selectCurrentRoomIds: (candidateIds) => {
              if (this.destroyed || generation !== this.loadGeneration) return new Set();
              return this.getRenderedPreviewRoomIds(roomCandidates, new Set(candidateIds));
            },
            loadSnapshots: (currentBatchIds) => this.previewCache.ensureRoomSnapshotsBatch(
              roomCandidates,
              currentBatchIds,
              {
                detail,
                priority: 'high',
              },
            ),
            prepareLoaded: (currentBatchIds) => this.previewCache.collectRenderableRooms(
              roomCandidates,
              new Set(currentBatchIds),
              new Set(),
            ),
            mergeLoaded: (renderableRooms, currentBatchIds) => {
              const batchIdSet = new Set(currentBatchIds);
              this.previewRenderer.mergeChunkPreviews(
                this.collectPreviewRooms(renderableRooms, batchIdSet),
              );
            },
          });
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(3, batches.length) }, () => loadNextBatch()),
    );
  }

  private isLoadGenerationCurrent(generation: number): boolean {
    return !this.destroyed && generation === this.loadGeneration;
  }

  private beginDynamicOverlayReadiness(generation: number): void {
    this.cancelDynamicOverlayReadiness();
    this.dynamicOverlayReadinessGeneration = generation;
    this.dynamicOverlayReadinessAbortController = new AbortController();
  }

  private cancelDynamicOverlayReadiness(): void {
    this.dynamicOverlayReadinessAbortController?.abort();
    this.dynamicOverlayReadinessAbortController = null;
    this.dynamicOverlayReadinessGeneration = -1;
  }

  private async waitForDynamicOverlayTargetLod(generation: number): Promise<boolean> {
    const abortController = this.dynamicOverlayReadinessAbortController;
    if (
      !abortController
      || this.dynamicOverlayReadinessGeneration !== generation
      || !this.isLoadGenerationCurrent(generation)
      || !this.worldTileController.isBrowseCutoverActive()
    ) return false;
    const ready = await this.worldTileController.waitForTargetLodReady(
      this.options.scene.cameras.main,
      abortController.signal,
    );
    const current = ready
      && this.dynamicOverlayReadinessGeneration === generation
      && this.isLoadGenerationCurrent(generation)
      && this.worldTileController.isBrowseCutoverActive();
    if (!current && this.isLoadGenerationCurrent(generation)) {
      this.clearStartupDynamicOverlayGeneration(generation);
    }
    return current;
  }

  private handleDynamicOverlayReadinessStopped(generation: number): void {
    if (!this.isLoadGenerationCurrent(generation)) return;
    this.clearStartupDynamicOverlayGeneration(generation);
    if (
      this.compactWorldActive
      && !this.worldTileController.isBrowseCutoverActive()
    ) {
      this.legacyCompactRefreshGeneration = generation;
      this.maybeStartLegacyCompactRefresh();
    }
  }

  private clearStartupDynamicOverlayGeneration(generation: number): void {
    const stopped = stopStartupDynamicOverlayGeneration({
      generation,
      startupDynamicOverlayGeneration: this.startupDynamicOverlayGeneration,
      fullPreviewUpgradeGeneration: this.fullPreviewUpgradeGeneration,
    });
    this.startupDynamicOverlayGeneration = stopped.startupDynamicOverlayGeneration;
    this.fullPreviewUpgradeGeneration = stopped.fullPreviewUpgradeGeneration;
  }

  private maybeStartLegacyCompactRefresh(): void {
    if (
      this.legacyCompactRefreshScheduled
      || this.chunkWindowRequestInFlight
      || this.legacyCompactRefreshGeneration < 0
    ) return;
    this.legacyCompactRefreshScheduled = true;
    queueMicrotask(() => {
      this.legacyCompactRefreshScheduled = false;
      const generation = this.legacyCompactRefreshGeneration;
      if (
        !this.isLoadGenerationCurrent(generation)
        || !this.compactWorldActive
        || this.worldTileController.isBrowseCutoverActive()
      ) return;
      this.legacyCompactRefreshGeneration = -1;
      void this.refreshAround(this.getFocusCoordinates()).catch((error) => {
        console.warn('Legacy compact fallback refresh stopped.', error);
      });
    });
  }

  private async mergeDeferredDynamicOverlays(
    generation: number,
    roomCandidates: Map<string, StreamingRoomCandidate>,
    roomIds: ReadonlySet<string>,
    fullRoomIds: ReadonlySet<string>,
  ): Promise<void> {
    if (!this.isLoadGenerationCurrent(generation)) return;
    const currentRoomIds = this.getRenderedPreviewRoomIds(roomCandidates, new Set(roomIds));
    if (currentRoomIds.size === 0) return;
    const currentFullRoomIds = new Set(
      [...fullRoomIds].filter((roomId) => currentRoomIds.has(roomId)),
    );
    const renderableRooms = await this.previewCache.collectRenderableRooms(
      roomCandidates,
      currentRoomIds,
      currentFullRoomIds,
    );
    if (!this.isLoadGenerationCurrent(generation)) return;
    const finalRoomIds = this.getRenderedPreviewRoomIds(roomCandidates, currentRoomIds);
    if (finalRoomIds.size === 0) return;
    this.previewRenderer.mergeChunkPreviews(
      this.collectPreviewRooms(renderableRooms, finalRoomIds),
    );
  }

  private scheduleDynamicOverlayRetry(
    generation: number,
    detail: RoomSnapshotQueryDetail,
    error: unknown,
  ): void {
    if (!this.isLoadGenerationCurrent(generation)) return;
    console.warn('Deferred construction preview loading stopped; retaining world tiles and retrying.', error);
    if (this.dynamicOverlayRetryTimer) return;

    this.startupDynamicOverlayGeneration = generation;
    if (detail === 'full') {
      this.fullPreviewUpgradeGeneration = generation;
    }
    const retryIndex = Math.min(
      this.dynamicOverlayRetryAttempt,
      DYNAMIC_OVERLAY_RETRY_DELAYS_MS.length - 1,
    );
    const retryDelay = DYNAMIC_OVERLAY_RETRY_DELAYS_MS[retryIndex];
    this.dynamicOverlayRetryAttempt += 1;
    this.dynamicOverlayRetryTimer = this.options.scene.time.delayedCall(retryDelay, () => {
      this.dynamicOverlayRetryTimer = null;
      if (
        !this.isLoadGenerationCurrent(generation)
        || !this.worldTileController.isBrowseCutoverActive()
      ) {
        if (generation === this.loadGeneration) {
          this.startupDynamicOverlayGeneration = -1;
        }
        return;
      }
      this.retryCurrentDynamicOverlays(generation, detail);
    });
  }

  private retryCurrentDynamicOverlays(
    generation: number,
    detail: RoomSnapshotQueryDetail,
  ): void {
    if (!this.isLoadGenerationCurrent(generation)) return;
    const roomCandidates = this.collectVisibleRoomCandidates();
    const previewSelection = this.computePreviewSelection(roomCandidates);
    const renderedPreviewRoomIds = this.getRenderedPreviewRoomIds(
      roomCandidates,
      previewSelection.previewRoomIds,
    );
    const selectedNearRoomIds = this.getNearestPreviewRoomIds(
      roomCandidates,
      renderedPreviewRoomIds,
      previewSelection.fullRoomIds,
      9,
    );
    const nearRoomIds = this.getRenderedPreviewRoomIds(roomCandidates, selectedNearRoomIds);
    void loadStartupDynamicOverlaySnapshots({
      awaitBeforeReady: false,
      waitForDeferredStart: () => this.waitForDynamicOverlayTargetLod(generation),
      onDeferredStartStopped: () => this.handleDynamicOverlayReadinessStopped(generation),
      loadSnapshots: () => this.previewCache.ensureRoomSnapshotsBatch(roomCandidates, nearRoomIds, {
        priority: 'high',
        detail,
      }),
      isCurrent: () => this.isLoadGenerationCurrent(generation),
      mergeDeferredSnapshots: async () => {
        await this.mergeDeferredDynamicOverlays(
          generation,
          roomCandidates,
          nearRoomIds,
          previewSelection.fullRoomIds,
        );
        if (!this.isLoadGenerationCurrent(generation)) return;
        await this.loadDistantPreviewsProgressively(
          generation,
          roomCandidates,
          renderedPreviewRoomIds,
          previewSelection.fullRoomIds,
          detail,
          true,
        );
        if (!this.isLoadGenerationCurrent(generation)) return;
        this.startupDynamicOverlayGeneration = -1;
        this.cancelDynamicOverlayRetry();
      },
      onDeferredError: (retryError) => this.scheduleDynamicOverlayRetry(
        generation,
        detail,
        retryError,
      ),
    });
  }

  private cancelDynamicOverlayRetry(): void {
    this.dynamicOverlayRetryTimer?.remove(false);
    this.dynamicOverlayRetryTimer = null;
    this.dynamicOverlayRetryAttempt = 0;
  }

  private requestFullPreviewUpgradeIfNeeded(
    roomCandidates: Map<string, StreamingRoomCandidate>,
    previewRoomIds: Set<string>,
    fullRoomIds: Set<string>,
  ): void {
    if (
      !this.compactWorldActive ||
      this.getPreviewSnapshotDetail() !== 'full' ||
      this.startupDynamicOverlayGeneration === this.loadGeneration ||
      this.fullPreviewUpgradeGeneration === this.loadGeneration
    ) {
      return;
    }

    const generation = this.loadGeneration;
    this.fullPreviewUpgradeGeneration = generation;
    const tiledBrowseCutover = this.worldTileController.isBrowseCutoverActive();
    const selectedNearRoomIds = this.getNearestPreviewRoomIds(
      roomCandidates,
      previewRoomIds,
      fullRoomIds,
      9,
    );
    const nearRoomIds = tiledBrowseCutover
      ? this.getRenderedPreviewRoomIds(roomCandidates, selectedNearRoomIds)
      : selectedNearRoomIds;
    void (async () => {
      if (tiledBrowseCutover) {
        if (!this.worldTileController.isBrowseCutoverActive()) {
          this.handleDynamicOverlayReadinessStopped(generation);
          return;
        }
        const sharpReady = await this.waitForDynamicOverlayTargetLod(generation);
        if (!sharpReady) {
          this.handleDynamicOverlayReadinessStopped(generation);
          return;
        }
      }
      if (!this.isLoadGenerationCurrent(generation)) return;
      await this.previewCache.ensureRoomSnapshotsBatch(roomCandidates, nearRoomIds, {
        priority: 'high',
        detail: 'full',
      });
      if (this.destroyed || generation !== this.loadGeneration) return;
      const nearRenderableRooms = await this.previewCache.collectRenderableRooms(
        roomCandidates,
        nearRoomIds,
        fullRoomIds,
      );
      if (this.destroyed || generation !== this.loadGeneration) return;
      this.previewRenderer.mergeChunkPreviews(
        this.collectPreviewRooms(nearRenderableRooms, nearRoomIds),
      );
      await this.loadDistantPreviewsProgressively(
        generation,
        roomCandidates,
        previewRoomIds,
        fullRoomIds,
        'full',
        tiledBrowseCutover,
      );
      if (this.isLoadGenerationCurrent(generation)) {
        this.dynamicOverlayRetryAttempt = 0;
        this.cancelDynamicOverlayRetry();
      }
    })().catch((error) => {
      if (generation === this.loadGeneration) {
        this.fullPreviewUpgradeGeneration = -1;
      }
      if (this.worldTileController.isBrowseCutoverActive()) {
        this.scheduleDynamicOverlayRetry(generation, 'full', error);
      } else {
        console.warn('Detailed world preview upgrade stopped', error);
      }
    });
  }

  private captureChunkPreviewHashes(chunkWindow: WorldChunkWindow): void {
    this.chunkPreviewHashesById = new Map(
      chunkWindow.chunks.map((chunk) => [chunk.id, chunk.chunkPreviewHash])
    );
  }

  private haveChunkPreviewHashesChanged(chunkWindow: WorldChunkWindow): boolean {
    if (this.chunkPreviewHashesById.size !== chunkWindow.chunks.length) {
      return true;
    }

    for (const chunk of chunkWindow.chunks) {
      if (this.chunkPreviewHashesById.get(chunk.id) !== chunk.chunkPreviewHash) {
        return true;
      }
    }

    return false;
  }

  private getDesiredChunkBounds(centerCoordinates: RoomCoordinates): WorldChunkBounds {
    const camera = this.options.scene.cameras.main;
    return getDesiredChunkBounds({
      centerCoordinates,
      mode: this.options.getMode(),
      performanceProfile: this.getEffectivePerformanceProfile(),
      zoom: camera.zoom,
      viewportWidth: this.options.scene.scale.width,
      viewportHeight: this.options.scene.scale.height,
    });
  }

  private getPreviewTileSize(): number {
    const camera = this.options.scene.cameras.main;
    return getChunkPreviewTileSize({
      mode: this.options.getMode(),
      performanceProfile: this.getEffectivePerformanceProfile(),
      zoom: camera.zoom,
    });
  }

  private getPreviewSnapshotDetail(): RoomSnapshotQueryDetail {
    return this.options.getMode() === 'browse' && this.getPreviewTileSize() <= 2
      ? 'overview'
      : 'full';
  }

  private getEffectivePerformanceProfile(): PerformanceProfile {
    return this.options.getMode() === 'play' && this.localPlayPressure.profile === 'reduced'
      ? 'reduced'
      : this.options.getPerformanceProfile();
  }

  private computeLocalPlayPressure(
    roomCandidates: Map<string, StreamingRoomCandidate>
  ): LocalPlayPressureMetrics {
    if (this.options.getMode() !== 'play') {
      return createDefaultLocalPlayPressureMetrics();
    }

    return computeLocalPlayPressureMetrics({
      focusCoordinates: this.options.getCurrentRoomCoordinates(),
      wasReduced: this.localPlayPressure.profile === 'reduced',
      getRoomSnapshot: (coordinates) => {
        const roomId = roomIdFromCoordinates(coordinates);
        const candidate = roomCandidates.get(roomId);
        if (candidate?.draft) {
          return candidate.draft;
        }

        if (candidate?.sharedPreview) {
          return candidate.sharedPreview;
        }

        const loadedRoom = this.loadedFullRoomsById.get(roomId);
        if (loadedRoom) {
          return loadedRoom.room;
        }

        return this.previewCache.getRoomSnapshot(roomId);
      },
    });
  }

  private getViewportRoomBounds(): WorldRoomBounds {
    const camera = this.options.scene.cameras.main;
    const zoom = Math.max(camera.zoom, 0.001);
    const visibleWorldWidth = camera.width / zoom;
    const visibleWorldHeight = camera.height / zoom;
    // Streaming refreshes can run immediately after setZoom(), before Phaser refreshes camera.worldView.
    const left = camera.scrollX + camera.width * camera.originX - visibleWorldWidth * 0.5;
    const top = camera.scrollY + camera.height * camera.originY - visibleWorldHeight * 0.5;
    const right = left + visibleWorldWidth;
    const bottom = top + visibleWorldHeight;
    const minX = Math.floor(left / ROOM_PX_WIDTH);
    const maxX = Math.floor((right - 1) / ROOM_PX_WIDTH);
    const minY = Math.floor(top / ROOM_PX_HEIGHT);
    const maxY = Math.floor((bottom - 1) / ROOM_PX_HEIGHT);

    return { minX, maxX, minY, maxY };
  }

  private getChunkRadius(bounds: WorldChunkBounds): number {
    return Math.max(bounds.maxChunkX - bounds.minChunkX, bounds.maxChunkY - bounds.minChunkY) / 2;
  }

  private getFocusCoordinates(): RoomCoordinates {
    return this.options.getMode() === 'play'
      ? this.options.getCurrentRoomCoordinates()
      : this.options.getSelectedCoordinates();
  }

  private invalidateRoomArtifacts(
    roomId: string,
    dropPublishedSnapshot: boolean,
    preserveLoadedRuntimeForReplacement = false,
  ): void {
    if (this.previousRoomArtifactRoomId === roomId) {
      this.previousRoomArtifactKey = null;
      this.previousRoomArtifactRoomId = null;
    }
    const loadedRoom = this.loadedFullRoomsById.get(roomId) ?? null;
    const replacementAvailable = Boolean(
      preserveLoadedRuntimeForReplacement
      && loadedRoom
      && this.resolveTransitionRenderableRoom(loadedRoom.room.coordinates),
    );
    this.fullPreviewUpgradeGeneration = -1;
    this.selectedExactPrefetchLifecycle.invalidate(roomId);
    this.cancelFullRoomPreparation(roomId, 'room-invalidated');
    if (!replacementAvailable) {
      this.destroyFullRoom(roomId);
      this.syncLiveObjectWorldColliders();
      this.options.syncLiveObjectInteractions?.(this.loadedFullRoomsById.values());
    }
    this.roomArtifactCache.invalidateRoom(roomId);
    this.previewRenderer.invalidateRoomPreview(roomId);
    this.previewCache.invalidateRoom(roomId, dropPublishedSnapshot);
  }

  private completeSelectedExactPrefetch(
    request: SelectedExactPrefetchRequest,
    room: RoomSnapshot | null,
  ): void {
    const currentRoomId = roomIdFromCoordinates(this.options.getSelectedCoordinates());
    const completion = this.selectedExactPrefetchLifecycle.complete({
      request,
      snapshotAvailable: room?.id === request.roomId,
      currentRoomId,
      nowMs: performance.now(),
    });
    if (
      !completion.accepted
      || !completion.shouldRefreshSelectedState
      || !room
      || currentRoomId !== request.roomId
    ) return;
    this.options.onSelectedExactRoomSnapshotReady?.(room);
  }

  private ensureFullRoom(room: RoomSnapshot, source: PlayableRoomSource): void {
    return this.measure('stream.ensureFullRoom', () => {
    const existing = this.loadedFullRoomsById.get(room.id);
    if (existing && this.isLoadedFullRoomCurrent(existing, room, source)) {
      this.ensurePlayerTerrainColliders(existing);
      return;
    }

    registerCustomSpritesFromSnapshot(room);
    const replacingExistingRoom = Boolean(existing);
    if (existing) {
      existing.collisionReady = false;
      this.options.onFullRoomSetChanged?.([existing.room.coordinates]);
    }
    this.destroyFullRoom(room.id, false);
    this.cancelFullRoomPreparation(room.id, 'synchronous-room-load');

    const textureKey = this.buildScopedRoomTextureKey(room, {
      includeBackground: false,
      includeObjects: false,
      includedLayers: ['background', 'terrain'],
    });
    const foregroundTextureKey = this.buildScopedRoomTextureKey(room, {
      includeBackground: false,
      includeObjects: false,
      includedLayers: ['foreground'],
    });
    if (!this.options.scene.textures.exists(textureKey)) {
      this.measure('stream.buildFullRoomTexture.terrain', () => {
        buildRoomSnapshotTexture(this.options.scene, room, textureKey, TILE_SIZE, {
          includeBackground: false,
          includeObjects: false,
          includedLayers: ['background', 'terrain'],
        });
      });
    }
    if (!this.options.scene.textures.exists(foregroundTextureKey)) {
      this.measure('stream.buildFullRoomTexture.foreground', () => {
        buildRoomSnapshotTexture(this.options.scene, room, foregroundTextureKey, TILE_SIZE, {
          includeBackground: false,
          includeObjects: false,
          includedLayers: ['foreground'],
        });
      });
    }

    const origin = this.options.getRoomOrigin(room.coordinates);
    const roomBackground = this.measure('stream.createRoomBackground', () =>
      this.createRoomBackground(room, origin)
    );
    const image = this.options.scene.add.image(
      origin.x + ROOM_PX_WIDTH / 2,
      origin.y + ROOM_PX_HEIGHT / 2,
      textureKey
    );
    image.setOrigin(0.5);
    image.setDepth(10);
    image.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    const foregroundImage = this.options.scene.add.image(
      origin.x + ROOM_PX_WIDTH / 2,
      origin.y + ROOM_PX_HEIGHT / 2,
      foregroundTextureKey
    );
    foregroundImage.setOrigin(0.5);
    foregroundImage.setDepth(27.25);
    foregroundImage.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);

    const map = this.measure('stream.createTilemap', () => this.options.scene.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: ROOM_WIDTH,
      height: ROOM_HEIGHT,
    }));
    const customRoomTileTextureKey = this.getCustomRoomTileTextureKey(room);
    if (customRoomTileTextureKey) {
      this.measure('stream.ensureCustomRoomTileTexture', () => {
        if (!this.options.scene.textures.exists(customRoomTileTextureKey)) {
          ensureCustomRoomTileTexture(this.options.scene, customRoomTileTextureKey, room.customTiles);
        }
      });
    }
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const tilesetConfig of TILESETS) {
      const tileset = map.addTilesetImage(
        tilesetConfig.key,
        tilesetConfig.key,
        TILE_SIZE,
        TILE_SIZE,
        0,
        0,
        tilesetConfig.firstGid
      );
      if (tileset) {
        tilesets.push(tileset);
      }
    }
    if (customRoomTileTextureKey) {
      const customTileset = ensureCustomRoomTilesetForMap(map, customRoomTileTextureKey);
      if (customTileset) {
        tilesets.push(customTileset);
      }
    }

    const terrainLayer = this.measure('stream.createTerrainLayer', () =>
      map.createBlankLayer(`terrain-${room.id}`, tilesets, origin.x, origin.y)
    );
    if (!terrainLayer) {
      roomBackground.colorRect?.destroy();
      for (const backgroundSprite of roomBackground.sprites) {
        backgroundSprite.sprite.destroy();
      }
      image.destroy();
      foregroundImage.destroy();
      map.destroy();
      return;
    }

    this.measure('stream.populateTerrainLayer', () => {
      this.populateTerrainLayerRows(room, terrainLayer, 0, ROOM_HEIGHT);
    });

    this.measure('stream.setTerrainCollision', () => {
      terrainLayer.setCollisionByExclusion([-1]);
    });
    terrainLayer.setVisible(false);
    const terrainInsetBodies = this.measure('stream.createTerrainInsetBodies', () =>
      this.createTerrainInsetBodies(room, origin, terrainLayer)
    );
    const staticLighting = this.measure('stream.extractStaticLighting', () =>
      extractRoomStaticLightingEmitters(room, origin)
    );

    const player = this.options.getPlayer();
    const loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall> = {
      room,
      source,
      staticLighting,
      backgroundColorRect: roomBackground.colorRect,
      backgroundSprites: roomBackground.sprites,
      image,
      textureKey,
      foregroundImage,
      foregroundTextureKey,
      map,
      terrainLayer,
      terrainCollider: player
        ? this.options.scene.physics.add.collider(
            player,
            terrainLayer,
            undefined,
            (_player, tile) =>
              this.options.shouldCollidePlayerWithTerrainTile?.(tile as Phaser.Tilemaps.Tile) ?? true,
          )
        : null,
      terrainInsetBodies,
      terrainInsetCollider:
        player && terrainInsetBodies
          ? this.options.scene.physics.add.collider(player, terrainInsetBodies)
          : null,
      edgeWalls: [],
      liveObjects: [],
      artifactKey: this.buildFullRoomArtifactKey(room, source),
      customRoomTileTextureKey,
      collisionReady: false,
    };
    this.measure('stream.updateFullRoomBackground', () => {
      this.updateFullRoomBackground(loadedRoom, this.options.scene.cameras.main);
    });
    this.measure('stream.createLiveObjects', () => {
      this.options.createLiveObjects(loadedRoom);
    });
    this.loadedFullRoomsById.set(room.id, loadedRoom);
    this.syncRoomArtifactCachePolicy();
    this.roomArtifactCache.record({
      key: this.buildFullRoomArtifactKey(room, source),
      roomId: room.id,
      byteSize: this.getFullRoomArtifactByteSize(room),
      resourceKeys: [textureKey, foregroundTextureKey, customRoomTileTextureKey]
        .filter((key): key is string => Boolean(key)),
      resourceByteSizes: this.getFullRoomArtifactResourceByteSizes(
        room,
        textureKey,
        foregroundTextureKey,
        customRoomTileTextureKey,
      ),
    });
    this.syncLiveObjectWorldColliders();
    this.options.syncLiveObjectInteractions?.(this.loadedFullRoomsById.values());
    loadedRoom.collisionReady = this.isLoadedRoomCollisionInfrastructureReady(loadedRoom);
    this.previewRenderer.syncPreviewVisibility();
    this.options.onBackdropObjectsChanged?.();
    this.options.onFullRoomSetChanged?.([room.coordinates]);
    if (replacingExistingRoom) {
      this.options.onFullRoomReplaced?.(loadedRoom);
    }
    if (loadedRoom.collisionReady) {
      this.options.onFullRoomCollisionReady?.(loadedRoom);
    }
    });
  }

  private ensurePlayerTerrainColliders(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    if (
      loadedRoom.runtimeSuspended === true
      || this.pendingFullRoomTeardownsById.has(loadedRoom.room.id)
    ) {
      return;
    }
    const player = this.options.getPlayer();
    if (!player) {
      return;
    }

    if (!loadedRoom.terrainCollider) {
      loadedRoom.terrainCollider = this.options.scene.physics.add.collider(
        player,
        loadedRoom.terrainLayer,
        undefined,
        (_player, tile) =>
          this.options.shouldCollidePlayerWithTerrainTile?.(tile as Phaser.Tilemaps.Tile) ?? true,
      );
    }
    if (loadedRoom.terrainInsetBodies && !loadedRoom.terrainInsetCollider) {
      loadedRoom.terrainInsetCollider = this.options.scene.physics.add.collider(
        player,
        loadedRoom.terrainInsetBodies,
      );
    }
  }

  private isLoadedFullRoomCurrent(
    existing: LoadedFullRoom<TLiveObject, TEdgeWall>,
    room: RoomSnapshot,
    source: PlayableRoomSource,
  ): boolean {
    return (
      existing.source === source &&
      existing.room.version === room.version &&
      existing.room.updatedAt === room.updatedAt &&
      existing.room.status === room.status
    );
  }

  private buildScopedRoomTextureKey(
    room: RoomSnapshot,
    options: {
      includeBackground?: boolean;
      includeObjects?: boolean;
      includedLayers?: ('background' | 'terrain' | 'foreground')[];
    },
  ): string {
    return `${this.textureNamespace}-${buildRoomTextureKey(room, 'full', TILE_SIZE, options)}`;
  }

  private buildFullRoomPreparationIdentity(
    room: RoomSnapshot,
    source: PlayableRoomSource,
  ): string {
    return [room.id, source, room.status, room.version, room.updatedAt].join(':');
  }

  private buildFullRoomArtifactKey(room: RoomSnapshot, source: PlayableRoomSource): string {
    return `full-room:${this.buildFullRoomPreparationIdentity(room, source)}`;
  }

  private getCustomRoomTileTextureKey(room: RoomSnapshot): string | null {
    if ((room.customTiles?.length ?? 0) === 0) return null;
    return buildCustomRoomTileTextureKey(
      `${this.textureNamespace}:${room.id}:${room.version}:${room.updatedAt}`,
    );
  }

  private getFullRoomArtifactByteSize(room: RoomSnapshot): number {
    const roomTextureBytes = ROOM_PX_WIDTH * ROOM_PX_HEIGHT * 4 * 2;
    if ((room.customTiles?.length ?? 0) === 0) return roomTextureBytes;
    const customTileTextureBytes =
      CUSTOM_ROOM_TILE_ATLAS_COLUMNS
      * TILE_SIZE
      * CUSTOM_ROOM_TILE_ATLAS_ROWS
      * TILE_SIZE
      * 4;
    return roomTextureBytes + customTileTextureBytes;
  }

  private getFullRoomArtifactResourceByteSizes(
    room: RoomSnapshot,
    textureKey: string,
    foregroundTextureKey: string,
    customRoomTileTextureKey: string | null,
  ): Readonly<Record<string, number>> {
    const roomLayerTextureBytes = ROOM_PX_WIDTH * ROOM_PX_HEIGHT * 4;
    const resourceByteSizes: Record<string, number> = {
      [textureKey]: roomLayerTextureBytes,
      [foregroundTextureKey]: roomLayerTextureBytes,
    };
    if (customRoomTileTextureKey && (room.customTiles?.length ?? 0) > 0) {
      resourceByteSizes[customRoomTileTextureKey] =
        CUSTOM_ROOM_TILE_ATLAS_COLUMNS
        * TILE_SIZE
        * CUSTOM_ROOM_TILE_ATLAS_ROWS
        * TILE_SIZE
        * 4;
    }
    return resourceByteSizes;
  }

  private getTransitionPreparationPriority(
    coordinates: RoomCoordinates,
    portalDestination = false,
  ): FrameWorkPriority {
    if (portalDestination) return 'portal-current-destination';
    const current = this.options.getCurrentRoomCoordinates();
    return Math.abs(coordinates.x - current.x) + Math.abs(coordinates.y - current.y) === 1
      ? 'predicted-destination-collision'
      : 'predicted-visuals-objects';
  }

  private isHigherFrameWorkPriority(
    candidate: FrameWorkPriority,
    current: FrameWorkPriority,
  ): boolean {
    return FRAME_WORK_PRIORITIES.indexOf(candidate) < FRAME_WORK_PRIORITIES.indexOf(current);
  }

  private estimateTimeToSeamMs(coordinates: RoomCoordinates): number {
    const current = this.options.getCurrentRoomCoordinates();
    const deltaX = coordinates.x - current.x;
    const deltaY = coordinates.y - current.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) !== 1) return 0;

    const player = this.options.getPlayer() as (Phaser.GameObjects.GameObject & {
      x?: number;
      y?: number;
      body?: Phaser.Physics.Arcade.Body | null;
    }) | null;
    const velocity = player?.body?.velocity;
    if (!player || !velocity || typeof player.x !== 'number' || typeof player.y !== 'number') {
      return Number.POSITIVE_INFINITY;
    }

    const origin = this.options.getRoomOrigin(current);
    if (deltaX === 1 && velocity.x > 0) {
      return Math.max(0, origin.x + ROOM_PX_WIDTH - player.x) / velocity.x * 1_000;
    }
    if (deltaX === -1 && velocity.x < 0) {
      return Math.max(0, player.x - origin.x) / Math.abs(velocity.x) * 1_000;
    }
    if (deltaY === 1 && velocity.y > 0) {
      return Math.max(0, origin.y + ROOM_PX_HEIGHT - player.y) / velocity.y * 1_000;
    }
    if (deltaY === -1 && velocity.y < 0) {
      return Math.max(0, player.y - origin.y) / Math.abs(velocity.y) * 1_000;
    }
    if (deltaX !== 0 && Math.abs(velocity.x) <= PREDICTED_VELOCITY_EPSILON) {
      const distance = deltaX > 0
        ? Math.max(0, origin.x + ROOM_PX_WIDTH - player.x)
        : Math.max(0, player.x - origin.x);
      if (distance <= PREDICTED_SEAM_LOCK_DISTANCE_PX) {
        return distance / PREDICTED_FALLBACK_SPEED_PX_PER_SEC * 1_000;
      }
    }
    if (deltaY !== 0 && Math.abs(velocity.y) <= PREDICTED_VELOCITY_EPSILON) {
      const distance = deltaY > 0
        ? Math.max(0, origin.y + ROOM_PX_HEIGHT - player.y)
        : Math.max(0, player.y - origin.y);
      if (distance <= PREDICTED_SEAM_LOCK_DISTANCE_PX) {
        return distance / PREDICTED_FALLBACK_SPEED_PX_PER_SEC * 1_000;
      }
    }
    return Number.POSITIVE_INFINITY;
  }

  private shouldAdoptPredictedPreparation(
    roomId: string,
    coordinates: RoomCoordinates,
  ): boolean {
    if (!this.predictedPreparationRoomId || this.predictedPreparationRoomId === roomId) {
      return true;
    }
    const previousCoordinates = this.predictedPreparationCoordinates;
    if (!previousCoordinates) return true;
    const previousEta = this.estimateTimeToSeamMs(previousCoordinates);
    const nextEta = this.estimateTimeToSeamMs(coordinates);
    return nextEta + PREDICTED_DESTINATION_SWITCH_HYSTERESIS_MS < previousEta;
  }

  private adoptPredictedPreparation(
    roomId: string,
    coordinates: RoomCoordinates,
  ): boolean {
    if (!this.shouldAdoptPredictedPreparation(roomId, coordinates)) return false;

    const previousRoomId = this.predictedPreparationRoomId;
    if (previousRoomId && previousRoomId !== roomId) {
      if (previousRoomId !== this.portalPreparationRoomId) {
        this.cancelFullRoomPreparation(previousRoomId, 'predicted-destination-changed');
        this.queueUnretainedPredictedRoomTeardown(previousRoomId);
      }
    }

    if (previousRoomId !== roomId) {
      this.predictedPreparationIntentGeneration += 1;
    }

    this.predictedPreparationRoomId = roomId;
    this.predictedPreparationCoordinates = { ...coordinates };
    this.predictedPreparationExpiresAt =
      this.options.scene.time.now + PREDICTED_DESTINATION_INTENT_TTL_MS;
    this.schedulePredictedPreparationExpiry();
    this.cancelPendingFullRoomTeardown(
      roomId,
      'room-became-predicted',
      true,
      true,
    );
    return true;
  }

  private schedulePredictedPreparationExpiry(): void {
    if (this.predictedPreparationExpiryTimer || !this.predictedPreparationRoomId) return;
    const now = this.options.scene.time.now;
    const delay = Math.max(1, this.predictedPreparationExpiresAt - now + 1);
    this.predictedPreparationExpiryTimer = this.options.scene.time.delayedCall(delay, () => {
      this.predictedPreparationExpiryTimer = null;
      if (!this.predictedPreparationRoomId) return;
      if (this.options.scene.time.now < this.predictedPreparationExpiresAt) {
        this.schedulePredictedPreparationExpiry();
        return;
      }
      this.clearPredictedPlayableRoomForTransition('prediction-expired');
    });
  }

  private cancelPredictedPreparationExpiryTimer(): void {
    this.predictedPreparationExpiryTimer?.remove(false);
    this.predictedPreparationExpiryTimer = null;
  }

  private queueUnretainedPredictedRoomTeardown(roomId: string): void {
    if (
      this.retainedFullRoomIds.has(roomId)
      || roomId === roomIdFromCoordinates(this.options.getCurrentRoomCoordinates())
    ) return;
    const loadedRoom = this.loadedFullRoomsById.get(roomId);
    if (!loadedRoom) return;
    const changedCoordinates = this.queueFullRoomTeardown(loadedRoom);
    if (changedCoordinates) {
      this.options.onFullRoomSetChanged?.([changedCoordinates]);
    }
  }

  private beginFullRoomPreparation(
    renderableRoom: RenderableRoom,
    priority: FrameWorkPriority,
    predicted: boolean,
    activateWhenReady = !predicted,
  ): PendingFullRoomPreparation<TLiveObject, TEdgeWall> | null {
    if (this.destroyed || this.options.getMode() !== 'play') return null;
    if (!predicted && activateWhenReady) {
      this.detachPredictedPreparationIntent(renderableRoom.id);
    }
    if (
      predicted
      && !this.adoptPredictedPreparation(renderableRoom.id, renderableRoom.coordinates)
    ) {
      return this.pendingFullRoomPreparationsById.get(renderableRoom.id) ?? null;
    }
    const loadedRoom = this.loadedFullRoomsById.get(renderableRoom.id);
    if (loadedRoom && this.isLoadedFullRoomCurrent(
      loadedRoom,
      renderableRoom.room,
      renderableRoom.source,
    )) {
      const pendingTeardown = this.pendingFullRoomTeardownsById.get(renderableRoom.id);
      if (pendingTeardown?.destructionStarted) {
        pendingTeardown.retainedAfterDestruction = true;
        if (!pendingTeardown.job) {
          this.enqueuePendingFullRoomTeardownJob(
            renderableRoom.id,
            pendingTeardown,
            pendingTeardown.phase,
          );
        }
      } else {
        this.cancelPendingFullRoomTeardown(
          renderableRoom.id,
          'loaded-room-requested-for-activation',
          true,
          true,
        );
        const restoredLoadedRoom = this.loadedFullRoomsById.get(renderableRoom.id) ?? null;
        if (
          restoredLoadedRoom
          && this.isLoadedFullRoomCurrent(
            restoredLoadedRoom,
            renderableRoom.room,
            renderableRoom.source,
          )
        ) {
          this.ensurePlayerTerrainColliders(restoredLoadedRoom);
          restoredLoadedRoom.collisionReady =
            this.isLoadedRoomCollisionInfrastructureReady(restoredLoadedRoom);
          if (restoredLoadedRoom.artifactKey) {
            this.roomArtifactCache.touch(restoredLoadedRoom.artifactKey);
          }
          return null;
        }
      }
    }

    const identity = this.buildFullRoomPreparationIdentity(
      renderableRoom.room,
      renderableRoom.source,
    );
    const existing = this.pendingFullRoomPreparationsById.get(renderableRoom.id);
    let inheritedStandardActivation = false;
    let inheritedPortalActivation = false;
    let inheritedDisposedReplacementRoom: LoadedFullRoom<TLiveObject, TEdgeWall> | null = null;
    if (existing?.identity === identity) {
      this.promoteFullRoomPreparation(existing, priority);
      if (activateWhenReady) this.requestFullRoomPreparationActivation(existing);
      return existing;
    }
    if (existing) {
      inheritedStandardActivation = existing.standardActivationRequested;
      inheritedPortalActivation = existing.portalActivationRequested;
      const inheritedPrediction = this.predictedPreparationRoomId === renderableRoom.id;
      inheritedDisposedReplacementRoom = this.cancelFullRoomPreparation(
        renderableRoom.id,
        'room-snapshot-replaced',
        true,
      );
      if (
        (predicted || inheritedPrediction)
        && !this.adoptPredictedPreparation(renderableRoom.id, renderableRoom.coordinates)
      ) {
        existing.disposedReplacementRoom = inheritedDisposedReplacementRoom;
        this.settleDisposedReplacementAfterPreparationStops(existing);
        return null;
      }
    }

    const textureKey = this.buildScopedRoomTextureKey(renderableRoom.room, {
      includeBackground: false,
      includeObjects: false,
      includedLayers: ['background', 'terrain'],
    });
    const foregroundTextureKey = this.buildScopedRoomTextureKey(renderableRoom.room, {
      includeBackground: false,
      includeObjects: false,
      includedLayers: ['foreground'],
    });
    const texturesReady = this.options.scene.textures.exists(textureKey)
      && this.options.scene.textures.exists(foregroundTextureKey);
    const resolvedBackground = resolveRoomBackground(renderableRoom.room.background);
    const customRoomTileTextureKey = this.getCustomRoomTileTextureKey(renderableRoom.room);
    const customTilePreparation = customRoomTileTextureKey
      && !this.options.scene.textures.exists(customRoomTileTextureKey)
      ? new CustomRoomTileTexturePreparation(
          this.options.scene,
          renderableRoom.room.customTiles,
        )
      : null;
    const customBackgroundReady = resolvedBackground.kind !== 'custom'
      || this.options.scene.textures.exists(getCustomBackgroundTextureKey(resolvedBackground.id));
    const customBackgroundPreparation = resolvedBackground.kind === 'custom'
      && !customBackgroundReady
      ? new CustomBackgroundTexturePreparation(resolvedBackground.id)
      : null;
    const standardActivationRequested = Boolean(
      activateWhenReady || inheritedStandardActivation,
    );
    const portalActivationRequested = inheritedPortalActivation;
    const preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall> = {
      identity,
      artifactKey: this.buildFullRoomArtifactKey(renderableRoom.room, renderableRoom.source),
      room: renderableRoom.room,
      source: renderableRoom.source,
      generation: this.frameWorkCoordinator.beginGeneration(`full-room:${renderableRoom.id}`),
      priority,
      queuedJob: null,
      activationRequested: standardActivationRequested || portalActivationRequested,
      standardActivationRequested,
      portalActivationRequested,
      phase: texturesReady ? 'uploads' : 'textures',
      texturePreparation: texturesReady
        ? null
        : new RoomTexturePreparation(this.options.scene, renderableRoom.room),
      customTilePreparation,
      textureKey,
      foregroundTextureKey,
      committedTextureKeys: [],
      loadedRoom: null,
      replacementRoom: null,
      disposedReplacementRoom: inheritedDisposedReplacementRoom,
      nextTerrainRow: 0,
      nextInsetRow: 0,
      insetBodyCount: 0,
      nextLiveObjectIndex: 0,
      customBackgroundReady,
      customBackgroundPreparation,
      backgroundPrepared: false,
    };
    this.pendingFullRoomPreparationsById.set(renderableRoom.id, preparation);
    this.syncRoomArtifactCachePolicy();

    if (customBackgroundPreparation) {
      void customBackgroundPreparation.prepare()
        .then(() => {
          if (!this.isFullRoomPreparationCurrent(preparation)) return;
          if (preparation.phase === 'custom-background') {
            this.queuePreparedCustomBackgroundUpload(preparation);
          }
        })
        .catch((error) => {
          if (!this.isFullRoomPreparationCurrent(preparation)) return;
          this.failFullRoomPreparation(preparation, error);
        });
    }

    if (preparation.texturePreparation) {
      this.queuePreparedTextureBatch(preparation);
    } else {
      this.queuePreparedCustomTiles(preparation);
    }
    return preparation;
  }

  private enqueueFullRoomPreparationJob(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    label: string,
    costKind: 'cpu' | 'gpu-upload',
    estimatedCostMs: number,
    execute: () => void,
  ): void {
    let queuedJob: FrameWorkJobHandle | null = null;
    queuedJob = this.frameWorkCoordinator.enqueue({
      label: `${label}:${preparation.room.id}`,
      priority: preparation.priority,
      costKind,
      estimatedCostMs,
      generation: preparation.generation,
      execute: () => {
        if (preparation.queuedJob === queuedJob) {
          preparation.queuedJob = null;
        }
        if (!this.isFullRoomPreparationCurrent(preparation)) return;
        try {
          execute();
        } catch (error) {
          this.failFullRoomPreparation(preparation, error);
          throw error;
        }
      },
    });
    preparation.queuedJob = queuedJob;
  }

  private promoteFullRoomPreparation(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    priority: FrameWorkPriority,
  ): void {
    if (!this.isHigherFrameWorkPriority(priority, preparation.priority)) return;
    preparation.priority = priority;
    preparation.queuedJob?.reprioritize(priority);
  }

  private requestFullRoomPreparationActivation(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    portalDestination = false,
  ): void {
    if (!this.isFullRoomPreparationCurrent(preparation)) return;
    if (portalDestination) {
      preparation.portalActivationRequested = true;
    } else {
      preparation.standardActivationRequested = true;
    }
    preparation.activationRequested = Boolean(
      preparation.standardActivationRequested || preparation.portalActivationRequested,
    );
    this.promoteFullRoomPreparation(preparation, 'portal-current-destination');
    if (preparation.phase === 'ready') {
      this.queuePreparedRoomCommit(preparation);
    }
  }

  private clearPreparedRoomActivationIfUnowned(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    reason: string,
  ): void {
    if (preparation.activationRequested) return;
    if (
      preparation.phase === 'commit'
      && preparation.queuedJob?.cancel(reason)
    ) {
      preparation.queuedJob = null;
      preparation.phase = 'ready';
      this.settleDisposedReplacementAfterPreparationStops(preparation);
      return;
    }
    if (preparation.phase !== 'waiting-for-teardown') return;
    const pendingTeardown = this.pendingFullRoomTeardownsById.get(preparation.room.id);
    if (pendingTeardown?.commitAfterTeardown === preparation) {
      pendingTeardown.commitAfterTeardown = null;
    }
    preparation.phase = 'ready';
    this.settleDisposedReplacementAfterPreparationStops(preparation);
  }

  private applySnapshotPreparationActivationOwners(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    request: PlayableRoomSnapshotPreparationRequest,
  ): void {
    if (request.standardActivationRequested) {
      this.requestFullRoomPreparationActivation(preparation, false);
    }
    if (request.portalActivationRequested) {
      this.requestFullRoomPreparationActivation(preparation, true);
    }
  }

  private detachPredictedPreparationIntent(roomId: string): void {
    if (this.predictedPreparationRoomId !== roomId) return;
    this.predictedPreparationRoomId = null;
    this.predictedPreparationCoordinates = null;
    this.predictedPreparationExpiresAt = 0;
    this.predictedPreparationIntentGeneration += 1;
    this.cancelPredictedPreparationExpiryTimer();
  }

  private queuePreparedTextureBatch(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'textures';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-texture-rows',
      'cpu',
      0.5,
      () => {
        const complete = preparation.texturePreparation?.runNextBatch(
          PREPARED_TEXTURE_ROWS_PER_JOB,
        ) ?? true;
        if (complete) {
          this.queuePreparedTextureUpload(preparation);
        } else {
          this.queuePreparedTextureBatch(preparation);
        }
      },
    );
  }

  private queuePreparedTextureUpload(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'uploads';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'upload-room-texture',
      'gpu-upload',
      1,
      () => {
        const result = preparation.texturePreparation?.commitNext(
          preparation.textureKey,
          preparation.foregroundTextureKey,
        ) ?? { resourceKey: null, complete: true };
        if (result.resourceKey) {
          if (!this.options.scene.textures.exists(result.resourceKey)) {
            throw new Error(`Prepared room texture ${result.resourceKey} was not registered.`);
          }
          if (!preparation.committedTextureKeys.includes(result.resourceKey)) {
            preparation.committedTextureKeys.push(result.resourceKey);
          }
        }
        if (result.complete) {
          this.queuePreparedCustomTiles(preparation);
        } else {
          this.queuePreparedTextureUpload(preparation);
        }
      },
    );
  }

  private queuePreparedCustomTiles(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'custom-tiles';
    const customTextureKey = this.getCustomRoomTileTextureKey(preparation.room);
    if (!customTextureKey || this.options.scene.textures.exists(customTextureKey)) {
      preparation.customTilePreparation?.cancel();
      this.finishPreparedCustomTiles(preparation);
      return;
    }
    const customTilePreparation = preparation.customTilePreparation;
    if (!customTilePreparation) {
      throw new Error(`Custom room tile preparation is missing for ${preparation.room.id}.`);
    }
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-custom-tile-batch',
      'cpu',
      0.5,
      () => {
        if (customTilePreparation.runNextBatch(PREPARED_CUSTOM_TILES_PER_JOB)) {
          this.queuePreparedCustomTileUpload(preparation, customTextureKey);
        } else {
          this.queuePreparedCustomTiles(preparation);
        }
      },
    );
  }

  private queuePreparedCustomTileUpload(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    customTextureKey: string,
  ): void {
    preparation.phase = 'custom-tiles';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'upload-room-custom-tiles',
      'gpu-upload',
      1,
      () => {
        preparation.customTilePreparation?.commit(customTextureKey);
        if (!this.options.scene.textures.exists(customTextureKey)) {
          throw new Error(`Prepared custom room texture ${customTextureKey} was not registered.`);
        }
        this.finishPreparedCustomTiles(preparation);
      },
    );
  }

  private finishPreparedCustomTiles(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    this.recordPreparedRoomArtifacts(preparation);
    if (
      !preparation.customBackgroundReady
      && preparation.customBackgroundPreparation
      && this.options.scene.textures.exists(preparation.customBackgroundPreparation.key)
    ) {
      preparation.customBackgroundPreparation.cancel();
      preparation.customBackgroundReady = true;
    }
    if (preparation.customBackgroundReady) {
      this.queuePreparedRuntimeShell(preparation);
    } else if (preparation.customBackgroundPreparation?.isPrepared()) {
      this.queuePreparedCustomBackgroundUpload(preparation);
    } else {
      preparation.phase = 'custom-background';
    }
  }

  private queuePreparedCustomBackgroundUpload(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'custom-background';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'upload-room-custom-background',
      'gpu-upload',
      1,
      () => {
        const backgroundPreparation = preparation.customBackgroundPreparation;
        if (backgroundPreparation) {
          backgroundPreparation.commit(this.options.scene);
        }
        preparation.customBackgroundReady = true;
        this.queuePreparedRuntimeShell(preparation);
      },
    );
  }

  private queuePreparedRuntimeShell(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'runtime-shell';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-runtime-shell',
      'cpu',
      1,
      () => {
        registerCustomSpritesFromSnapshot(preparation.room);
        const origin = this.options.getRoomOrigin(preparation.room.coordinates);
        const image = this.options.scene.add.image(
          origin.x + ROOM_PX_WIDTH / 2,
          origin.y + ROOM_PX_HEIGHT / 2,
          preparation.textureKey,
        );
        image.setOrigin(0.5);
        image.setDepth(10);
        image.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
        image.setActive(false);
        image.setVisible(false);
        const foregroundImage = this.options.scene.add.image(
          origin.x + ROOM_PX_WIDTH / 2,
          origin.y + ROOM_PX_HEIGHT / 2,
          preparation.foregroundTextureKey,
        );
        foregroundImage.setOrigin(0.5);
        foregroundImage.setDepth(27.25);
        foregroundImage.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
        foregroundImage.setActive(false);
        foregroundImage.setVisible(false);

        const map = this.options.scene.make.tilemap({
          tileWidth: TILE_SIZE,
          tileHeight: TILE_SIZE,
          width: ROOM_WIDTH,
          height: ROOM_HEIGHT,
        });
        const tilesets: Phaser.Tilemaps.Tileset[] = [];
        for (const tilesetConfig of TILESETS) {
          const tileset = map.addTilesetImage(
            tilesetConfig.key,
            tilesetConfig.key,
            TILE_SIZE,
            TILE_SIZE,
            0,
            0,
            tilesetConfig.firstGid,
          );
          if (tileset) tilesets.push(tileset);
        }
        const customRoomTileTextureKey = this.getCustomRoomTileTextureKey(preparation.room);
        if (customRoomTileTextureKey) {
          const customTileset = ensureCustomRoomTilesetForMap(map, customRoomTileTextureKey);
          if (customTileset) tilesets.push(customTileset);
        }
        const terrainLayer = map.createBlankLayer(
          `terrain-${preparation.room.id}`,
          tilesets,
          origin.x,
          origin.y,
        );
        if (!terrainLayer) {
          image.destroy();
          foregroundImage.destroy();
          map.destroy();
          throw new Error(`Could not create terrain layer for ${preparation.room.id}.`);
        }
        terrainLayer.setVisible(false);
        terrainLayer.setActive(false);
        preparation.loadedRoom = {
          room: preparation.room,
          source: preparation.source,
          staticLighting: { emitters: [], objectCount: 0, tileCount: 0 },
          backgroundColorRect: null,
          backgroundSprites: [],
          image,
          textureKey: preparation.textureKey,
          foregroundImage,
          foregroundTextureKey: preparation.foregroundTextureKey,
          map,
          terrainLayer,
          terrainCollider: null,
          terrainInsetBodies: null,
          terrainInsetCollider: null,
          edgeWalls: [],
          liveObjects: [],
          artifactKey: preparation.artifactKey,
          customRoomTileTextureKey,
          collisionReady: false,
        };
        this.queuePreparedBackground(preparation);
      },
    );
  }

  private queuePreparedBackground(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'custom-background';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-background',
      'cpu',
      0.75,
      () => {
        const loadedRoom = this.requirePreparedLoadedRoom(preparation);
        const origin = this.options.getRoomOrigin(preparation.room.coordinates);
        const roomBackground = this.createRoomBackground(preparation.room, origin, {
          dormant: true,
          requireCustomTextureReady: true,
        });
        loadedRoom.backgroundColorRect = roomBackground.colorRect;
        loadedRoom.backgroundSprites = roomBackground.sprites;
        preparation.backgroundPrepared = true;
        this.queuePreparedTerrainBatch(preparation);
      },
    );
  }

  private queuePreparedTerrainBatch(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'terrain';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-terrain-rows',
      'cpu',
      0.75,
      () => {
        const loadedRoom = this.requirePreparedLoadedRoom(preparation);
        const endRow = Math.min(
          ROOM_HEIGHT,
          preparation.nextTerrainRow + PREPARED_TERRAIN_ROWS_PER_JOB,
        );
        this.populateTerrainLayerRows(
          preparation.room,
          loadedRoom.terrainLayer,
          preparation.nextTerrainRow,
          endRow,
        );
        preparation.nextTerrainRow = endRow;
        if (endRow < ROOM_HEIGHT) {
          this.queuePreparedTerrainBatch(preparation);
        } else {
          this.queuePreparedTerrainCollision(preparation);
        }
      },
    );
  }

  private queuePreparedTerrainCollision(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'terrain-collision';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-terrain-collision',
      'cpu',
      0.75,
      () => {
        const loadedRoom = this.requirePreparedLoadedRoom(preparation);
        loadedRoom.terrainLayer.setCollisionByExclusion([-1]);
        loadedRoom.terrainInsetBodies = this.options.scene.physics.add.staticGroup();
        this.queuePreparedTerrainInsets(preparation);
      },
    );
  }

  private queuePreparedTerrainInsets(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'terrain-insets';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-terrain-insets',
      'cpu',
      0.75,
      () => {
        const loadedRoom = this.requirePreparedLoadedRoom(preparation);
        const endRow = Math.min(
          ROOM_HEIGHT,
          preparation.nextInsetRow + PREPARED_TERRAIN_ROWS_PER_JOB,
        );
        preparation.insetBodyCount += this.createTerrainInsetBodiesRows(
          preparation.room,
          this.options.getRoomOrigin(preparation.room.coordinates),
          loadedRoom.terrainLayer,
          loadedRoom.terrainInsetBodies,
          preparation.nextInsetRow,
          endRow,
          true,
        );
        preparation.nextInsetRow = endRow;
        if (endRow < ROOM_HEIGHT) {
          this.queuePreparedTerrainInsets(preparation);
          return;
        }
        if (preparation.insetBodyCount === 0) {
          loadedRoom.terrainInsetBodies?.destroy();
          loadedRoom.terrainInsetBodies = null;
        } else {
          loadedRoom.terrainLayer.calculateFacesWithin(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
        }
        this.queuePreparedLighting(preparation);
      },
    );
  }

  private queuePreparedLighting(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'lighting';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-lighting',
      'cpu',
      0.75,
      () => {
        const loadedRoom = this.requirePreparedLoadedRoom(preparation);
        loadedRoom.staticLighting = extractRoomStaticLightingEmitters(
          preparation.room,
          this.options.getRoomOrigin(preparation.room.coordinates),
        );
        this.queuePreparedLiveObjects(preparation);
      },
    );
  }

  private queuePreparedLiveObjects(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'objects';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-live-objects',
      'cpu',
      0.75,
      () => {
        const loadedRoom = this.requirePreparedLoadedRoom(preparation);
        if (!this.options.createLiveObjectsBatch || !this.options.finalizeLiveObjectCreation) {
          throw new Error('Dormant room preparation requires batched live-object callbacks.');
        }
        const endIndex = Math.min(
          preparation.room.placedObjects.length,
          preparation.nextLiveObjectIndex + PREPARED_LIVE_OBJECTS_PER_JOB,
        );
        const nextIndex = this.options.createLiveObjectsBatch(
          loadedRoom,
          preparation.nextLiveObjectIndex,
          endIndex,
          true,
        );
        if (nextIndex <= preparation.nextLiveObjectIndex && endIndex > preparation.nextLiveObjectIndex) {
          throw new Error(`Live-object preparation did not advance for ${preparation.room.id}.`);
        }
        preparation.nextLiveObjectIndex = nextIndex;
        if (nextIndex < preparation.room.placedObjects.length) {
          this.queuePreparedLiveObjects(preparation);
        } else {
          this.queuePreparedLiveObjectFinalization(preparation);
        }
      },
    );
  }

  private queuePreparedLiveObjectFinalization(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    this.enqueueFullRoomPreparationJob(
      preparation,
      'prepare-room-object-links-state',
      'cpu',
      0.75,
      () => {
        const loadedRoom = this.requirePreparedLoadedRoom(preparation);
        this.options.onPreparedLiveObjectsReady?.(loadedRoom);
        this.options.finalizeLiveObjectCreation?.(loadedRoom, true);
        this.markPreparedFullRoomReady(preparation);
      },
    );
  }

  private markPreparedFullRoomReady(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    preparation.phase = 'ready';
    if (preparation.activationRequested) {
      this.queuePreparedRoomCommit(preparation);
    }
  }

  private queuePreparedRoomCommit(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    if (preparation.phase === 'commit' || preparation.phase === 'committed') return;
    preparation.phase = 'commit';
    this.enqueueFullRoomPreparationJob(
      preparation,
      'commit-prepared-room',
      'cpu',
      1,
      () => this.commitPreparedFullRoom(preparation),
    );
  }

  private commitPreparedFullRoom(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    if (!this.isFullRoomPreparationSnapshotCurrent(preparation)) {
      this.cancelFullRoomPreparation(preparation.room.id, 'stale-before-commit');
      return;
    }
    const loadedRoom = this.requirePreparedLoadedRoom(preparation);
    let existing = this.loadedFullRoomsById.get(preparation.room.id) ?? null;
    const pendingTeardown = this.pendingFullRoomTeardownsById.get(preparation.room.id) ?? null;
    if (
      existing
      && !pendingTeardown
      && existing.runtimeSuspended !== true
      && this.isLoadedFullRoomCurrent(existing, preparation.room, preparation.source)
    ) {
      this.settleDisposedReplacementAsActivated(preparation, existing);
      this.cancelFullRoomPreparation(preparation.room.id, 'already-activated');
      return;
    }
    if (pendingTeardown?.loadedRoom === existing) {
      if (pendingTeardown.destructionStarted) {
        pendingTeardown.commitAfterTeardown = preparation;
        preparation.phase = 'waiting-for-teardown';
        return;
      }
      this.cancelPendingFullRoomTeardown(
        preparation.room.id,
        'prepared-replacement-owns-old-runtime-disposal',
        true,
        false,
        false,
      );
      existing = this.loadedFullRoomsById.get(preparation.room.id) ?? null;
      if (
        existing
        && existing.runtimeSuspended !== true
        && this.isLoadedFullRoomCurrent(existing, preparation.room, preparation.source)
      ) {
        this.settleDisposedReplacementAsActivated(preparation, existing);
        this.cancelFullRoomPreparation(preparation.room.id, 'already-activated-after-restore');
        return;
      }
    }
    preparation.replacementRoom = existing;
    const previousReleaseAt = existing
      ? this.fullRoomReleaseAtById?.get(preparation.room.id)
      : undefined;

    try {
      if (!preparation.backgroundPrepared) {
        throw new Error(`Prepared background is incomplete for ${preparation.room.id}.`);
      }
      this.setPreparedRoomBackgroundActive(loadedRoom, true);
      loadedRoom.image.setActive(true);
      loadedRoom.image.setVisible(true);
      loadedRoom.foregroundImage?.setActive(true);
      loadedRoom.foregroundImage?.setVisible(true);
      loadedRoom.terrainLayer.setActive(true);
      this.setPreparedInsetBodiesActive(loadedRoom, true);
      this.options.setLiveObjectsDormant?.(loadedRoom, false);

      // Publish the prepared runtime only after its local activation succeeds.
      // A replaced runtime remains intact off-map until every observer accepts
      // the new runtime, so any callback failure can atomically restore it.
      this.loadedFullRoomsById.set(preparation.room.id, loadedRoom);
      this.ensurePlayerTerrainColliders(loadedRoom);
      this.syncLiveObjectWorldColliders();
      this.options.syncLiveObjectInteractions?.(this.loadedFullRoomsById.values());
      if (!this.isLoadedRoomCollisionInfrastructureReady(loadedRoom)) {
        throw new Error(`Prepared runtime collision is incomplete for ${preparation.room.id}.`);
      }
      loadedRoom.collisionReady = true;
      this.updateFullRoomBackground(loadedRoom, this.options.scene.cameras.main);
      this.previewRenderer.syncPreviewVisibility();
      this.options.onBackdropObjectsChanged?.();
      this.options.onFullRoomSetChanged?.([preparation.room.coordinates]);
      // Settle this preparation before callbacks that may synchronously clear
      // course overrides and invalidate this same room. Re-entrant invalidation
      // must not cancel and destroy the runtime that was just published.
      preparation.phase = 'committed';
      if (this.pendingFullRoomPreparationsById.get(preparation.room.id) === preparation) {
        this.pendingFullRoomPreparationsById.delete(preparation.room.id);
      }
      if (preparation.generation) {
        this.frameWorkCoordinator.releaseGeneration(preparation.generation);
      }
      if (existing || preparation.disposedReplacementRoom) {
        this.options.onFullRoomReplaced?.(loadedRoom);
      }
      this.options.onFullRoomCollisionReady?.(loadedRoom);
      this.syncRoomArtifactCachePolicy();
      this.retainPreparedTransitionRoom(preparation.room.id);
    } catch (error) {
      this.rollbackPreparedFullRoomActivation(
        preparation,
        loadedRoom,
        existing,
        previousReleaseAt,
      );
      preparation.phase = 'failed';
      if (this.pendingFullRoomPreparationsById.get(preparation.room.id) !== preparation) {
        this.settleDisposedReplacementAfterPreparationStops(preparation);
      }
      throw error;
    }

    if (existing) this.destroyReplacedFullRoomAfterCommit(existing);
    preparation.replacementRoom = null;
    preparation.disposedReplacementRoom = null;
    this.syncRoomArtifactCachePolicy();
  }

  private rollbackPreparedFullRoomActivation(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    existing: LoadedFullRoom<TLiveObject, TEdgeWall> | null,
    previousReleaseAt: number | undefined,
  ): void {
    loadedRoom.collisionReady = false;

    if (this.loadedFullRoomsById.get(loadedRoom.room.id) === loadedRoom) {
      this.loadedFullRoomsById.delete(loadedRoom.room.id);
    }
    if (existing) {
      this.loadedFullRoomsById.set(existing.room.id, existing);
    }
    if (previousReleaseAt === undefined) {
      this.fullRoomReleaseAtById.delete(loadedRoom.room.id);
    } else {
      this.fullRoomReleaseAtById.set(loadedRoom.room.id, previousReleaseAt);
    }
    this.runPreparedRoomRollbackStep('destroy destination runtime', () => {
      this.destroyLoadedRoomResources(loadedRoom, true);
    });
    preparation.loadedRoom = null;

    this.runPreparedRoomRollbackStep('repair survivor world colliders', () => {
      this.syncLiveObjectWorldColliders();
    });
    this.runPreparedRoomRollbackStep('repair survivor interactions', () => {
      this.options.syncLiveObjectInteractions?.(this.loadedFullRoomsById.values());
    });
    this.runPreparedRoomRollbackStep('repair preview visibility', () => {
      this.previewRenderer.syncPreviewVisibility();
    });
    this.runPreparedRoomRollbackStep('repair backdrop display state', () => {
      this.options.onBackdropObjectsChanged?.();
    });
    this.runPreparedRoomRollbackStep('restore destination seams', () => {
      this.options.onFullRoomSetChanged?.([loadedRoom.room.coordinates]);
    });
    this.runPreparedRoomRollbackStep('repair room artifact policy', () => {
      this.syncRoomArtifactCachePolicy();
    });
    this.runPreparedRoomRollbackStep('restore room release scheduling', () => {
      const sceneTime = this.options.scene.time as Phaser.Time.Clock | undefined;
      if (!sceneTime || typeof sceneTime.delayedCall !== 'function') return;
      const now = sceneTime.now;
      let nextReleaseAt: number | null = null;
      for (const releaseAt of this.fullRoomReleaseAtById.values()) {
        if (releaseAt <= now) continue;
        nextReleaseAt = nextReleaseAt === null
          ? releaseAt
          : Math.min(nextReleaseAt, releaseAt);
      }
      this.scheduleFullRoomReleaseCleanup(nextReleaseAt, now);
    });
    preparation.replacementRoom = null;
  }

  private destroyReplacedFullRoomAfterCommit(
    existing: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    existing.collisionReady = false;
    const artifactRemainsCached = Boolean(
      existing.artifactKey && this.roomArtifactCache.has(existing.artifactKey),
    );
    if (existing.artifactKey && artifactRemainsCached) {
      this.roomArtifactCache.touch(existing.artifactKey);
    }
    const resourceKeys = [
      existing.textureKey,
      existing.foregroundTextureKey,
      existing.customRoomTileTextureKey,
    ].filter((key): key is string => Boolean(key));
    try {
      this.destroyLoadedRoomResources(existing, true);
    } catch (error) {
      console.error(`Replaced room ${existing.room.id} could not be fully destroyed.`, error);
    }
    // This is replacement disposal, not removal of the room ID. Room-scoped
    // controllers (notably portals and special tiles) must keep state owned by
    // the newly published same-ID runtime.
    if (!artifactRemainsCached) {
      this.releaseRoomArtifactResources(resourceKeys);
    }
  }

  private runPreparedRoomRollbackStep(label: string, step: () => void): void {
    try {
      step();
    } catch (error) {
      console.error(`Prepared room rollback could not ${label}.`, error);
    }
  }

  private requirePreparedLoadedRoom(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): LoadedFullRoom<TLiveObject, TEdgeWall> {
    if (!preparation.loadedRoom) {
      throw new Error(`Prepared runtime shell is missing for ${preparation.room.id}.`);
    }
    return preparation.loadedRoom;
  }

  private isFullRoomPreparationCurrent(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): boolean {
    return !this.destroyed
      && preparation.phase !== 'cancelled'
      && preparation.phase !== 'failed'
      && this.pendingFullRoomPreparationsById.get(preparation.room.id) === preparation;
  }

  private isFullRoomPreparationSnapshotCurrent(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): boolean {
    if (!this.isFullRoomPreparationCurrent(preparation)) return false;
    const current = this.resolveTransitionRenderableRoom(preparation.room.coordinates);
    return Boolean(
      current
      && this.buildFullRoomPreparationIdentity(current.room, current.source) === preparation.identity,
    );
  }

  private recordPreparedRoomArtifacts(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
  ): void {
    this.syncRoomArtifactCachePolicy();
    const resourceKeys = [preparation.textureKey, preparation.foregroundTextureKey];
    const customTextureKey = this.getCustomRoomTileTextureKey(preparation.room);
    if (customTextureKey) resourceKeys.push(customTextureKey);
    this.roomArtifactCache.record({
      key: preparation.artifactKey,
      roomId: preparation.room.id,
      byteSize: this.getFullRoomArtifactByteSize(preparation.room),
      resourceKeys,
      resourceByteSizes: this.getFullRoomArtifactResourceByteSizes(
        preparation.room,
        preparation.textureKey,
        preparation.foregroundTextureKey,
        customTextureKey,
      ),
    });
  }

  private cancelFullRoomPreparation(
    roomId: string,
    reason: string,
    preserveDisposedReplacementLifecycle = false,
    allowDisposedReplacementRefresh = true,
  ): LoadedFullRoom<TLiveObject, TEdgeWall> | null {
    const preparation = this.pendingFullRoomPreparationsById.get(roomId);
    if (!preparation) return null;
    const disposedReplacementRoom = preparation.disposedReplacementRoom;
    const shouldRefreshDisposedReplacement = Boolean(
      disposedReplacementRoom
      && allowDisposedReplacementRefresh
      && this.shouldRefreshDisposedReplacementRoom(roomId)
    );
    if (preserveDisposedReplacementLifecycle) {
      preparation.disposedReplacementRoom = null;
    }
    this.pendingFullRoomPreparationsById.delete(roomId);
    this.frameWorkCoordinator.cancelGeneration(preparation.generation, reason);
    preparation.queuedJob = null;
    preparation.phase = 'cancelled';
    preparation.texturePreparation?.cancel();
    preparation.customTilePreparation?.cancel();
    preparation.customBackgroundPreparation?.cancel();
    if (preparation.loadedRoom) {
      const loadedRoom = preparation.loadedRoom;
      this.runPreparedRoomRollbackStep('destroy cancelled destination runtime', () => {
        this.destroyLoadedRoomResources(loadedRoom, true);
      });
      preparation.loadedRoom = null;
    }
    if (!this.roomArtifactCache.has(preparation.artifactKey)) {
      const resourceKeys = [
        ...preparation.committedTextureKeys,
        this.getCustomRoomTileTextureKey(preparation.room),
      ].filter((key): key is string => Boolean(key));
      this.releaseRoomArtifactResources(resourceKeys);
    }
    if (this.predictedPreparationRoomId === roomId) {
      this.predictedPreparationRoomId = null;
      this.predictedPreparationCoordinates = null;
      this.predictedPreparationExpiresAt = 0;
      this.predictedPreparationIntentGeneration += 1;
      this.cancelPredictedPreparationExpiryTimer();
    }
    this.syncRoomArtifactCachePolicy();
    if (!preserveDisposedReplacementLifecycle) {
      this.settleDisposedReplacementAfterPreparationStops(
        preparation,
        shouldRefreshDisposedReplacement,
      );
    }
    return preserveDisposedReplacementLifecycle ? disposedReplacementRoom : null;
  }

  private cancelAllFullRoomPreparations(reason: string): void {
    const hadPredictedIntent = this.predictedPreparationRoomId !== null;
    this.frameWorkCoordinator.cancelAll(reason);
    for (const roomId of Array.from(this.pendingFullRoomPreparationsById.keys())) {
      this.cancelFullRoomPreparation(roomId, reason, false, false);
    }
    this.predictedPreparationRoomId = null;
    this.predictedPreparationCoordinates = null;
    this.predictedPreparationExpiresAt = 0;
    if (hadPredictedIntent && this.predictedPreparationRoomId === null) {
      this.predictedPreparationIntentGeneration += 1;
    }
    this.cancelPredictedPreparationExpiryTimer();
  }

  private failFullRoomPreparation(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    error: unknown,
  ): void {
    if (
      this.destroyed
      || this.pendingFullRoomPreparationsById.get(preparation.room.id) !== preparation
      || preparation.phase === 'cancelled'
      || preparation.phase === 'committed'
    ) return;
    preparation.phase = 'failed';
    console.error(`Room ${preparation.room.id} preparation failed.`, error);
    this.cancelFullRoomPreparation(preparation.room.id, 'preparation-failed');
  }

  private settleDisposedReplacementAfterPreparationStops(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    shouldRefresh?: boolean,
  ): void {
    const disposedReplacement = preparation.disposedReplacementRoom;
    if (!disposedReplacement) return;
    preparation.disposedReplacementRoom = null;
    this.runFullRoomTeardownCleanupStep('notify failed replacement disposal', () => {
      this.options.onFullRoomDestroyed?.(disposedReplacement);
    });
    if (
      !this.destroyed
      && (shouldRefresh ?? this.shouldRefreshDisposedReplacementRoom(preparation.room.id))
    ) {
      this.refreshVisibleRoomsFromCache();
    }
  }

  private settleDisposedReplacementAsActivated(
    preparation: PendingFullRoomPreparation<TLiveObject, TEdgeWall>,
    activatedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    if (!preparation.disposedReplacementRoom) return;
    preparation.disposedReplacementRoom = null;
    this.runFullRoomTeardownCleanupStep('notify replacement activation', () => {
      this.options.onFullRoomReplaced?.(activatedRoom);
    });
  }

  private shouldRefreshDisposedReplacementRoom(roomId: string): boolean {
    return this.retainedFullRoomIds.has(roomId)
      || roomId === this.predictedPreparationRoomId
      || roomId === this.portalPreparationRoomId
      || roomId === roomIdFromCoordinates(this.options.getCurrentRoomCoordinates());
  }

  private syncRoomArtifactCachePolicy(): void {
    const protectedKeys = new Set<string>();
    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      if (loadedRoom.artifactKey) protectedKeys.add(loadedRoom.artifactKey);
    }
    for (const preparation of this.pendingFullRoomPreparationsById.values()) {
      protectedKeys.add(preparation.artifactKey);
      if (preparation.replacementRoom?.artifactKey) {
        protectedKeys.add(preparation.replacementRoom.artifactKey);
      }
    }
    if (this.previousRoomArtifactKey) protectedKeys.add(this.previousRoomArtifactKey);
    this.roomArtifactCache.setProtectedKeys(protectedKeys);
    const effectiveProfile = this.getEffectivePerformanceProfile() === 'reduced'
      ? 'reduced'
      : 'normal';
    this.roomArtifactCache.setBudgetBytes(
      effectiveProfile === 'reduced'
        ? REDUCED_ROOM_ARTIFACT_CACHE_BYTES
        : NORMAL_ROOM_ARTIFACT_CACHE_BYTES,
    );
    this.roomArtifactCacheProfile = effectiveProfile;
  }

  private releaseRoomArtifactResources(resourceKeys: readonly string[]): void {
    for (const resourceKey of new Set(resourceKeys)) {
      const referencedByLoadedRoom = Array.from(this.loadedFullRoomsById.values()).some(
        (loadedRoom) => loadedRoom.textureKey === resourceKey
          || loadedRoom.foregroundTextureKey === resourceKey
          || loadedRoom.customRoomTileTextureKey === resourceKey,
      );
      const referencedByPreparation = Array.from(
        this.pendingFullRoomPreparationsById.values(),
      ).some((preparation) => preparation.loadedRoom && (
        preparation.loadedRoom.textureKey === resourceKey
        || preparation.loadedRoom.foregroundTextureKey === resourceKey
        || preparation.loadedRoom.customRoomTileTextureKey === resourceKey
      ));
      if (
        !referencedByLoadedRoom
        && !referencedByPreparation
        && !this.roomArtifactCache.referencesResource(resourceKey)
        && this.options.scene.textures.exists(resourceKey)
      ) {
        this.options.scene.textures.remove(resourceKey);
      }
    }
  }

  private populateTerrainLayerRows(
    room: RoomSnapshot,
    terrainLayer: Phaser.Tilemaps.TilemapLayer,
    startRow: number,
    endRow: number,
  ): void {
    for (let y = Math.max(0, startRow); y < Math.min(ROOM_HEIGHT, endRow); y += 1) {
      for (let x = 0; x < ROOM_WIDTH; x += 1) {
        const { gid, flipX, flipY } = decodeTileDataValue(room.tileData.terrain[y][x]);
        if (gid <= 0) continue;
        const tile = terrainLayer.putTileAt(gid, x, y);
        if (tile) {
          tile.flipX = flipX;
          tile.flipY = flipY;
        }
      }
    }
  }

  private setPreparedInsetBodiesActive(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    active: boolean,
  ): void {
    loadedRoom.terrainInsetBodies?.children.iterate((child) => {
      const gameObject = child as Phaser.GameObjects.GameObject & {
        body?: Phaser.Physics.Arcade.StaticBody | null;
      };
      gameObject.setActive(active);
      if (gameObject.body) gameObject.body.enable = active;
      return true;
    });
  }

  private unloadFullRoomsOutsideStream(fullRoomIds: Set<string>): void {
    const changedCoordinates: RoomCoordinates[] = [];
    this.retainedFullRoomIds = new Set(fullRoomIds);

    for (const roomId of Array.from(this.pendingFullRoomTeardownsById.keys())) {
      if (this.shouldRetainFullRoom(roomId)) {
        const restoredCoordinates = this.cancelPendingFullRoomTeardown(
          roomId,
          'room-retained-before-teardown',
          true,
          false,
        );
        if (restoredCoordinates) changedCoordinates.push(restoredCoordinates);
      }
    }

    for (const [roomId, loadedRoom] of this.loadedFullRoomsById) {
      if (this.shouldRetainFullRoom(roomId)) continue;
      const queuedCoordinates = this.queueFullRoomTeardown(loadedRoom, false);
      if (queuedCoordinates) changedCoordinates.push(queuedCoordinates);
    }
    if (changedCoordinates.length > 0) {
      this.previewRenderer.syncPreviewVisibility();
      this.options.onBackdropObjectsChanged?.();
      this.options.onFullRoomSetChanged?.(changedCoordinates);
    }

    for (const roomId of Array.from(this.pendingFullRoomPreparationsById.keys())) {
      if (this.shouldRetainFullRoom(roomId)) continue;
      this.cancelFullRoomPreparation(roomId, 'room-left-stream');
    }
  }

  private shouldRetainFullRoom(roomId: string): boolean {
    return this.retainedFullRoomIds.has(roomId)
      || roomId === this.predictedPreparationRoomId
      || roomId === this.portalPreparationRoomId
      || this.pendingFullRoomPreparationsById.get(roomId)?.activationRequested === true
      || roomId === roomIdFromCoordinates(this.options.getCurrentRoomCoordinates());
  }

  private queueFullRoomTeardown(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    notifyVisibility = true,
  ): RoomCoordinates | null {
    const roomId = loadedRoom.room.id;
    const existing = this.pendingFullRoomTeardownsById.get(roomId);
    if (existing?.loadedRoom === loadedRoom) return null;
    if (existing) {
      this.cancelPendingFullRoomTeardown(
        roomId,
        'loaded-room-replaced-before-teardown',
        false,
        false,
      );
    }

    const pending: PendingFullRoomTeardown<TLiveObject, TEdgeWall> = {
      loadedRoom,
      restoreCollisionReady: loadedRoom.collisionReady === true,
      restoreRuntime: null,
      liveObjectReconciliationGeneration:
        this.options.getLiveObjectPhysicsReconciliationGeneration?.() ?? null,
      phase: 'queued',
      destructionStarted: false,
      liveObjectRoomStateCleared: false,
      retainedAfterDestruction: false,
      commitAfterTeardown: null,
      job: null,
    };
    // Close the seam and publish teardown ownership before suspension touches
    // any Phaser runtime state. If a display/collider callback throws midway,
    // the room can still be force-disposed through this pending handle rather
    // than remaining partially suspended behind an open seam.
    loadedRoom.collisionReady = false;
    this.pendingFullRoomTeardownsById.set(roomId, pending);
    try {
      pending.restoreRuntime = this.suspendLoadedRoomRuntime(loadedRoom);
    } catch (error) {
      console.error(`Could not suspend room ${roomId} for deferred teardown.`, error);
      pending.destructionStarted = true;
      this.forceCompletePendingFullRoomTeardown(roomId, pending, true);
      if (notifyVisibility) {
        this.previewRenderer.syncPreviewVisibility();
        this.options.onBackdropObjectsChanged?.();
      }
      return loadedRoom.room.coordinates;
    }
    this.enqueuePendingFullRoomTeardownJob(roomId, pending, 'begin');
    if (notifyVisibility) {
      this.previewRenderer.syncPreviewVisibility();
      this.options.onBackdropObjectsChanged?.();
    }
    return loadedRoom.room.coordinates;
  }

  private executePendingFullRoomTeardown(
    roomId: string,
    pending: PendingFullRoomTeardown<TLiveObject, TEdgeWall>,
  ): void {
    if (this.pendingFullRoomTeardownsById.get(roomId) !== pending) return;
    pending.job = null;
    if (this.shouldRetainFullRoom(roomId) && !pending.destructionStarted) {
      this.cancelPendingFullRoomTeardown(
        roomId,
        'room-retained-at-teardown',
        true,
        true,
      );
      return;
    }
    if (this.shouldRetainFullRoom(roomId)) {
      pending.retainedAfterDestruction = true;
    }

    if (!this.options.destroyLiveObjectsBatch) {
      this.pendingFullRoomTeardownsById.delete(roomId);
      if (this.loadedFullRoomsById.get(roomId) !== pending.loadedRoom) return;
      const destroyedCoordinates = this.destroyFullRoom(roomId, false);
      if (!destroyedCoordinates) return;
      this.queueFullRoomTeardownReconciliation();
      return;
    }

    pending.destructionStarted = true;
    pending.restoreRuntime = null;

    if (pending.phase === 'queued' || pending.phase === 'objects') {
      pending.phase = 'objects';
      const complete = this.options.destroyLiveObjectsBatch(
        pending.loadedRoom,
        TEARDOWN_LIVE_OBJECTS_PER_JOB,
        {
          clearRoomTriggerState: !pending.liveObjectRoomStateCleared,
        },
      );
      pending.liveObjectRoomStateCleared = true;
      if (!complete) {
        this.enqueuePendingFullRoomTeardownJob(roomId, pending, 'objects');
        return;
      }
      pending.phase = 'collision';
      this.enqueuePendingFullRoomTeardownJob(roomId, pending, 'collision');
      return;
    }

    if (pending.phase === 'collision') {
      this.destroyLoadedRoomCollisionResources(pending.loadedRoom);
      pending.phase = 'insets';
      this.enqueuePendingFullRoomTeardownJob(roomId, pending, 'insets');
      return;
    }

    if (pending.phase === 'insets') {
      if (this.destroyLoadedRoomInsetBodyBatch(pending.loadedRoom)) {
        pending.phase = 'terrain';
      }
      this.enqueuePendingFullRoomTeardownJob(roomId, pending, pending.phase);
      return;
    }

    if (pending.phase === 'terrain') {
      pending.loadedRoom.terrainLayer.destroy();
      pending.loadedRoom.map.destroy();
      pending.phase = 'backgrounds';
      this.enqueuePendingFullRoomTeardownJob(roomId, pending, 'backgrounds');
      return;
    }

    if (pending.phase === 'backgrounds') {
      for (
        let index = 0;
        index < TEARDOWN_BACKGROUND_SPRITES_PER_JOB;
        index += 1
      ) {
        const background = pending.loadedRoom.backgroundSprites.at(-1);
        if (!background) break;
        background.sprite.destroy();
        pending.loadedRoom.backgroundSprites.pop();
      }
      if (pending.loadedRoom.backgroundSprites.length === 0) {
        pending.phase = 'display';
      }
      this.enqueuePendingFullRoomTeardownJob(roomId, pending, pending.phase);
      return;
    }

    if (pending.phase === 'display') {
      pending.loadedRoom.backgroundColorRect?.destroy();
      pending.loadedRoom.backgroundColorRect = null;
      pending.loadedRoom.image.destroy();
      pending.loadedRoom.foregroundImage?.destroy();
      pending.loadedRoom.foregroundImage = null;
      pending.phase = 'finalize';
      this.enqueuePendingFullRoomTeardownJob(roomId, pending, 'finalize');
      return;
    }

    this.finalizePendingFullRoomTeardown(roomId, pending, true);
  }

  private enqueuePendingFullRoomTeardownJob(
    roomId: string,
    pending: PendingFullRoomTeardown<TLiveObject, TEdgeWall>,
    phaseLabel: string,
  ): void {
    let job: FrameWorkJobHandle | null = null;
    job = this.frameWorkCoordinator.enqueue({
      label: `teardown-full-room-${phaseLabel}:${roomId}`,
      priority: 'teardown',
      costKind: 'cpu',
      estimatedCostMs: 0.75,
      execute: () => {
        if (pending.job === job) pending.job = null;
        try {
          this.executePendingFullRoomTeardown(roomId, pending);
        } catch (error) {
          this.forceCompletePendingFullRoomTeardown(roomId, pending, true);
          throw error;
        }
      },
    });
    pending.job = job;
  }

  private finalizePendingFullRoomTeardown(
    roomId: string,
    pending: PendingFullRoomTeardown<TLiveObject, TEdgeWall>,
    queueReconciliation: boolean,
  ): void {
    if (this.pendingFullRoomTeardownsById.get(roomId) !== pending) return;
    this.pendingFullRoomTeardownsById.delete(roomId);
    if (this.loadedFullRoomsById.get(roomId) !== pending.loadedRoom) return;
    const loadedRoom = pending.loadedRoom;
    const deferredCommit = pending.commitAfterTeardown;
    const canCommitDeferredPreparation = Boolean(
      deferredCommit
      && deferredCommit.activationRequested
      && this.isFullRoomPreparationSnapshotCurrent(deferredCommit),
    );
    const artifactRemainsCached = Boolean(
      loadedRoom.artifactKey && this.roomArtifactCache.has(loadedRoom.artifactKey),
    );
    if (loadedRoom.artifactKey && artifactRemainsCached) {
      this.roomArtifactCache.touch(loadedRoom.artifactKey);
    }
    const resourceKeys = [
      loadedRoom.textureKey,
      loadedRoom.foregroundTextureKey,
      loadedRoom.customRoomTileTextureKey,
    ].filter((key): key is string => Boolean(key));
    if (canCommitDeferredPreparation && deferredCommit) {
      deferredCommit.disposedReplacementRoom = loadedRoom;
    } else if (
      deferredCommit
      && this.pendingFullRoomPreparationsById.get(roomId) === deferredCommit
    ) {
      pending.commitAfterTeardown = null;
      this.cancelFullRoomPreparation(
        roomId,
        'deferred-preparation-stale-after-teardown',
      );
    }
    this.loadedFullRoomsById.delete(roomId);
    this.fullRoomReleaseAtById.delete(roomId);
    if (!canCommitDeferredPreparation) {
      this.runFullRoomTeardownCleanupStep('notify room destruction', () => {
        this.options.onFullRoomDestroyed?.(loadedRoom);
      });
    }
    if (!artifactRemainsCached) {
      this.runFullRoomTeardownCleanupStep('release room artifact resources', () => {
        this.releaseRoomArtifactResources(resourceKeys);
      });
    }
    this.runFullRoomTeardownCleanupStep('synchronize the room artifact policy', () => {
      this.syncRoomArtifactCachePolicy();
    });
    if (queueReconciliation) {
      this.queueFullRoomTeardownReconciliation();
    }
    if (canCommitDeferredPreparation && deferredCommit) {
      this.queuePreparedRoomCommit(deferredCommit);
      return;
    }
    if (
      queueReconciliation
      && (pending.retainedAfterDestruction || this.shouldRetainFullRoom(roomId))
    ) {
      this.refreshVisibleRoomsFromCache();
    }
  }

  private forceCompletePendingFullRoomTeardown(
    roomId: string,
    pending: PendingFullRoomTeardown<TLiveObject, TEdgeWall>,
    queueReconciliation = false,
  ): void {
    pending.job?.cancel('teardown-force-completed');
    pending.job = null;

    if (pending.phase === 'queued' || pending.phase === 'objects') {
      this.runFullRoomTeardownCleanupStep('destroy remaining live objects', () => {
        this.options.destroyLiveObjects(pending.loadedRoom, {
          preserveTriggerState: pending.liveObjectRoomStateCleared,
        });
      });
      pending.liveObjectRoomStateCleared = true;
      pending.phase = 'collision';
    }
    if (pending.phase === 'collision') {
      this.runFullRoomTeardownCleanupStep('destroy edge walls', () => {
        this.options.destroyEdgeWalls(pending.loadedRoom);
      });
      this.runFullRoomTeardownCleanupStep('destroy the terrain collider', () => {
        pending.loadedRoom.terrainCollider?.destroy();
      });
      pending.loadedRoom.terrainCollider = null;
      this.runFullRoomTeardownCleanupStep('destroy the inset collider', () => {
        pending.loadedRoom.terrainInsetCollider?.destroy();
      });
      pending.loadedRoom.terrainInsetCollider = null;
      pending.phase = 'insets';
    }
    if (pending.phase === 'insets') {
      this.forceDestroyLoadedRoomInsetBodies(pending.loadedRoom);
      pending.phase = 'terrain';
    }
    if (pending.phase === 'terrain') {
      this.runFullRoomTeardownCleanupStep('destroy the terrain layer', () => {
        pending.loadedRoom.terrainLayer.destroy();
      });
      this.runFullRoomTeardownCleanupStep('destroy the tilemap', () => {
        pending.loadedRoom.map.destroy();
      });
      pending.phase = 'backgrounds';
    }
    if (pending.phase === 'backgrounds') {
      for (const background of pending.loadedRoom.backgroundSprites) {
        this.runFullRoomTeardownCleanupStep('destroy a background sprite', () => {
          background.sprite.destroy();
        });
      }
      pending.loadedRoom.backgroundSprites = [];
      pending.phase = 'display';
    }
    if (pending.phase === 'display') {
      this.runFullRoomTeardownCleanupStep('destroy the background color', () => {
        pending.loadedRoom.backgroundColorRect?.destroy();
      });
      pending.loadedRoom.backgroundColorRect = null;
      this.runFullRoomTeardownCleanupStep('destroy the room image', () => {
        pending.loadedRoom.image.destroy();
      });
      this.runFullRoomTeardownCleanupStep('destroy the foreground image', () => {
        pending.loadedRoom.foregroundImage?.destroy();
      });
      pending.loadedRoom.foregroundImage = null;
      pending.phase = 'finalize';
    }
    this.finalizePendingFullRoomTeardown(roomId, pending, queueReconciliation);
  }

  private runFullRoomTeardownCleanupStep(label: string, step: () => void): void {
    try {
      step();
    } catch (error) {
      console.error(`Full-room teardown could not ${label}.`, error);
    }
  }

  private forceDestroyLoadedRoomInsetBodies(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    const insetBodies = loadedRoom.terrainInsetBodies;
    if (!insetBodies) return;
    let children: Phaser.GameObjects.GameObject[] = [];
    this.runFullRoomTeardownCleanupStep('enumerate terrain inset bodies', () => {
      children = [...insetBodies.getChildren()];
    });
    for (const child of children) {
      this.runFullRoomTeardownCleanupStep('detach a terrain inset body', () => {
        insetBodies.remove(child, false, false);
      });
      this.runFullRoomTeardownCleanupStep('destroy a terrain inset body', () => {
        child.destroy();
      });
    }
    this.runFullRoomTeardownCleanupStep('clear terrain inset bodies', () => {
      insetBodies.clear(false, false);
    });
    this.runFullRoomTeardownCleanupStep('destroy the terrain inset group', () => {
      insetBodies.destroy();
    });
    loadedRoom.terrainInsetBodies = null;
  }

  private destroyLoadedRoomCollisionResources(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): void {
    this.options.destroyEdgeWalls(loadedRoom);
    loadedRoom.terrainCollider?.destroy();
    loadedRoom.terrainCollider = null;
    loadedRoom.terrainInsetCollider?.destroy();
    loadedRoom.terrainInsetCollider = null;
  }

  private destroyLoadedRoomInsetBodyBatch(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): boolean {
    const insetBodies = loadedRoom.terrainInsetBodies;
    if (!insetBodies) return true;
    const children = insetBodies.getChildren();
    for (
      let index = 0;
      index < Math.min(TEARDOWN_INSET_BODIES_PER_JOB, children.length);
      index += 1
    ) {
      insetBodies.remove(children[index], true, true);
    }
    if (insetBodies.getLength() > 0) return false;
    insetBodies.destroy();
    loadedRoom.terrainInsetBodies = null;
    return true;
  }

  private queueFullRoomTeardownReconciliation(): void {
    this.fullRoomTeardownReconciliationRequired = true;
    this.fullRoomTeardownReconciliationGeneration =
      this.options.getLiveObjectPhysicsReconciliationGeneration?.() ?? null;
    if (this.pendingFullRoomTeardownReconciliationJob) return;

    let job: FrameWorkJobHandle | null = null;
    job = this.frameWorkCoordinator.enqueue({
      label: 'reconcile-full-room-teardowns',
      priority: 'teardown',
      costKind: 'cpu',
      estimatedCostMs: 1,
      execute: () => {
        if (this.pendingFullRoomTeardownReconciliationJob === job) {
          this.pendingFullRoomTeardownReconciliationJob = null;
        }
        if (this.pendingFullRoomTeardownsById.size > 0) {
          return;
        }
        if (!this.fullRoomTeardownReconciliationRequired) return;
        this.fullRoomTeardownReconciliationRequired = false;
        const queuedAtGeneration = this.fullRoomTeardownReconciliationGeneration;
        this.fullRoomTeardownReconciliationGeneration = null;
        const currentGeneration =
          this.options.getLiveObjectPhysicsReconciliationGeneration?.() ?? null;
        if (queuedAtGeneration !== null && currentGeneration !== queuedAtGeneration) {
          return;
        }
        this.syncLiveObjectWorldColliders();
        this.options.syncLiveObjectInteractions?.(this.loadedFullRoomsById.values());
      },
    });
    this.pendingFullRoomTeardownReconciliationJob = job;
  }

  private cancelPendingFullRoomTeardown(
    roomId: string,
    reason: string,
    restoreCollisionReady: boolean,
    notifySeams: boolean,
    notifyVisibility = notifySeams,
  ): RoomCoordinates | null {
    const pending = this.pendingFullRoomTeardownsById.get(roomId);
    if (!pending) return null;
    if (restoreCollisionReady && pending.destructionStarted) {
      pending.retainedAfterDestruction = true;
      if (!pending.job) {
        this.enqueuePendingFullRoomTeardownJob(roomId, pending, pending.phase);
      }
      if (notifySeams) {
        this.options.onFullRoomSetChanged?.([pending.loadedRoom.room.coordinates]);
      }
      return pending.loadedRoom.room.coordinates;
    }
    if (!restoreCollisionReady && pending.destructionStarted) {
      const coordinates = pending.loadedRoom.room.coordinates;
      this.forceCompletePendingFullRoomTeardown(roomId, pending);
      return coordinates;
    }
    const loadedRoom = this.loadedFullRoomsById.get(roomId);
    if (loadedRoom !== pending.loadedRoom) {
      this.pendingFullRoomTeardownsById.delete(roomId);
      pending.job?.cancel(reason);
      return null;
    }
    if (restoreCollisionReady) {
      try {
        pending.restoreRuntime?.();
        pending.restoreRuntime = null;
      } catch (error) {
        console.error(`Could not restore suspended runtime for retained room ${roomId}.`, error);
        pending.restoreRuntime = null;
        pending.destructionStarted = true;
        pending.retainedAfterDestruction = true;
        this.forceCompletePendingFullRoomTeardown(roomId, pending, true);
        if (notifySeams) {
          this.options.onFullRoomSetChanged?.([loadedRoom.room.coordinates]);
        }
        return loadedRoom.room.coordinates;
      }
    }

    this.pendingFullRoomTeardownsById.delete(roomId);
    pending.job?.cancel(reason);

    if (restoreCollisionReady) {
      const currentReconciliationGeneration =
        this.options.getLiveObjectPhysicsReconciliationGeneration?.() ?? null;
      const canRestoreWithoutReconciliation =
        pending.liveObjectReconciliationGeneration !== null
        && currentReconciliationGeneration === pending.liveObjectReconciliationGeneration
        && !this.fullRoomTeardownReconciliationRequired
        && this.pendingFullRoomTeardownsById.size === 0;
      let collisionInfrastructureReady = false;
      try {
        this.ensurePlayerTerrainColliders(loadedRoom);
        collisionInfrastructureReady = this.isLoadedRoomCollisionInfrastructureReady(loadedRoom);
      } catch (error) {
        console.error(`Could not restore collision readiness for retained room ${roomId}.`, error);
      }
      if (!pending.restoreCollisionReady || !collisionInfrastructureReady) {
        loadedRoom.collisionReady = false;
        pending.destructionStarted = true;
        pending.retainedAfterDestruction = true;
        this.pendingFullRoomTeardownsById.set(roomId, pending);
        this.forceCompletePendingFullRoomTeardown(roomId, pending, true);
        if (notifySeams) {
          this.options.onFullRoomSetChanged?.([loadedRoom.room.coordinates]);
        }
        return loadedRoom.room.coordinates;
      }
      if (!canRestoreWithoutReconciliation) {
        try {
          this.syncLiveObjectWorldColliders();
          this.options.syncLiveObjectInteractions?.(this.loadedFullRoomsById.values());
        } catch (error) {
          console.error(`Could not reconcile retained room ${roomId}.`, error);
          loadedRoom.collisionReady = false;
          pending.destructionStarted = true;
          pending.retainedAfterDestruction = true;
          this.pendingFullRoomTeardownsById.set(roomId, pending);
          this.forceCompletePendingFullRoomTeardown(roomId, pending, true);
          if (notifySeams) {
            this.options.onFullRoomSetChanged?.([loadedRoom.room.coordinates]);
          }
          return loadedRoom.room.coordinates;
        }
        this.pendingFullRoomTeardownReconciliationJob?.cancel(
          'teardown-reconciliation-covered-by-room-restore',
        );
        this.pendingFullRoomTeardownReconciliationJob = null;
        this.fullRoomTeardownReconciliationRequired = false;
        this.fullRoomTeardownReconciliationGeneration = null;
      }
      loadedRoom.collisionReady = true;
      if (notifyVisibility) {
        this.previewRenderer.syncPreviewVisibility();
        this.options.onBackdropObjectsChanged?.();
      }
      this.options.onFullRoomCollisionReady?.(loadedRoom);
    }
    if (notifySeams) {
      this.options.onFullRoomSetChanged?.([loadedRoom.room.coordinates]);
    }
    if (
      this.pendingFullRoomTeardownsById.size === 0
      && this.fullRoomTeardownReconciliationRequired
      && !this.pendingFullRoomTeardownReconciliationJob
    ) {
      this.queueFullRoomTeardownReconciliation();
    }
    return loadedRoom.room.coordinates;
  }

  private suspendLoadedRoomRuntime(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
  ): () => void {
    loadedRoom.runtimeSuspended = true;
    const displayObjects = [
      loadedRoom.backgroundColorRect,
      ...(loadedRoom.backgroundSprites ?? []).map((background) => background.sprite),
      loadedRoom.image,
      loadedRoom.foregroundImage,
      loadedRoom.terrainLayer,
    ].filter(Boolean) as Phaser.GameObjects.GameObject[];
    const displayStates = displayObjects.map((gameObject) => {
      const displayObject = gameObject as Phaser.GameObjects.GameObject & {
        visible?: boolean;
        setVisible?: (visible: boolean) => unknown;
      };
      const state = {
        gameObject: displayObject,
        active: displayObject.active,
        visible: displayObject.visible,
      };
      displayObject.setActive(false);
      displayObject.setVisible?.(false);
      return state;
    });
    const terrainColliderActive = loadedRoom.terrainCollider?.active ?? false;
    const terrainInsetColliderActive = loadedRoom.terrainInsetCollider?.active ?? false;
    if (loadedRoom.terrainCollider) loadedRoom.terrainCollider.active = false;
    if (loadedRoom.terrainInsetCollider) loadedRoom.terrainInsetCollider.active = false;
    this.setPreparedInsetBodiesActive(loadedRoom, false);
    this.options.setLiveObjectsDormant?.(loadedRoom, true);
    this.options.setLiveObjectWorldCollisionTargetDormant?.(loadedRoom, true);

    return () => {
      loadedRoom.runtimeSuspended = false;
      for (const state of displayStates) {
        if (!state.gameObject.scene) continue;
        state.gameObject.setActive(state.active);
        if (typeof state.visible === 'boolean') {
          state.gameObject.setVisible?.(state.visible);
        }
      }
      if (loadedRoom.terrainCollider) {
        loadedRoom.terrainCollider.active = terrainColliderActive;
      }
      if (loadedRoom.terrainInsetCollider) {
        loadedRoom.terrainInsetCollider.active = terrainInsetColliderActive;
      }
      this.setPreparedInsetBodiesActive(loadedRoom, true);
      this.options.setLiveObjectsDormant?.(loadedRoom, false);
      this.options.setLiveObjectWorldCollisionTargetDormant?.(loadedRoom, false);
    };
  }

  private cancelAllPendingFullRoomTeardowns(
    reason: string,
    restoreCollisionReady: boolean,
  ): void {
    for (const roomId of Array.from(this.pendingFullRoomTeardownsById.keys())) {
      this.cancelPendingFullRoomTeardown(
        roomId,
        reason,
        restoreCollisionReady,
        false,
      );
    }
    this.pendingFullRoomTeardownsById.clear();
  }

  private getRetainedFullRoomIds(targetFullRoomIds: Set<string>): Set<string> {
    const protectedRoomIds = this.getProtectedLoadedFullRoomIds(targetFullRoomIds);
    const effectiveTargetRoomIds = new Set<string>(targetFullRoomIds);
    for (const roomId of protectedRoomIds) {
      effectiveTargetRoomIds.add(roomId);
    }

    const retainedRoomIds = new Set<string>(effectiveTargetRoomIds);
    const now = this.options.scene.time.now;
    const retainReleaseGrace = this.getEffectivePerformanceProfile() !== 'reduced';
    let nextReleaseAt: number | null = null;

    for (const roomId of effectiveTargetRoomIds) {
      this.fullRoomReleaseAtById.delete(roomId);
    }

    for (const roomId of Array.from(this.fullRoomReleaseAtById.keys())) {
      if (!this.loadedFullRoomsById.has(roomId)) {
        this.fullRoomReleaseAtById.delete(roomId);
      }
    }

    for (const roomId of this.loadedFullRoomsById.keys()) {
      if (effectiveTargetRoomIds.has(roomId)) {
        continue;
      }
      if (this.pendingFullRoomTeardownsById.has(roomId)) {
        continue;
      }

      if (!retainReleaseGrace) {
        this.fullRoomReleaseAtById.delete(roomId);
        continue;
      }

      const releaseAt = this.fullRoomReleaseAtById.get(roomId) ?? (now + FULL_ROOM_RELEASE_GRACE_MS);
      this.fullRoomReleaseAtById.set(roomId, releaseAt);
      if (releaseAt > now) {
        retainedRoomIds.add(roomId);
        nextReleaseAt = nextReleaseAt === null ? releaseAt : Math.min(nextReleaseAt, releaseAt);
      } else {
        this.fullRoomReleaseAtById.delete(roomId);
      }
    }

    this.scheduleFullRoomReleaseCleanup(nextReleaseAt, now);
    return retainedRoomIds;
  }

  private getProtectedLoadedFullRoomIds(targetFullRoomIds: ReadonlySet<string>): Set<string> {
    const protectedRoomIds = new Set<string>();
    const protectedIds = this.options.getProtectedFullRoomIds?.(targetFullRoomIds) ?? [];
    for (const roomId of protectedIds) {
      if (this.loadedFullRoomsById.has(roomId)) {
        protectedRoomIds.add(roomId);
      }
    }
    return protectedRoomIds;
  }

  private scheduleFullRoomReleaseCleanup(releaseAt: number | null, now: number): void {
    this.cancelFullRoomReleaseCleanup();
    if (releaseAt === null || this.destroyed || this.options.getMode() !== 'play') {
      return;
    }

    this.fullRoomReleaseCleanupTimer = this.options.scene.time.delayedCall(
      Math.max(1, releaseAt - now + 1),
      () => {
        this.fullRoomReleaseCleanupTimer = null;
        if (this.destroyed || this.options.getMode() !== 'play') {
          return;
        }

        this.refreshVisibleRoomsFromCache();
      },
    );
  }

  private cancelFullRoomReleaseCleanup(): void {
    this.fullRoomReleaseCleanupTimer?.remove(false);
    this.fullRoomReleaseCleanupTimer = null;
  }

  private destroyFullRoom(
    roomId: string,
    notifyDisplayChanges = true,
  ): RoomCoordinates | null {
    const pendingTeardown = this.pendingFullRoomTeardownsById.get(roomId);
    if (pendingTeardown?.destructionStarted) {
      const coordinates = pendingTeardown.loadedRoom.room.coordinates;
      pendingTeardown.loadedRoom.collisionReady = false;
      if (notifyDisplayChanges) {
        this.options.onFullRoomSetChanged?.([coordinates]);
      }
      this.cancelPendingFullRoomTeardown(
        roomId,
        'room-destroyed-synchronously',
        false,
        false,
      );
      if (notifyDisplayChanges) {
        this.options.onBackdropObjectsChanged?.();
      }
      return coordinates;
    }
    this.cancelPendingFullRoomTeardown(
      roomId,
      'room-destroyed-synchronously',
      false,
      false,
    );
    const loadedRoom = this.loadedFullRoomsById.get(roomId);
    if (!loadedRoom) {
      return null;
    }
    loadedRoom.collisionReady = false;
    if (notifyDisplayChanges) {
      this.options.onFullRoomSetChanged?.([loadedRoom.room.coordinates]);
    }
    const artifactRemainsCached = Boolean(
      loadedRoom.artifactKey && this.roomArtifactCache.has(loadedRoom.artifactKey),
    );
    if (loadedRoom.artifactKey && artifactRemainsCached) {
      this.roomArtifactCache.touch(loadedRoom.artifactKey);
    }
    const resourceKeys = [
      loadedRoom.textureKey,
      loadedRoom.foregroundTextureKey,
      loadedRoom.customRoomTileTextureKey,
    ].filter((key): key is string => Boolean(key));
    this.loadedFullRoomsById.delete(roomId);
    this.fullRoomReleaseAtById.delete(roomId);
    this.runFullRoomTeardownCleanupStep('destroy room resources', () => {
      this.destroyLoadedRoomResources(loadedRoom);
    });
    this.runFullRoomTeardownCleanupStep('notify room destruction', () => {
      this.options.onFullRoomDestroyed?.(loadedRoom);
    });
    if (!artifactRemainsCached) {
      this.runFullRoomTeardownCleanupStep('release room artifact resources', () => {
        this.releaseRoomArtifactResources(resourceKeys);
      });
    }
    if (notifyDisplayChanges) {
      this.runFullRoomTeardownCleanupStep('synchronize backdrop display state', () => {
        this.options.onBackdropObjectsChanged?.();
      });
    }
    this.runFullRoomTeardownCleanupStep('synchronize the room artifact policy', () => {
      this.syncRoomArtifactCachePolicy();
    });
    return loadedRoom.room.coordinates;
  }

  private destroyLoadedRoomResources(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    preserveTriggerState = false,
  ): void {
    let firstError: unknown;
    let hasError = false;
    const attempt = (operation: () => void) => {
      try {
        operation();
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    };
    attempt(() => this.options.destroyEdgeWalls(loadedRoom));
    attempt(() => this.options.destroyLiveObjects(loadedRoom, { preserveTriggerState }));
    attempt(() => loadedRoom.terrainCollider?.destroy());
    loadedRoom.terrainCollider = null;
    attempt(() => loadedRoom.terrainInsetCollider?.destroy());
    loadedRoom.terrainInsetCollider = null;
    attempt(() => loadedRoom.terrainInsetBodies?.clear(true, true));
    attempt(() => loadedRoom.terrainInsetBodies?.destroy());
    loadedRoom.terrainInsetBodies = null;
    attempt(() => loadedRoom.terrainLayer.destroy());
    attempt(() => loadedRoom.map.destroy());
    attempt(() => loadedRoom.backgroundColorRect?.destroy());
    loadedRoom.backgroundColorRect = null;
    for (const backgroundSprite of loadedRoom.backgroundSprites) {
      attempt(() => backgroundSprite.sprite.destroy());
    }
    loadedRoom.backgroundSprites = [];
    attempt(() => loadedRoom.image.destroy());
    attempt(() => loadedRoom.foregroundImage?.destroy());
    loadedRoom.foregroundImage = null;
    if (hasError) throw firstError;
  }

  private syncLiveObjectWorldColliders(): void {
    this.options.syncLiveObjectWorldColliders?.(this.loadedFullRoomsById.values());
  }

  private createTerrainInsetBodies(
    room: RoomSnapshot,
    origin: { x: number; y: number },
    terrainLayer: Phaser.Tilemaps.TilemapLayer
  ): Phaser.Physics.Arcade.StaticGroup | null {
    const insetBodies = this.options.scene.physics.add.staticGroup();
    let bodyCount = 0;

    bodyCount += this.createTerrainInsetBodiesRows(
      room,
      origin,
      terrainLayer,
      insetBodies,
      0,
      ROOM_HEIGHT,
      false,
    );

    if (bodyCount === 0) {
      insetBodies.destroy();
      return null;
    }

    terrainLayer.calculateFacesWithin(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    return insetBodies;
  }

  private createTerrainInsetBodiesRows(
    room: RoomSnapshot,
    origin: { x: number; y: number },
    terrainLayer: Phaser.Tilemaps.TilemapLayer,
    insetBodies: Phaser.Physics.Arcade.StaticGroup | null,
    startRow: number,
    endRow: number,
    dormant: boolean,
  ): number {
    if (!insetBodies) return 0;
    let bodyCount = 0;
    for (let y = Math.max(0, startRow); y < Math.min(ROOM_HEIGHT, endRow); y += 1) {
      for (let x = 0; x < ROOM_WIDTH; x += 1) {
        const tile = terrainLayer.getTileAt(x, y);
        if (tile && terrainTileDisablesTilemapCollision(room, x, y)) {
          tile.setCollision(false, false, false, false);
        }
        if (!terrainTileNeedsInsetBody(room, x, y)) continue;

        const profile = getTerrainTileCollisionProfile(room, x, y);
        const zone = this.options.scene.add.zone(
          origin.x + x * TILE_SIZE + TILE_SIZE / 2,
          origin.y + y * TILE_SIZE + profile.topInset + profile.height / 2,
          TILE_SIZE,
          profile.height,
        );
        this.options.scene.physics.add.existing(zone, true);
        insetBodies.add(zone);
        if (dormant) {
          zone.setActive(false);
          const body = zone.body as Phaser.Physics.Arcade.StaticBody | null;
          if (body) body.enable = false;
        }
        bodyCount += 1;
      }
    }
    return bodyCount;
  }

  private createRoomBackground(
    room: RoomSnapshot,
    origin: { x: number; y: number },
    options: {
      dormant?: boolean;
      requireCustomTextureReady?: boolean;
    } = {},
  ): {
    colorRect: Phaser.GameObjects.Rectangle | null;
    sprites: LoadedRoomBackgroundSprite[];
  } {
    const resolved = resolveRoomBackground(room.background);
    let colorRect: Phaser.GameObjects.Rectangle | null = null;
    const sprites: LoadedRoomBackgroundSprite[] = [];
    const finish = () => {
      if (options.dormant) {
        this.setRoomBackgroundObjectsActive(colorRect, sprites, false);
      }
      return { colorRect, sprites };
    };

    if (resolved.kind === 'none') {
      colorRect = this.options.scene.add.rectangle(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        RETRO_COLORS.backgroundNumber,
      );
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);

      for (let index = 0; index < 2; index += 1) {
        const config = getStarfieldLayerConfig(index, PLAY_ROOM_PARALLAX_MULTIPLIER);
        sprites.push({
          sprite: createStarfieldTileSprite(this.options.scene, {
            x: origin.x,
            y: origin.y,
            width: ROOM_PX_WIDTH,
            height: ROOM_PX_HEIGHT,
            depth: 9 + index * 0.1,
            alpha: config.alpha,
          }),
          parallax: config.parallax,
          tileScale: config.tileScale,
          useVerticalParallax: false,
        });
      }

      return finish();
    }

    if (resolved.kind === 'solid') {
      const color = Phaser.Display.Color.HexStringToColor(resolved.color).color;
      colorRect = this.options.scene.add.rectangle(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, color);
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);
      return finish();
    }

    if (resolved.kind === 'custom') {
      colorRect = this.options.scene.add.rectangle(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        RETRO_COLORS.backgroundNumber,
      );
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);
      const createReadyCustomBackground = () => {
        const layer = createCustomBackgroundLayer(this.options.scene, resolved.id, resolved.fit);
        const sprite = createCustomBackgroundObject(
          this.options.scene,
          layer,
          origin.x,
          origin.y,
          ROOM_PX_WIDTH,
          ROOM_PX_HEIGHT,
          9,
        );
        sprites.push({
          sprite,
          parallax: 0,
          tileScale: ROOM_PX_HEIGHT / layer.height,
          useVerticalParallax: false,
          customLayer: layer,
        });
      };
      if (this.options.scene.textures.exists(getCustomBackgroundTextureKey(resolved.id))) {
        createReadyCustomBackground();
      } else if (options.requireCustomTextureReady) {
        colorRect.destroy();
        colorRect = null;
        throw new Error(`Prepared custom background texture is missing for ${room.id}.`);
      } else {
        const currentColorRect = colorRect;
        void ensureCustomBackgroundTexture(this.options.scene, resolved.id)
          .then(() => {
            if (!currentColorRect.active || this.destroyed) return;
            createReadyCustomBackground();
            this.options.onBackdropObjectsChanged?.();
          })
          .catch(() => {});
      }
      return finish();
    }

    if (resolved.group.bgColor) {
      const color = Phaser.Display.Color.HexStringToColor(resolved.group.bgColor).color;
      colorRect = this.options.scene.add.rectangle(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, color);
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);
    }

    for (let index = 0; index < resolved.group.layers.length; index += 1) {
      const layer = resolved.group.layers[index];
      const sprite = createBuiltInBackgroundObject(
        this.options.scene,
        layer,
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        9 + index * 0.01,
      );
      const tileScale = getBuiltInBackgroundTileScale(layer, ROOM_PX_HEIGHT);
      sprites.push({
        sprite,
        parallax: layer.scrollFactor * PLAY_ROOM_PARALLAX_MULTIPLIER,
        tileScale,
        useVerticalParallax: false,
        builtInLayer: layer,
      });
    }

    return finish();
  }

  private setRoomBackgroundObjectsActive(
    colorRect: Phaser.GameObjects.Rectangle | null,
    sprites: readonly LoadedRoomBackgroundSprite[],
    active: boolean,
  ): void {
    colorRect?.setActive(active);
    colorRect?.setVisible(active);
    for (const background of sprites) {
      background.sprite.setActive(active);
      background.sprite.setVisible(active);
    }
  }

  private setPreparedRoomBackgroundActive(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    active: boolean,
  ): void {
    this.setRoomBackgroundObjectsActive(
      loadedRoom.backgroundColorRect ?? null,
      loadedRoom.backgroundSprites ?? [],
      active,
    );
  }

  private updateFullRoomBackground(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    camera: Phaser.Cameras.Scene2D.Camera
  ): void {
    const origin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
    const worldView = camera.worldView;
    if (
      origin.x + ROOM_PX_WIDTH < worldView.left
      || origin.x > worldView.right
      || origin.y + ROOM_PX_HEIGHT < worldView.top
      || origin.y > worldView.bottom
    ) {
      return;
    }

    if (loadedRoom.backgroundColorRect) {
      loadedRoom.backgroundColorRect.setPosition(origin.x, origin.y);
      loadedRoom.backgroundColorRect.setSize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    }

    for (const backgroundSprite of loadedRoom.backgroundSprites) {
      if (backgroundSprite.customLayer) {
        syncCustomBackgroundObject(
          backgroundSprite.sprite as CustomBackgroundObject,
          backgroundSprite.customLayer,
          origin.x,
          origin.y,
          ROOM_PX_WIDTH,
          ROOM_PX_HEIGHT,
          camera.scrollX,
        );
        continue;
      }

      if (backgroundSprite.builtInLayer) {
        syncBuiltInBackgroundObject(
          backgroundSprite.sprite as BuiltInBackgroundObject,
          backgroundSprite.builtInLayer,
          origin.x,
          origin.y,
          ROOM_PX_WIDTH,
          ROOM_PX_HEIGHT,
          (camera.scrollX * backgroundSprite.parallax) / backgroundSprite.tileScale,
          backgroundSprite.useVerticalParallax
            ? (camera.scrollY * backgroundSprite.parallax) / backgroundSprite.tileScale
            : 0,
        );
        continue;
      }

      const sprite = backgroundSprite.sprite as Phaser.GameObjects.TileSprite;
      syncStarfieldTileSprite(
        sprite,
        camera,
        {
          parallax: backgroundSprite.parallax,
          tileScale: backgroundSprite.tileScale,
        },
        {
          x: origin.x,
          y: origin.y,
          width: ROOM_PX_WIDTH,
          height: ROOM_PX_HEIGHT,
          useVerticalParallax: backgroundSprite.useVerticalParallax,
        },
      );
    }
  }
}

function sanitizeTextureNamespace(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function summarizeChunkWindow(chunkWindow: WorldChunkWindow): Record<string, unknown> {
  return {
    chunkCount: chunkWindow.chunks.length,
    roomSummaryCount: chunkWindow.chunks.reduce((total, chunk) => total + chunk.rooms.length, 0),
    previewRoomCount: chunkWindow.chunks.reduce((total, chunk) => total + chunk.previewRooms.length, 0),
  };
}

function compactWorldWindowToLegacyShell(window: CompactWorldChunkWindow): WorldChunkWindow {
  return {
    chunkBounds: { ...window.chunkBounds },
    roomBounds: { ...window.roomBounds },
    chunks: window.chunks.map((chunk) => ({
      ...chunk,
      coordinates: { ...chunk.coordinates },
      roomBounds: { ...chunk.roomBounds },
      rooms: chunk.rooms.map((room) => ({ ...room, coordinates: { ...room.coordinates } })),
      previewRooms: [],
    })),
  };
}
