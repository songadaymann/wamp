import Phaser from 'phaser';
import {
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
  computeWorldSummariesFromPublishedSummariesInBounds,
  createPublishedRoomSummary,
  createWorldWindowFromRoomBounds,
  isWithinRoomBounds,
  roomToChunkCoordinates,
  type WorldChunkBounds,
  type WorldChunkWindow,
  type WorldRoomBounds,
  type WorldRoomSummary,
  type WorldWindow,
  WORLD_CHUNK_SIZE,
} from '../../persistence/worldModel';
import { RETRO_COLORS, ensureStarfieldTexture } from '../../visuals/starfield';
import { buildRoomSnapshotTexture, buildRoomTextureKey } from '../../visuals/roomSnapshotTexture';
import type { OverworldMode } from '../sceneData';

const STREAM_RADIUS = 1;
const PLAY_MAX_CHUNK_RADIUS = 2;
const BROWSE_MAX_CHUNK_RADIUS = 3;
const PLAY_MAX_PREVIEW_ROOMS = 25;
const BROWSE_NEAR_MAX_PREVIEW_ROOMS = 25;
const BROWSE_MID_MAX_PREVIEW_ROOMS = 49;
const BROWSE_FAR_MAX_PREVIEW_ROOMS = 81;
const PLAY_MID_LOD_ROOM_RADIUS = 4;
const BROWSE_NEAR_MID_LOD_ROOM_RADIUS = 4;
const BROWSE_MID_MID_LOD_ROOM_RADIUS = 6;
const BROWSE_FAR_MID_LOD_ROOM_RADIUS = 8;
const PREVIEW_TILE_SIZE = 4;
const MIN_ZOOM = 0.08;
const FULL_ROOM_BUDGET = (STREAM_RADIUS * 2 + 1) ** 2;
const PLAY_ROOM_PARALLAX_MULTIPLIER = 0.2;

export interface LoadedFullRoom<TLiveObject = unknown, TEdgeWall = unknown> {
  room: RoomSnapshot;
  backgroundColorRect: Phaser.GameObjects.Rectangle | null;
  backgroundSprites: LoadedRoomBackgroundSprite[];
  image: Phaser.GameObjects.Image;
  textureKey: string;
  map: Phaser.Tilemaps.Tilemap;
  terrainLayer: Phaser.Tilemaps.TilemapLayer;
  terrainCollider: Phaser.Physics.Arcade.Collider | null;
  edgeWalls: TEdgeWall[];
  liveObjects: TLiveObject[];
}

interface RenderableRoom {
  id: string;
  coordinates: RoomCoordinates;
  room: RoomSnapshot;
}

interface RoomCandidate {
  id: string;
  coordinates: RoomCoordinates;
  summary: WorldRoomSummary | null;
  draft: RoomSnapshot | null;
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
  private roomSummariesById = new Map<string, WorldRoomSummary>();
  private draftRoomsById = new Map<string, RoomSnapshot>();
  private roomSnapshotsById = new Map<string, RoomSnapshot>();
  private roomLoadPromisesById = new Map<string, Promise<RoomSnapshot | null>>();
  private previewImagesByRoomId = new Map<string, Phaser.GameObjects.Image>();
  private previewTextureKeysByRoomId = new Map<string, string>();
  private loadedFullRoomsById = new Map<string, LoadedFullRoom<TLiveObject, TEdgeWall>>();
  private nearLodRoomIds = new Set<string>();
  private midLodRoomIds = new Set<string>();
  private farLodRoomIds = new Set<string>();
  private visibleRoomIds = new Set<string>();
  private previewRoomBudget = 0;
  private fullRoomBudget = 0;
  private activeChunkRadius = 0;

  constructor(private readonly options: OverworldWorldStreamingControllerOptions<TLiveObject, TEdgeWall>) {}

  reset(): void {
    this.loadGeneration += 1;
    this.destroyed = false;
    this.clearDisplayState();
    this.worldWindow = null;
    this.chunkWindow = null;
    this.loadedRoomBounds = null;
    this.loadedChunkBounds = null;
    this.roomSummariesById = new Map();
    this.draftRoomsById = new Map();
    this.roomSnapshotsById = new Map();
    this.roomLoadPromisesById = new Map();
    this.previewImagesByRoomId = new Map();
    this.previewTextureKeysByRoomId = new Map();
    this.loadedFullRoomsById = new Map();
    this.nearLodRoomIds = new Set();
    this.midLodRoomIds = new Set();
    this.farLodRoomIds = new Set();
    this.visibleRoomIds = new Set();
    this.previewRoomBudget = 0;
    this.fullRoomBudget = 0;
    this.activeChunkRadius = 0;
  }

  destroy(): void {
    this.loadGeneration += 1;
    this.destroyed = true;
    this.clearDisplayState();
    this.worldWindow = null;
    this.chunkWindow = null;
    this.loadedRoomBounds = null;
    this.loadedChunkBounds = null;
    this.roomSummariesById = new Map();
    this.draftRoomsById = new Map();
    this.roomSnapshotsById = new Map();
    this.roomLoadPromisesById = new Map();
    this.previewImagesByRoomId = new Map();
    this.previewTextureKeysByRoomId = new Map();
    this.loadedFullRoomsById = new Map();
    this.nearLodRoomIds = new Set();
    this.midLodRoomIds = new Set();
    this.farLodRoomIds = new Set();
    this.visibleRoomIds = new Set();
    this.previewRoomBudget = 0;
    this.fullRoomBudget = 0;
    this.activeChunkRadius = 0;
  }

  setDraftRoom(room: RoomSnapshot): void {
    this.draftRoomsById.set(room.id, cloneRoomSnapshot(room));
  }

  clearDraftRoom(roomId: string): void {
    this.draftRoomsById.delete(roomId);
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
      this.roomSnapshotsById.set(nextPublishedRoom.id, nextPublishedRoom);
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
    const generation = ++this.loadGeneration;

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

        this.chunkWindow = chunkWindow;
        this.loadedChunkBounds = { ...chunkWindow.chunkBounds };
        this.loadedRoomBounds = { ...chunkWindow.roomBounds };

        const mergedRoomSummaries = this.mergeRoomSummariesFromChunks(chunkWindow);
        const nextWorldWindow = createWorldWindowFromRoomBounds(chunkWindow.roomBounds);
        nextWorldWindow.rooms = mergedRoomSummaries;
        this.worldWindow = nextWorldWindow;
        this.roomSummariesById = new Map(mergedRoomSummaries.map((summary) => [summary.id, summary]));
        this.activeChunkRadius = this.getChunkRadius(chunkWindow.chunkBounds);
      }

      const roomCandidates = this.collectVisibleRoomCandidates();
      this.visibleRoomIds = new Set(roomCandidates.keys());
      const budgets = this.computeStreamingBudgets();
      this.previewRoomBudget = budgets.previewRoomBudget;
      this.fullRoomBudget = budgets.fullRoomBudget;
      const lodRoomIds = this.computeLodRoomIds(roomCandidates);
      this.nearLodRoomIds = lodRoomIds.near;
      this.midLodRoomIds = lodRoomIds.mid;
      this.farLodRoomIds = lodRoomIds.far;
      const previewRoomIds = this.selectPrioritizedRoomIds(
        roomCandidates,
        new Set([...this.nearLodRoomIds, ...this.midLodRoomIds]),
        this.previewRoomBudget
      );
      const fullRoomIds =
        this.options.getMode() === 'play'
          ? this.selectPrioritizedRoomIds(roomCandidates, this.nearLodRoomIds, this.fullRoomBudget)
          : new Set<string>();
      const requestedRoomIds = new Set<string>([...previewRoomIds, ...fullRoomIds]);
      const renderableRooms = await this.collectRenderableRooms(roomCandidates, requestedRoomIds);
      if (this.destroyed || generation !== this.loadGeneration) {
        return 'cancelled';
      }

      for (const renderableRoom of renderableRooms.values()) {
        if (previewRoomIds.has(renderableRoom.id)) {
          this.ensureRoomPreview(renderableRoom.room);
        }
      }

      if (this.options.getMode() === 'play') {
        for (const renderableRoom of renderableRooms.values()) {
          if (fullRoomIds.has(renderableRoom.id)) {
            await this.ensureFullRoom(renderableRoom.room);
          }
        }
      }

      this.unloadRoomsOutsideWindow(this.visibleRoomIds, previewRoomIds);
      this.unloadFullRoomsOutsideStream(fullRoomIds);
      return 'success';
    } catch {
      return 'error';
    }
  }

  needsRefreshAround(centerCoordinates: RoomCoordinates): boolean {
    const desiredChunkBounds = this.getDesiredChunkBounds(centerCoordinates);
    return !this.loadedChunkBounds || !this.containsChunkBounds(this.loadedChunkBounds, desiredChunkBounds);
  }

  syncPreviewVisibility(): void {
    for (const [roomId, image] of this.previewImagesByRoomId.entries()) {
      image.setVisible(!this.loadedFullRoomsById.has(roomId));
    }
    this.options.onFullRoomVisibilityChanged?.();
  }

  isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean {
    return this.loadedRoomBounds ? isWithinRoomBounds(coordinates, this.loadedRoomBounds) : false;
  }

  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null {
    const roomId = roomIdFromCoordinates(coordinates);
    const draftRoom = this.draftRoomsById.get(roomId);
    if (draftRoom) {
      return cloneRoomSnapshot(draftRoom);
    }

    return this.roomSnapshotsById.get(roomId) ?? null;
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
    return this.roomSnapshotsById;
  }

  getPreviewImagesByRoomId(): Map<string, Phaser.GameObjects.Image> {
    return this.previewImagesByRoomId;
  }

  getPreviewTextureKeysByRoomId(): Map<string, string> {
    return this.previewTextureKeysByRoomId;
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
      loadedPreviewRoomCount: this.previewImagesByRoomId.size,
      loadedFullRoomCount: this.loadedFullRoomsById.size,
    };
  }

  updateFullRoomBackgrounds(camera: Phaser.Cameras.Scene2D.Camera): void {
    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      this.updateFullRoomBackground(loadedRoom, camera);
    }
  }

  private clearDisplayState(): void {
    for (const roomId of Array.from(this.loadedFullRoomsById.keys())) {
      this.destroyFullRoom(roomId);
    }

    for (const image of this.previewImagesByRoomId.values()) {
      image.destroy();
    }

    for (const textureKey of this.previewTextureKeysByRoomId.values()) {
      if (this.options.scene.textures.exists(textureKey)) {
        this.options.scene.textures.remove(textureKey);
      }
    }
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
    this.syncChunkWindowRoomsFromSummaries();
  }

  private syncChunkWindowRoomsFromSummaries(): void {
    if (!this.chunkWindow) {
      return;
    }

    const summaries = Array.from(this.roomSummariesById.values());
    for (const chunk of this.chunkWindow.chunks) {
      chunk.rooms = summaries
        .filter((summary) => isWithinRoomBounds(summary.coordinates, chunk.roomBounds))
        .sort((left, right) => {
          if (left.coordinates.y !== right.coordinates.y) {
            return left.coordinates.y - right.coordinates.y;
          }
          return left.coordinates.x - right.coordinates.x;
        });
    }
  }

  private refreshVisibleRoomsFromCache(): void {
    if (!this.loadedRoomBounds) {
      return;
    }

    const roomCandidates = this.collectVisibleRoomCandidates();
    this.visibleRoomIds = new Set(roomCandidates.keys());
    const budgets = this.computeStreamingBudgets();
    this.previewRoomBudget = budgets.previewRoomBudget;
    this.fullRoomBudget = budgets.fullRoomBudget;
    const lodRoomIds = this.computeLodRoomIds(roomCandidates);
    this.nearLodRoomIds = lodRoomIds.near;
    this.midLodRoomIds = lodRoomIds.mid;
    this.farLodRoomIds = lodRoomIds.far;

    const previewRoomIds = this.selectPrioritizedRoomIds(
      roomCandidates,
      new Set([...this.nearLodRoomIds, ...this.midLodRoomIds]),
      this.previewRoomBudget
    );
    const fullRoomIds =
      this.options.getMode() === 'play'
        ? this.selectPrioritizedRoomIds(roomCandidates, this.nearLodRoomIds, this.fullRoomBudget)
        : new Set<string>();

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

      const cachedRoom = this.roomSnapshotsById.get(candidate.summary.id);
      if (!cachedRoom) {
        continue;
      }

      renderableRooms.set(candidate.id, {
        id: candidate.id,
        coordinates: { ...candidate.coordinates },
        room: cloneRoomSnapshot(cachedRoom),
      });
    }

    for (const renderableRoom of renderableRooms.values()) {
      if (previewRoomIds.has(renderableRoom.id)) {
        this.ensureRoomPreview(renderableRoom.room);
      }
    }

    if (this.options.getMode() === 'play') {
      for (const renderableRoom of renderableRooms.values()) {
        if (fullRoomIds.has(renderableRoom.id)) {
          void this.ensureFullRoom(renderableRoom.room);
        }
      }
    }

    this.unloadRoomsOutsideWindow(this.visibleRoomIds, previewRoomIds);
    this.unloadFullRoomsOutsideStream(fullRoomIds);
  }

  private collectVisibleRoomCandidates(): Map<string, RoomCandidate> {
    const candidates = new Map<string, RoomCandidate>();
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

    return candidates;
  }

  private async collectRenderableRooms(
    roomCandidates: Map<string, RoomCandidate>,
    requestedRoomIds: Set<string>
  ): Promise<Map<string, RenderableRoom>> {
    const renderableRooms = new Map<string, RenderableRoom>();
    if (requestedRoomIds.size === 0) {
      return renderableRooms;
    }

    await Promise.all(
      Array.from(requestedRoomIds.values()).map(async (roomId) => {
        const candidate = roomCandidates.get(roomId);
        if (!candidate) {
          return;
        }

        if (candidate.draft) {
          renderableRooms.set(candidate.id, {
            id: candidate.id,
            coordinates: { ...candidate.coordinates },
            room: cloneRoomSnapshot(candidate.draft),
          });
          return;
        }

        if (!candidate.summary || candidate.summary.state !== 'published') {
          return;
        }

        const publishedRoom = await this.ensurePublishedRoomSnapshot(candidate.summary);
        if (!publishedRoom) {
          return;
        }

        renderableRooms.set(candidate.id, {
          id: candidate.id,
          coordinates: { ...candidate.coordinates },
          room: publishedRoom,
        });
      })
    );

    return renderableRooms;
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

  private computeLodRoomIds(roomCandidates: Map<string, RoomCandidate>): {
    near: Set<string>;
    mid: Set<string>;
    far: Set<string>;
  } {
    const focusCoordinates = this.getFocusCoordinates();
    const midLodRoomRadius = this.getMidLodRoomRadius();
    const near = new Set<string>();
    const mid = new Set<string>();
    const far = new Set<string>();

    for (const roomCandidate of roomCandidates.values()) {
      const deltaX = Math.abs(roomCandidate.coordinates.x - focusCoordinates.x);
      const deltaY = Math.abs(roomCandidate.coordinates.y - focusCoordinates.y);

      if (deltaX <= STREAM_RADIUS && deltaY <= STREAM_RADIUS) {
        near.add(roomCandidate.id);
        continue;
      }

      if (deltaX <= midLodRoomRadius && deltaY <= midLodRoomRadius) {
        mid.add(roomCandidate.id);
        continue;
      }

      far.add(roomCandidate.id);
    }

    return { near, mid, far };
  }

  private getDesiredChunkBounds(centerCoordinates: RoomCoordinates): WorldChunkBounds {
    const chunkCenter = roomToChunkCoordinates(centerCoordinates);
    const camera = this.options.scene.cameras.main;
    const zoom = Math.max(camera.zoom, MIN_ZOOM);
    const visibleRoomsX = Math.ceil(this.options.scene.scale.width / (ROOM_PX_WIDTH * zoom));
    const visibleRoomsY = Math.ceil(this.options.scene.scale.height / (ROOM_PX_HEIGHT * zoom));
    const paddedRoomRadius = Math.max(
      STREAM_RADIUS + 1,
      Math.ceil(Math.max(visibleRoomsX, visibleRoomsY) * 0.5) + 2
    );
    const maxChunkRadius = this.options.getMode() === 'play' ? PLAY_MAX_CHUNK_RADIUS : BROWSE_MAX_CHUNK_RADIUS;
    const chunkRadius = Phaser.Math.Clamp(
      Math.ceil(paddedRoomRadius / WORLD_CHUNK_SIZE),
      1,
      maxChunkRadius
    );

    return {
      minChunkX: chunkCenter.x - chunkRadius,
      maxChunkX: chunkCenter.x + chunkRadius,
      minChunkY: chunkCenter.y - chunkRadius,
      maxChunkY: chunkCenter.y + chunkRadius,
    };
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

  private getMidLodRoomRadius(): number {
    const zoom = Math.max(this.options.scene.cameras.main.zoom, MIN_ZOOM);
    if (this.options.getMode() === 'play') {
      return PLAY_MID_LOD_ROOM_RADIUS;
    }

    if (zoom <= 0.12) {
      return BROWSE_FAR_MID_LOD_ROOM_RADIUS;
    }

    if (zoom <= 0.2) {
      return BROWSE_MID_MID_LOD_ROOM_RADIUS;
    }

    return BROWSE_NEAR_MID_LOD_ROOM_RADIUS;
  }

  private computeStreamingBudgets(): {
    previewRoomBudget: number;
    fullRoomBudget: number;
  } {
    const zoom = Math.max(this.options.scene.cameras.main.zoom, MIN_ZOOM);
    if (this.options.getMode() === 'play') {
      return {
        previewRoomBudget: PLAY_MAX_PREVIEW_ROOMS,
        fullRoomBudget: FULL_ROOM_BUDGET,
      };
    }

    if (zoom <= 0.12) {
      return {
        previewRoomBudget: BROWSE_FAR_MAX_PREVIEW_ROOMS,
        fullRoomBudget: 0,
      };
    }

    if (zoom <= 0.2) {
      return {
        previewRoomBudget: BROWSE_MID_MAX_PREVIEW_ROOMS,
        fullRoomBudget: 0,
      };
    }

    return {
      previewRoomBudget: BROWSE_NEAR_MAX_PREVIEW_ROOMS,
      fullRoomBudget: 0,
    };
  }

  private selectPrioritizedRoomIds(
    roomCandidates: Map<string, RoomCandidate>,
    eligibleRoomIds: Set<string>,
    budget: number
  ): Set<string> {
    if (budget <= 0 || eligibleRoomIds.size === 0) {
      return new Set();
    }

    const focusCoordinates = this.getFocusCoordinates();
    const prioritized = Array.from(eligibleRoomIds.values())
      .map((roomId) => roomCandidates.get(roomId) ?? null)
      .filter(
        (roomCandidate): roomCandidate is RoomCandidate =>
          roomCandidate !== null &&
          (roomCandidate.draft !== null || roomCandidate.summary?.state === 'published')
      )
      .sort((left, right) => {
        const leftBucket = this.nearLodRoomIds.has(left.id) ? 0 : 1;
        const rightBucket = this.nearLodRoomIds.has(right.id) ? 0 : 1;
        if (leftBucket !== rightBucket) {
          return leftBucket - rightBucket;
        }

        const leftDistance =
          Math.abs(left.coordinates.x - focusCoordinates.x) +
          Math.abs(left.coordinates.y - focusCoordinates.y);
        const rightDistance =
          Math.abs(right.coordinates.x - focusCoordinates.x) +
          Math.abs(right.coordinates.y - focusCoordinates.y);
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }

        if (left.coordinates.y !== right.coordinates.y) {
          return left.coordinates.y - right.coordinates.y;
        }

        return left.coordinates.x - right.coordinates.x;
      });

    return new Set(prioritized.slice(0, budget).map((roomCandidate) => roomCandidate.id));
  }

  private async ensurePublishedRoomSnapshot(summary: WorldRoomSummary): Promise<RoomSnapshot | null> {
    const cached = this.roomSnapshotsById.get(summary.id);
    if (cached && cached.version === (summary.version ?? cached.version)) {
      return cached;
    }

    const inFlight = this.roomLoadPromisesById.get(summary.id);
    if (inFlight) {
      return inFlight;
    }

    const request = this.options.worldRepository
      .loadPublishedRoom(summary.id, summary.coordinates)
      .then((room) => {
        if (room) {
          this.roomSnapshotsById.set(room.id, room);
        }
        return room;
      })
      .finally(() => {
        this.roomLoadPromisesById.delete(summary.id);
      });

    this.roomLoadPromisesById.set(summary.id, request);
    return request;
  }

  private ensureRoomPreview(room: RoomSnapshot): void {
    const textureKey = buildRoomTextureKey(room, 'preview', PREVIEW_TILE_SIZE);
    const previousTextureKey = this.previewTextureKeysByRoomId.get(room.id);

    if (
      previousTextureKey &&
      previousTextureKey !== textureKey &&
      this.options.scene.textures.exists(previousTextureKey)
    ) {
      this.options.scene.textures.remove(previousTextureKey);
    }

    if (!this.options.scene.textures.exists(textureKey)) {
      buildRoomSnapshotTexture(this.options.scene, room, textureKey, PREVIEW_TILE_SIZE);
    }

    let previewImage = this.previewImagesByRoomId.get(room.id) ?? null;
    if (!previewImage) {
      previewImage = this.options.scene.add.image(0, 0, textureKey);
      previewImage.setOrigin(0.5);
      previewImage.setDepth(0);
      this.previewImagesByRoomId.set(room.id, previewImage);
      this.options.onBackdropObjectsChanged?.();
    } else {
      previewImage.setTexture(textureKey);
    }

    const origin = this.options.getRoomOrigin(room.coordinates);
    previewImage.setPosition(origin.x + ROOM_PX_WIDTH / 2, origin.y + ROOM_PX_HEIGHT / 2);
    previewImage.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    previewImage.setVisible(!this.loadedFullRoomsById.has(room.id));
    this.previewTextureKeysByRoomId.set(room.id, textureKey);
  }

  private invalidateRoomArtifacts(roomId: string, dropPublishedSnapshot: boolean): void {
    this.destroyFullRoom(roomId);

    const previewImage = this.previewImagesByRoomId.get(roomId);
    if (previewImage) {
      previewImage.destroy();
      this.previewImagesByRoomId.delete(roomId);
    }

    const previewTextureKey = this.previewTextureKeysByRoomId.get(roomId);
    if (previewTextureKey && this.options.scene.textures.exists(previewTextureKey)) {
      this.options.scene.textures.remove(previewTextureKey);
    }
    this.previewTextureKeysByRoomId.delete(roomId);
    this.roomLoadPromisesById.delete(roomId);

    if (dropPublishedSnapshot) {
      this.roomSnapshotsById.delete(roomId);
    }

    this.options.onBackdropObjectsChanged?.();
    this.options.onFullRoomVisibilityChanged?.();
  }

  private async ensureFullRoom(room: RoomSnapshot): Promise<void> {
    const existing = this.loadedFullRoomsById.get(room.id);
    if (existing && existing.room.version === room.version && existing.room.updatedAt === room.updatedAt) {
      existing.image.setVisible(true);
      for (const liveObject of existing.liveObjects) {
        const sprite = (liveObject as { sprite?: Phaser.GameObjects.Sprite }).sprite;
        sprite?.setVisible(true);
      }
      this.previewImagesByRoomId.get(room.id)?.setVisible(false);
      this.options.onFullRoomVisibilityChanged?.();
      return;
    }

    this.destroyFullRoom(room.id);

    const textureKey = buildRoomTextureKey(room, 'full', TILE_SIZE, {
      includeBackground: false,
      includeObjects: false,
    });
    if (!this.options.scene.textures.exists(textureKey)) {
      buildRoomSnapshotTexture(this.options.scene, room, textureKey, TILE_SIZE, {
        includeBackground: false,
        includeObjects: false,
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
        const gid = room.tileData.terrain[y][x];
        if (gid > 0) {
          terrainLayer.putTileAt(gid, x, y);
        }
      }
    }

    terrainLayer.setCollisionByExclusion([-1]);
    terrainLayer.setVisible(false);

    const player = this.options.getPlayer();
    const loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall> = {
      room,
      backgroundColorRect: roomBackground.colorRect,
      backgroundSprites: roomBackground.sprites,
      image,
      textureKey,
      map,
      terrainLayer,
      terrainCollider: player ? this.options.scene.physics.add.collider(player, terrainLayer) : null,
      edgeWalls: [],
      liveObjects: [],
    };
    this.updateFullRoomBackground(loadedRoom, this.options.scene.cameras.main);
    this.options.createLiveObjects(loadedRoom);
    this.loadedFullRoomsById.set(room.id, loadedRoom);
    this.previewImagesByRoomId.get(room.id)?.setVisible(false);
    this.options.onBackdropObjectsChanged?.();
    this.options.onFullRoomVisibilityChanged?.();
  }

  private unloadRoomsOutsideWindow(visibleRoomIds: Set<string>, previewRoomIds: Set<string>): void {
    for (const [roomId, image] of this.previewImagesByRoomId.entries()) {
      if (visibleRoomIds.has(roomId) && previewRoomIds.has(roomId)) {
        continue;
      }

      image.destroy();
      this.previewImagesByRoomId.delete(roomId);

      const textureKey = this.previewTextureKeysByRoomId.get(roomId);
      if (textureKey && this.options.scene.textures.exists(textureKey)) {
        this.options.scene.textures.remove(textureKey);
      }
      this.previewTextureKeysByRoomId.delete(roomId);
    }

    for (const roomId of Array.from(this.roomSnapshotsById.keys())) {
      if (!visibleRoomIds.has(roomId) && !this.loadedFullRoomsById.has(roomId)) {
        this.roomSnapshotsById.delete(roomId);
      }
    }

    this.options.onBackdropObjectsChanged?.();
  }

  private unloadFullRoomsOutsideStream(fullRoomIds: Set<string>): void {
    for (const roomId of Array.from(this.loadedFullRoomsById.keys())) {
      if (fullRoomIds.has(roomId)) {
        continue;
      }

      this.destroyFullRoom(roomId);
      this.previewImagesByRoomId.get(roomId)?.setVisible(true);
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
    loadedRoom.terrainLayer.destroy();
    loadedRoom.map.destroy();
    loadedRoom.backgroundColorRect?.destroy();
    for (const backgroundSprite of loadedRoom.backgroundSprites) {
      backgroundSprite.sprite.destroy();
    }
    loadedRoom.image.destroy();

    if (this.options.scene.textures.exists(loadedRoom.textureKey)) {
      this.options.scene.textures.remove(loadedRoom.textureKey);
    }

    this.loadedFullRoomsById.delete(roomId);
    this.options.onBackdropObjectsChanged?.();
    this.options.onFullRoomVisibilityChanged?.();
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
