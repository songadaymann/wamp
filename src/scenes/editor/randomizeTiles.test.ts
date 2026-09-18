import { describe, expect, it } from 'vitest';
import { TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG, editorState, getSelectionTileValue } from '../../config';
import {
  applyRandomizeFlips,
  clampRandomizeBrushSize,
  collectOccupiedSelectionValues,
  isScrambleOneByOne,
  sampleDrawWindow,
  scrambleWindow,
} from './randomizeTiles';

function sequenceRng(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  };
}

describe('randomizeTiles', () => {
  it('clamps shuffle and scramble sizes to 1–5', () => {
    expect(clampRandomizeBrushSize(1, false)).toBe(1);
    expect(clampRandomizeBrushSize(1, true)).toBe(1);
    expect(clampRandomizeBrushSize(9, true)).toBe(5);
    expect(clampRandomizeBrushSize(0, false)).toBe(1);
    expect(isScrambleOneByOne(true, 1)).toBe(true);
    expect(isScrambleOneByOne(true, 3)).toBe(false);
    expect(isScrambleOneByOne(false, 1)).toBe(false);
  });

  it('weights the occupied palette pool evenly, including duplicates', () => {
    const pool = collectOccupiedSelectionValues(
      {
        tilesetKey: 'test',
        startCol: 0,
        startRow: 0,
        width: 2,
        height: 2,
        occupiedMask: [
          [true, false],
          [true, true],
        ],
      },
      (dx, dy) => (dy === 1 && dx === 0 ? 7 : 3),
    );
    expect(pool).toEqual([3, 7, 3]);
  });

  it('samples each draw cell independently from the selected pool', () => {
    const pool = [10, 20];
    expect(sampleDrawWindow(2, pool, sequenceRng([0, 0.9, 0, 0.9]))).toEqual([
      [10, 20],
      [10, 20],
    ]);
    expect(sampleDrawWindow(2, pool, sequenceRng([0, 0, 0.9, 0.9]))).toEqual([
      [10, 10],
      [20, 20],
    ]);
  });

  it('scrambles the whole window and preserves the bag of tiles', () => {
    const source = [
      [1, 2, -1],
      [3, 4, 5],
    ];
    const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
    const shuffled = scrambleWindow(source, sequenceRng([0.2, 0.9, 0.1, 0.7, 0.4]));
    expect(sorted(shuffled.flat())).toEqual(sorted(source.flat()));
  });

  it('randomizes H/V flips independently when those toggles are on', () => {
    expect(applyRandomizeFlips(12, false, false, () => 0)).toBe(12);
    expect(applyRandomizeFlips(12, true, false, () => 0.1)).toBe(12 + TILE_FLIP_X_FLAG);
    expect(applyRandomizeFlips(12, true, false, () => 0.9)).toBe(12);
    expect(applyRandomizeFlips(12, false, true, () => 0.1)).toBe(12 + TILE_FLIP_Y_FLAG);
    expect(applyRandomizeFlips(-1, true, true, () => 0)).toBe(-1);
  });

  it('skips empty mask cells the same way pencil stamps do', () => {
    const previous = editorState.selection;
    editorState.selection = {
      ...previous,
      width: 2,
      height: 1,
      occupiedMask: [[true, false]],
    };
    expect(getSelectionTileValue(1, 0)).toBe(-1);
    editorState.selection = previous;
  });
});
