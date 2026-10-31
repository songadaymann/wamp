import { describe, expect, it } from 'vitest';
import {
  SPECIAL_TILESET_FIRST_GID,
  SPECIAL_TILE_LOCAL_INDICES,
  TILE_FLIP_X_FLAG,
  TILE_FLIP_Y_FLAG,
  decodeTileDataValue,
  editorState,
  updateEditorState,
  getSelectionTileValue,
} from '../../config';
import {
  applyEditorTileFlipModes,
  clampRandomizeBrushSize,
  collectOccupiedSelectionValues,
  isScrambleOneByOne,
  sampleDrawWindow,
  samplePatternWindow,
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
  it('clamps scramble and draw brush sizes to 1–5', () => {
    expect(clampRandomizeBrushSize(1)).toBe(1);
    expect(clampRandomizeBrushSize(9)).toBe(5);
    expect(clampRandomizeBrushSize(0)).toBe(1);
    expect(isScrambleOneByOne(1)).toBe(true);
    expect(isScrambleOneByOne(3)).toBe(false);
  });

  it('lays a diagonal pattern across a draw brush without using selection size', () => {
    expect(samplePatternWindow(2, 0, 0, [10, 20])).toEqual([
      [10, 20],
      [20, 10],
    ]);
  });

  it('applies rand flip modes independently of the current flags', () => {
    updateEditorState({ tileFlipXMode: 'rand' });
    updateEditorState({ tileFlipYMode: 'off' });
    expect(applyEditorTileFlipModes(12, { random: () => 0.1 })).toBe(12 + TILE_FLIP_X_FLAG);
    updateEditorState({ tileFlipXMode: 'off' });
    updateEditorState({ tileFlipYMode: 'off' });
  });

  it('keeps special tileset tiles unflipped when the brush or a copy is mirrored', () => {
    const gid = SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES.gravityUp;
    updateEditorState({ tileFlipXMode: 'on', tileFlipYMode: 'on' });
    expect(applyEditorTileFlipModes(gid)).toBe(gid);
    expect(decodeTileDataValue(gid + TILE_FLIP_X_FLAG + TILE_FLIP_Y_FLAG)).toEqual({
      gid,
      flipX: false,
      flipY: false,
    });
    updateEditorState({ tileFlipXMode: 'off', tileFlipYMode: 'off' });
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

  it('skips empty mask cells the same way pencil stamps do', () => {
    const previous = editorState.selection;
    updateEditorState({ selection: {
      ...previous,
      width: 2,
      height: 1,
      occupiedMask: [[true, false]],
    } });
    expect(getSelectionTileValue(1, 0)).toBe(-1);
    updateEditorState({ selection: previous });
  });
});
