import type Phaser from 'phaser';
import { ROOM_HEIGHT, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, ROOM_WIDTH, TILE_SIZE } from '../../config';
import { RETRO_COLORS } from '../../visuals/starfield';

const GUIDE_INTERVAL_TILES = 5;

export function drawEditorGrid(graphics: Phaser.GameObjects.Graphics, originX: number, originY: number): void {
  const drawLines = (lineWidth: number, alpha: number, guides: boolean): void => {
    graphics.lineStyle(lineWidth, RETRO_COLORS.grid, alpha);
    graphics.beginPath();

    for (let x = 1; x < ROOM_WIDTH; x += 1) {
      if ((x % GUIDE_INTERVAL_TILES === 0) !== guides) continue;
      const worldX = originX + x * TILE_SIZE;
      graphics.moveTo(worldX, originY);
      graphics.lineTo(worldX, originY + ROOM_PX_HEIGHT);
    }
    for (let y = 1; y < ROOM_HEIGHT; y += 1) {
      if ((y % GUIDE_INTERVAL_TILES === 0) !== guides) continue;
      const worldY = originY + y * TILE_SIZE;
      graphics.moveTo(originX, worldY);
      graphics.lineTo(originX + ROOM_PX_WIDTH, worldY);
    }

    graphics.strokePath();
  };

  drawLines(1, 0.12, false);
  drawLines(2, 0.18, true);
}
