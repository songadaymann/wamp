import type { TileSelection } from '../../config';

export interface PaletteCell {
  col: number;
  row: number;
}

export function paletteCellKey(cell: PaletteCell): string {
  return `${cell.col},${cell.row}`;
}

export function walkDragCells(
  col1: number,
  row1: number,
  col2: number,
  row2: number,
): PaletteCell[] {
  const cells: PaletteCell[] = [];
  const colStep = col2 >= col1 ? 1 : -1;
  const rowStep = row2 >= row1 ? 1 : -1;
  for (let row = row1; ; row += rowStep) {
    for (let col = col1; ; col += colStep) {
      cells.push({ col, row });
      if (col === col2) {
        break;
      }
    }
    if (row === row2) {
      break;
    }
  }
  return cells;
}

export function collectOccupiedDragOrder(
  col1: number,
  row1: number,
  col2: number,
  row2: number,
  isOccupied: (col: number, row: number) => boolean,
): PaletteCell[] {
  return walkDragCells(col1, row1, col2, row2).filter((cell) => isOccupied(cell.col, cell.row));
}

export function appendPatternCells(
  order: readonly PaletteCell[],
  cells: readonly PaletteCell[],
): PaletteCell[] {
  const next = order.map((cell) => ({ ...cell }));
  const seen = new Set(next.map(paletteCellKey));
  for (const cell of cells) {
    const key = paletteCellKey(cell);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push({ col: cell.col, row: cell.row });
  }
  return next;
}

export function removePatternCells(
  order: readonly PaletteCell[],
  cells: readonly PaletteCell[],
): PaletteCell[] {
  const removed = new Set(cells.map(paletteCellKey));
  return order.filter((cell) => !removed.has(paletteCellKey(cell)));
}

export function rowMajorOccupiedOrder(selection: TileSelection): PaletteCell[] {
  const cells: PaletteCell[] = [];
  for (let dy = 0; dy < selection.height; dy += 1) {
    for (let dx = 0; dx < selection.width; dx += 1) {
      if (!selection.occupiedMask[dy]?.[dx]) {
        continue;
      }
      cells.push({
        col: selection.startCol + dx,
        row: selection.startRow + dy,
      });
    }
  }
  return cells;
}

export function resolveSelectionPatternOrder(selection: TileSelection): PaletteCell[] {
  if (selection.patternOrder && selection.patternOrder.length > 0) {
    return selection.patternOrder.filter((cell) => isSelectionCellOccupied(selection, cell.col, cell.row));
  }
  return rowMajorOccupiedOrder(selection);
}

export function countOccupiedSelectionTiles(selection: TileSelection): number {
  return resolveSelectionPatternOrder(selection).length;
}

export function isSelectionCellOccupied(
  selection: TileSelection,
  col: number,
  row: number,
): boolean {
  return Boolean(selection.occupiedMask[row - selection.startRow]?.[col - selection.startCol]);
}

export function getOrderedSelectionValues(
  selection: TileSelection,
  readValue: (dx: number, dy: number) => number,
): number[] {
  const values: number[] = [];
  for (const cell of resolveSelectionPatternOrder(selection)) {
    const value = readValue(cell.col - selection.startCol, cell.row - selection.startRow);
    if (value >= 0) {
      values.push(value);
    }
  }
  return values;
}

export function diagonalPatternIndex(localX: number, localY: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return ((localX - localY) % count + count) % count;
}

export function pathPatternIndex(step: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return ((step % count) + count) % count;
}
