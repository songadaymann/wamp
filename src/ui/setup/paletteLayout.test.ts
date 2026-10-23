import { describe, expect, it } from 'vitest';
import { TILESETS } from '../../config/tilesets';
import { getTilesetPaletteAvailableWidth, getTilesetPaletteScale } from './paletteLayout';

describe('tileset palette layout', () => {
  it('does not bake a 1x atlas while the hidden panel still reports no width', () => {
    expect(getTilesetPaletteScale(getTilesetPaletteAvailableWidth(0), 192)).toBeNull();
    expect(getTilesetPaletteScale(0, 192)).toBeNull();
  });

  it('scales the atlas to the visible container width', () => {
    expect(getTilesetPaletteScale(getTilesetPaletteAvailableWidth(388), 192)).toBeCloseTo(384 / 192);
    expect(getTilesetPaletteScale(96, 192)).toBe(1);
  });

  // The phone sheet leaves the picker 281px on a 320px phone and 351px on a 390px one. Phones draw
  // the atlas at most 2x, and the sheet scrolls it vertically, so only the width has to fit (F368).
  it.each([281, 351])('fits every tileset across a %ipx phone picker', (containerWidth) => {
    for (const ts of TILESETS) {
      const scale = getTilesetPaletteScale(getTilesetPaletteAvailableWidth(containerWidth), ts.imageWidth, 2);
      expect(scale, ts.key).not.toBeNull();
      expect(Math.floor(ts.imageWidth * scale!), ts.key).toBeLessThanOrEqual(containerWidth);
    }
  });
});
