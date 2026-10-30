import { TILE_SIZE } from '../config/room';
import type { CustomRoomTileDefinition } from './model';
import { BLOCKED_ART_COLOR, isCustomSpriteBlocked } from '../customSprites/blocklist';

export function drawCustomRoomTileToContext(
  context: CanvasRenderingContext2D,
  tile: CustomRoomTileDefinition,
  dx: number,
  dy: number,
  size: number,
): void {
  const cellSize = size / TILE_SIZE;
  if (isCustomSpriteBlocked(tile.sourceSpriteId)) {
    context.fillStyle = BLOCKED_ART_COLOR;
    context.fillRect(dx, dy, Math.ceil(size), Math.ceil(size));
    return;
  }
  for (let index = 0; index < tile.pixels.length; index += 1) {
    const color = tile.pixels[index];
    if (!color) {
      continue;
    }
    const x = index % TILE_SIZE;
    const y = Math.floor(index / TILE_SIZE);
    context.fillStyle = color;
    context.fillRect(
      dx + x * cellSize,
      dy + y * cellSize,
      Math.ceil(cellSize),
      Math.ceil(cellSize),
    );
  }
}
