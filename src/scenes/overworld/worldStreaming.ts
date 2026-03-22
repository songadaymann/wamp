import Phaser from 'phaser';
import {
  decodeTileDataValue,
  getBackgroundGroup,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
} from '../../config';
import {
  cloneRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import type { WorldRepository } from '../../persistence/worldRepository';
import {
  computeWorldChunkPreviewHash,
  computeWorldSummariesFromPublishedSummariesInBounds,
  createPublishedRoomSummary,
  createWorldWindowFromRoomBounds,
  isWithinRoomBounds,
  type WorldChunkBounds,
  type WorldChunkWindow,
  type WorldRoomBounds,
  type WorldRoomSummary,
  type WorldWindow,
} from '../../persistence/worldModel';
import { RETRO_COLORS, ensureStarfieldTexture } from '../../visuals/starfield';
import { buildRoomSnapshotTexture, buildRoomTextureKey } from '../../visuals/roomSnapshotTexture';
import type { OverworldMode } from '../sceneData';
import { OverworldChunkPreviewRenderer } from './chunkPreviewRenderer';
import {
  OverworldPreviewCache,
  type RenderableRoom,
  type StreamingRoomCandidate,
} from './previewCache';
import {
  computeOverworldPreviewSelection,
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

const PREVIEW_TILE_SIZE = 4;
const PLAY_ROOM_PARALLAX_MULTIPLIER = 0.2;

export interface LoadedFullRoom<TLiveObject = unknown, TEdgeWall = unknown> {
  room: RoomSnapshot;
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
  sprite: Phaser.GameObjects.TileSprite;
  parallax: number;
  tileScale: number;
  useVerticalParallax: boolean;
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
  createLiveObjects: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  destroyLiveObjects: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  destroyEdgeWalls: (loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>) => void;
  onBackdropObjectsChanged?: () => void;
  onFullRoomVisibilityChanged?: () => void;
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
  private readonly previewCache: OverworldPreviewCache;
  private readonly previewRenderer: OverworldChunkPreviewRenderer;
  private loadedFullRoomsById = new Map<string, LoadedFullRoom<TLiveObject, TEdgeWall>>();
  private nearLodRoomIds = new Set<string>();
  private midLodRoomIds = new Set<string>();
  private farLodRoomIds = new Set<string>();
  private visibleRoomIds = new Set<string>();
  private previewRoomBudget = 0;
  private fullRoomBudget = 0;
  private activeChunkRadius = 0;
  private chunkWindowRequestInFlight = false;

  constructor(private readonly options: OverworldWorldStreamingControllerOptions<TLiveObject, TEdgeWall>) {
    this.previewCache = new OverworldPreviewCache(options.worldRepository);
    this.previewRenderer = new OverworldChunkPreviewRenderer({
      scene: options.scene,
      previewTileSize: PREVIEW_TILE_SIZE,
      getRoomOrigin: options.getRoomOrigin,
      isFullRoomLoaded: (roomId) => this.loadedFullRoomsById.has(roomId),
      onBackdropObjectsChanged: options.onBackdropObjectsChanged,
      onFullRoomVisibilityChanged: options.onFullRoomVisibilityChanged,
    });
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
    this.previewCache.reset();
    this.previewRenderer.reset();
    this.loadedFullRoomsById = new Map();
    this.nearLodRoomIds = new Set();
    this.midLodRoomIds = new Set();
    this.farLodRoomIds = new Set();
    this.visibleRoomIds = new Set();
    this.previewRoomBudget = 0;
    this.fullRoomBudget = 0;
    this.activeChunkRadius = 0;
    this.chunkWindowRequestInFlight = false;
  }

  destroy(): void {
    this.loadGeneration += 1;
    this.destroyed = true;
    this.clearDisplayState();
    this.worldWindow = null;
    this.chunkWindow = null;
    this.loadedRoomBounds = null;
    this.loadedChunkBounds = null;
    this.chunkPreviewHashesById = new Map();
    this.roomSummariesById = new Map();
    this.draftRoomsById = new Map();
    this.transientRoomOverridesById = new Map();
    this.previewCache.reset();
    this.previewRenderer.reset();
    this.loadedFullRoomsById = new Map();
    this.nearLodRoomIds = new Set();
    this.midLodRoomIds = new Set();
    this.farLodRoomIds = new Set();
    this.visibleRoomIds = new Set();
    this.previewRoomBudget = 0;
    this.fullRoomBudget = 0;
    this.activeChunkRadius = 0;
    this.chunkWindowRequestInFlight = false;
  }

  setDraftRoom(room: RoomSnapshot): void {
    this.draftRoomsById.set(room.id, cloneRoomSnapshot(room));
  }

  clearDraftRoom(roomId: string): void {
    this.draftRoomsById.delete(roomId);
  }

  setTransientRoomOverride(room: RoomSnapshot): void {
    this.transientRoomOverridesById.set(room.id, cloneRoomSnapshot(room));
    this.invalidateRoomArtifacts(room.id, false);
    this.rebuildLoadedSummaryState();
    this.refreshVisibleRoomsFromCache();
  }

  clearTransientRoomOverride(roomId: string): void {
    if (!this.transientRoomOverridesById.delete(roomId)) {
      return;
    }

    this.invalidateRoomArtifacts(roomId, false);
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
      return 'cancelled';
    }

    const generation = ++this.loadGeneration;
    this.chunkWindowRequestInFlight = true;

    try {
      const desiredChunkBounds = this.getDesiredChunkBounds(centerCoordinates);
      if (
        options.forceChunkReload ||
        !this.chunkWindow ||
        !this.loadedChunkBounds ||
        !this.containsChunkBounds(this.loadedChunkBounds, desiredChunkBounds)
      ) {
        const chunkWindow = await this.options.worldRepository.loadWorldChunkWindow(desiredChunkBounds);
        if (this.destroyed || generation !== this.loadGeneration) {
          return 'cancelled';
        }
        this.applyChunkWindow(chunkWindow);
      }

      const roomCandidates = this.collectVisibleRoomCandidates();
      this.visibleRoomIds = new Set(roomCandidates.keys());
      const previewSelection = this.computePreviewSelection(roomCandidates);
      const previewRoomIds = previewSelection.previewRoomIds;
      const fullRoomIds = previewSelection.fullRoomIds;
      const renderableRooms = await this.previewCache.collectRenderableRooms(
        roomCandidates,
        previewRoomIds,
        fullRoomIds
      );
      if (this.destroyed || generation !== this.loadGeneration) {
        return 'cancelled';
      }

      this.previewRenderer.renderChunkPreviews(
        Array.from(renderableRooms.values(), (renderableRoom) => renderableRoom.room).filter((room) =>
          previewRoomIds.has(room.id)
        )
      );

      if (this.options.getMode() === 'play') {
        for (const renderableRoom of renderableRooms.values()) {
          if (fullRoomIds.has(renderableRoom.id)) {
            await this.ensureFullRoom(renderableRoom.room);
          }
        }
      }

      this.previewRenderer.unloadOutsideWindow(this.visibleRoomIds, previewRoomIds);
      this.previewCache.pruneSnapshots(this.visibleRoomIds, new Set(this.loadedFullRoomsById.keys()));
      this.unloadFullRoomsOutsideStream(fullRoomIds);
      return 'success';
    } catch {
      return 'error';
    } finally {
      this.chunkWindowRequestInFlight = false;
    }
  }

  async refreshLoadedChunksIfChanged(
    centerCoordinates: RoomCoordinates
  ): Promise<ChunkWindowRefreshResult> {
    if (this.chunkWindowRequestInFlight || !this.loadedChunkBounds || !this.chunkWindow) {
      return 'cancelled';
    }

    const desiredChunkBounds = this.getDesiredChunkBounds(centerCoordinates);
    if (!this.containsChunkBounds(this.loadedChunkBounds, desiredChunkBounds)) {
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
    return !this.loadedChunkBounds || !this.containsChunkBounds(this.loadedChunkBounds, desiredChunkBounds);
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
    visibleRoomCount: number;
    previewRoomBudget: number;
    fullRoomBudget: number;
    loadedPreviewRoomCount: number;
    loadedFullRoomCount: number;
  } {
    return {
      activeChunkRadius: this.activeChunkRadius,
      visibleRoomCount: this.visibleRoomIds.size,
      previewRoomBudget: this.previewRoomBudget,
      fullRoomBudget: this.fullRoomBudget,
      loadedPreviewRoomCount: this.previewRenderer.getLoadedPreviewRoomCount(),
      loadedFullRoomCount: this.loadedFullRoomsById.size,
    };
  }

  updateFullRoomBackgrounds(camera: Phaser.Cameras.Scene2D.Camera): void {
    if (this.options.getMode() === 'play' && this.options.getPerformanceProfile() === 'reduced') {
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

    const publishedSummaries = Array.from(this.roomSummariesById.values()).filter(
      (summary) => summary.state === 'published'
    );
    const nextSummaries = computeWorldSummariesFromPublishedSummariesInBounds(
      publishedSummaries,
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
    const publishedPreviewRooms = Array.from(this.previewCache.getRoomSnapshotsById().values())
      .filter((room) => room.status === 'published');
    for (const chunk of this.chunkWindow.chunks) {
      chunk.rooms = summaries
        .filter((summary) => isWithinRoomBounds(summary.coordinates, chunk.roomBounds))
        .sort((left, right) => {
          if (left.coordinates.y !== right.coordinates.y) {
            return left.coordinates.y - right.coordinates.y;
          }
          return left.coordinates.x - right.coordinates.x;
        });
      chunk.previewRooms = publishedPreviewRooms
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
    if (!this.loadedRoomBounds) {
      return;
    }

    const roomCandidates = this.collectVisibleRoomCandidates();
    this.visibleRoomIds = new Set(roomCandidates.keys());
    const previewSelection = this.computePreviewSelection(roomCandidates);
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
          room: cloneRoomSnapshot(candidate.draft),
        });
        continue;
      }

      if (!candidate.summary || candidate.summary.state !== 'published') {
        continue;
      }

      const cachedRoom = this.previewCache.getRoomSnapshot(candidate.summary.id);
      if (!cachedRoom) {
        continue;
      }

      renderableRooms.set(candidate.id, {
        id: candidate.id,
        coordinates: { ...candidate.coordinates },
        room: cloneRoomSnapshot(cachedRoom),
      });
    }

    this.previewRenderer.renderChunkPreviews(
      Array.from(renderableRooms.values(), (renderableRoom) => renderableRoom.room).filter((room) =>
        previewRoomIds.has(room.id)
      )
    );

    if (this.options.getMode() === 'play') {
      for (const renderableRoom of renderableRooms.values()) {
        if (fullRoomIds.has(renderableRoom.id)) {
          void this.ensureFullRoom(renderableRoom.room);
        }
      }
    }

    this.previewRenderer.unloadOutsideWindow(this.visibleRoomIds, previewRoomIds);
    this.previewCache.pruneSnapshots(this.visibleRoomIds, new Set(this.loadedFullRoomsById.keys()));
    this.unloadFullRoomsOutsideStream(fullRoomIds);
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
      });
    }

    return candidates;
  }

  private computePreviewSelection(
    roomCandidates: Map<string, StreamingRoomCandidate>
  ): OverworldPreviewSelection {
    const previewCandidates: PreviewSelectionCandidate[] = Array.from(roomCandidates.values()).map(
      (roomCandidate) => ({
        id: roomCandidate.id,
        coordinates: { ...roomCandidate.coordinates },
        isRenderable: roomCandidate.draft !== null || roomCandidate.summary?.state === 'published',
      })
    );

    const selection = computeOverworldPreviewSelection({
      mode: this.options.getMode(),
      performanceProfile: this.options.getPerformanceProfile(),
      zoom: this.options.scene.cameras.main.zoom,
      focusCoordinates: this.getFocusCoordinates(),
      roomCandidates: previewCandidates,
    });

    this.previewRoomBudget = selection.previewRoomBudget;
    this.fullRoomBudget = selection.fullRoomBudget;
    this.nearLodRoomIds = selection.nearLodRoomIds;
    this.midLodRoomIds = selection.midLodRoomIds;
    this.farLodRoomIds = selection.farLodRoomIds;

    return selection;
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
      performanceProfile: this.options.getPerformanceProfile(),
      zoom: camera.zoom,
      viewportWidth: this.options.scene.scale.width,
      viewportHeight: this.options.scene.scale.height,
    });
  }

  private containsChunkBounds(container: WorldChunkBounds, inner: WorldChunkBounds): boolean {
    return (
      container.minChunkX <= inner.minChunkX &&
      container.maxChunkX >= inner.maxChunkX &&
      container.minChunkY <= inner.minChunkY &&
      container.maxChunkY >= inner.maxChunkY
    );
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
    this.previewRenderer.invalidateRoomPreview(roomId);
    this.previewCache.invalidateRoom(roomId, dropPublishedSnapshot);
  }

  private async ensureFullRoom(room: RoomSnapshot): Promise<void> {
    const existing = this.loadedFullRoomsById.get(room.id);
    if (existing && existing.room.version === room.version && existing.room.updatedAt === room.updatedAt) {
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

    this.destroyFullRoom(room.id);

    const textureKey = buildRoomTextureKey(room, 'full', TILE_SIZE, {
      includeBackground: false,
      includeObjects: false,
      includedLayers: ['background', 'terrain'],
    });
    const foregroundTextureKey = buildRoomTextureKey(room, 'full', TILE_SIZE, {
      includeBackground: false,
      includeObjects: false,
      includedLayers: ['foreground'],
    });
    if (!this.options.scene.textures.exists(textureKey)) {
      buildRoomSnapshotTexture(this.options.scene, room, textureKey, TILE_SIZE, {
        includeBackground: false,
        includeObjects: false,
        includedLayers: ['background', 'terrain'],
      });
    }
    if (!this.options.scene.textures.exists(foregroundTextureKey)) {
      buildRoomSnapshotTexture(this.options.scene, room, foregroundTextureKey, TILE_SIZE, {
        includeBackground: false,
        includeObjects: false,
        includedLayers: ['foreground'],
      });
    }

    const origin = this.options.getRoomOrigin(room.coordinates);
    const roomBackground = this.createRoomBackground(room, origin);
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
        tilesetConfig.firstGid
      );
      if (tileset) {
        tilesets.push(tileset);
      }
    }

    const terrainLayer = map.createBlankLayer(`terrain-${room.id}`, tilesets, origin.x, origin.y);
    if (!terrainLayer) {
      roomBackground.colorRect?.destroy();
      for (const backgroundSprite of roomBackground.sprites) {
        backgroundSprite.sprite.destroy();
      }
      image.destroy();
      return;
    }

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

    terrainLayer.setCollisionByExclusion([-1]);
    terrainLayer.setVisible(false);
    const terrainInsetBodies = this.createTerrainInsetBodies(room, origin, terrainLayer);

    const player = this.options.getPlayer();
    const loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall> = {
      room,
      backgroundColorRect: roomBackground.colorRect,
      backgroundSprites: roomBackground.sprites,
      image,
      textureKey,
      foregroundImage,
      foregroundTextureKey,
      map,
      terrainLayer,
      terrainCollider: player ? this.options.scene.physics.add.collider(player, terrainLayer) : null,
      terrainInsetBodies,
      terrainInsetCollider:
        player && terrainInsetBodies
          ? this.options.scene.physics.add.collider(player, terrainInsetBodies)
          : null,
      edgeWalls: [],
      liveObjects: [],
    };
    this.updateFullRoomBackground(loadedRoom, this.options.scene.cameras.main);
    this.options.createLiveObjects(loadedRoom);
    this.loadedFullRoomsById.set(room.id, loadedRoom);
    this.previewRenderer.syncPreviewVisibility();
    this.options.onBackdropObjectsChanged?.();
    this.options.onFullRoomVisibilityChanged?.();
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
      this.previewRenderer.syncPreviewVisibility();
    }
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

    this.loadedFullRoomsById.delete(roomId);
    this.options.onBackdropObjectsChanged?.();
    this.options.onFullRoomVisibilityChanged?.();
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
    const group = getBackgroundGroup(room.background);
    let colorRect: Phaser.GameObjects.Rectangle | null = null;
    const sprites: LoadedRoomBackgroundSprite[] = [];

    if (!group || group.layers.length === 0) {
      const textureKey = ensureStarfieldTexture(this.options.scene);

      colorRect = this.options.scene.add.rectangle(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        RETRO_COLORS.backgroundNumber,
      );
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);

      const farLayer = this.options.scene.add.tileSprite(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        textureKey,
      );
      farLayer.setOrigin(0, 0);
      farLayer.setDepth(9);
      farLayer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      sprites.push({
        sprite: farLayer,
        parallax: 0.035 * PLAY_ROOM_PARALLAX_MULTIPLIER,
        tileScale: 1,
        useVerticalParallax: true,
      });

      const nearLayer = this.options.scene.add.tileSprite(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        textureKey,
      );
      nearLayer.setOrigin(0, 0);
      nearLayer.setDepth(9.1);
      nearLayer.setAlpha(0.28);
      nearLayer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      sprites.push({
        sprite: nearLayer,
        parallax: 0.12 * PLAY_ROOM_PARALLAX_MULTIPLIER,
        tileScale: 0.58,
        useVerticalParallax: true,
      });

      return { colorRect, sprites };
    }

    if (group.bgColor) {
      const color = Phaser.Display.Color.HexStringToColor(group.bgColor).color;
      colorRect = this.options.scene.add.rectangle(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, color);
      colorRect.setOrigin(0, 0);
      colorRect.setDepth(8);
    }

    for (let index = 0; index < group.layers.length; index += 1) {
      const layer = group.layers[index];
      const sprite = this.options.scene.add.tileSprite(
        origin.x,
        origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        layer.key,
      );
      sprite.setOrigin(0, 0);
      sprite.setDepth(9 + index * 0.01);
      sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      sprites.push({
        sprite,
        parallax: layer.scrollFactor * PLAY_ROOM_PARALLAX_MULTIPLIER,
        tileScale: ROOM_PX_HEIGHT / layer.height,
        useVerticalParallax: false,
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
      backgroundSprite.sprite.setPosition(origin.x, origin.y);
      backgroundSprite.sprite.setSize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
      backgroundSprite.sprite.setTileScale(backgroundSprite.tileScale, backgroundSprite.tileScale);
      backgroundSprite.sprite.tilePositionX =
        (camera.scrollX * backgroundSprite.parallax) / backgroundSprite.tileScale;
      backgroundSprite.sprite.tilePositionY = backgroundSprite.useVerticalParallax
        ? (camera.scrollY * backgroundSprite.parallax) / backgroundSprite.tileScale
        : 0;
    }
  }
}
