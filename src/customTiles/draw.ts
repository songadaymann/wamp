import { TILE_SIZE } from '../config/room';
import type { CustomRoomTileDefinition } from './model';

export function drawCustomRoomTileToContext(
  context: CanvasRenderingContext2D,
  tile: CustomRoomTileDefinition,
  dx: number,
  dy: number,
  size: number,
): void {
  const cellSize = size / TILE_SIZE;
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
