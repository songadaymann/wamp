import { describe, expect, it } from 'vitest';
import type { TileSelection } from '../../config';
import {
  embedSelectionInBounds,
  isSelectionCellOccupied,
  selectionHasOccupiedCells,
  setSelectionRectOccupied,
} from './paletteSelectionMask';

function selection(partial: Partial<TileSelection> & Pick<TileSelection, 'occupiedMask' | 'width' | 'height'>): TileSelection {
  return {
    tilesetKey: 'atlas',
    startCol: 2,
    startRow: 1,
    ...partial,
  };
}

describe('paletteSelectionMask', () => {
  it('expands the bounding box while keeping existing gaps', () => {
    const current = selection({
      width: 2,
      height: 1,
      occupiedMask: [[true, false]],
    });
    const expanded = embedSelectionInBounds(current, 2, 1, 4, 2);
    expect(expanded).toMatchObject({
      startCol: 2,
      startRow: 1,
      width: 3,
      height: 2,
    });
    expect(expanded.occupiedMask).toEqual([
      [true, false, false],
      [false, false, false],
    ]);
  });

  it('toggles a sparse ctrl-select without filling occupancy', () => {
    const current = selection({
      width: 1,
      height: 1,
      occupiedMask: [[true]],
    });
    const next = setSelectionRectOccupied(current, 4, 1, 4, 1, true);
    expect(next.occupiedMask).toEqual([[true, false, true]]);
    expect(isSelectionCellOccupied(next, 3, 1)).toBe(false);
    expect(selectionHasOccupiedCells(next)).toBe(true);
  });
});
