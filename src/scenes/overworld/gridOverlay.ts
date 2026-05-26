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
  private lastRedrawSignature = '';

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
    this.lastRedrawSignature = '';
  }

  redraw(): void {
    const worldWindow = this.host.getWorldWindow();
    if (!worldWindow || !this.roomGridGraphics) {
      this.lastRedrawSignature = '';
      this.roomGridGraphics?.clear();
      return;
    }

    const worldView = this.host.scene.cameras.main.worldView;
    const firstCol = Math.floor(worldView.left / ROOM_PX_WIDTH) - 1;
    const lastCol = Math.ceil(worldView.right / ROOM_PX_WIDTH) + 1;
    const firstRow = Math.floor(worldView.top / ROOM_PX_HEIGHT) - 1;
    const lastRow = Math.ceil(worldView.bottom / ROOM_PX_HEIGHT) + 1;
    const lineWidth = 1 / this.host.getZoom();
    const redrawSignature = [
      firstCol,
      lastCol,
      firstRow,
      lastRow,
      lineWidth.toFixed(4),
      this.getExpandedRoomRedrawSignature(firstCol, lastCol, firstRow, lastRow),
    ].join(':');
    if (redrawSignature === this.lastRedrawSignature) {
      return;
    }

    this.lastRedrawSignature = redrawSignature;
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

  private getExpandedRoomRedrawSignature(
    firstCol: number,
    lastCol: number,
    firstRow: number,
    lastRow: number,
  ): string {
    if (!this.host.getExpandedRoomIdAt) {
      return '';
    }

    const parts: string[] = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        const expandedRoomId = this.host.getExpandedRoomIdAt({ x: col, y: row });
        if (expandedRoomId) {
          parts.push(`${col},${row}=${expandedRoomId}`);
        }
      }
    }
    return parts.join('|');
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return this.roomGridGraphics ? [this.roomGridGraphics] : [];
  }
}
