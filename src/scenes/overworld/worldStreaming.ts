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
  createBuiltInBackgroundObject,
  createCustomBackgroundLayer,
  createCustomBackgroundObject,
  ensureCustomBackgroundTexture,
  getBuiltInBackgroundTileScale,
  syncBuiltInBackgroundObject,
  syncCustomBackgroundObject,
  type BuiltInBackgroundObject,
  type CustomBackgroundLayer,
  type CustomBackgroundObject,
} from '../../backgrounds/runtime';
import {
  cloneRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import type { WorldRepository } from '../../persistence/worldRepository';
import {
  computeWorldChunkPreviewHash,
  computeWorldSummariesFromOccupancySummariesInBounds,
  containsWorldChunkBounds,
  createPublishedRoomSummary,
  createWorldWindowFromRoomBounds,
  isWithinRoomBounds,
  type WorldChunkBounds,
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
  ensureCustomRoomTileTexture,
  ensureCustomRoomTilesetForMap,
} from '../../customTiles/runtime';
import {
  extractRoomStaticLightingEmitters,
  type RoomStaticLightingEmitters,
} from '../../lighting/emissiveSources';
import type { OverworldMode } from '../sceneData';
import { OverworldChunkPreviewRenderer } from './chunkPreviewRenderer';
import {
  OverworldPreviewCache,
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

const PLAY_ROOM_PARALLAX_MULTIPLIER = 0.2;
const FULL_ROOM_RELEASE_GRACE_MS = 300;
const DEFERRED_FULL_ROOM_LOAD_DELAY_MS = 24;
const DEFERRED_PREVIEW_RENDER_DELAY_MS = 32;

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
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  getPlayer: () => Phaser.GameObjects.GameObject | null;
  shouldCollidePlayerWithTerrainTile?: (tile: Phaser.Tilemaps.Tile) => boolean;
  createLiveObjects: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  destroyLiveObjects: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  destroyEdgeWalls: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  syncLiveObjectWorldColliders?: (
    loadedRooms: Iterable<LoadedFullRoom<TLiveObject, TEdgeWall>>,
  ) => void;
  getProtectedFullRoomIds?: (targetFullRoomIds: ReadonlySet<string>) => Iterable<string>;
  onBackdropObjectsChanged?: () => void;
  onFullRoomVisibilityChanged?: () => void;
  onFullRoomDestroyed?: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  onFullRoomReplaced?: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
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
  private readonly previewCache: OverworldPreviewCache;
  private readonly previewRenderer: OverworldChunkPreviewRenderer;
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
  private deferredFullRoomLoadQueue: RenderableRoom[] = [];
  private deferredFullRoomLoadTimer: Phaser.Time.TimerEvent | null = null;
  private deferredPreviewRooms: RoomSnapshot[] = [];
  private deferredPreviewRenderTimer: Phaser.Time.TimerEvent | null = null;
  private fullRoomReleaseCleanupTimer: Phaser.Time.TimerEvent | null = null;
  private readonly textureNamespace: string;

  constructor(private readonly options: OverworldWorldStreamingControllerOptions<TLiveObject, TEdgeWall>) {
    this.textureNamespace = sanitizeTextureNamespace(options.scene.sys.settings.key);
    this.previewCache = new OverworldPreviewCache(options.worldRepository);
    this.previewRenderer = new OverworldChunkPreviewRenderer({
      scene: options.scene,
      getPreviewTileSize: () => this.getPreviewTileSize(),
      getFocusCoordinates: () => this.getFocusCoordinates(),
      getRoomOrigin: options.getRoomOrigin,
      isFullRoomLoaded: (roomId) => this.loadedFullRoomsById.has(roomId),
      onBackdropObjectsChanged: options.onBackdropObjectsChanged,
      onFullRoomVisibilityChanged: options.onFullRoomVisibilityChanged,
      measurePerformance: options.measurePerformance,
    });
  }

  private measure<T>(label: string, callback: () => T): T {
    return this.options.measurePerformance
      ? this.options.measurePerformance(label, callback)
      : callback();
  }

  reset(): void {
    this.loadGeneration += 1;
    this.destroyed = false;
    this.clearDisplayState();
    this.worldWindow = null;
    this.chunkWindow = null;
    this.loadedRoomBounds = null;
    this.loadedChunkBounds = null;
    this.chunkPreviewHashesById = new Map();
    this.roomSummariesById = new Map();
    this.draftRoomsById = new Map();
    this.transientRoomOverridesById = new Map();
    this.presencePreviewRoomsById = new Map();
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
    this.cancelDeferredFullRoomLoads();
    this.cancelDeferredPreviewRender();
    this.cancelFullRoomReleaseCleanup();
  }

  destroy(): void {
    this.loadGeneration += 1;
    this.destroyed = true;
    this.cancelDeferredFullRoomLoads();
    this.cancelDeferredPreviewRender();
    this.cancelFullRoomReleaseCleanup();
    this.clearDisplayState();
    this.worldWindow = null;
    this.chunkWindow = null;
    this.loadedRoomBounds = null;
    this.loadedChunkBounds = null;
    this.chunkPreviewHashesById = new Map();
    this.roomSummariesById = new Map();
    this.draftRoomsById = new Map();
    this.transientRoomOverridesById = new Map();
    this.presencePreviewRoomsById = new Map();
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
      this.invalidateRoomArtifacts(room.id, false);
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
      nextPreviewsById.set(preview.id, cloneRoomSnapshot(preview));
    }

    if (this.arePresencePreviewMapsEqual(this.presencePreviewRoomsById, nextPreviewsById)) {
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

      this.invalidateRoomArtifacts(roomId, false);
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
      touchedRoomIds.add(nextPublishedRoom.id);
    }

    if (mutation.invalidateRoomId) {
      const shouldDropPublishedSnapshot = mutation.invalidateRoomId !== nextPublishedRoom?.id;
      this.invalidateRoomArtifacts(mutation.invalidateRoomId, shouldDropPublishedSnapshot);
      touchedRoomIds.add(mutation.invalidateRoomId);
    }

    if (nextDraftRoom) {
      this.invalidateRoomArtifacts(nextDraftRoom.id, false);
    }

    if (nextPublishedRoom) {
      this.invalidateRoomArtifacts(nextPublishedRoom.id, false);
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

    const generation = ++this.loadGeneration;
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
        try {
          chunkWindow = await this.options.worldRepository.loadWorldChunkWindow(desiredChunkBounds);
        } finally {
          cancelChunkStallWatch();
        }
        if (this.destroyed || generation !== this.loadGeneration) {
          return 'cancelled';
        }
        logBootPhase('world-stream:chunk-window:done', summarizeChunkWindow(chunkWindow));
        this.applyChunkWindow(chunkWindow);
      }

      const roomCandidates = this.collectVisibleRoomCandidates();
      this.visibleRoomIds = new Set(roomCandidates.keys());
      const previewSelection = this.computePreviewSelection(roomCandidates);
      const previewRoomIds = previewSelection.previewRoomIds;
      const fullRoomIds = previewSelection.fullRoomIds;
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
          previewRoomIds,
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
      this.previewRenderer.renderChunkPreviews(
        this.collectPreviewRooms(renderableRooms, previewRoomIds)
      );

      if (this.options.getMode() === 'play') {
        this.syncPlayFullRooms(renderableRooms, fullRoomIds);
      } else {
        this.cancelDeferredFullRoomLoads();
      }

      this.previewRenderer.unloadOutsideWindow(this.visibleRoomIds, previewRoomIds);
      this.previewCache.pruneSnapshots(this.visibleRoomIds, new Set(this.loadedFullRoomsById.keys()));
      this.unloadFullRoomsOutsideStream(
        this.options.getMode() === 'play'
          ? this.getRetainedFullRoomIds(fullRoomIds)
          : fullRoomIds
      );
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

    const generation = ++this.loadGeneration;
    this.chunkWindowRequestInFlight = true;

    try {
      const nextChunkWindow = await this.options.worldRepository.loadWorldChunkWindow(this.loadedChunkBounds);
      if (this.destroyed || generation !== this.loadGeneration) {
        return 'cancelled';
      }

      if (!this.haveChunkPreviewHashesChanged(nextChunkWindow)) {
        this.captureChunkPreviewHashes(nextChunkWindow);
        return 'unchanged';
      }

      this.applyChunkWindow(nextChunkWindow);
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

  isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean {
    return this.loadedRoomBounds ? isWithinRoomBounds(coordinates, this.loadedRoomBounds) : false;
  }

  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null {
    const roomId = roomIdFromCoordinates(coordinates);
    const transientRoom = this.transientRoomOverridesById.get(roomId);
    if (transientRoom) {
      return cloneRoomSnapshot(transientRoom);
    }

    const draftRoom = this.draftRoomsById.get(roomId);
    if (draftRoom) {
      return cloneRoomSnapshot(draftRoom);
    }

    const presencePreviewRoom = this.presencePreviewRoomsById.get(roomId);
    if (presencePreviewRoom) {
      return cloneRoomSnapshot(presencePreviewRoom);
    }

    const loadedFullRoom = this.loadedFullRoomsById.get(roomId);
    if (loadedFullRoom) {
      return cloneRoomSnapshot(loadedFullRoom.room);
    }

    return this.previewCache.getRoomSnapshot(roomId);
  }

  getWorldWindow(): WorldWindow | null {
    return this.worldWindow;
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
    return this.previewRenderer.getPreviewImages();
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
    localPlayPressureProfile: LocalPlayPressureMetrics['profile'];
    localPlayPressureScore: number;
    localPlayPressureRoomCount: number;
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
      localPlayPressureProfile: this.localPlayPressure.profile,
      localPlayPressureScore: this.localPlayPressure.score,
      localPlayPressureRoomCount: this.localPlayPressure.roomBreakdowns.length,
    };
  }

  updateFullRoomBackgrounds(camera: Phaser.Cameras.Scene2D.Camera): void {
    if (this.options.getMode() === 'play' && this.getEffectivePerformanceProfile() === 'reduced') {
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
        .map((room) => cloneRoomSnapshot(room))
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
    const fullRoomIds = previewSelection.fullRoomIds;
    const requestedRoomIds = new Set<string>([...previewRoomIds, ...fullRoomIds]);
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
        const cachedPublishedRoom = this.previewCache.getRoomSnapshot(candidate.summary.id);
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

      const cachedRoom = this.previewCache.getRoomSnapshot(candidate.summary.id);
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

    const previewRooms = this.collectPreviewRooms(renderableRooms, previewRoomIds);
    if (this.options.getMode() === 'play') {
      this.queueDeferredPreviewRender(previewRooms);
    } else {
      this.cancelDeferredPreviewRender();
      this.measure('stream.renderChunkPreviews', () => {
        this.previewRenderer.renderChunkPreviews(previewRooms);
      });
    }

    this.measure('stream.unloadPreviewOutsideWindow', () => {
      this.previewRenderer.unloadOutsideWindow(this.visibleRoomIds, previewRoomIds);
      this.previewCache.pruneSnapshots(this.visibleRoomIds, new Set(this.loadedFullRoomsById.keys()));
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
          : fullRoomIds
      );
    });
    });
  }

  private syncPlayFullRooms(
    renderableRooms: Map<string, RenderableRoom>,
    fullRoomIds: Set<string>,
  ): void {
    this.measure('stream.syncPlayFullRooms', () => {
      const focusRoomId = roomIdFromCoordinates(this.options.getCurrentRoomCoordinates());
      const deferredRooms: RenderableRoom[] = [];

      for (const renderableRoom of renderableRooms.values()) {
        if (!fullRoomIds.has(renderableRoom.id)) {
          continue;
        }

        if (renderableRoom.id === focusRoomId || this.loadedFullRoomsById.has(renderableRoom.id)) {
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

  private queueDeferredPreviewRender(rooms: RoomSnapshot[]): void {
    this.cancelDeferredPreviewRender();
    this.deferredPreviewRooms = rooms;
    this.deferredPreviewRenderTimer = this.options.scene.time.delayedCall(
      DEFERRED_PREVIEW_RENDER_DELAY_MS,
      () => {
        this.deferredPreviewRenderTimer = null;
        if (this.destroyed) {
          this.deferredPreviewRooms = [];
          return;
        }

        const previewRooms = this.deferredPreviewRooms;
        this.deferredPreviewRooms = [];
        this.measure('stream.renderChunkPreviews', () => {
          this.previewRenderer.renderChunkPreviews(previewRooms);
        });
      },
    );
  }

  private cancelDeferredPreviewRender(): void {
    this.deferredPreviewRenderTimer?.remove(false);
    this.deferredPreviewRenderTimer = null;
    this.deferredPreviewRooms = [];
  }

  private queueDeferredFullRoomLoads(rooms: RenderableRoom[]): void {
    this.cancelDeferredFullRoomLoads();
    if (rooms.length === 0) {
      return;
    }

    this.deferredFullRoomLoadQueue = rooms;
    this.scheduleNextDeferredFullRoomLoad();
  }

  private scheduleNextDeferredFullRoomLoad(): void {
    if (
      this.destroyed
      || this.options.getMode() !== 'play'
      || this.deferredFullRoomLoadQueue.length === 0
    ) {
      this.cancelDeferredFullRoomLoads();
      return;
    }

    this.deferredFullRoomLoadTimer = this.options.scene.time.delayedCall(
      DEFERRED_FULL_ROOM_LOAD_DELAY_MS,
      () => {
        this.deferredFullRoomLoadTimer = null;
        const nextRoom = this.deferredFullRoomLoadQueue.shift() ?? null;
        if (nextRoom && this.options.getMode() === 'play' && !this.destroyed) {
          this.ensureFullRoom(nextRoom.room, nextRoom.source);
        }
        this.scheduleNextDeferredFullRoomLoad();
      },
    );
  }

  private cancelDeferredFullRoomLoads(): void {
    this.deferredFullRoomLoadTimer?.remove(false);
    this.deferredFullRoomLoadTimer = null;
    this.deferredFullRoomLoadQueue = [];
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
        draft: cloneRoomSnapshot(draftRoom),
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
        draft: cloneRoomSnapshot(overrideRoom),
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
        sharedPreview: cloneRoomSnapshot(previewRoom),
        allowFullRoomLoad:
          existing?.summary?.state === 'claimed_unpublished' ||
          (!existing?.summary && previewRoom.status === 'draft'),
        source: 'live_construction_preview',
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

    return selection;
  }

  private arePresencePreviewMapsEqual(
    current: Map<string, RoomSnapshot>,
    next: Map<string, RoomSnapshot>,
  ): boolean {
    if (current.size !== next.size) {
      return false;
    }

    for (const [roomId, currentRoom] of current.entries()) {
      const nextRoom = next.get(roomId);
      if (!nextRoom) {
        return false;
      }

      if (
        currentRoom.version !== nextRoom.version ||
        currentRoom.updatedAt !== nextRoom.updatedAt ||
        currentRoom.status !== nextRoom.status
      ) {
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

  private applyChunkWindow(chunkWindow: WorldChunkWindow): void {
    this.chunkWindow = chunkWindow;
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

  private invalidateRoomArtifacts(roomId: string, dropPublishedSnapshot: boolean): void {
    this.destroyFullRoom(roomId);
    this.syncLiveObjectWorldColliders();
    this.previewRenderer.invalidateRoomPreview(roomId);
    this.previewCache.invalidateRoom(roomId, dropPublishedSnapshot);
  }

  private ensureFullRoom(room: RoomSnapshot, source: PlayableRoomSource): void {
    return this.measure('stream.ensureFullRoom', () => {
    registerCustomSpritesFromSnapshot(room);
    const existing = this.loadedFullRoomsById.get(room.id);
    if (existing && this.isLoadedFullRoomCurrent(existing, room, source)) {
      existing.image.setVisible(true);
      existing.foregroundImage?.setVisible(true);
      for (const liveObject of existing.liveObjects) {
        const sprite = (liveObject as { sprite?: Phaser.GameObjects.Sprite }).sprite;
        sprite?.setVisible(true);
      }
      this.previewRenderer.syncPreviewVisibility();
      this.options.onFullRoomVisibilityChanged?.();
      return;
    }

    const replacingExistingRoom = Boolean(existing);
    this.destroyFullRoom(room.id);

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
    const customRoomTileTextureKey = buildCustomRoomTileTextureKey(
      `${this.textureNamespace}:${room.id}:${room.version}:${room.updatedAt}`
    );
    this.measure('stream.ensureCustomRoomTileTexture', () => {
      ensureCustomRoomTileTexture(this.options.scene, customRoomTileTextureKey, room.customTiles);
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
        tilesetConfig.firstGid
      );
      if (tileset) {
        tilesets.push(tileset);
      }
    }
    const customTileset = ensureCustomRoomTilesetForMap(map, customRoomTileTextureKey);
    if (customTileset) {
      tilesets.push(customTileset);
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
      return;
    }

    this.measure('stream.populateTerrainLayer', () => {
      for (let y = 0; y < ROOM_HEIGHT; y += 1) {
        for (let x = 0; x < ROOM_WIDTH; x += 1) {
          const { gid, flipX, flipY } = decodeTileDataValue(room.tileData.terrain[y][x]);
          if (gid > 0) {
            const tile = terrainLayer.putTileAt(gid, x, y);
            if (tile) {
              tile.flipX = flipX;
              tile.flipY = flipY;
            }
          }
        }
      }
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
    };
    this.measure('stream.updateFullRoomBackground', () => {
      this.updateFullRoomBackground(loadedRoom, this.options.scene.cameras.main);
    });
    this.measure('stream.createLiveObjects', () => {
      this.options.createLiveObjects(loadedRoom);
    });
    this.loadedFullRoomsById.set(room.id, loadedRoom);
    this.syncLiveObjectWorldColliders();
    this.previewRenderer.syncPreviewVisibility();
    this.options.onBackdropObjectsChanged?.();
    this.options.onFullRoomVisibilityChanged?.();
    if (replacingExistingRoom) {
      this.options.onFullRoomReplaced?.(loadedRoom);
    }
    });
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

  private unloadFullRoomsOutsideStream(fullRoomIds: Set<string>): void {
    let changed = false;
    for (const roomId of Array.from(this.loadedFullRoomsById.keys())) {
      if (fullRoomIds.has(roomId)) {
        continue;
      }

      this.destroyFullRoom(roomId);
      changed = true;
    }

    if (changed) {
      this.syncLiveObjectWorldColliders();
      this.previewRenderer.syncPreviewVisibility();
    }
  }

  private getRetainedFullRoomIds(targetFullRoomIds: Set<string>): Set<string> {
    const protectedRoomIds = this.getProtectedLoadedFullRoomIds(targetFullRoomIds);
    const effectiveTargetRoomIds = new Set<string>(targetFullRoomIds);
    for (const roomId of protectedRoomIds) {
      effectiveTargetRoomIds.add(roomId);
    }

    const retainedRoomIds = new Set<string>(effectiveTargetRoomIds);
    const now = this.options.scene.time.now;
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

  private destroyFullRoom(roomId: string): void {
    const loadedRoom = this.loadedFullRoomsById.get(roomId);
    if (!loadedRoom) {
      return;
    }

    this.options.destroyEdgeWalls(loadedRoom);
    this.options.destroyLiveObjects(loadedRoom);
    loadedRoom.terrainCollider?.destroy();
    loadedRoom.terrainInsetCollider?.destroy();
    loadedRoom.terrainInsetBodies?.clear(true, true);
    loadedRoom.terrainInsetBodies?.destroy();
    loadedRoom.terrainLayer.destroy();
    loadedRoom.map.destroy();
    loadedRoom.backgroundColorRect?.destroy();
    for (const backgroundSprite of loadedRoom.backgroundSprites) {
      backgroundSprite.sprite.destroy();
    }
    loadedRoom.image.destroy();
    loadedRoom.foregroundImage?.destroy();

    if (this.options.scene.textures.exists(loadedRoom.textureKey)) {
      this.options.scene.textures.remove(loadedRoom.textureKey);
    }
    if (loadedRoom.foregroundTextureKey && this.options.scene.textures.exists(loadedRoom.foregroundTextureKey)) {
      this.options.scene.textures.remove(loadedRoom.foregroundTextureKey);
    }

    this.options.onFullRoomDestroyed?.(loadedRoom);
    this.loadedFullRoomsById.delete(roomId);
    this.fullRoomReleaseAtById.delete(roomId);
    this.options.onBackdropObjectsChanged?.();
    this.options.onFullRoomVisibilityChanged?.();
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

    for (let y = 0; y < ROOM_HEIGHT; y += 1) {
      for (let x = 0; x < ROOM_WIDTH; x += 1) {
        const tile = terrainLayer.getTileAt(x, y);
        if (tile && terrainTileDisablesTilemapCollision(room, x, y)) {
          tile.setCollision(false, false, false, false);
        }

        if (!terrainTileNeedsInsetBody(room, x, y)) {
          continue;
        }

        const profile = getTerrainTileCollisionProfile(room, x, y);
        const zone = this.options.scene.add.zone(
          origin.x + x * TILE_SIZE + TILE_SIZE / 2,
          origin.y + y * TILE_SIZE + profile.topInset + profile.height / 2,
          TILE_SIZE,
          profile.height
        );
        this.options.scene.physics.add.existing(zone, true);
        insetBodies.add(zone);
        bodyCount += 1;
      }
    }

    if (bodyCount === 0) {
      insetBodies.destroy();
      return null;
    }

    terrainLayer.calculateFacesWithin(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    return insetBodies;
  }

  private createRoomBackground(
    room: RoomSnapshot,
    origin: { x: number; y: number }
  ): {
    colorRect: Phaser.GameObjects.Rectangle | null;
    sprites: LoadedRoomBackgroundSprite[];
  } {
    const resolved = resolveRoomBackground(room.background);
    let colorRect: Phaser.GameObjects.Rectangle | null = null;
    const sprites: LoadedRoomBackgroundSprite[] = [];

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
          useVerticalParallax: true,
        });
      }

      return { colorRect, sprites };
    }

    if (resolved.kind === 'solid') {
      const color = Phaser.Display.Color.HexStringToColor(resolved.color).color;
      colorRect = this.options.scene.add.rectangle(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, color);
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);
      return { colorRect, sprites };
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
      const currentColorRect = colorRect;
      void ensureCustomBackgroundTexture(this.options.scene, resolved.id)
        .then(() => {
          if (!currentColorRect.active || this.destroyed) {
            return;
          }
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
          this.options.onBackdropObjectsChanged?.();
        })
        .catch(() => {});
      return { colorRect, sprites };
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

    return { colorRect, sprites };
  }

  private updateFullRoomBackground(
    loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>,
    camera: Phaser.Cameras.Scene2D.Camera
  ): void {
    const origin = this.options.getRoomOrigin(loadedRoom.room.coordinates);

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
