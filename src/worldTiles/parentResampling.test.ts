import { describe, expect, it } from 'vitest';
import { downsampleWorldTileParentRgba } from './parentResampling';

describe('world tile parent resampling', () => {
  it('uses the representative box-average color instead of one highlighted source pixel', () => {
    const source = new Uint8ClampedArray([
      82, 177, 85, 255,
      142, 196, 76, 255,
      103, 183, 91, 255,
      82, 177, 85, 255,
    ]);

    expect([...downsampleWorldTileParentRgba(source, 2, 2)])
      .toEqual([102, 183, 84, 255]);
  });

  it('averages transparent edges in premultiplied-alpha space', () => {
    const source = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 128,
      0, 0, 255, 0,
      255, 255, 255, 0,
    ]);

    expect([...downsampleWorldTileParentRgba(source, 2, 2)])
      .toEqual([170, 85, 0, 96]);
  });

  it('rejects malformed or odd-sized parent sources', () => {
    expect(() => downsampleWorldTileParentRgba(new Uint8ClampedArray(12), 3, 1))
      .toThrow('positive even-sized RGBA image');
  });
});
