import type { TileSelection } from '../../config';
import { rowMajorOccupiedOrder } from '../../scenes/editor/selectionPattern';

/** Crosses out the empty cells of a tile selection in the palette and the tile preview. */
export function drawSelectionEmptyCellOverlay(
  ctx: CanvasRenderingContext2D,
  selection: TileSelection,
  cellWidth: number,
  cellHeight: number,
  offsetX: number,
  offsetY: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(5, 6, 10, 0.45)';
  ctx.strokeStyle = 'rgba(255, 210, 145, 0.7)';
  ctx.lineWidth = Math.max(1, Math.min(2, Math.min(cellWidth, cellHeight) * 0.08));

  for (let dy = 0; dy < selection.height; dy++) {
    for (let dx = 0; dx < selection.width; dx++) {
      if (selection.occupiedMask[dy]?.[dx]) {
        continue;
      }

      const left = offsetX + dx * cellWidth;
      const top = offsetY + dy * cellHeight;
      const inset = Math.max(1, Math.min(cellWidth, cellHeight) * 0.12);
      const width = Math.max(1, cellWidth - inset * 2);
      const height = Math.max(1, cellHeight - inset * 2);

      ctx.fillRect(left + inset, top + inset, width, height);
      ctx.beginPath();
      ctx.moveTo(left + inset, top + inset);
      ctx.lineTo(left + inset + width, top + inset + height);
      ctx.moveTo(left + inset + width, top + inset);
      ctx.lineTo(left + inset, top + inset + height);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Numbers the tiles in the order Pattern places them, once a selection has two or more. */
export function drawSelectionPatternOrderOverlay(
  ctx: CanvasRenderingContext2D,
  selection: TileSelection,
  cellWidth: number,
  cellHeight: number,
): void {
  const order = selection.patternOrder && selection.patternOrder.length > 0
    ? selection.patternOrder
    : rowMajorOccupiedOrder(selection);
  if (order.length <= 1) {
    return;
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.max(8, Math.floor(Math.min(cellWidth, cellHeight) * 0.42))}px "IBM Plex Mono", monospace`;
  ctx.lineWidth = Math.max(2, Math.min(cellWidth, cellHeight) * 0.08);
  ctx.strokeStyle = 'rgba(8, 10, 14, 0.85)';
  ctx.fillStyle = '#fff6de';

  order.forEach((cell, index) => {
    const x = (cell.col + 0.5) * cellWidth;
    const y = (cell.row + 0.5) * cellHeight;
    const label = String(index + 1);
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
  });
  ctx.restore();
}
