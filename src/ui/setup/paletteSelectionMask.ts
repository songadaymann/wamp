import type { TileSelection } from '../../config';

export function cloneTileSelection(selection: TileSelection): TileSelection {
  return {
    ...selection,
    occupiedMask: selection.occupiedMask.map((row) => row.slice()),
    patternOrder: (selection.patternOrder ?? []).map((cell) => ({ ...cell })),
  };
}

export function isSelectionCellOccupied(
  selection: TileSelection,
  col: number,
  row: number,
): boolean {
  return Boolean(selection.occupiedMask[row - selection.startRow]?.[col - selection.startCol]);
}

export function setSelectionRectOccupied(
  selection: TileSelection,
  col1: number,
  row1: number,
  col2: number,
  row2: number,
  occupied: boolean,
): TileSelection {
  const minCol = Math.min(col1, col2);
  const minRow = Math.min(row1, row2);
  const maxCol = Math.max(col1, col2);
  const maxRow = Math.max(row1, row2);
  const expanded = embedSelectionInBounds(selection, minCol, minRow, maxCol, maxRow);
  const nextMask = expanded.occupiedMask.map((row) => row.slice());
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const dx = col - expanded.startCol;
      const dy = row - expanded.startRow;
      if (!nextMask[dy]) {
        continue;
      }
      nextMask[dy][dx] = occupied;
    }
  }
  return { ...expanded, occupiedMask: nextMask, patternOrder: selection.patternOrder ?? [] };
}

export function embedSelectionInBounds(
  selection: TileSelection,
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
): TileSelection {
  const startCol = Math.min(selection.startCol, minCol);
  const startRow = Math.min(selection.startRow, minRow);
  const endCol = Math.max(selection.startCol + selection.width - 1, maxCol);
  const endRow = Math.max(selection.startRow + selection.height - 1, maxRow);
  const width = endCol - startCol + 1;
  const height = endRow - startRow + 1;
  if (startCol === selection.startCol && startRow === selection.startRow
    && width === selection.width && height === selection.height) {
    return {
      ...selection,
      occupiedMask: selection.occupiedMask.map((row) => row.slice()),
    };
  }

  const occupiedMask = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
  for (let dy = 0; dy < selection.height; dy += 1) {
    for (let dx = 0; dx < selection.width; dx += 1) {
      const nextDy = selection.startRow + dy - startRow;
      const nextDx = selection.startCol + dx - startCol;
      occupiedMask[nextDy]![nextDx] = Boolean(selection.occupiedMask[dy]?.[dx]);
    }
  }

  return {
    ...selection,
    startCol,
    startRow,
    width,
    height,
    occupiedMask,
    patternOrder: selection.patternOrder ?? [],
  };
}

export function selectionHasOccupiedCells(selection: TileSelection): boolean {
  return selection.occupiedMask.some((row) => row.some(Boolean));
}
