import { describe, expect, it } from 'vitest';
import {
  constrainToSquare,
  iterateCurveTiles,
  iterateEllipseTiles,
  iterateLineTiles,
  iterateRectTiles,
  resolveShapeEnd,
  snapLineEnd,
} from './shapeTiles';

describe('shapeTiles', () => {
  it('constrains to the smaller dimension, anchored at the start tile', () => {
    expect(constrainToSquare({ x: 10, y: 10 }, { x: 15, y: 20 })).toEqual({ x: 15, y: 15 });
    expect(constrainToSquare({ x: 10, y: 10 }, { x: 4, y: 2 })).toEqual({ x: 4, y: 4 });
    expect(constrainToSquare({ x: 10, y: 10 }, { x: 18, y: 10 })).toEqual({ x: 10, y: 10 });
  });

  it('only applies the square constrain when requested', () => {
    expect(resolveShapeEnd({ x: 2, y: 2 }, { x: 6, y: 9 }, false)).toEqual({ x: 6, y: 9 });
    expect(resolveShapeEnd({ x: 2, y: 2 }, { x: 6, y: 9 }, true)).toEqual({ x: 6, y: 6 });
  });

  it('fills and outlines inclusive rectangles', () => {
    expect(iterateRectTiles(1, 1, 1, 1, false)).toEqual([{ x: 1, y: 1 }]);
    expect(iterateRectTiles(1, 1, 1, 1, true)).toEqual([{ x: 1, y: 1 }]);
    expect(iterateRectTiles(0, 0, 2, 0, true)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);

    const filled = iterateRectTiles(0, 0, 2, 2, false);
    expect(filled).toHaveLength(9);
    const outline = iterateRectTiles(0, 0, 2, 2, true);
    expect(outline).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it('fills ellipses from cell centers and outlines a one-tile edge', () => {
    expect(iterateEllipseTiles(3, 3, 3, 3, false)).toEqual([{ x: 3, y: 3 }]);
    expect(iterateEllipseTiles(0, 0, 0, 4, false)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 0, y: 4 },
    ]);

    const filled = iterateEllipseTiles(0, 0, 4, 4, false);
    expect(filled).toContainEqual({ x: 2, y: 2 });
    expect(filled).not.toContainEqual({ x: 0, y: 0 });
    expect(filled.length).toBeLessThan(25);

    const outline = iterateEllipseTiles(0, 0, 4, 4, true);
    expect(outline.every((tile) => filled.some((inside) => inside.x === tile.x && inside.y === tile.y))).toBe(true);
    expect(outline).not.toContainEqual({ x: 2, y: 2 });
    expect(outline.length).toBeGreaterThan(0);
    expect(outline.length).toBeLessThan(filled.length);
  });

  it('rasters a one-tile-thick line and snaps to 45-degree increments', () => {
    expect(iterateLineTiles(0, 0, 0, 0)).toEqual([{ x: 0, y: 0 }]);
    expect(iterateLineTiles(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(iterateLineTiles(0, 0, 2, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);

    expect(snapLineEnd({ x: 10, y: 10 }, { x: 16, y: 11 })).toEqual({ x: 16, y: 10 });
    expect(snapLineEnd({ x: 10, y: 10 }, { x: 16, y: 15 })).toEqual({ x: 16, y: 16 });
    expect(snapLineEnd({ x: 10, y: 10 }, { x: 10, y: 4 })).toEqual({ x: 10, y: 4 });
  });

  it('pulls a quadratic curve so the mouse tile sits at the arc midpoint', () => {
    const tiles = iterateCurveTiles(0, 0, 4, 0, { x: 2, y: 2 });
    expect(tiles[0]).toEqual({ x: 0, y: 0 });
    expect(tiles[tiles.length - 1]).toEqual({ x: 4, y: 0 });
    expect(tiles).toContainEqual({ x: 2, y: 2 });
    expect(tiles.length).toBeGreaterThan(5);
  });
});
