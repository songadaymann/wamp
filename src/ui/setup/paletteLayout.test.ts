import { describe, expect, it } from 'vitest';
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
});
