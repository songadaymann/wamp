import type Phaser from 'phaser';
import { TILE_SIZE } from '../../config/room';
import type { DeathMapCell } from '../../insights/model';
import type { RoomCoordinates } from '../../persistence/roomModel';
export function drawDeathMap(graphics: Phaser.GameObjects.Graphics, points: DeathMapCell[], originFor: (cell: RoomCoordinates) => { x: number; y: number } | null): void {
  graphics.clear();
  const max = Math.max(1,...points.map(point => point.deaths));
  for (const point of points) {
    const origin = originFor({ x: point.roomX, y: point.roomY }); if (!origin) continue;
    const strength = point.deaths / max;
    graphics.fillStyle(strength >= 0.5 ? 0xff6f3c : 0xf2c94c, 0.3 + strength * 0.45);
    graphics.fillRect(origin.x + point.tileX * TILE_SIZE,origin.y + point.tileY * TILE_SIZE,TILE_SIZE,TILE_SIZE);
    graphics.lineStyle(1,0xf6f1de,0.7);
    graphics.strokeRect(origin.x + point.tileX * TILE_SIZE,origin.y + point.tileY * TILE_SIZE,TILE_SIZE,TILE_SIZE);
  }
}
