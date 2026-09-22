import { describe, expect, it } from 'vitest';
import { forEachDraggedTileCell, resolvePencilStampOrigin } from './stampDrag';

describe('resolvePencilStampOrigin', () => {
  it('snaps multi-tile stamps to the selection grid while dragging', () => {
    expect(resolvePencilStampOrigin({ x: 4, y: 2 }, { x: 7, y: 2 }, 3, 1, false)).toEqual({ x: 7, y: 2 });
    expect(resolvePencilStampOrigin({ x: 4, y: 2 }, { x: 6, y: 2 }, 3, 1, false)).toEqual({ x: 4, y: 2 });
    expect(resolvePencilStampOrigin({ x: 4, y: 2 }, { x: 7, y: 4 }, 3, 2, false)).toEqual({ x: 7, y: 4 });
  });

  it('places on every hovered tile when continuous stamping is on', () => {
    expect(resolvePencilStampOrigin({ x: 4, y: 2 }, { x: 6, y: 3 }, 3, 1, true)).toEqual({ x: 6, y: 3 });
  });
});

describe('forEachDraggedTileCell', () => {
  it('fills gaps in a fast horizontal or diagonal drag without repeating the start', () => {
    const horizontal: string[] = [];
    forEachDraggedTileCell({ x: 2, y: 3 }, { x: 5, y: 3 }, (x, y) => horizontal.push(`${x},${y}`));
    expect(horizontal).toEqual(['3,3', '4,3', '5,3']);

    const diagonal: string[] = [];
    forEachDraggedTileCell({ x: 2, y: 3 }, { x: 4, y: 5 }, (x, y) => diagonal.push(`${x},${y}`));
    expect(diagonal).toEqual(['3,4', '4,5']);
  });
});
