import Phaser from 'phaser';
import { TILE_SIZE } from '../config/room';
import {
  CUSTOM_ROOM_TILE_ATLAS_COLUMNS,
  CUSTOM_ROOM_TILE_ATLAS_ROWS,
  CUSTOM_ROOM_TILE_FIRST_GID,
  CUSTOM_ROOM_TILE_MAX_TILES,
  CUSTOM_ROOM_TILESET_KEY_PREFIX,
  normalizeCustomRoomTileDefinitions,
  type CustomRoomTileDefinition,
} from './model';

const CUSTOM_ROOM_TILE_ATLAS_WIDTH = CUSTOM_ROOM_TILE_ATLAS_COLUMNS * TILE_SIZE;
const CUSTOM_ROOM_TILE_ATLAS_HEIGHT = CUSTOM_ROOM_TILE_ATLAS_ROWS * TILE_SIZE;

interface PreparedCustomRoomTileCanvas {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

export interface CustomRoomTileTexturePreparationSnapshot {
  readonly tileCount: number;
  readonly nextTileIndex: number;
  readonly complete: boolean;
  readonly cancelled: boolean;
  readonly committed: boolean;
  readonly committedTextureKey: string | null;
  readonly byteSize: number;
}

/**
 * Incrementally draws a normalized custom-room-tile atlas on a detached canvas.
 * Phaser does not see the canvas until `commit`, keeping every draw batch
 * cancellable and limiting the texture manager to one explicit upload.
 */
export class CustomRoomTileTexturePreparation {
  private readonly tiles: CustomRoomTileDefinition[];
  private preparedCanvas: PreparedCustomRoomTileCanvas | null = null;
  private nextTileIndex = 0;
  private cancelled = false;
  private committedTextureKey: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    customTiles: readonly CustomRoomTileDefinition[] | null | undefined,
    private readonly createCanvas: () => HTMLCanvasElement = createDetachedCanvas,
  ) {
    // Normalize and own mutable ingress once. Subsequent batches only read this
    // stable copy, even if an editor mutates its source array while we yield.
    this.tiles = normalizeCustomRoomTileDefinitions(customTiles);
  }

  runNextBatch(maxTiles: number): boolean {
    if (this.cancelled) {
      return false;
    }
    if (this.isComplete()) {
      return true;
    }

    const batchSize = normalizeBatchSize(maxTiles);
    const prepared = this.getPreparedCanvas();
    const endIndex = Math.min(this.tiles.length, this.nextTileIndex + batchSize);
    drawCustomRoomTileRangeToContext(
      prepared.context,
      this.tiles,
      this.nextTileIndex,
      endIndex,
    );
    this.nextTileIndex = endIndex;
    return this.isComplete();
  }

  commit(textureKey: string): string {
    const normalizedTextureKey = textureKey.trim();
    if (!normalizedTextureKey) {
      throw new TypeError('Custom room tile texture key must not be empty.');
    }
    if (this.cancelled) {
      throw new Error('Cancelled custom room tile textures cannot be committed.');
    }
    if (!this.isComplete()) {
      throw new Error('Custom room tile textures cannot be committed before preparation completes.');
    }
    if (this.committedTextureKey) {
      if (this.committedTextureKey !== normalizedTextureKey) {
        throw new Error('A custom room tile preparation cannot be committed under two texture keys.');
      }
      return this.committedTextureKey;
    }

    const prepared = this.getPreparedCanvas();
    if (this.scene.textures.exists(normalizedTextureKey)) {
      this.releaseDetachedCanvas(true);
      this.committedTextureKey = normalizedTextureKey;
      return normalizedTextureKey;
    }

    this.scene.textures.addCanvas(normalizedTextureKey, prepared.canvas);
    if (!this.scene.textures.exists(normalizedTextureKey)) {
      throw new Error(`Prepared custom room tile texture ${normalizedTextureKey} was not registered.`);
    }

    // The texture manager now owns the canvas. Drop only our references; zeroing
    // its dimensions would invalidate Phaser's newly registered texture source.
    this.preparedCanvas = null;
    this.committedTextureKey = normalizedTextureKey;
    return normalizedTextureKey;
  }

  cancel(): void {
    if (this.cancelled || this.committedTextureKey) {
      return;
    }
    this.cancelled = true;
    this.releaseDetachedCanvas(true);
  }

  isComplete(): boolean {
    return this.nextTileIndex >= this.tiles.length;
  }

  getSnapshot(): CustomRoomTileTexturePreparationSnapshot {
    return {
      tileCount: this.tiles.length,
      nextTileIndex: this.nextTileIndex,
      complete: this.isComplete(),
      cancelled: this.cancelled,
      committed: this.committedTextureKey !== null,
      committedTextureKey: this.committedTextureKey,
      byteSize: CUSTOM_ROOM_TILE_ATLAS_WIDTH * CUSTOM_ROOM_TILE_ATLAS_HEIGHT * 4,
    };
  }

  private getPreparedCanvas(): PreparedCustomRoomTileCanvas {
    if (this.preparedCanvas) {
      return this.preparedCanvas;
    }

    const canvas = this.createCanvas();
    canvas.width = CUSTOM_ROOM_TILE_ATLAS_WIDTH;
    canvas.height = CUSTOM_ROOM_TILE_ATLAS_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) {
      canvas.width = 0;
      canvas.height = 0;
      throw new Error('Could not create a detached custom room tile texture canvas.');
    }
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    this.preparedCanvas = { canvas, context };
    return this.preparedCanvas;
  }

  private releaseDetachedCanvas(clearPixels: boolean): void {
    if (!this.preparedCanvas) {
      return;
    }
    if (clearPixels) {
      this.preparedCanvas.canvas.width = 0;
      this.preparedCanvas.canvas.height = 0;
    }
    this.preparedCanvas = null;
  }
}

export function buildCustomRoomTileTextureKey(scope: string): string {
  return `${CUSTOM_ROOM_TILESET_KEY_PREFIX}:${sanitizeTextureKey(scope)}`;
}

export function ensureCustomRoomTileTexture(
  scene: Phaser.Scene,
  textureKey: string,
  customTiles: readonly CustomRoomTileDefinition[] | null | undefined,
): void {
  const tiles = normalizeCustomRoomTileDefinitions(customTiles);
  const width = CUSTOM_ROOM_TILE_ATLAS_WIDTH;
  const height = CUSTOM_ROOM_TILE_ATLAS_HEIGHT;
  const texture = scene.textures.exists(textureKey)
    ? scene.textures.get(textureKey) as Phaser.Textures.CanvasTexture
    : scene.textures.createCanvas(textureKey, width, height);
  if (!texture) {
    return;
  }

  if (typeof texture.setSize === 'function') {
    texture.setSize(width, height);
  }

  const canvas = texture.getSourceImage() as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  drawCustomRoomTileRangeToContext(context, tiles, 0, tiles.length);

  texture.refresh();
}

function createDetachedCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

function normalizeBatchSize(maxTiles: number): number {
  if (!Number.isFinite(maxTiles) || maxTiles <= 0) {
    throw new RangeError('Custom room tile batch size must be a positive finite number.');
  }
  return Math.max(1, Math.floor(maxTiles));
}

function drawCustomRoomTileRangeToContext(
  context: CanvasRenderingContext2D,
  tiles: readonly CustomRoomTileDefinition[],
  startIndex: number,
  endIndex: number,
): void {
  const firstIndex = Math.max(0, Math.floor(startIndex));
  const lastIndex = Math.min(
    tiles.length,
    CUSTOM_ROOM_TILE_MAX_TILES,
    Math.max(firstIndex, Math.floor(endIndex)),
  );
  for (let index = firstIndex; index < lastIndex; index += 1) {
    drawCustomRoomTileToContext(
      context,
      tiles[index],
      (index % CUSTOM_ROOM_TILE_ATLAS_COLUMNS) * TILE_SIZE,
      Math.floor(index / CUSTOM_ROOM_TILE_ATLAS_COLUMNS) * TILE_SIZE,
      TILE_SIZE,
    );
  }
}

export function drawCustomRoomTileToContext(
  context: CanvasRenderingContext2D,
  tile: CustomRoomTileDefinition,
  dx: number,
  dy: number,
  size: number,
): void {
  const cellSize = size / TILE_SIZE;
  for (let index = 0; index < tile.pixels.length; index += 1) {
    const color = tile.pixels[index];
    if (!color) {
      continue;
    }
    const x = index % TILE_SIZE;
    const y = Math.floor(index / TILE_SIZE);
    context.fillStyle = color;
    context.fillRect(
      dx + x * cellSize,
      dy + y * cellSize,
      Math.ceil(cellSize),
      Math.ceil(cellSize),
    );
  }
}

export function ensureCustomRoomTilesetForMap(
  map: Phaser.Tilemaps.Tilemap,
  textureKey: string,
): Phaser.Tilemaps.Tileset | null {
  const existing = map.tilesets.find((tileset) => tileset.name === textureKey);
  if (existing) {
    return existing;
  }

  return map.addTilesetImage(
    textureKey,
    textureKey,
    TILE_SIZE,
    TILE_SIZE,
    0,
    0,
    CUSTOM_ROOM_TILE_FIRST_GID,
  );
}

export function syncCustomRoomTilesetForLayers(
  map: Phaser.Tilemaps.Tilemap,
  layers: Iterable<Phaser.Tilemaps.TilemapLayer>,
  textureKey: string,
): void {
  const tileset = ensureCustomRoomTilesetForMap(map, textureKey);
  if (!tileset) {
    return;
  }

  for (const layer of layers) {
    const currentTilesets = Array.isArray(layer.tileset) ? layer.tileset : [];
    if (currentTilesets.some((candidate) => candidate.name === textureKey)) {
      continue;
    }
    layer.tileset = [...currentTilesets, tileset];
  }
}

function sanitizeTextureKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}
