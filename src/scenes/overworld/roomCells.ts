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
  getExpandedRoomIdAt(coordinates: RoomCoordinates): string | null;
}

export class OverworldRoomCellController {
  private roomFillGraphics: Phaser.GameObjects.Graphics | null = null;
  private roomFrameGraphics: Phaser.GameObjects.Graphics | null = null;
  private roomFocusGraphics: Phaser.GameObjects.Graphics | null = null;
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

    if (!this.roomFocusGraphics) {
      this.roomFocusGraphics = this.host.scene.add.graphics();
      this.roomFocusGraphics.setDepth(21);
    }
  }

  destroy(): void {
    this.destroyFrontierLabels();
    this.roomFillGraphics?.destroy();
    this.roomFillGraphics = null;
    this.roomFrameGraphics?.destroy();
    this.roomFrameGraphics = null;
    this.roomFocusGraphics?.destroy();
    this.roomFocusGraphics = null;
    this.lastZoomRenderKey = null;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    const ignoredObjects: Array<Phaser.GameObjects.GameObject | null> = [
      this.roomFillGraphics,
      this.roomFrameGraphics,
      this.roomFocusGraphics,
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
    this.roomFocusGraphics?.clear();

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
    this.redrawFocusHighlights();
    this.lastZoomRenderKey = this.getZoomRenderKey();
  }

  redrawFocusHighlights(): void {
    this.roomFocusGraphics?.clear();
    if (!this.roomFocusGraphics) {
      return;
    }

    const worldWindow = this.host.getWorldWindow();
    if (!worldWindow) {
      return;
    }

    const currentCoordinates = this.host.getCurrentRoomCoordinates();
    if (
      this.host.getMode() === 'play' &&
      this.isWithinWorldWindow(currentCoordinates, worldWindow) &&
      !this.host.getExpandedRoomIdAt(currentCoordinates) &&
      !this.host.isRoomInActiveCourse(currentCoordinates)
    ) {
      const currentOrigin = this.host.getRoomOrigin(currentCoordinates);
      this.drawInsetFrame(
        this.roomFocusGraphics,
        currentOrigin.x,
        currentOrigin.y,
        4,
        3,
        RETRO_COLORS.draft,
        0.98,
      );
    }

    const selectedCoordinates = this.host.getSelectedCoordinates();
    if (!this.isWithinWorldWindow(selectedCoordinates, worldWindow)) {
      return;
    }

    const selectedExpandedRoomId = this.host.getExpandedRoomIdAt(selectedCoordinates);
    if (selectedExpandedRoomId) {
      this.drawSelectedExpandedRoomBoundary(
        selectedCoordinates,
        selectedExpandedRoomId,
        worldWindow,
      );
      return;
    }
    if (this.host.isRoomInActiveCourse(selectedCoordinates)) {
      return;
    }

    const selectedOrigin = this.host.getRoomOrigin(selectedCoordinates);
    this.drawInsetFrame(
      this.roomFocusGraphics,
      selectedOrigin.x,
      selectedOrigin.y,
      8,
      2,
      RETRO_COLORS.selected,
      0.95,
    );
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

    const expandedRoomId = this.host.getExpandedRoomIdAt(coordinates);
    if (expandedRoomId) {
      return;
    }

    if (this.host.isRoomInActiveCourse(coordinates)) {
      this.drawActiveCourseBoundary(coordinates, x, y);
      return;
    }

    const editorCount = this.host.getRoomEditorCount(coordinates);
    if (cellState === 'draft') {
      this.drawInsetFrame(this.roomFrameGraphics, x, y, 4, 2, RETRO_COLORS.draft, 0.95);
    } else if (cellState === 'claimed_unpublished') {
      this.drawInsetFrame(this.roomFrameGraphics, x, y, 4, 2, RETRO_COLORS.claimedUnpublished, 0.92);
    } else if (cellState === 'frontier') {
      this.drawInsetFrame(this.roomFrameGraphics, x, y, 4, 2, FRONTIER_BUILD_HERE_RED, 0.95);
    } else if (cellState === 'published') {
      this.drawInsetFrame(this.roomFrameGraphics, x, y, 2, 1, RETRO_COLORS.published, 0.45);
    }

    if (editorCount > 0 && cellState !== 'draft') {
      const editorHighlightColor =
        cellState === 'frontier' ? FRONTIER_BUILD_HERE_RED : RETRO_COLORS.frontier;
      this.drawInsetFrame(this.roomFrameGraphics, x, y, 14, 2, editorHighlightColor, 0.88);
    }
  }

  private drawInsetFrame(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    inset: number,
    screenThicknessPx: number,
    color: number,
    alpha: number,
  ): void {
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

    graphics.fillStyle(color, alpha);
    graphics.fillRect(frameX, frameY, frameWidth, thickness);
    graphics.fillRect(frameX, bottomY, frameWidth, thickness);
    graphics.fillRect(frameX, frameY, thickness, frameHeight);
    graphics.fillRect(rightX, frameY, thickness, frameHeight);
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
    this.drawConnectedCellBoundary(
      this.roomFrameGraphics,
      coordinates,
      x,
      y,
      (candidate) => this.host.isRoomInActiveCourse(candidate),
      RETRO_COLORS.draft,
      0.92,
      3,
    );
  }

  private drawConnectedCellBoundary(
    graphics: Phaser.GameObjects.Graphics,
    coordinates: RoomCoordinates,
    x: number,
    y: number,
    isConnectedNeighbor: (coordinates: RoomCoordinates) => boolean,
    color: number,
    alpha: number,
    screenThicknessPx: number,
  ): void {
    const lineInset = 4;
    const left = x + lineInset;
    const right = x + ROOM_PX_WIDTH - lineInset;
    const top = y + lineInset;
    const bottom = y + ROOM_PX_HEIGHT - lineInset;
    const boundaryWidth = right - left;
    const boundaryHeight = bottom - top;
    const thickness = this.getWorldLineThickness(screenThicknessPx, boundaryWidth, boundaryHeight);
    const neighbors = {
      left: isConnectedNeighbor({ x: coordinates.x - 1, y: coordinates.y }),
      right: isConnectedNeighbor({ x: coordinates.x + 1, y: coordinates.y }),
      up: isConnectedNeighbor({ x: coordinates.x, y: coordinates.y - 1 }),
      down: isConnectedNeighbor({ x: coordinates.x, y: coordinates.y + 1 }),
    };

    graphics.fillStyle(color, alpha);
    if (!neighbors.left) {
      graphics.fillRect(left, top, thickness, boundaryHeight);
    }
    if (!neighbors.right) {
      graphics.fillRect(right - thickness, top, thickness, boundaryHeight);
    }
    if (!neighbors.up) {
      graphics.fillRect(left, top, boundaryWidth, thickness);
    }
    if (!neighbors.down) {
      graphics.fillRect(left, bottom - thickness, boundaryWidth, thickness);
    }
  }

  private drawSelectedExpandedRoomBoundary(
    selectedCoordinates: RoomCoordinates,
    expandedRoomId: string,
    worldWindow: WorldWindow,
  ): void {
    if (!this.roomFocusGraphics) {
      return;
    }

    const pending: RoomCoordinates[] = [{ ...selectedCoordinates }];
    const visited = new Set<string>();
    for (let index = 0; index < pending.length; index += 1) {
      const coordinates = pending[index];
      if (!coordinates) {
        continue;
      }
      const key = `${coordinates.x},${coordinates.y}`;
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);
      if (
        !this.isWithinWorldWindow(coordinates, worldWindow) ||
        this.host.getExpandedRoomIdAt(coordinates) !== expandedRoomId
      ) {
        continue;
      }

      const origin = this.host.getRoomOrigin(coordinates);
      this.drawConnectedCellBoundary(
        this.roomFocusGraphics,
        coordinates,
        origin.x,
        origin.y,
        (candidate) => this.host.getExpandedRoomIdAt(candidate) === expandedRoomId,
        RETRO_COLORS.selected,
        0.96,
        4,
      );
      pending.push(
        { x: coordinates.x - 1, y: coordinates.y },
        { x: coordinates.x + 1, y: coordinates.y },
        { x: coordinates.x, y: coordinates.y - 1 },
        { x: coordinates.x, y: coordinates.y + 1 },
      );
    }
  }

  private isWithinWorldWindow(coordinates: RoomCoordinates, worldWindow: WorldWindow): boolean {
    return (
      Math.abs(coordinates.x - worldWindow.center.x) <= worldWindow.radius &&
      Math.abs(coordinates.y - worldWindow.center.y) <= worldWindow.radius
    );
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
