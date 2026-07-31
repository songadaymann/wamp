import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import type { RoomCoordinates } from '../../persistence/roomModel';
import { type WorldWindow } from '../../persistence/worldModel';
import { RETRO_COLORS } from '../../visuals/starfield';

interface OverworldGridOverlayControllerHost {
  scene: Phaser.Scene;
  getWorldWindow(): WorldWindow | null;
  getZoom(): number;
  getExpandedRoomIdAt?(coordinates: RoomCoordinates): string | null;
}

export class OverworldGridOverlayController {
  private roomGridGraphics: Phaser.GameObjects.Graphics | null = null;
  private lastFirstCol = Number.NaN;
  private lastLastCol = Number.NaN;
  private lastFirstRow = Number.NaN;
  private lastLastRow = Number.NaN;
  private lastLineWidth = Number.NaN;
  private contentRevision = 0;
  private renderedContentRevision = -1;

  constructor(private readonly host: OverworldGridOverlayControllerHost) {}

  create(): void {
    if (this.roomGridGraphics) {
      return;
    }

    this.roomGridGraphics = this.host.scene.add.graphics();
    this.roomGridGraphics.setDepth(-4);
  }

  destroy(): void {
    this.roomGridGraphics?.destroy();
    this.roomGridGraphics = null;
    this.resetRenderedState();
  }

  invalidateContent(): void {
    this.contentRevision += 1;
  }

  redraw(): void {
    const worldWindow = this.host.getWorldWindow();
    if (!worldWindow || !this.roomGridGraphics) {
      this.resetRenderedState();
      this.roomGridGraphics?.clear();
      return;
    }

    const worldView = this.host.scene.cameras.main.worldView;
    const firstCol = Math.floor(worldView.left / ROOM_PX_WIDTH) - 1;
    const lastCol = Math.ceil(worldView.right / ROOM_PX_WIDTH) + 1;
    const firstRow = Math.floor(worldView.top / ROOM_PX_HEIGHT) - 1;
    const lastRow = Math.ceil(worldView.bottom / ROOM_PX_HEIGHT) + 1;
    const lineWidth = 1 / this.host.getZoom();
    if (
      firstCol === this.lastFirstCol
      && lastCol === this.lastLastCol
      && firstRow === this.lastFirstRow
      && lastRow === this.lastLastRow
      && lineWidth === this.lastLineWidth
      && this.contentRevision === this.renderedContentRevision
    ) {
      return;
    }

    this.lastFirstCol = firstCol;
    this.lastLastCol = lastCol;
    this.lastFirstRow = firstRow;
    this.lastLastRow = lastRow;
    this.lastLineWidth = lineWidth;
    this.renderedContentRevision = this.contentRevision;
    this.roomGridGraphics.clear();

    this.roomGridGraphics.fillStyle(RETRO_COLORS.grid, 0.14);

    for (let col = firstCol; col <= lastCol; col += 1) {
      const worldX = col * ROOM_PX_WIDTH;
      for (let row = firstRow; row < lastRow; row += 1) {
        if (this.shouldSkipVerticalSegment(col, row)) {
          continue;
        }
        this.roomGridGraphics.fillRect(
          worldX - lineWidth * 0.5,
          row * ROOM_PX_HEIGHT,
          lineWidth,
          ROOM_PX_HEIGHT,
        );
      }
    }

    for (let row = firstRow; row <= lastRow; row += 1) {
      const worldY = row * ROOM_PX_HEIGHT;
      for (let col = firstCol; col < lastCol; col += 1) {
        if (this.shouldSkipHorizontalSegment(col, row)) {
          continue;
        }
        this.roomGridGraphics.fillRect(
          col * ROOM_PX_WIDTH,
          worldY - lineWidth * 0.5,
          ROOM_PX_WIDTH,
          lineWidth,
        );
      }
    }
  }

  private shouldSkipVerticalSegment(col: number, row: number): boolean {
    const leftExpandedRoomId = this.host.getExpandedRoomIdAt?.({ x: col - 1, y: row }) ?? null;
    if (!leftExpandedRoomId) {
      return false;
    }

    return leftExpandedRoomId === (this.host.getExpandedRoomIdAt?.({ x: col, y: row }) ?? null);
  }

  private shouldSkipHorizontalSegment(col: number, row: number): boolean {
    const upExpandedRoomId = this.host.getExpandedRoomIdAt?.({ x: col, y: row - 1 }) ?? null;
    if (!upExpandedRoomId) {
      return false;
    }

    return upExpandedRoomId === (this.host.getExpandedRoomIdAt?.({ x: col, y: row }) ?? null);
  }

  private resetRenderedState(): void {
    this.lastFirstCol = Number.NaN;
    this.lastLastCol = Number.NaN;
    this.lastFirstRow = Number.NaN;
    this.lastLastRow = Number.NaN;
    this.lastLineWidth = Number.NaN;
    this.renderedContentRevision = -1;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return this.roomGridGraphics ? [this.roomGridGraphics] : [];
  }
}
