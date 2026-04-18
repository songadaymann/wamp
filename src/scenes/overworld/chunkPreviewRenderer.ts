import Phaser from 'phaser';
import { resolveRoomBackground } from '../../backgrounds/model';
import {
  ensureCustomBackgroundTexture,
  getCustomBackgroundTextureKey,
} from '../../backgrounds/runtime';
import { ROOM_HEIGHT, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, ROOM_WIDTH } from '../../config';
import { type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import {
  roomToChunkCoordinates,
  type WorldChunkCoordinates,
  WORLD_CHUNK_SIZE,
} from '../../persistence/worldModel';
import { drawRoomSnapshotToContext } from '../../visuals/roomSnapshotTexture';
import { hashStringToSeed } from '../../visuals/starfield';

interface OverworldChunkPreviewRendererOptions {
  scene: Phaser.Scene;
  getPreviewTileSize: () => number;
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

const CHUNK_PREVIEW_WIDTH = WORLD_CHUNK_SIZE * ROOM_PX_WIDTH;
const CHUNK_PREVIEW_HEIGHT = WORLD_CHUNK_SIZE * ROOM_PX_HEIGHT;

export class OverworldChunkPreviewRenderer {
  private chunkStatesByChunkId = new Map<string, ChunkPreviewState>();
  private chunkImagesByChunkId = new Map<string, Phaser.GameObjects.Image>();
  private chunkTextureKeysByChunkId = new Map<string, string>();
  private visiblePreviewRoomIds = new Set<string>();
  private pendingCustomBackgroundLoads = new Map<string, Promise<string>>();
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
    for (const image of this.chunkImagesByChunkId.values()) {
      image.destroy();
    }

    for (const textureKey of this.chunkTextureKeysByChunkId.values()) {
      if (this.options.scene.textures.exists(textureKey)) {
        this.options.scene.textures.remove(textureKey);
      }
    }

    this.chunkImagesByChunkId = new Map();
    this.chunkTextureKeysByChunkId = new Map();
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
    const tileSize = this.getPreviewTileSize();
    const chunkTextureWidth = WORLD_CHUNK_SIZE * ROOM_WIDTH * tileSize;
    const chunkTextureHeight = WORLD_CHUNK_SIZE * ROOM_HEIGHT * tileSize;
    return this.chunkImagesByChunkId.size * chunkTextureWidth * chunkTextureHeight;
  }

  hasPreviewForRoom(roomId: string): boolean {
    return this.visiblePreviewRoomIds.has(roomId);
  }

  renderChunkPreviews(previewRooms: Iterable<RoomSnapshot>): void {
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

    this.chunkStatesByChunkId = groupedStates;
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

  unloadOutsideWindow(_visibleRoomIds: Set<string>, _previewRoomIds: Set<string>): void {
    this.syncChunkImages();
  }

  private syncChunkImages(): void {
    const nextVisiblePreviewRoomIds = new Set<string>();
    const activeChunkIds = new Set(this.chunkStatesByChunkId.keys());

    for (const [chunkId, chunkState] of this.chunkStatesByChunkId.entries()) {
      const visibleRooms = chunkState.rooms
        .filter((room) => !this.options.isFullRoomLoaded(room.id))
        .slice()
        .sort(compareRoomSnapshots);

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
    this.options.onBackdropObjectsChanged?.();
  }

  private ensureChunkPreview(
    chunkCoordinates: WorldChunkCoordinates,
    rooms: RoomSnapshot[]
  ): void {
    const chunkId = `${chunkCoordinates.x},${chunkCoordinates.y}`;
    const previewTileSize = this.getPreviewTileSize();
    const textureKey = this.buildChunkTextureKey(chunkId, rooms, previewTileSize);
    const previousTextureKey = this.chunkTextureKeysByChunkId.get(chunkId);

    this.ensureCustomBackgroundsForChunk(rooms);

    if (
      previousTextureKey &&
      previousTextureKey !== textureKey &&
      this.options.scene.textures.exists(previousTextureKey)
    ) {
      this.options.scene.textures.remove(previousTextureKey);
    }

    if (!this.options.scene.textures.exists(textureKey)) {
      this.buildChunkTexture(textureKey, chunkCoordinates, rooms, previewTileSize);
    }

    let image = this.chunkImagesByChunkId.get(chunkId) ?? null;
    if (!image) {
      image = this.options.scene.add.image(0, 0, textureKey);
      image.setOrigin(0, 0);
      image.setDepth(0);
      this.chunkImagesByChunkId.set(chunkId, image);
    } else {
      image.setTexture(textureKey);
    }

    const origin = this.options.getRoomOrigin({
      x: chunkCoordinates.x * WORLD_CHUNK_SIZE,
      y: chunkCoordinates.y * WORLD_CHUNK_SIZE,
    });
    image.setPosition(origin.x, origin.y);
    image.setDisplaySize(CHUNK_PREVIEW_WIDTH, CHUNK_PREVIEW_HEIGHT);
    image.setVisible(true);
    this.chunkTextureKeysByChunkId.set(chunkId, textureKey);
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
    if (textureKey && this.options.scene.textures.exists(textureKey)) {
      this.options.scene.textures.remove(textureKey);
    }
    this.chunkTextureKeysByChunkId.delete(chunkId);
  }

  private buildChunkTexture(
    textureKey: string,
    chunkCoordinates: WorldChunkCoordinates,
    rooms: RoomSnapshot[],
    previewTileSize: number,
  ): void {
    this.measure('stream.buildChunkPreviewTexture', () => {
      const canvasTexture = this.options.scene.textures.createCanvas(
        textureKey,
        WORLD_CHUNK_SIZE * ROOM_WIDTH * previewTileSize,
        WORLD_CHUNK_SIZE * ROOM_HEIGHT * previewTileSize,
      );
      if (!canvasTexture) {
        return;
      }

      const canvas = canvasTexture.getSourceImage() as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) {
        return;
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
            offsetX: localRoomX * ROOM_WIDTH * previewTileSize,
            offsetY: localRoomY * ROOM_HEIGHT * previewTileSize,
          }
        );
      }

      canvasTexture.refresh();
    });
  }

  private buildChunkTextureKey(
    chunkId: string,
    rooms: RoomSnapshot[],
    previewTileSize: number,
  ): string {
    const signature = rooms
      .map((room) => `${room.id}:${room.version}:${room.updatedAt}`)
      .join('|');
    const hash = hashStringToSeed(`${chunkId}|${signature}`).toString(36);
    return `chunk-preview-${this.textureNamespace}-${sanitizeChunkKey(chunkId)}-${previewTileSize}-${hash}`;
  }

  private getPreviewTileSize(): number {
    return Math.max(1, Math.floor(this.options.getPreviewTileSize()));
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
