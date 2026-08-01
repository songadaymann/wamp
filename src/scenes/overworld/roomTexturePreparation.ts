import Phaser from 'phaser';

import {
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  TILE_SIZE,
  type LayerName,
} from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { drawRoomTileLayerRowsToContext } from '../../visuals/roomSnapshotTexture';

const PREPARED_LAYERS: readonly LayerName[] = ['background', 'terrain', 'foreground'];

interface PreparedCanvas {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

export interface RoomTexturePreparationSnapshot {
  layer: LayerName | null;
  nextRow: number;
  complete: boolean;
  cancelled: boolean;
  committedTextureCount: number;
  byteSize: number;
}

/** Incrementally draws full-resolution room layers before one atomic Phaser upload. */
export class RoomTexturePreparation {
  private terrain: PreparedCanvas | null = null;
  private foreground: PreparedCanvas | null = null;
  private layerIndex = 0;
  private nextRow = 0;
  private cancelled = false;
  private terrainCommitted = false;
  private foregroundCommitted = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly room: RoomSnapshot,
    private readonly createCanvas: () => HTMLCanvasElement = createDetachedCanvas,
  ) {}

  runNextBatch(maxRows: number): boolean {
    if (this.cancelled || this.isCommitted() || this.isComplete()) {
      return this.isComplete();
    }
    let remainingRows = Math.max(1, Math.floor(maxRows));
    while (remainingRows > 0 && this.layerIndex < PREPARED_LAYERS.length) {
      const layer = PREPARED_LAYERS[this.layerIndex];
      const batchRows = Math.min(remainingRows, ROOM_HEIGHT - this.nextRow);
      const target = this.getPreparedCanvas(layer);
      drawRoomTileLayerRowsToContext(
        this.scene,
        target.context,
        this.room,
        TILE_SIZE,
        layer,
        this.nextRow,
        this.nextRow + batchRows,
      );
      this.nextRow += batchRows;
      remainingRows -= batchRows;
      if (this.nextRow >= ROOM_HEIGHT) {
        this.layerIndex += 1;
        this.nextRow = 0;
      }
    }
    return this.isComplete();
  }

  commit(terrainTextureKey: string, foregroundTextureKey: string): readonly string[] {
    if (this.cancelled || !this.isComplete()) {
      throw new Error('Room textures cannot be committed before preparation completes.');
    }
    while (!this.isCommitted()) {
      this.commitNext(terrainTextureKey, foregroundTextureKey);
    }
    return [terrainTextureKey, foregroundTextureKey];
  }

  commitNext(
    terrainTextureKey: string,
    foregroundTextureKey: string,
  ): { resourceKey: string | null; complete: boolean } {
    if (this.cancelled || !this.isComplete()) {
      throw new Error('Room textures cannot be committed before preparation completes.');
    }
    if (!this.terrainCommitted) {
      const terrain = this.requirePreparedCanvas(this.terrain, 'terrain');
      if (!this.scene.textures.exists(terrainTextureKey)) {
        this.scene.textures.addCanvas(terrainTextureKey, terrain.canvas);
      }
      this.terrainCommitted = true;
      return { resourceKey: terrainTextureKey, complete: this.isCommitted() };
    }
    if (!this.foregroundCommitted) {
      const foreground = this.requirePreparedCanvas(this.foreground, 'foreground');
      if (!this.scene.textures.exists(foregroundTextureKey)) {
        this.scene.textures.addCanvas(foregroundTextureKey, foreground.canvas);
      }
      this.foregroundCommitted = true;
      return { resourceKey: foregroundTextureKey, complete: true };
    }
    return { resourceKey: null, complete: true };
  }

  cancel(): void {
    if (this.isCommitted()) {
      return;
    }
    this.cancelled = true;
    if (!this.terrainCommitted && this.terrain) {
      this.terrain.canvas.width = 0;
      this.terrain.canvas.height = 0;
    }
    if (!this.foregroundCommitted && this.foreground) {
      this.foreground.canvas.width = 0;
      this.foreground.canvas.height = 0;
    }
  }

  isComplete(): boolean {
    return this.layerIndex >= PREPARED_LAYERS.length;
  }

  getSnapshot(): RoomTexturePreparationSnapshot {
    return {
      layer: PREPARED_LAYERS[this.layerIndex] ?? null,
      nextRow: this.nextRow,
      complete: this.isComplete(),
      cancelled: this.cancelled,
      committedTextureCount: Number(this.terrainCommitted) + Number(this.foregroundCommitted),
      byteSize: ROOM_PX_WIDTH * ROOM_PX_HEIGHT * 4 * 2,
    };
  }

  private isCommitted(): boolean {
    return this.terrainCommitted && this.foregroundCommitted;
  }

  private getPreparedCanvas(layer: LayerName): PreparedCanvas {
    if (layer === 'foreground') {
      this.foreground ??= initializeCanvas(this.createCanvas());
      return this.foreground;
    }
    this.terrain ??= initializeCanvas(this.createCanvas());
    return this.terrain;
  }

  private requirePreparedCanvas(
    preparedCanvas: PreparedCanvas | null,
    layer: 'terrain' | 'foreground',
  ): PreparedCanvas {
    if (!preparedCanvas) {
      throw new Error(`Prepared ${layer} canvas is missing.`);
    }
    return preparedCanvas;
  }
}

function createDetachedCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

function initializeCanvas(canvas: HTMLCanvasElement): PreparedCanvas {
  canvas.width = ROOM_PX_WIDTH;
  canvas.height = ROOM_PX_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create a detached room texture canvas.');
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  return { canvas, context };
}
