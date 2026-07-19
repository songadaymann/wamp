import { describe, expect, it } from 'vitest';

import {
  getRoomMetadataBackgroundLayerLayout,
  getRoomMetadataObjectDrawRect,
} from './roomMetadataRenderLayout';

describe('room metadata renderer parity helpers', () => {
  it('stretches non-repeating backgrounds exactly once across the room', () => {
    expect(getRoomMetadataBackgroundLayerLayout(
      { width: 576, height: 324, repeat: false },
      640,
      352,
    )).toEqual({
      repeat: false,
      drawWidth: 640,
    });
  });

  it('uses the canonical integer-width tiling layout for repeating backgrounds', () => {
    expect(getRoomMetadataBackgroundLayerLayout(
      { width: 576, height: 324 },
      640,
      352,
    )).toEqual({
      repeat: true,
      drawWidth: 626,
    });
  });

  it('applies canonical object display offsets and scale', () => {
    expect(getRoomMetadataObjectDrawRect({
      frameWidth: 32,
      frameHeight: 32,
      displayScale: 1,
      displayOffset: { x: -8, y: 6 },
    }, { x: 80, y: 96 }, 16)).toEqual({
      x: 56,
      y: 86,
      width: 32,
      height: 32,
    });
    expect(getRoomMetadataObjectDrawRect({
      frameWidth: 48,
      frameHeight: 48,
      displayScale: 1.12,
      displayOffset: { x: 0, y: 8 },
    }, { x: 80, y: 96 }, 16)).toEqual({
      x: 53,
      y: 77,
      width: 54,
      height: 54,
    });
  });
});
