import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { type RoomCoordinates } from '../../persistence/roomModel';
import { type WorldWindow } from '../../persistence/worldModel';
import { RETRO_COLORS } from '../../visuals/starfield';
import { type SelectedCellState } from './hudViewModel';
import { type OverworldMode } from '../sceneData';

interface OverworldRoomCellControllerHost {
  scene: Phaser.Scene;
  getWorldWindow(): WorldWindow | null;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  getCellStateAt(coordinates: RoomCoordinates): SelectedCellState;
  getRoomEditorCount(coordinates: RoomCoordinates): number;
  getCurrentRoomCoordinates(): RoomCoordinates;
  getSelectedCoordinates(): RoomCoordinates;
  getMode(): OverworldMode;
  isRoomInActiveCourse(coordinates: RoomCoordinates): boolean;
}

export class OverworldRoomCellController {
  private roomFillGraphics: Phaser.GameObjects.Graphics | null = null;
  private roomFrameGraphics: Phaser.GameObjects.Graphics | null = null;

  constructor(private readonly host: OverworldRoomCellControllerHost) {}

  create(): void {
    if (!this.roomFillGraphics) {
      this.roomFillGraphics = this.host.scene.add.graphics();
      this.roomFillGraphics.setDepth(-5);
    }

    if (!this.roomFrameGraphics) {
      this.roomFrameGraphics = this.host.scene.add.graphics();
      this.roomFrameGraphics.setDepth(20);
    }
  }

  destroy(): void {
    this.roomFillGraphics?.destroy();
    this.roomFillGraphics = null;
    this.roomFrameGraphics?.destroy();
    this.roomFrameGraphics = null;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return [this.roomFillGraphics, this.roomFrameGraphics].filter(
      (graphic): graphic is Phaser.GameObjects.Graphics => Boolean(graphic),
    );
  }

  redraw(): void {
    this.roomFillGraphics?.clear();
    this.roomFrameGraphics?.clear();

    if (!this.roomFillGraphics || !this.roomFrameGraphics) {
      return;
    }

    const worldWindow = this.host.getWorldWindow();
    if (!worldWindow) {
      return;
    }

    const gridSize = worldWindow.radius * 2 + 1;
    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const coordinates = {
          x: worldWindow.center.x + col - worldWindow.radius,
          y: worldWindow.center.y + row - worldWindow.radius,
        };
        const origin = this.host.getRoomOrigin(coordinates);
        const cellState = this.host.getCellStateAt(coordinates);
        const cellFill = this.getCellFillStyle(cellState);

        this.roomFillGraphics.fillStyle(cellFill.color, cellFill.alpha);
        this.roomFillGraphics.fillRect(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
        this.drawCellFrame(coordinates, cellState, origin.x, origin.y);
      }
    }
  }

  private drawCellFrame(
    coordinates: RoomCoordinates,
    cellState: SelectedCellState,
    x: number,
    y: number,
  ): void {
    if (!this.roomFrameGraphics) {
      return;
    }

    if (this.host.isRoomInActiveCourse(coordinates)) {
      this.drawActiveCourseBoundary(coordinates, x, y);
      return;
    }

    const editorCount = this.host.getRoomEditorCount(coordinates);
    if (cellState === 'draft') {
      this.roomFrameGraphics.lineStyle(2, RETRO_COLORS.draft, 0.95);
      this.roomFrameGraphics.strokeRect(x + 4, y + 4, ROOM_PX_WIDTH - 8, ROOM_PX_HEIGHT - 8);
    } else if (cellState === 'frontier') {
      this.roomFrameGraphics.lineStyle(2, RETRO_COLORS.frontier, 0.9);
      this.roomFrameGraphics.strokeRect(x + 4, y + 4, ROOM_PX_WIDTH - 8, ROOM_PX_HEIGHT - 8);
    } else if (cellState === 'published') {
      this.roomFrameGraphics.lineStyle(1, RETRO_COLORS.published, 0.45);
      this.roomFrameGraphics.strokeRect(x + 2, y + 2, ROOM_PX_WIDTH - 4, ROOM_PX_HEIGHT - 4);
    }

    const currentRoomCoordinates = this.host.getCurrentRoomCoordinates();
    if (
      coordinates.x === currentRoomCoordinates.x &&
      coordinates.y === currentRoomCoordinates.y &&
      this.host.getMode() === 'play'
    ) {
      this.roomFrameGraphics.lineStyle(3, RETRO_COLORS.draft, 0.98);
      this.roomFrameGraphics.strokeRect(x + 4, y + 4, ROOM_PX_WIDTH - 8, ROOM_PX_HEIGHT - 8);
    }

    const selectedCoordinates = this.host.getSelectedCoordinates();
    if (
      coordinates.x === selectedCoordinates.x &&
      coordinates.y === selectedCoordinates.y
    ) {
      this.roomFrameGraphics.lineStyle(2, RETRO_COLORS.selected, 0.95);
      this.roomFrameGraphics.strokeRect(x + 8, y + 8, ROOM_PX_WIDTH - 16, ROOM_PX_HEIGHT - 16);
    }

    if (editorCount > 0 && cellState !== 'draft') {
      this.roomFrameGraphics.lineStyle(2, RETRO_COLORS.frontier, 0.88);
      this.roomFrameGraphics.strokeRect(x + 14, y + 14, ROOM_PX_WIDTH - 28, ROOM_PX_HEIGHT - 28);
    }
  }

  private drawActiveCourseBoundary(
    coordinates: RoomCoordinates,
    x: number,
    y: number,
  ): void {
    if (!this.roomFrameGraphics) {
      return;
    }

    const lineInset = 4;
    const left = x + lineInset;
    const right = x + ROOM_PX_WIDTH - lineInset;
    const top = y + lineInset;
    const bottom = y + ROOM_PX_HEIGHT - lineInset;
    const neighbors = {
      left: this.host.isRoomInActiveCourse({ x: coordinates.x - 1, y: coordinates.y }),
      right: this.host.isRoomInActiveCourse({ x: coordinates.x + 1, y: coordinates.y }),
      up: this.host.isRoomInActiveCourse({ x: coordinates.x, y: coordinates.y - 1 }),
      down: this.host.isRoomInActiveCourse({ x: coordinates.x, y: coordinates.y + 1 }),
    };

    this.roomFrameGraphics.lineStyle(3, RETRO_COLORS.draft, 0.92);
    if (!neighbors.left) {
      this.roomFrameGraphics.lineBetween(left, top, left, bottom);
    }
    if (!neighbors.right) {
      this.roomFrameGraphics.lineBetween(right, top, right, bottom);
    }
    if (!neighbors.up) {
      this.roomFrameGraphics.lineBetween(left, top, right, top);
    }
    if (!neighbors.down) {
      this.roomFrameGraphics.lineBetween(left, bottom, right, bottom);
    }
  }

  private getCellFillStyle(cellState: SelectedCellState): { color: number; alpha: number } {
    switch (cellState) {
      case 'draft':
        return { color: RETRO_COLORS.draft, alpha: 0.07 };
      case 'published':
        return { color: RETRO_COLORS.published, alpha: 0.025 };
      case 'frontier':
        return { color: RETRO_COLORS.frontier, alpha: 0.16 };
      default:
        return { color: RETRO_COLORS.backgroundNumber, alpha: 0.18 };
    }
  }
}
