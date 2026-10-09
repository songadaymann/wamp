import type Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import type { RoomEdgeGuide } from './edgeGuides';

export function drawRoomEdgeGuides(graphics: Phaser.GameObjects.Graphics, guides: readonly RoomEdgeGuide[], zoom: number): void {
  graphics.clear();
  drawRoomEdgeGuideMarks(graphics, guides, zoom, { x: 0, y: 0 });
}

/** Draws one room's markers at its world origin without clearing, for multi-room workspaces. */
export function drawRoomEdgeGuideMarks(
  graphics: Phaser.GameObjects.Graphics,
  guides: readonly RoomEdgeGuide[],
  zoom: number,
  origin: { x: number; y: number },
): void {
  const size = Math.min(9, 4 / Math.max(zoom, 0.1));
  for (const guide of guides) {
    const count = Math.min(4, Math.max(1, Math.ceil((guide.end - guide.start) / 80)));
    const color = guide.state === 'connected' ? 0x75cf60 : guide.state === 'blocked' ? 0xff6f3c : 0x7de5ff;
    graphics.lineStyle(2 / Math.max(zoom, 0.1), color, 0.95);
    for (let i = 0; i < count; i++) {
      const axis = guide.start + (guide.end - guide.start) * (i + 0.5) / count;
      const x = origin.x + (guide.side === 'left' ? size + 2 : guide.side === 'right' ? ROOM_PX_WIDTH - size - 2 : axis);
      const y = origin.y + (guide.side === 'top' ? size + 2 : guide.side === 'bottom' ? ROOM_PX_HEIGHT - size - 2 : axis);
      if (guide.state === 'blocked') {
        graphics.lineBetween(x - size, y - size, x + size, y + size);
        graphics.lineBetween(x - size, y + size, x + size, y - size);
      } else {
        const dx = guide.side === 'left' ? -1 : guide.side === 'right' ? 1 : 0;
        const dy = guide.side === 'top' ? -1 : guide.side === 'bottom' ? 1 : 0;
        graphics.lineBetween(x - dx * size - dy * size, y - dy * size + dx * size, x + dx * size, y + dy * size);
        graphics.lineBetween(x + dx * size, y + dy * size, x - dx * size + dy * size, y - dy * size - dx * size);
      }
    }
  }
}
