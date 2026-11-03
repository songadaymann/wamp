import { describe, expect, it } from 'vitest';
import {
  trianglePixelLayer,
  triangleTilePoolIndex,
  triangleWrapDistance,
} from './triangleTileFill';
import { diagonalPatternIndex } from '../scenes/editor/selectionPattern';

describe('triangle tile fill', () => {
  it('starts each row on the hypotenuse and steps toward the vertical edge', () => {
    expect(triangleWrapDistance(3, -1, 64, -64)).toBe(0);
    expect(triangleWrapDistance(2, -1, 64, -64)).toBe(1);
    expect(triangleWrapDistance(1, -1, 64, -64)).toBe(2);
    expect(triangleWrapDistance(0, -1, 64, -64)).toBe(3);
    expect(triangleWrapDistance(2, -2, 64, -64)).toBe(0);
    expect(triangleWrapDistance(1, -2, 64, -64)).toBe(1);
    expect(triangleWrapDistance(0, -2, 64, -64)).toBe(2);
  });

  it('keeps every cell a row\'s hypotenuse crosses on the first tile', () => {
    // 11×7 ramp. The diagonal covers two cells on the bottom row, so both are the first tile.
    expect(triangleWrapDistance(10, -1, 176, -112)).toBe(0);
    expect(triangleWrapDistance(9, -1, 176, -112)).toBe(0);
    expect(triangleWrapDistance(8, -1, 176, -112)).toBe(1);
    expect(triangleWrapDistance(0, -1, 176, -112)).toBe(9);
    // The row center sits one cell past the inner edge, which used to start the wrap too far out.
    expect(triangleWrapDistance(0, -6, 176, -112)).toBe(1);
    expect(triangleWrapDistance(1, -6, 176, -112)).toBe(0);
    expect(triangleWrapDistance(2, -6, 176, -112)).toBe(0);
    expect(triangleWrapDistance(3, -6, 176, -112)).toBe(0);
    // The same edge mirrored to the left.
    expect(triangleWrapDistance(-11, -1, -176, -112)).toBe(0);
    expect(triangleWrapDistance(-10, -1, -176, -112)).toBe(0);
    expect(triangleWrapDistance(-9, -1, -176, -112)).toBe(1);
  });

  it('keeps the first tile on the slope and mixes the rest', () => {
    expect(triangleTilePoolIndex('wrap', 3, -1, 64, -64, 3, 'ramp', true)).toBe(0);
    expect(triangleTilePoolIndex('wrap', 2, -1, 64, -64, 3, 'ramp', true)).toBe(1);
    expect(triangleTilePoolIndex('wrap', 1, -1, 64, -64, 3, 'ramp', true)).toBe(2);
    expect(triangleTilePoolIndex('wrap', 0, -1, 64, -64, 3, 'ramp', true)).toBe(1);
    expect(triangleTilePoolIndex('wrap', 2, -1, 64, -64, 1, 'ramp', true)).toBe(0);
    expect(triangleTilePoolIndex('pattern', 3, -1, 64, -64, 3, 'ramp', true)).toBe(0);
    expect(triangleTilePoolIndex('pattern', 2, -1, 64, -64, 3, 'ramp', true)).toBe(
      1 + diagonalPatternIndex(2, -1, 2),
    );
    const shuffled = triangleTilePoolIndex('shuffle', 0, -1, 64, -64, 4, 'ramp', true);
    expect(shuffled).toBeGreaterThanOrEqual(1);
    expect(shuffled).toBeLessThan(4);
    expect(triangleTilePoolIndex('shuffle', 3, -1, 64, -64, 4, 'ramp', true)).toBe(0);
  });

  it('wraps the selected tiles and repeats the count on the next row', () => {
    expect(triangleTilePoolIndex('wrap', 3, -1, 64, -64, 2, 'ramp')).toBe(0);
    expect(triangleTilePoolIndex('wrap', 2, -1, 64, -64, 2, 'ramp')).toBe(1);
    expect(triangleTilePoolIndex('wrap', 1, -1, 64, -64, 2, 'ramp')).toBe(0);
    expect(triangleTilePoolIndex('wrap', 2, -2, 64, -64, 2, 'ramp')).toBe(0);
  });

  it('uses the same diagonal pattern as the other tools', () => {
    expect(triangleTilePoolIndex('pattern', 2, -1, 64, -64, 3, 'ramp')).toBe(
      diagonalPatternIndex(2, -1, 3),
    );
  });

  it('draws the stroke over tiles and keeps the background under transparent pixels', () => {
    expect(trianglePixelLayer(0.4, 255)).toBe('stroke');
    expect(trianglePixelLayer(4, 0)).toBe('background');
    expect(trianglePixelLayer(4, null)).toBe('background');
    expect(trianglePixelLayer(4, 255)).toBe('tile');
  });
});
