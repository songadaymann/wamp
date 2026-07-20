import Phaser from 'phaser';
import { resolveRoomBackground } from '../../backgrounds/model';
import {
  ensureCustomBackgroundTexture,
  getCustomBackgroundTextureKey,
} from '../../backgrounds/runtime';
import {
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
import { drawRoomSnapshotToContext } from '../../visuals/roomSnapshotTexture';
import { hashStringToSeed } from '../../visuals/starfield';
import { calculateChunkPreviewCrop, type ChunkPreviewCrop } from './chunkPreviewCrop';

interface OverworldChunkPreviewRendererOptions {
  scene: Phaser.Scene;
  getPreviewTileSize: () => number;
  getFocusCoordinates?: () => RoomCoordinates;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  isFullRoomLoaded: (roomId: string) => boolean;
  onBackdropObjectsChanged?: () => void;
  onFullRoomVisibilityChanged?: () => void;
  measurePerformance?: <T>(label: string, callback: () => T) => T;
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
}
const CHUNK_PREVIEW_TEXTURE_CACHE_MAX_PIXELS = 32_000_000;
const CUSTOM_BACKGROUND_PREVIEW_TILE_SIZE = 4;
const DEFERRED_CHUNK_PREVIEW_BUILD_DELAY_MS = 24;
const INITIAL_IMMEDIATE_CHUNK_TEXTURE_BUILDS = 1;
const LIGHTWEIGHT_PREVIEW_LAYERS: LayerName[] = ['background', 'terrain'];

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
    return this.pendingTextureBuildQueue.length;
  }

  flushPendingTextureBuilds(): number {
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

    if (this.shouldDrawCustomBackgroundImages(previewTileSize)) {
      this.ensureCustomBackgroundsForChunk(rooms);
    }

    let displayTextureKey =
      this.findReusableTextureKey(chunkId, contentSignature, previewTileSize) ?? textureKey;
    const image = this.chunkImagesByChunkId.get(chunkId) ?? null;

    if (!this.options.scene.textures.exists(displayTextureKey)) {
      if (this.shouldDeferTextureBuild()) {
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
            includeObjects: this.shouldDrawDetailedRoomPreviews(previewTileSize),
            includedLayers: this.getPreviewLayers(previewTileSize),
            showConstructionOverlay: room.status !== 'published',
            constructionLabel: 'BUILDING',
            skipCustomBackgroundImages: !this.shouldDrawCustomBackgroundImages(previewTileSize),
          }
        );
      }

      canvasTexture.refresh();
      return true;
    });
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
      .map((room) => `${room.id}:${room.version}:${room.updatedAt}:${room.status}`)
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
    if (
      this.options.scene.textures.exists(request.textureKey) ||
      this.pendingTextureBuildsByKey.has(request.textureKey)
    ) {
      return;
    }

    this.pendingTextureBuildQueue = this.pendingTextureBuildQueue.filter((pending) => {
      if (pending.chunkId !== request.chunkId) {
        return true;
      }
      this.pendingTextureBuildsByKey.delete(pending.textureKey);
      return false;
    });
    this.pendingTextureBuildsByKey.set(request.textureKey, request);
    this.pendingTextureBuildQueue.push(request);
    this.scheduleNextTextureBuild();
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

  private cancelQueuedTextureBuilds(): void {
    if (this.textureBuildTimer !== null) {
      window.clearTimeout(this.textureBuildTimer);
      this.textureBuildTimer = null;
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

  private getPreviewLayers(previewTileSize: number): LayerName[] | undefined {
    return this.shouldDrawDetailedRoomPreviews(previewTileSize)
      ? undefined
      : LIGHTWEIGHT_PREVIEW_LAYERS;
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
