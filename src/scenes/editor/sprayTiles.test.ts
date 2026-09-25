import { describe, expect, it } from 'vitest';
import {
  clampSprayBrushSize,
  clampSprayRate,
  createCircleBrushMask,
  getSprayTilesPerSecond,
  listCircleBrushOffsets,
  pickSprayEraseOffset,
  pickSprayOffset,
  sampleSprayTileValue,
} from './sprayTiles';

describe('sprayTiles', () => {
  it('clamps spray sizes to 5–10 and rates to 0–1', () => {
    expect(clampSprayBrushSize(5)).toBe(5);
    expect(clampSprayBrushSize(10)).toBe(10);
    expect(clampSprayBrushSize(3)).toBe(5);
    expect(clampSprayBrushSize(12)).toBe(10);
    expect(clampSprayRate(-1)).toBe(0);
    expect(clampSprayRate(2)).toBe(1);
    expect(clampSprayRate(0.4)).toBe(0.4);
  });

  it('builds a circular mask that is smaller than the bounding square', () => {
    const mask = createCircleBrushMask(5);
    expect(mask).toHaveLength(5);
    expect(mask[0]).toEqual([false, true, true, true, false]);
    expect(listCircleBrushOffsets(5).length).toBeLessThan(25);
    expect(listCircleBrushOffsets(5).length).toBeGreaterThan(12);
  });

  it('maps slow to filling the circle in 2.5 seconds and fast in half a second', () => {
    const cells = listCircleBrushOffsets(8).length;
    expect(getSprayTilesPerSecond(8, 0)).toBe((cells / 5) * 2);
    expect(getSprayTilesPerSecond(8, 1)).toBe(cells * 2);
  });

  it('sprays anywhere until 90% already matches, then only fills unmatched cells', () => {
    const offsets = [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 2, dy: 0 },
      { dx: 3, dy: 0 },
      { dx: 4, dy: 0 },
      { dx: 5, dy: 0 },
      { dx: 6, dy: 0 },
      { dx: 7, dy: 0 },
      { dx: 8, dy: 0 },
      { dx: 9, dy: 0 },
    ];
    expect(pickSprayOffset(offsets, (dx) => dx !== 0, () => 0.99)).toEqual({ dx: 0, dy: 0 });
    expect(pickSprayOffset(offsets, (dx) => dx < 5, () => 0.99)).toEqual({ dx: 9, dy: 0 });
  });

  it('erases occupied cells and prefers authored tiles when both exist', () => {
    const offsets = [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 2, dy: 0 }];
    expect(pickSprayEraseOffset(offsets, (dx) => dx > 0, () => 0)).toEqual({ dx: 1, dy: 0 });
    expect(pickSprayEraseOffset(offsets, (dx) => dx > 0, () => 0, (dx) => dx === 2)).toEqual({ dx: 2, dy: 0 });
    expect(pickSprayEraseOffset(offsets, () => false, () => 0)).toBeNull();
  });

  it('uses world pattern coordinates or a shuffle pick', () => {
    expect(sampleSprayTileValue(0, 0, [10, 20], 'pattern')).toBe(10);
    expect(sampleSprayTileValue(1, 0, [10, 20], 'pattern')).toBe(20);
    expect(sampleSprayTileValue(0, 0, [10, 20], 'shuffle', () => 0.9)).toBe(20);
  });
});
