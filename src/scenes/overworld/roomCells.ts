import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { type RoomCoordinates } from '../../persistence/roomModel';
import { type WorldWindow } from '../../persistence/worldModel';
import { RETRO_COLORS } from '../../visuals/starfield';
import { type SelectedCellState } from './hudViewModel';
import { type OverworldMode } from '../sceneData';

const FRONTIER_BUILD_HERE_RED = 0x2c5071;

interface OverworldRoomCellControllerHost {
  scene: Phaser.Scene;
  getWorldWindow(): WorldWindow | null;
  getZoom(): number;
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
  private frontierLabelTexts = new Map<string, Phaser.GameObjects.Text>();
  private lastZoomRenderKey: string | null = null;

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
    this.destroyFrontierLabels();
    this.roomFillGraphics?.destroy();
    this.roomFillGraphics = null;
    this.roomFrameGraphics?.destroy();
    this.roomFrameGraphics = null;
    this.lastZoomRenderKey = null;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    const ignoredObjects: Array<Phaser.GameObjects.GameObject | null> = [
      this.roomFillGraphics,
      this.roomFrameGraphics,
      ...this.frontierLabelTexts.values(),
    ];
    return ignoredObjects.filter(
      (gameObject): gameObject is Phaser.GameObjects.GameObject => gameObject !== null,
    );
  }

  redrawForZoom(): void {
    const nextZoomRenderKey = this.getZoomRenderKey();
    if (this.lastZoomRenderKey === nextZoomRenderKey) {
      return;
    }
    this.redraw();
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

    const visibleFrontierLabelKeys = new Set<string>();
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
        if (cellState === 'frontier') {
          this.syncFrontierLabel(coordinates, origin.x, origin.y);
          visibleFrontierLabelKeys.add(this.getFrontierLabelKey(coordinates));
        }
      }
    }

    this.pruneFrontierLabels(visibleFrontierLabelKeys);
    this.lastZoomRenderKey = this.getZoomRenderKey();
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
      this.drawInsetFrame(x, y, 4, 2, RETRO_COLORS.draft, 0.95);
    } else if (cellState === 'claimed_unpublished') {
      this.drawInsetFrame(x, y, 4, 2, RETRO_COLORS.claimedUnpublished, 0.92);
    } else if (cellState === 'frontier') {
      this.drawInsetFrame(x, y, 4, 2, FRONTIER_BUILD_HERE_RED, 0.95);
    } else if (cellState === 'published') {
      this.drawInsetFrame(x, y, 2, 1, RETRO_COLORS.published, 0.45);
    }

    const currentRoomCoordinates = this.host.getCurrentRoomCoordinates();
    if (
      coordinates.x === currentRoomCoordinates.x &&
      coordinates.y === currentRoomCoordinates.y &&
      this.host.getMode() === 'play'
    ) {
      this.drawInsetFrame(x, y, 4, 3, RETRO_COLORS.draft, 0.98);
    }

    const selectedCoordinates = this.host.getSelectedCoordinates();
    if (
      coordinates.x === selectedCoordinates.x &&
      coordinates.y === selectedCoordinates.y
    ) {
      this.drawInsetFrame(x, y, 8, 2, RETRO_COLORS.selected, 0.95);
    }

    if (editorCount > 0 && cellState !== 'draft') {
      const editorHighlightColor =
        cellState === 'frontier' ? FRONTIER_BUILD_HERE_RED : RETRO_COLORS.frontier;
      this.drawInsetFrame(x, y, 14, 2, editorHighlightColor, 0.88);
    }
  }

  private drawInsetFrame(
    x: number,
    y: number,
    inset: number,
    screenThicknessPx: number,
    color: number,
    alpha: number,
  ): void {
    if (!this.roomFrameGraphics) {
      return;
    }

    const frameX = x + inset;
    const frameY = y + inset;
    const frameWidth = ROOM_PX_WIDTH - inset * 2;
    const frameHeight = ROOM_PX_HEIGHT - inset * 2;
    const thickness = this.getWorldLineThickness(screenThicknessPx, frameWidth, frameHeight);
    if (thickness <= 0 || frameWidth <= 0 || frameHeight <= 0) {
      return;
    }

    const rightX = frameX + frameWidth - thickness;
    const bottomY = frameY + frameHeight - thickness;

    this.roomFrameGraphics.fillStyle(color, alpha);
    this.roomFrameGraphics.fillRect(frameX, frameY, frameWidth, thickness);
    this.roomFrameGraphics.fillRect(frameX, bottomY, frameWidth, thickness);
    this.roomFrameGraphics.fillRect(frameX, frameY, thickness, frameHeight);
    this.roomFrameGraphics.fillRect(rightX, frameY, thickness, frameHeight);
  }

  private getWorldLineThickness(
    screenThicknessPx: number,
    frameWidth: number,
    frameHeight: number,
  ): number {
    const zoom = Math.max(this.host.getZoom(), 0.001);
    return Math.min(screenThicknessPx / zoom, frameWidth * 0.5, frameHeight * 0.5);
  }

  private syncFrontierLabel(coordinates: RoomCoordinates, x: number, y: number): void {
    const key = this.getFrontierLabelKey(coordinates);
    let label = this.frontierLabelTexts.get(key) ?? null;
    if (!label) {
      label = this.host.scene.add.text(0, 0, 'BUILD\nHERE', {
        fontFamily: 'Early GameBoy',
        fontSize: '18px',
        color: '#fff3db',
        align: 'center',
      });
      label.setOrigin(0.5, 0.5);
      label.setDepth(8);
      label.setLineSpacing(10);
      label.setResolution(2);
      this.frontierLabelTexts.set(key, label);
    }

    label.setPosition(x + ROOM_PX_WIDTH * 0.5, y + ROOM_PX_HEIGHT * 0.5);
    label.setVisible(true);
  }

  private destroyFrontierLabels(): void {
    for (const label of this.frontierLabelTexts.values()) {
      label.destroy();
    }
    this.frontierLabelTexts.clear();
  }

  private pruneFrontierLabels(visibleFrontierLabelKeys: Set<string>): void {
    for (const [key, label] of this.frontierLabelTexts.entries()) {
      if (visibleFrontierLabelKeys.has(key)) {
        continue;
      }
      label.destroy();
      this.frontierLabelTexts.delete(key);
    }
  }

  private getFrontierLabelKey(coordinates: RoomCoordinates): string {
    return `${coordinates.x},${coordinates.y}`;
  }

  private getZoomRenderKey(): string {
    const zoom = Math.max(this.host.getZoom(), 0.001);
    return [
      Math.round(1 / zoom),
      Math.round(2 / zoom),
      Math.round(3 / zoom),
    ].join('|');
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
    const boundaryWidth = right - left;
    const boundaryHeight = bottom - top;
    const thickness = this.getWorldLineThickness(3, boundaryWidth, boundaryHeight);
    const neighbors = {
      left: this.host.isRoomInActiveCourse({ x: coordinates.x - 1, y: coordinates.y }),
      right: this.host.isRoomInActiveCourse({ x: coordinates.x + 1, y: coordinates.y }),
      up: this.host.isRoomInActiveCourse({ x: coordinates.x, y: coordinates.y - 1 }),
      down: this.host.isRoomInActiveCourse({ x: coordinates.x, y: coordinates.y + 1 }),
    };

    this.roomFrameGraphics.fillStyle(RETRO_COLORS.draft, 0.92);
    if (!neighbors.left) {
      this.roomFrameGraphics.fillRect(left, top, thickness, boundaryHeight);
    }
    if (!neighbors.right) {
      this.roomFrameGraphics.fillRect(right - thickness, top, thickness, boundaryHeight);
    }
    if (!neighbors.up) {
      this.roomFrameGraphics.fillRect(left, top, boundaryWidth, thickness);
    }
    if (!neighbors.down) {
      this.roomFrameGraphics.fillRect(left, bottom - thickness, boundaryWidth, thickness);
    }
  }

  private getCellFillStyle(cellState: SelectedCellState): { color: number; alpha: number } {
    switch (cellState) {
      case 'draft':
        return { color: RETRO_COLORS.draft, alpha: 0.07 };
      case 'claimed_unpublished':
        return { color: RETRO_COLORS.claimedUnpublished, alpha: 0.085 };
      case 'published':
        return { color: RETRO_COLORS.published, alpha: 0.025 };
      case 'frontier':
        return { color: FRONTIER_BUILD_HERE_RED, alpha: 0 };
      default:
        return { color: RETRO_COLORS.backgroundNumber, alpha: 0.18 };
    }
  }
}
