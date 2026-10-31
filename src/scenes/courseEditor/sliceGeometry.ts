import Phaser from 'phaser';
import { ROOM_HEIGHT, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, ROOM_WIDTH, TILE_SIZE } from '../../config';

interface SliceOrigin {
  origin: { x: number; y: number };
}

export function courseSliceAtWorldPoint<T extends SliceOrigin>(
  slices: Iterable<T>,
  worldX: number,
  worldY: number,
): T | null {
  for (const slice of slices) {
    if (
      worldX >= slice.origin.x &&
      worldX < slice.origin.x + ROOM_PX_WIDTH &&
      worldY >= slice.origin.y &&
      worldY < slice.origin.y + ROOM_PX_HEIGHT
    ) {
      return slice;
    }
  }
  return null;
}

export function courseLocalTile(
  worldX: number,
  worldY: number,
  origin: { x: number; y: number },
): { tileX: number; tileY: number } | null {
  const tileX = Math.floor((worldX - origin.x) / TILE_SIZE);
  const tileY = Math.floor((worldY - origin.y) / TILE_SIZE);
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) return null;
  return { tileX, tileY };
}

export function courseClosestTile(
  worldX: number,
  worldY: number,
  origin: { x: number; y: number },
): { tileX: number; tileY: number } {
  const localX = Phaser.Math.Clamp(worldX - origin.x, 0, ROOM_PX_WIDTH - 1);
  const localY = Phaser.Math.Clamp(worldY - origin.y, 0, ROOM_PX_HEIGHT - 1);
  return {
    tileX: Math.floor(localX / TILE_SIZE),
    tileY: Math.floor(localY / TILE_SIZE),
  };
}
