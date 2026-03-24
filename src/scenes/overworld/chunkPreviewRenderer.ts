import Phaser from 'phaser';
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
  previewTileSize: number;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  isFullRoomLoaded: (roomId: string) => boolean;
  onBackdropObjectsChanged?: () => void;
  onFullRoomVisibilityChanged?: () => void;
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

  constructor(private readonly options: OverworldChunkPreviewRendererOptions) {}

  reset(): void {
    this.clear();
    this.chunkStatesByChunkId = new Map();
    this.visiblePreviewRoomIds = new Set();
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
  }

  getPreviewImages(): Phaser.GameObjects.Image[] {
    return Array.from(this.chunkImagesByChunkId.values());
  }

  getLoadedPreviewRoomCount(): number {
    return this.visiblePreviewRoomIds.size;
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
    const textureKey = this.buildChunkTextureKey(chunkId, rooms);
    const previousTextureKey = this.chunkTextureKeysByChunkId.get(chunkId);

    if (
      previousTextureKey &&
      previousTextureKey !== textureKey &&
      this.options.scene.textures.exists(previousTextureKey)
    ) {
      this.options.scene.textures.remove(previousTextureKey);
    }

    if (!this.options.scene.textures.exists(textureKey)) {
      this.buildChunkTexture(textureKey, chunkCoordinates, rooms);
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
    rooms: RoomSnapshot[]
  ): void {
    const canvasTexture = this.options.scene.textures.createCanvas(
      textureKey,
      WORLD_CHUNK_SIZE * ROOM_WIDTH * this.options.previewTileSize,
      WORLD_CHUNK_SIZE * ROOM_HEIGHT * this.options.previewTileSize,
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
        this.options.previewTileSize,
        {
          offsetX: localRoomX * ROOM_WIDTH * this.options.previewTileSize,
          offsetY: localRoomY * ROOM_HEIGHT * this.options.previewTileSize,
          showConstructionOverlay: room.status !== 'published',
          constructionLabel: 'BUILDING',
        }
      );
    }

    canvasTexture.refresh();
  }

  private buildChunkTextureKey(chunkId: string, rooms: RoomSnapshot[]): string {
    const signature = rooms
      .map((room) => `${room.id}:${room.version}:${room.updatedAt}:${room.status}`)
      .join('|');
    const hash = hashStringToSeed(`${chunkId}|${signature}`).toString(36);
    return `chunk-preview-${sanitizeChunkKey(chunkId)}-${this.options.previewTileSize}-${hash}`;
  }
}

function sanitizeChunkKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function compareRoomSnapshots(a: RoomSnapshot, b: RoomSnapshot): number {
  if (a.coordinates.y !== b.coordinates.y) {
    return a.coordinates.y - b.coordinates.y;
  }

  return a.coordinates.x - b.coordinates.x;
}
