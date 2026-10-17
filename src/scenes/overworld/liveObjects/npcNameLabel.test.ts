import { describe, expect, it } from 'vitest';
import {
  quantizeNpcNamePixels,
  resolveNpcNameLabelResolution,
} from './npcNameLabel';

describe('NPC name label sharpness', () => {
  it('renders the pixel font at an integer camera scale', () => {
    expect(resolveNpcNameLabelResolution(2)).toBe(2);
    expect(resolveNpcNameLabelResolution(2.4)).toBe(2);
    expect(resolveNpcNameLabelResolution(0.18)).toBe(1);
    expect(resolveNpcNameLabelResolution(Number.NaN)).toBe(1);
  });

  it('snaps antialiased edges to solid ink or paper', () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 40,
      180, 180, 180, 200,
      40, 40, 50, 180,
      16, 21, 34, 255,
    ]);

    quantizeNpcNamePixels(pixels);

    expect(Array.from(pixels)).toEqual([
      255, 255, 255, 0,
      255, 255, 255, 255,
      16, 21, 34, 255,
      16, 21, 34, 255,
    ]);
  });
});
