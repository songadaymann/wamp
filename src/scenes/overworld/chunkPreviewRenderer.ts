import Phaser from 'phaser';
import { resolveRoomBackground } from '../../backgrounds/model';
import {
  ensureCustomBackgroundTexture,
  getCustomBackgroundTextureKey,
} from '../../backgrounds/runtime';
import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  type LayerName,
} from '../../config';
import { type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import {
  roomToChunkCoordinates,
  type WorldChunkCoordinates,
  WORLD_CHUNK_SIZE,
} from '../../persistence/worldModel';
import {
  drawConstructionOverlay,
  drawRoomBackground,
  drawRoomObjectRangeForLayerToContext,
  drawRoomSnapshotToContext,
  drawRoomTileLayerRowsToContext,
} from '../../visuals/roomSnapshotTexture';
import { hashStringToSeed } from '../../visuals/starfield';
import { calculateChunkPreviewCrop, type ChunkPreviewCrop } from './chunkPreviewCrop';
import type {
  FrameWorkGeneration,
  FrameWorkJobHandle,
  FrameWorkJobSpec,
} from './frameWorkCoordinator';

/**
 * Minimal scene-owned scheduling surface used by chunk preview work. A
 * FrameWorkCoordinator satisfies this interface directly, while callers that
 * need Browse-mode immediate rendering can omit the hook for the legacy timer
 * path.
 */
export interface ChunkPreviewWorkScheduler {
  beginGeneration(scope: string): FrameWorkGeneration;
  enqueue(spec: FrameWorkJobSpec): FrameWorkJobHandle;
  cancelGeneration(generation: FrameWorkGeneration, reason?: string): number;
  releaseGeneration(generation: FrameWorkGeneration): boolean;
}

export interface OverworldChunkPreviewRendererOptions {
  scene: Phaser.Scene;
  getPreviewTileSize: () => number;
  getFocusCoordinates?: () => RoomCoordinates;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  isFullRoomLoaded: (roomId: string) => boolean;
  onBackdropObjectsChanged?: () => void;
  onFullRoomVisibilityChanged?: () => void;
  measurePerformance?: <T>(label: string, callback: () => T) => T;
  /**
   * When supplied, every chunk texture build stage is deferred through this
   * scheduler at preview-cosmetic priority while shouldScheduleWork permits
   * it. Omit it to preserve the immediate first Browse preview and
   * timer-driven fallback behavior.
   */
  workScheduler?: ChunkPreviewWorkScheduler;
  /** Dynamically keeps Browse rendering on the immediate/timer fallback. */
  shouldScheduleWork?: () => boolean;
  /** Test seam for creating a detached, unregistered preview canvas. */
  createCanvas?: () => HTMLCanvasElement;
}

interface ChunkPreviewState {
  chunkId: string;
  chunkCoordinates: WorldChunkCoordinates;
  rooms: RoomSnapshot[];
}

interface CachedChunkPreviewTexture {
  textureKey: string;
  chunkId: string;
  contentSignature: string;
  previewTileSize: number;
  crop: ChunkPreviewCrop;
  pixelCount: number;
  lastUsedAt: number;
}

interface PendingChunkPreviewBuild {
  textureKey: string;
  chunkId: string;
  contentSignature: string;
  chunkCoordinates: WorldChunkCoordinates;
  rooms: RoomSnapshot[];
  previewTileSize: number;
  crop: ChunkPreviewCrop;
  generation?: FrameWorkGeneration;
  canvas?: HTMLCanvasElement;
  context?: CanvasRenderingContext2D;
  uploaded?: boolean;
  ownsUploadedTexture?: boolean;
  scheduledCursor?: ScheduledChunkPreviewCursor;
}

type ScheduledChunkPreviewStage =
  | 'prepare-canvas'
  | 'room-background'
  | 'layer-tiles'
  | 'layer-objects'
  | 'room-overlay'
  | 'upload-texture'
  | 'commit-image';

interface ScheduledChunkPreviewCursor {
  stage: ScheduledChunkPreviewStage;
  roomIndex: number;
  layerIndex: number;
  nextRow: number;
  nextObjectIndex: number;
}
const CHUNK_PREVIEW_TEXTURE_CACHE_MAX_PIXELS = 32_000_000;
const CUSTOM_BACKGROUND_PREVIEW_TILE_SIZE = 4;
const DEFERRED_CHUNK_PREVIEW_BUILD_DELAY_MS = 24;
const INITIAL_IMMEDIATE_CHUNK_TEXTURE_BUILDS = 1;
const LIGHTWEIGHT_PREVIEW_LAYERS: LayerName[] = ['background', 'terrain'];
const PREVIEW_CANVAS_PREPARE_ESTIMATE_MS = 0.25;
const PREVIEW_BACKGROUND_DRAW_ESTIMATE_MS = 0.5;
const PREVIEW_TILE_BATCH_ESTIMATE_MS = 0.5;
const PREVIEW_OBJECT_BATCH_ESTIMATE_MS = 0.5;
const PREVIEW_OVERLAY_DRAW_ESTIMATE_MS = 0.25;
const PREVIEW_TEXTURE_UPLOAD_ESTIMATE_MS = 0.5;
const PREVIEW_IMAGE_COMMIT_ESTIMATE_MS = 0.25;
const PREVIEW_TILE_ROWS_PER_JOB = 1;
const PREVIEW_OBJECTS_PER_JOB = 8;

export class OverworldChunkPreviewRenderer {
  private chunkStatesByChunkId = new Map<string, ChunkPreviewState>();
  private chunkImagesByChunkId = new Map<string, Phaser.GameObjects.Image>();
  private chunkTextureKeysByChunkId = new Map<string, string>();
  private visiblePreviewRoomIds = new Set<string>();
  private pendingCustomBackgroundLoads = new Map<string, Promise<string>>();
  private cachedTexturesByKey = new Map<string, CachedChunkPreviewTexture>();
  private pendingTextureBuildsByKey = new Map<string, PendingChunkPreviewBuild>();
  private pendingTextureBuildQueue: PendingChunkPreviewBuild[] = [];
  private textureBuildTimer: number | null = null;
  private cacheClock = 0;
  private hasCompletedInitialTexturePass = false;
  private initialImmediateTextureBuildsRemaining = INITIAL_IMMEDIATE_CHUNK_TEXTURE_BUILDS;
  private customBackgroundLoadGeneration = 0;
  private readonly textureNamespace: string;

  constructor(private readonly options: OverworldChunkPreviewRendererOptions) {
    this.textureNamespace = sanitizeChunkKey(options.scene.sys.settings.key);
  }

  private measure<T>(label: string, callback: () => T): T {
    return this.options.measurePerformance
      ? this.options.measurePerformance(label, callback)
      : callback();
  }

  reset(): void {
    this.clear();
    this.chunkStatesByChunkId = new Map();
    this.visiblePreviewRoomIds = new Set();
    this.pendingCustomBackgroundLoads = new Map();
  }

  clear(): void {
    this.cancelQueuedTextureBuilds();
    for (const image of this.chunkImagesByChunkId.values()) {
      image.destroy();
    }

    const textureKeys = new Set<string>([
      ...this.chunkTextureKeysByChunkId.values(),
      ...this.cachedTexturesByKey.keys(),
    ]);
    for (const textureKey of textureKeys) {
      if (this.options.scene.textures.exists(textureKey)) {
        this.options.scene.textures.remove(textureKey);
      }
    }

    this.chunkImagesByChunkId = new Map();
    this.chunkTextureKeysByChunkId = new Map();
    this.cachedTexturesByKey = new Map();
    this.pendingTextureBuildsByKey = new Map();
    this.pendingTextureBuildQueue = [];
    this.hasCompletedInitialTexturePass = false;
    this.initialImmediateTextureBuildsRemaining = INITIAL_IMMEDIATE_CHUNK_TEXTURE_BUILDS;
    this.visiblePreviewRoomIds = new Set();
    this.pendingCustomBackgroundLoads = new Map();
    this.customBackgroundLoadGeneration += 1;
  }

  getPreviewImages(): Phaser.GameObjects.Image[] {
    return Array.from(this.chunkImagesByChunkId.values());
  }

  getLoadedPreviewRoomCount(): number {
    return this.visiblePreviewRoomIds.size;
  }

  getLoadedPreviewChunkCount(): number {
    return this.chunkImagesByChunkId.size;
  }

  getActivePreviewTileSize(): number {
    return this.getPreviewTileSize();
  }

  getApproximatePreviewTexturePixels(): number {
    let cachedPixelCount = 0;
    for (const textureKey of new Set(this.chunkTextureKeysByChunkId.values())) {
      cachedPixelCount += this.cachedTexturesByKey.get(textureKey)?.pixelCount ?? 0;
    }
    if (cachedPixelCount > 0) {
      return cachedPixelCount;
    }

    const tileSize = this.getPreviewTileSize();
    const chunkTextureWidth = WORLD_CHUNK_SIZE * ROOM_WIDTH * tileSize;
    const chunkTextureHeight = WORLD_CHUNK_SIZE * ROOM_HEIGHT * tileSize;
    return this.chunkImagesByChunkId.size * chunkTextureWidth * chunkTextureHeight;
  }

  hasPreviewForRoom(roomId: string): boolean {
    return this.visiblePreviewRoomIds.has(roomId);
  }

  getPendingTextureBuildCount(): number {
    return this.pendingTextureBuildsByKey.size;
  }

  flushPendingTextureBuilds(): number {
    // A scheduled renderer must never bypass the scene-owned frame budget,
    // even when a diagnostic caller asks to flush. The coordinator will drain
    // these jobs once critical simulation leaves headroom.
    if (this.shouldSchedulePreviewWork()) {
      return 0;
    }

    // If the mode changed from Play to Browse before scheduled work drained,
    // reclaim those requests for the synchronous diagnostic flush rather than
    // leaving coordinator-owned jobs stranded.
    for (const request of Array.from(this.pendingTextureBuildsByKey.values())) {
      if (!request.generation) continue;
      const stillCurrent = this.isTextureBuildRequestCurrent(request);
      this.cancelPendingTextureBuild(request, 'preview-scheduler-disabled');
      if (!stillCurrent) continue;
      request.generation = undefined;
      request.uploaded = undefined;
      request.ownsUploadedTexture = undefined;
      request.scheduledCursor = undefined;
      this.pendingTextureBuildsByKey.set(request.textureKey, request);
      this.pendingTextureBuildQueue.push(request);
    }

    if (this.textureBuildTimer !== null) {
      window.clearTimeout(this.textureBuildTimer);
      this.textureBuildTimer = null;
    }

    let processedCount = 0;
    while (this.pendingTextureBuildQueue.length > 0) {
      const request = this.pendingTextureBuildQueue.shift() ?? null;
      if (!request) {
        continue;
      }

      this.pendingTextureBuildsByKey.delete(request.textureKey);
      if (!this.isTextureBuildRequestCurrent(request)) {
        continue;
      }

      if (!this.options.scene.textures.exists(request.textureKey)) {
        const built = this.buildChunkTexture(
          request.textureKey,
          request.chunkCoordinates,
          request.rooms,
          request.previewTileSize,
          request.crop,
        );
        if (built) {
          this.recordCachedTexture(
            request.textureKey,
            request.chunkId,
            request.contentSignature,
            request.previewTileSize,
            request.crop,
          );
        }
      }
      processedCount += 1;
    }

    this.syncChunkImages();
    return processedCount;
  }

  renderChunkPreviews(previewRooms: Iterable<RoomSnapshot>): void {
    this.chunkStatesByChunkId = groupChunkPreviewRooms(previewRooms);
    this.syncChunkImages();
  }

  mergeChunkPreviews(previewRooms: Iterable<RoomSnapshot>): void {
    const incomingStates = groupChunkPreviewRooms(previewRooms);
    for (const [chunkId, incomingState] of incomingStates) {
      const existingState = this.chunkStatesByChunkId.get(chunkId);
      if (!existingState) {
        this.chunkStatesByChunkId.set(chunkId, incomingState);
        continue;
      }

      const roomsById = new Map(existingState.rooms.map((room) => [room.id, room]));
      for (const room of incomingState.rooms) {
        roomsById.set(room.id, room);
      }
      this.chunkStatesByChunkId.set(chunkId, {
        ...existingState,
        rooms: Array.from(roomsById.values()).sort(compareRoomSnapshots),
      });
    }
    this.syncChunkImages();
  }

  syncPreviewVisibility(): void {
    this.syncChunkImages();
    this.options.onFullRoomVisibilityChanged?.();
  }

  invalidateRoomPreview(roomId: string): void {
    let touched = false;

    for (const [chunkId, chunkState] of Array.from(this.chunkStatesByChunkId.entries())) {
      const nextRooms = chunkState.rooms.filter((room) => room.id !== roomId);
      if (nextRooms.length === chunkState.rooms.length) {
        continue;
      }

      touched = true;
      if (nextRooms.length === 0) {
        this.chunkStatesByChunkId.delete(chunkId);
      } else {
        this.chunkStatesByChunkId.set(chunkId, {
          ...chunkState,
          rooms: nextRooms,
        });
      }
    }

    if (touched) {
      this.syncChunkImages();
      this.options.onFullRoomVisibilityChanged?.();
    }
  }

  unloadOutsideWindow(visibleRoomIds: Set<string>, previewRoomIds: Set<string>): void {
    for (const [chunkId, chunkState] of Array.from(this.chunkStatesByChunkId.entries())) {
      const nextRooms = chunkState.rooms.filter(
        (room) => visibleRoomIds.has(room.id) && previewRoomIds.has(room.id)
      );
      if (nextRooms.length === chunkState.rooms.length) {
        continue;
      }

      if (nextRooms.length === 0) {
        this.chunkStatesByChunkId.delete(chunkId);
      } else {
        this.chunkStatesByChunkId.set(chunkId, {
          ...chunkState,
          rooms: nextRooms,
        });
      }
    }

    this.syncChunkImages();
  }

  private syncChunkImages(): void {
    const nextVisiblePreviewRoomIds = new Set<string>();
    const activeChunkIds = new Set(this.chunkStatesByChunkId.keys());

    for (const [chunkId, chunkState] of this.getPrioritizedChunkStates()) {
      const visibleRooms = this.getVisibleRoomsForChunk(chunkState);

      if (visibleRooms.length === 0) {
        this.destroyChunkPreview(chunkId);
        continue;
      }

      for (const room of visibleRooms) {
        nextVisiblePreviewRoomIds.add(room.id);
      }

      this.ensureChunkPreview(chunkState.chunkCoordinates, visibleRooms);
    }

    for (const chunkId of Array.from(this.chunkImagesByChunkId.keys())) {
      if (!activeChunkIds.has(chunkId)) {
        this.destroyChunkPreview(chunkId);
      }
    }

    this.visiblePreviewRoomIds = nextVisiblePreviewRoomIds;
    this.hasCompletedInitialTexturePass = true;
    this.pruneTextureCache();
    this.options.onBackdropObjectsChanged?.();
  }

  private ensureChunkPreview(
    chunkCoordinates: WorldChunkCoordinates,
    rooms: RoomSnapshot[]
  ): void {
    const chunkId = `${chunkCoordinates.x},${chunkCoordinates.y}`;
    const previewTileSize = this.getPreviewTileSize();
    const crop = calculateChunkPreviewCrop(
      chunkCoordinates,
      rooms.map((room) => room.coordinates),
    );
    if (!crop) return;
    const contentSignature = this.buildChunkContentSignature(chunkId, rooms);
    const textureKey = this.buildChunkTextureKey(chunkId, contentSignature, previewTileSize);
    const schedulePreviewWork = this.shouldSchedulePreviewWork();

    if (this.shouldDrawCustomBackgroundImages(previewTileSize) && !schedulePreviewWork) {
      this.ensureCustomBackgroundsForChunk(rooms);
    }

    let displayTextureKey =
      this.findReusableTextureKey(chunkId, contentSignature, previewTileSize) ?? textureKey;
    const image = this.chunkImagesByChunkId.get(chunkId) ?? null;

    if (!this.isTextureReadyForDisplay(displayTextureKey)) {
      if (
        schedulePreviewWork
        || this.shouldDeferTextureBuild()
        || this.pendingTextureBuildsByKey.has(textureKey)
      ) {
        this.queueTextureBuild({
          textureKey,
          chunkId,
          contentSignature,
          chunkCoordinates: { ...chunkCoordinates },
          rooms: rooms.slice(),
          previewTileSize,
          crop,
        });
        if (image) {
          const displayedTextureKey = this.chunkTextureKeysByChunkId.get(chunkId) ?? null;
          const displayedCrop = displayedTextureKey
            ? this.cachedTexturesByKey.get(displayedTextureKey)?.crop ?? null
            : null;
          if (displayedCrop) this.positionChunkImage(image, chunkCoordinates, displayedCrop);
        }
        return;
      }

      displayTextureKey = textureKey;
      if (!this.options.scene.textures.exists(textureKey)) {
        this.markImmediateTextureBuild();
        const built = this.buildChunkTexture(
          textureKey,
          chunkCoordinates,
          rooms,
          previewTileSize,
          crop,
        );
        if (!built) {
          return;
        }
      }
      this.recordCachedTexture(textureKey, chunkId, contentSignature, previewTileSize, crop);
    } else if (displayTextureKey === textureKey && !this.cachedTexturesByKey.has(textureKey)) {
      this.recordCachedTexture(textureKey, chunkId, contentSignature, previewTileSize, crop);
    }
    this.touchCachedTexture(displayTextureKey);
    const displayCrop = this.cachedTexturesByKey.get(displayTextureKey)?.crop ?? crop;

    if (!image) {
      const nextImage = this.options.scene.add.image(0, 0, displayTextureKey);
      nextImage.setOrigin(0, 0);
      nextImage.setDepth(0);
      this.chunkImagesByChunkId.set(chunkId, nextImage);
      this.positionChunkImage(nextImage, chunkCoordinates, displayCrop);
    } else {
      image.setTexture(displayTextureKey);
      this.positionChunkImage(image, chunkCoordinates, displayCrop);
    }
    this.chunkTextureKeysByChunkId.set(chunkId, displayTextureKey);
  }

  private positionChunkImage(
    image: Phaser.GameObjects.Image,
    chunkCoordinates: WorldChunkCoordinates,
    crop: ChunkPreviewCrop,
  ): void {
    const origin = this.options.getRoomOrigin({
      x: chunkCoordinates.x * WORLD_CHUNK_SIZE + crop.minLocalRoomX,
      y: chunkCoordinates.y * WORLD_CHUNK_SIZE + crop.minLocalRoomY,
    });
    image.setPosition(origin.x, origin.y);
    image.setDisplaySize(
      crop.roomColumns * ROOM_PX_WIDTH,
      crop.roomRows * ROOM_PX_HEIGHT,
    );
    image.setVisible(true);
  }

  private ensureCustomBackgroundsForChunk(rooms: RoomSnapshot[]): void {
    const missingBackgroundIds = new Set<string>();
    for (const room of rooms) {
      const backgroundId = getCustomBackgroundId(room);
      if (
        backgroundId &&
        !this.options.scene.textures.exists(getCustomBackgroundTextureKey(backgroundId))
      ) {
        missingBackgroundIds.add(backgroundId);
      }
    }

    for (const id of missingBackgroundIds) {
      if (this.pendingCustomBackgroundLoads.has(id)) {
        continue;
      }

      const generation = this.customBackgroundLoadGeneration;
      const load = ensureCustomBackgroundTexture(this.options.scene, id)
        .then((key) => {
          this.pendingCustomBackgroundLoads.delete(id);
          if (generation === this.customBackgroundLoadGeneration) {
            this.rebuildChunksUsingCustomBackground(id);
          }
          return key;
        })
        .catch((error: unknown) => {
          this.pendingCustomBackgroundLoads.delete(id);
          console.warn('Failed to load custom background for overworld preview.', id, error);
          return '';
        });
      this.pendingCustomBackgroundLoads.set(id, load);
    }
  }

  private rebuildChunksUsingCustomBackground(backgroundId: string): void {
    const chunkIdsToRebuild: string[] = [];
    for (const [chunkId, chunkState] of this.chunkStatesByChunkId.entries()) {
      if (chunkState.rooms.some((room) => getCustomBackgroundId(room) === backgroundId)) {
        chunkIdsToRebuild.push(chunkId);
      }
    }

    for (const chunkId of chunkIdsToRebuild) {
      this.destroyChunkPreview(chunkId);
      this.destroyCachedTexturesForChunk(chunkId);
    }

    if (chunkIdsToRebuild.length > 0) {
      this.syncChunkImages();
      this.options.onFullRoomVisibilityChanged?.();
    }
  }

  private destroyChunkPreview(chunkId: string): void {
    for (const request of Array.from(this.pendingTextureBuildsByKey.values())) {
      if (request.chunkId === chunkId) {
        this.cancelPendingTextureBuild(request, 'preview-chunk-no-longer-visible');
      }
    }

    const image = this.chunkImagesByChunkId.get(chunkId);
    if (image) {
      image.destroy();
      this.chunkImagesByChunkId.delete(chunkId);
    }

    const textureKey = this.chunkTextureKeysByChunkId.get(chunkId);
    if (textureKey) {
      this.touchCachedTexture(textureKey);
    }
    this.chunkTextureKeysByChunkId.delete(chunkId);
  }

  private buildChunkTexture(
    textureKey: string,
    chunkCoordinates: WorldChunkCoordinates,
    rooms: RoomSnapshot[],
    previewTileSize: number,
    crop: ChunkPreviewCrop,
  ): boolean {
    return this.measure('stream.buildChunkPreviewTexture', () => {
      const canvasTexture = this.options.scene.textures.createCanvas(
        textureKey,
        crop.roomColumns * ROOM_WIDTH * previewTileSize,
        crop.roomRows * ROOM_HEIGHT * previewTileSize,
      );
      if (!canvasTexture) {
        return false;
      }

      const canvas = canvasTexture.getSourceImage() as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) {
        this.options.scene.textures.remove(textureKey);
        return false;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;

      for (const room of rooms) {
        this.drawChunkPreviewRoom(
          context,
          chunkCoordinates,
          room,
          previewTileSize,
          crop,
        );
      }

      canvasTexture.refresh();
      return true;
    });
  }

  private drawChunkPreviewRoom(
    context: CanvasRenderingContext2D,
    chunkCoordinates: WorldChunkCoordinates,
    room: RoomSnapshot,
    previewTileSize: number,
    crop: ChunkPreviewCrop,
  ): void {
    const localRoomX = room.coordinates.x - chunkCoordinates.x * WORLD_CHUNK_SIZE;
    const localRoomY = room.coordinates.y - chunkCoordinates.y * WORLD_CHUNK_SIZE;
    drawRoomSnapshotToContext(
      this.options.scene,
      context,
      room,
      previewTileSize,
      {
        offsetX: (localRoomX - crop.minLocalRoomX) * ROOM_WIDTH * previewTileSize,
        offsetY: (localRoomY - crop.minLocalRoomY) * ROOM_HEIGHT * previewTileSize,
        includeObjects: this.shouldDrawDetailedRoomPreview(room, previewTileSize),
        includedLayers: this.getPreviewLayers(room, previewTileSize),
        showConstructionOverlay: room.status !== 'published',
        constructionLabel: 'BUILDING',
        skipCustomBackgroundImages: !this.shouldDrawCustomBackgroundImages(previewTileSize),
      },
    );
  }

  private buildChunkTextureKey(
    chunkId: string,
    contentSignature: string,
    previewTileSize: number,
  ): string {
    return `chunk-preview-${this.textureNamespace}-${sanitizeChunkKey(chunkId)}-${previewTileSize}-${contentSignature}`;
  }

  private buildChunkContentSignature(chunkId: string, rooms: RoomSnapshot[]): string {
    const signature = rooms
      .map((room) => {
        const customBackgroundId = getCustomBackgroundId(room);
        const customBackgroundResident = customBackgroundId
          ? Number(this.options.scene.textures.exists(
              getCustomBackgroundTextureKey(customBackgroundId),
            ))
          : 0;
        const customSpriteResidency = (room.customSprites ?? [])
          .map((sprite) => (
            `${sprite.id}:${Number(this.options.scene.textures.exists(`custom_sprite:${sprite.id}`))}`
          ))
          .join(',');
        return [
          room.id,
          room.version,
          room.updatedAt,
          room.status,
          `preview-data:${hasDetailedPreviewTileData(room) ? 'detailed' : 'lightweight'}`,
          `background-resident:${customBackgroundResident}`,
          `sprites-resident:${customSpriteResidency}`,
        ].join(':');
      })
      .join('|');
    return hashStringToSeed(`${chunkId}|${signature}`).toString(36);
  }

  private findReusableTextureKey(
    chunkId: string,
    contentSignature: string,
    requestedTileSize: number,
  ): string | null {
    let best: CachedChunkPreviewTexture | null = null;

    for (const [textureKey, record] of Array.from(this.cachedTexturesByKey.entries())) {
      if (!this.options.scene.textures.exists(textureKey)) {
        this.cachedTexturesByKey.delete(textureKey);
        continue;
      }

      if (record.chunkId !== chunkId || record.contentSignature !== contentSignature) {
        continue;
      }

      if (record.previewTileSize < requestedTileSize) {
        continue;
      }

      if (!best || record.previewTileSize < best.previewTileSize) {
        best = record;
      }
    }

    return best?.textureKey ?? null;
  }

  private isTextureReadyForDisplay(textureKey: string): boolean {
    if (!this.options.scene.textures.exists(textureKey)) return false;
    const pending = this.pendingTextureBuildsByKey.get(textureKey);
    return !pending || this.cachedTexturesByKey.has(textureKey);
  }

  private recordCachedTexture(
    textureKey: string,
    chunkId: string,
    contentSignature: string,
    previewTileSize: number,
    crop: ChunkPreviewCrop,
  ): void {
    this.cachedTexturesByKey.set(textureKey, {
      textureKey,
      chunkId,
      contentSignature,
      previewTileSize,
      crop: { ...crop },
      pixelCount: this.getChunkTexturePixelCount(previewTileSize, crop),
      lastUsedAt: ++this.cacheClock,
    });
  }

  private touchCachedTexture(textureKey: string): void {
    const record = this.cachedTexturesByKey.get(textureKey);
    if (record) {
      record.lastUsedAt = ++this.cacheClock;
    }
  }

  private pruneTextureCache(): void {
    const activeTextureKeys = new Set(this.chunkTextureKeysByChunkId.values());
    let totalPixels = 0;

    for (const [textureKey, record] of Array.from(this.cachedTexturesByKey.entries())) {
      if (!this.options.scene.textures.exists(textureKey)) {
        this.cachedTexturesByKey.delete(textureKey);
        continue;
      }
      totalPixels += record.pixelCount;
    }

    if (totalPixels <= CHUNK_PREVIEW_TEXTURE_CACHE_MAX_PIXELS) {
      return;
    }

    const evictableRecords = Array.from(this.cachedTexturesByKey.values())
      .filter((record) => !activeTextureKeys.has(record.textureKey))
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

    for (const record of evictableRecords) {
      if (totalPixels <= CHUNK_PREVIEW_TEXTURE_CACHE_MAX_PIXELS) {
        break;
      }
      this.removeCachedTexture(record.textureKey);
      totalPixels -= record.pixelCount;
    }
  }

  private destroyCachedTexturesForChunk(chunkId: string): void {
    for (const record of Array.from(this.cachedTexturesByKey.values())) {
      if (record.chunkId === chunkId) {
        this.removeCachedTexture(record.textureKey);
      }
    }
  }

  private removeCachedTexture(textureKey: string): void {
    this.cachedTexturesByKey.delete(textureKey);
    if (this.options.scene.textures.exists(textureKey)) {
      this.options.scene.textures.remove(textureKey);
    }
  }

  private getChunkTexturePixelCount(
    previewTileSize: number,
    crop: ChunkPreviewCrop,
  ): number {
    return (
      crop.roomColumns *
      ROOM_WIDTH *
      previewTileSize *
      crop.roomRows *
      ROOM_HEIGHT *
      previewTileSize
    );
  }

  private getVisibleRoomsForChunk(chunkState: ChunkPreviewState): RoomSnapshot[] {
    return chunkState.rooms
      .filter((room) => !this.options.isFullRoomLoaded(room.id))
      .slice()
      .sort(compareRoomSnapshots);
  }

  private shouldDeferTextureBuild(): boolean {
    return (
      this.hasCompletedInitialTexturePass ||
      this.initialImmediateTextureBuildsRemaining <= 0
    );
  }

  private markImmediateTextureBuild(): void {
    if (!this.hasCompletedInitialTexturePass) {
      this.initialImmediateTextureBuildsRemaining = Math.max(
        0,
        this.initialImmediateTextureBuildsRemaining - 1,
      );
    }
  }

  private queueTextureBuild(request: PendingChunkPreviewBuild): void {
    const sameTexturePending = this.pendingTextureBuildsByKey.get(request.textureKey);
    if (sameTexturePending) {
      if (sameTexturePending.generation && !this.shouldSchedulePreviewWork()) {
        this.cancelPendingTextureBuild(sameTexturePending, 'preview-scheduler-disabled');
      } else {
        return;
      }
    }
    if (this.options.scene.textures.exists(request.textureKey)) {
      return;
    }

    for (const pending of Array.from(this.pendingTextureBuildsByKey.values())) {
      if (pending.chunkId === request.chunkId) {
        this.cancelPendingTextureBuild(pending, 'superseded-preview-texture');
      }
    }
    this.pendingTextureBuildsByKey.set(request.textureKey, request);

    if (this.shouldSchedulePreviewWork()) {
      this.scheduleTextureBuild(request);
      return;
    }

    this.pendingTextureBuildQueue.push(request);
    this.scheduleNextTextureBuild();
  }

  private scheduleTextureBuild(request: PendingChunkPreviewBuild): void {
    const scheduler = this.options.workScheduler;
    if (!scheduler) return;

    request.generation = scheduler.beginGeneration(
      `chunk-preview:${this.textureNamespace}:${request.chunkId}`,
    );
    request.scheduledCursor = {
      stage: 'prepare-canvas',
      roomIndex: 0,
      layerIndex: 0,
      nextRow: 0,
      nextObjectIndex: 0,
    };
    this.enqueueNextScheduledTextureStage(request);
  }

  private enqueueNextScheduledTextureStage(request: PendingChunkPreviewBuild): void {
    const cursor = request.scheduledCursor;
    if (!cursor) return;

    const room = request.rooms[cursor.roomIndex] ?? null;
    const layers = room
      ? this.getPreviewLayers(room, request.previewTileSize) ?? LAYER_NAMES
      : LIGHTWEIGHT_PREVIEW_LAYERS;
    const layer = layers[cursor.layerIndex] ?? null;
    switch (cursor.stage) {
      case 'prepare-canvas':
        this.enqueueScheduledTextureStage(
          request,
          'prepare-canvas',
          'cpu',
          PREVIEW_CANVAS_PREPARE_ESTIMATE_MS,
          () => this.prepareScheduledChunkCanvas(request),
        );
        return;
      case 'room-background':
        if (!room) {
          this.moveScheduledCursorToUpload(request);
          this.enqueueNextScheduledTextureStage(request);
          return;
        }
        this.enqueueScheduledTextureStage(
          request,
          `draw-background-${cursor.roomIndex + 1}-of-${request.rooms.length}`,
          'cpu',
          PREVIEW_BACKGROUND_DRAW_ESTIMATE_MS,
          () => this.drawScheduledRoomBackground(request, room),
        );
        return;
      case 'layer-tiles': {
        if (!room || !layer) {
          this.advanceScheduledRoom(request);
          this.enqueueNextScheduledTextureStage(request);
          return;
        }
        const endRow = Math.min(ROOM_HEIGHT, cursor.nextRow + PREVIEW_TILE_ROWS_PER_JOB);
        this.enqueueScheduledTextureStage(
          request,
          `draw-${layer}-rows-${cursor.nextRow}-${endRow}-room-${cursor.roomIndex + 1}`,
          'cpu',
          PREVIEW_TILE_BATCH_ESTIMATE_MS,
          () => this.drawScheduledRoomTileRows(request, room, layer, endRow),
        );
        return;
      }
      case 'layer-objects': {
        if (!room || !layer) {
          this.advanceScheduledRoom(request);
          this.enqueueNextScheduledTextureStage(request);
          return;
        }
        const endObjectIndex = Math.min(
          room.placedObjects.length,
          cursor.nextObjectIndex + PREVIEW_OBJECTS_PER_JOB,
        );
        this.enqueueScheduledTextureStage(
          request,
          `draw-${layer}-objects-${cursor.nextObjectIndex}-${endObjectIndex}-room-${cursor.roomIndex + 1}`,
          'cpu',
          PREVIEW_OBJECT_BATCH_ESTIMATE_MS,
          () => this.drawScheduledRoomObjects(request, room, layer, endObjectIndex),
        );
        return;
      }
      case 'room-overlay':
        if (!room) {
          this.moveScheduledCursorToUpload(request);
          this.enqueueNextScheduledTextureStage(request);
          return;
        }
        this.enqueueScheduledTextureStage(
          request,
          `draw-overlay-room-${cursor.roomIndex + 1}`,
          'cpu',
          PREVIEW_OVERLAY_DRAW_ESTIMATE_MS,
          () => this.drawScheduledRoomOverlay(request, room),
        );
        return;
      case 'upload-texture':
        this.enqueueScheduledTextureStage(
          request,
          'upload-texture',
          'gpu-upload',
          PREVIEW_TEXTURE_UPLOAD_ESTIMATE_MS,
          () => this.uploadScheduledChunkTexture(request),
        );
        return;
      case 'commit-image':
        this.enqueueScheduledTextureStage(
          request,
          'commit-image',
          'cpu',
          PREVIEW_IMAGE_COMMIT_ESTIMATE_MS,
          () => this.commitScheduledChunkTexture(request),
        );
    }
  }

  private enqueueScheduledTextureStage(
    request: PendingChunkPreviewBuild,
    stage: string,
    costKind: 'cpu' | 'gpu-upload',
    estimatedCostMs: number,
    execute: () => void,
  ): void {
    const scheduler = this.options.workScheduler;
    const generation = request.generation;
    if (!scheduler || !generation) return;

    scheduler.enqueue({
      label: `preview.${stage}:${request.chunkId}`,
      priority: 'preview-cosmetic',
      costKind,
      estimatedCostMs,
      generation,
      execute: () => {
        if (!this.isScheduledTextureBuildCurrent(request)) {
          this.cancelPendingTextureBuild(request, 'stale-preview-texture');
          return;
        }
        try {
          execute();
          if (this.isScheduledTextureBuildCurrent(request)) {
            this.enqueueNextScheduledTextureStage(request);
          }
        } catch (error) {
          this.cancelPendingTextureBuild(request, 'preview-texture-stage-failed');
          throw error;
        }
      },
    });
  }

  private prepareScheduledChunkCanvas(request: PendingChunkPreviewBuild): void {
    if (this.options.scene.textures.exists(request.textureKey)) {
      request.uploaded = true;
      request.ownsUploadedTexture = false;
      request.scheduledCursor = {
        ...request.scheduledCursor!,
        stage: 'commit-image',
      };
      return;
    }

    const canvas = this.options.createCanvas?.() ?? document.createElement('canvas');
    canvas.width = request.crop.roomColumns * ROOM_WIDTH * request.previewTileSize;
    canvas.height = request.crop.roomRows * ROOM_HEIGHT * request.previewTileSize;
    const context = canvas.getContext('2d');
    if (!context) {
      canvas.width = 0;
      canvas.height = 0;
      this.cancelPendingTextureBuild(request, 'preview-canvas-context-missing');
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    request.canvas = canvas;
    request.context = context;
    request.scheduledCursor = {
      ...request.scheduledCursor!,
      stage: request.rooms.length > 0 ? 'room-background' : 'upload-texture',
    };
  }

  private drawScheduledRoomBackground(
    request: PendingChunkPreviewBuild,
    room: RoomSnapshot,
  ): void {
    const context = this.requireScheduledPreviewContext(request);
    if (!context) return;
    const draw = this.getScheduledRoomDrawRect(request, room);
    this.measure('stream.drawChunkPreviewBackground', () => {
      this.withScheduledRoomClip(context, draw, () => {
        drawRoomBackground(
          this.options.scene,
          context,
          room,
          draw.width,
          draw.height,
          draw.offsetX,
          draw.offsetY,
          false,
        );
      });
    });
    request.scheduledCursor = {
      ...request.scheduledCursor!,
      stage: 'layer-tiles',
      layerIndex: 0,
      nextRow: 0,
      nextObjectIndex: 0,
    };
  }

  private drawScheduledRoomTileRows(
    request: PendingChunkPreviewBuild,
    room: RoomSnapshot,
    layer: LayerName,
    endRow: number,
  ): void {
    const context = this.requireScheduledPreviewContext(request);
    if (!context) return;
    const cursor = request.scheduledCursor!;
    const draw = this.getScheduledRoomDrawRect(request, room);
    this.measure('stream.drawChunkPreviewTileRows', () => {
      this.withScheduledRoomClip(context, draw, () => {
        drawRoomTileLayerRowsToContext(
          this.options.scene,
          context,
          room,
          request.previewTileSize,
          layer,
          cursor.nextRow,
          endRow,
          draw.offsetX,
          draw.offsetY,
        );
      });
    });
    cursor.nextRow = endRow;
    if (endRow < ROOM_HEIGHT) return;
    if (
      this.shouldDrawDetailedRoomPreview(room, request.previewTileSize)
      && room.placedObjects.length > 0
    ) {
      cursor.stage = 'layer-objects';
      cursor.nextObjectIndex = 0;
      return;
    }
    this.advanceScheduledLayer(request, room);
  }

  private drawScheduledRoomObjects(
    request: PendingChunkPreviewBuild,
    room: RoomSnapshot,
    layer: LayerName,
    endObjectIndex: number,
  ): void {
    const context = this.requireScheduledPreviewContext(request);
    if (!context) return;
    const cursor = request.scheduledCursor!;
    const draw = this.getScheduledRoomDrawRect(request, room);
    this.measure('stream.drawChunkPreviewObjects', () => {
      this.withScheduledRoomClip(context, draw, () => {
        drawRoomObjectRangeForLayerToContext(
          this.options.scene,
          context,
          room,
          request.previewTileSize,
          layer,
          cursor.nextObjectIndex,
          endObjectIndex,
          draw.offsetX,
          draw.offsetY,
          { ensureCustomSpriteTextures: false },
        );
      });
    });
    cursor.nextObjectIndex = endObjectIndex;
    if (endObjectIndex < room.placedObjects.length) return;
    this.advanceScheduledLayer(request, room);
  }

  private drawScheduledRoomOverlay(
    request: PendingChunkPreviewBuild,
    room: RoomSnapshot,
  ): void {
    const context = this.requireScheduledPreviewContext(request);
    if (!context) return;
    const draw = this.getScheduledRoomDrawRect(request, room);
    this.measure('stream.drawChunkPreviewOverlay', () => {
      this.withScheduledRoomClip(context, draw, () => {
        drawConstructionOverlay(
          context,
          draw.width,
          draw.height,
          draw.offsetX,
          draw.offsetY,
          'BUILDING',
        );
      });
    });
    this.advanceScheduledRoom(request);
  }

  private advanceScheduledLayer(
    request: PendingChunkPreviewBuild,
    room: RoomSnapshot,
  ): void {
    const cursor = request.scheduledCursor!;
    const layers = this.getPreviewLayers(room, request.previewTileSize) ?? LAYER_NAMES;
    cursor.layerIndex += 1;
    cursor.nextRow = 0;
    cursor.nextObjectIndex = 0;
    if (cursor.layerIndex < layers.length) {
      cursor.stage = 'layer-tiles';
      return;
    }
    if (room.status !== 'published') {
      cursor.stage = 'room-overlay';
      return;
    }
    this.advanceScheduledRoom(request);
  }

  private advanceScheduledRoom(request: PendingChunkPreviewBuild): void {
    const cursor = request.scheduledCursor!;
    cursor.roomIndex += 1;
    cursor.layerIndex = 0;
    cursor.nextRow = 0;
    cursor.nextObjectIndex = 0;
    cursor.stage = cursor.roomIndex < request.rooms.length
      ? 'room-background'
      : 'upload-texture';
  }

  private moveScheduledCursorToUpload(request: PendingChunkPreviewBuild): void {
    request.scheduledCursor = {
      ...request.scheduledCursor!,
      stage: 'upload-texture',
    };
  }

  private requireScheduledPreviewContext(
    request: PendingChunkPreviewBuild,
  ): CanvasRenderingContext2D | null {
    if (request.uploaded) return null;
    if (!request.context) {
      this.cancelPendingTextureBuild(request, 'preview-canvas-not-ready');
      return null;
    }
    return request.context;
  }

  private getScheduledRoomDrawRect(
    request: PendingChunkPreviewBuild,
    room: RoomSnapshot,
  ): { offsetX: number; offsetY: number; width: number; height: number } {
    const localRoomX = room.coordinates.x - request.chunkCoordinates.x * WORLD_CHUNK_SIZE;
    const localRoomY = room.coordinates.y - request.chunkCoordinates.y * WORLD_CHUNK_SIZE;
    return {
      offsetX:
        (localRoomX - request.crop.minLocalRoomX) * ROOM_WIDTH * request.previewTileSize,
      offsetY:
        (localRoomY - request.crop.minLocalRoomY) * ROOM_HEIGHT * request.previewTileSize,
      width: ROOM_WIDTH * request.previewTileSize,
      height: ROOM_HEIGHT * request.previewTileSize,
    };
  }

  private withScheduledRoomClip(
    context: CanvasRenderingContext2D,
    draw: { offsetX: number; offsetY: number; width: number; height: number },
    callback: () => void,
  ): void {
    context.save();
    context.beginPath();
    context.rect(draw.offsetX, draw.offsetY, draw.width, draw.height);
    context.clip();
    try {
      callback();
    } finally {
      context.restore();
    }
  }

  private uploadScheduledChunkTexture(request: PendingChunkPreviewBuild): void {
    if (!request.uploaded) {
      if (!request.canvas) {
        this.cancelPendingTextureBuild(request, 'preview-canvas-not-ready');
        return;
      }
      if (this.options.scene.textures.exists(request.textureKey)) {
        request.uploaded = true;
        request.ownsUploadedTexture = false;
        request.canvas.width = 0;
        request.canvas.height = 0;
        request.canvas = undefined;
        request.context = undefined;
      } else {
        const canvas = request.canvas;
        this.measure('stream.uploadChunkPreviewTexture', () => {
          this.options.scene.textures.addCanvas(request.textureKey, canvas);
        });
        if (!this.options.scene.textures.exists(request.textureKey)) {
          this.cancelPendingTextureBuild(request, 'preview-texture-upload-failed');
          return;
        }
        request.uploaded = true;
        request.ownsUploadedTexture = true;
      }
    }
    request.scheduledCursor = {
      ...request.scheduledCursor!,
      stage: 'commit-image',
    };
  }

  private commitScheduledChunkTexture(request: PendingChunkPreviewBuild): void {
    if (!request.uploaded || !this.options.scene.textures.exists(request.textureKey)) {
      this.cancelPendingTextureBuild(request, 'preview-texture-not-uploaded');
      return;
    }
    this.recordCachedTexture(
      request.textureKey,
      request.chunkId,
      request.contentSignature,
      request.previewTileSize,
      request.crop,
    );
    if (this.pendingTextureBuildsByKey.get(request.textureKey) === request) {
      this.pendingTextureBuildsByKey.delete(request.textureKey);
    }
    request.canvas = undefined;
    request.context = undefined;
    request.scheduledCursor = undefined;
    this.syncChunkImages();
    const generation = request.generation;
    request.generation = undefined;
    if (generation) {
      this.options.workScheduler?.releaseGeneration(generation);
    }
  }

  private scheduleNextTextureBuild(): void {
    if (this.textureBuildTimer !== null || this.pendingTextureBuildQueue.length === 0) {
      return;
    }

    this.textureBuildTimer = window.setTimeout(() => {
      this.textureBuildTimer = null;
      this.runNextQueuedTextureBuild();
    }, DEFERRED_CHUNK_PREVIEW_BUILD_DELAY_MS);
  }

  private runNextQueuedTextureBuild(): void {
    const request = this.pendingTextureBuildQueue.shift() ?? null;
    if (!request) {
      return;
    }

    this.pendingTextureBuildsByKey.delete(request.textureKey);
    if (!this.isTextureBuildRequestCurrent(request)) {
      this.scheduleNextTextureBuild();
      return;
    }

    if (!this.options.scene.textures.exists(request.textureKey)) {
      const built = this.buildChunkTexture(
        request.textureKey,
        request.chunkCoordinates,
        request.rooms,
        request.previewTileSize,
        request.crop,
      );
      if (built) {
        this.recordCachedTexture(
          request.textureKey,
          request.chunkId,
          request.contentSignature,
          request.previewTileSize,
          request.crop,
        );
      }
    }

    this.syncChunkImages();
    this.scheduleNextTextureBuild();
  }

  private isTextureBuildRequestCurrent(request: PendingChunkPreviewBuild): boolean {
    const chunkState = this.chunkStatesByChunkId.get(request.chunkId);
    if (!chunkState) {
      return false;
    }

    const visibleRooms = this.getVisibleRoomsForChunk(chunkState);
    if (visibleRooms.length === 0) {
      return false;
    }

    return this.buildChunkContentSignature(request.chunkId, visibleRooms) === request.contentSignature;
  }

  private isScheduledTextureBuildCurrent(request: PendingChunkPreviewBuild): boolean {
    if (this.pendingTextureBuildsByKey.get(request.textureKey) !== request) return false;
    const chunkState = this.chunkStatesByChunkId.get(request.chunkId);
    return Boolean(
      chunkState
      && chunkState.rooms.some((room) => !this.options.isFullRoomLoaded(room.id)),
    );
  }

  private cancelPendingTextureBuild(
    request: PendingChunkPreviewBuild,
    reason: string,
  ): void {
    if (request.generation) {
      this.options.workScheduler?.cancelGeneration(request.generation, reason);
      request.generation = undefined;
    }
    if (this.pendingTextureBuildsByKey.get(request.textureKey) === request) {
      this.pendingTextureBuildsByKey.delete(request.textureKey);
    }
    this.pendingTextureBuildQueue = this.pendingTextureBuildQueue.filter(
      (pending) => pending !== request,
    );
    const displayedTextureKey = this.chunkTextureKeysByChunkId.get(request.chunkId) ?? null;
    const displayedImage = this.chunkImagesByChunkId.get(request.chunkId) as unknown as {
      texture?: { key?: string };
      textureKey?: string;
    } | undefined;
    const requestTextureIsDisplayed = displayedTextureKey === request.textureKey
      || displayedImage?.texture?.key === request.textureKey
      || displayedImage?.textureKey === request.textureKey;
    if (!requestTextureIsDisplayed) {
      this.cachedTexturesByKey.delete(request.textureKey);
    }
    if (
      request.ownsUploadedTexture
      && !requestTextureIsDisplayed
      && this.options.scene.textures.exists(request.textureKey)
    ) {
      this.options.scene.textures.remove(request.textureKey);
    }
    if (request.canvas && !requestTextureIsDisplayed) {
      request.canvas.width = 0;
      request.canvas.height = 0;
    }
    request.canvas = undefined;
    request.context = undefined;
    request.uploaded = undefined;
    request.ownsUploadedTexture = undefined;
    request.scheduledCursor = undefined;
  }

  private cancelQueuedTextureBuilds(): void {
    if (this.textureBuildTimer !== null) {
      window.clearTimeout(this.textureBuildTimer);
      this.textureBuildTimer = null;
    }
    for (const request of Array.from(this.pendingTextureBuildsByKey.values())) {
      this.cancelPendingTextureBuild(request, 'preview-renderer-cleared');
    }
    this.pendingTextureBuildsByKey = new Map();
    this.pendingTextureBuildQueue = [];
  }

  private getPreviewTileSize(): number {
    return Math.max(1, Math.floor(this.options.getPreviewTileSize()));
  }

  private shouldDrawCustomBackgroundImages(previewTileSize: number): boolean {
    return previewTileSize >= CUSTOM_BACKGROUND_PREVIEW_TILE_SIZE;
  }

  private shouldDrawDetailedRoomPreviews(previewTileSize: number): boolean {
    return previewTileSize >= CUSTOM_BACKGROUND_PREVIEW_TILE_SIZE;
  }

  private shouldDrawDetailedRoomPreview(
    room: RoomSnapshot,
    previewTileSize: number,
  ): boolean {
    return this.shouldDrawDetailedRoomPreviews(previewTileSize)
      && hasDetailedPreviewTileData(room);
  }

  private getPreviewLayers(
    room: RoomSnapshot,
    previewTileSize: number,
  ): LayerName[] | undefined {
    return this.shouldDrawDetailedRoomPreview(room, previewTileSize)
      ? undefined
      : LIGHTWEIGHT_PREVIEW_LAYERS;
  }

  private shouldSchedulePreviewWork(): boolean {
    return Boolean(
      this.options.workScheduler
      && (this.options.shouldScheduleWork?.() ?? true),
    );
  }

  private getPrioritizedChunkStates(): Array<[string, ChunkPreviewState]> {
    const focusCoordinates = this.options.getFocusCoordinates?.() ?? null;
    if (!focusCoordinates) {
      return Array.from(this.chunkStatesByChunkId.entries());
    }

    const focusChunkCoordinates = roomToChunkCoordinates(focusCoordinates);
    return Array.from(this.chunkStatesByChunkId.entries()).sort((left, right) => {
      const leftDistance = getChunkDistance(left[1].chunkCoordinates, focusChunkCoordinates);
      const rightDistance = getChunkDistance(right[1].chunkCoordinates, focusChunkCoordinates);
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return left[0].localeCompare(right[0]);
    });
  }
}

function sanitizeChunkKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function getCustomBackgroundId(room: RoomSnapshot): string | null {
  const resolved = resolveRoomBackground(room.background);
  return resolved.kind === 'custom' ? resolved.id : null;
}

function hasDetailedPreviewTileData(room: RoomSnapshot): boolean {
  return LAYER_NAMES.every(
    (layerName) => room.tileData[layerName]?.length >= ROOM_HEIGHT,
  );
}

function compareRoomSnapshots(a: RoomSnapshot, b: RoomSnapshot): number {
  if (a.coordinates.y !== b.coordinates.y) {
    return a.coordinates.y - b.coordinates.y;
  }

  return a.coordinates.x - b.coordinates.x;
}

function groupChunkPreviewRooms(previewRooms: Iterable<RoomSnapshot>): Map<string, ChunkPreviewState> {
  const groupedStates = new Map<string, ChunkPreviewState>();
  for (const room of previewRooms) {
    const chunkCoordinates = roomToChunkCoordinates(room.coordinates);
    const chunkId = `${chunkCoordinates.x},${chunkCoordinates.y}`;
    const existing = groupedStates.get(chunkId);
    if (existing) {
      existing.rooms.push(room);
    } else {
      groupedStates.set(chunkId, {
        chunkId,
        chunkCoordinates,
        rooms: [room],
      });
    }
  }
  for (const state of groupedStates.values()) {
    state.rooms.sort(compareRoomSnapshots);
  }
  return groupedStates;
}

function getChunkDistance(
  chunkCoordinates: WorldChunkCoordinates,
  focusChunkCoordinates: WorldChunkCoordinates,
): number {
  return Math.max(
    Math.abs(chunkCoordinates.x - focusChunkCoordinates.x),
    Math.abs(chunkCoordinates.y - focusChunkCoordinates.y),
  );
}
