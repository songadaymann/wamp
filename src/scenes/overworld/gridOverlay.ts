import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { type WorldWindow } from '../../persistence/worldModel';
import { RETRO_COLORS } from '../../visuals/starfield';

interface OverworldGridOverlayControllerHost {
  scene: Phaser.Scene;
  getWorldWindow(): WorldWindow | null;
  getZoom(): number;
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
    const left = firstCol * ROOM_PX_WIDTH;
    const right = lastCol * ROOM_PX_WIDTH;
    const top = firstRow * ROOM_PX_HEIGHT;
    const bottom = lastRow * ROOM_PX_HEIGHT;
    const lineWidth = 1 / this.host.getZoom();
    const redrawSignature = [
      firstCol,
      lastCol,
      firstRow,
      lastRow,
      lineWidth.toFixed(4),
    ].join(':');
    if (redrawSignature === this.lastRedrawSignature) {
      return;
    }

    this.lastRedrawSignature = redrawSignature;
    this.roomGridGraphics.clear();

    this.roomGridGraphics.fillStyle(RETRO_COLORS.grid, 0.14);

    for (let col = firstCol; col <= lastCol; col += 1) {
      const worldX = col * ROOM_PX_WIDTH;
      this.roomGridGraphics.fillRect(
        worldX - lineWidth * 0.5,
        top,
        lineWidth,
        bottom - top,
      );
    }

    for (let row = firstRow; row <= lastRow; row += 1) {
      const worldY = row * ROOM_PX_HEIGHT;
      this.roomGridGraphics.fillRect(
        left,
        worldY - lineWidth * 0.5,
        right - left,
        lineWidth,
      );
    }
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return this.roomGridGraphics ? [this.roomGridGraphics] : [];
  }
}
