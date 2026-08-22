import { describe, expect, it } from 'vitest';
import {
  buildEditorClipboardState,
  cloneEditorClipboardState,
  planEditorClipboardPaste,
} from './clipboard';

describe('editor clipboard planning', () => {
  it('normalizes reversed bounds, clamps to the room, and retains sparse cells', () => {
    const state = buildEditorClipboardState('terrain', 3, 2, -2, -1, (x, y) =>
      x === 1 && y === 1 ? -1 : y * 100 + x,
    );
    expect(state).toEqual({
      sourceLayer: 'terrain',
      width: 4,
      height: 3,
      tiles: [[0, 1, 2, 3], [100, -1, 102, 103], [200, 201, 202, 203]],
      occupiedMask: [
        [true, true, true, true],
        [true, false, true, true],
        [true, true, true, true],
      ],
    });
  });

  it('rejects an empty selection and plans only occupied in-bounds paste writes', () => {
    expect(buildEditorClipboardState('foreground', 0, 0, 1, 1, () => -1)).toBeNull();
    const state = buildEditorClipboardState('terrain', 0, 0, 1, 1, (x, y) =>
      x === 0 && y === 0 ? -1 : y * 10 + x + 1,
    );
    expect(planEditorClipboardPaste(state!, 39, 20)).toEqual([
      { x: 39, y: 21, encodedTileValue: 11 },
    ]);
  });

  it('deep-clones clipboard rows for cross-room reuse', () => {
    const state = buildEditorClipboardState(
      'terrain', 0, 0, 1, 0, (x) => x + 1,
      (x) => x === 0 ? { theme: 'forest', material: 'ground', lockedGid: 61 } : undefined,
    )!;
    const clone = cloneEditorClipboardState(state)!;
    clone.tiles[0][0] = 999;
    clone.occupiedMask[0][0] = false;
    clone.smartCells!['0,0'].lockedGid = 99;
    expect(state.tiles[0][0]).toBe(1);
    expect(state.occupiedMask[0][0]).toBe(true);
    expect(state.smartCells).toEqual({
      '0,0': { theme: 'forest', material: 'ground', lockedGid: 61 },
    });
  });
});
