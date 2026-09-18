import { describe, expect, it } from 'vitest';
import { TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG, encodeTileDataValue } from '../../config';
import { encodedTilesMatchForFlood } from './floodFillMatch';

describe('floodFillMatch', () => {
  it('treats flip bits as distinct unless ignore-flipping is on', () => {
    const plain = encodeTileDataValue(12, false, false);
    const flippedX = encodeTileDataValue(12, true, false);
    const flippedY = encodeTileDataValue(12, false, true);
    const other = encodeTileDataValue(13, false, false);

    expect(encodedTilesMatchForFlood(plain, flippedX, false)).toBe(false);
    expect(encodedTilesMatchForFlood(plain, flippedY, false)).toBe(false);
    expect(encodedTilesMatchForFlood(plain, flippedX, true)).toBe(true);
    expect(encodedTilesMatchForFlood(plain, flippedY, true)).toBe(true);
    expect(encodedTilesMatchForFlood(flippedX, flippedY, true)).toBe(true);
    expect(encodedTilesMatchForFlood(plain, other, true)).toBe(false);
    expect(encodedTilesMatchForFlood(-1, -1, true)).toBe(true);
    expect(encodedTilesMatchForFlood(-1, plain, true)).toBe(false);
    expect(flippedX).toBe(12 + TILE_FLIP_X_FLAG);
    expect(flippedY).toBe(12 + TILE_FLIP_Y_FLAG);
  });
});
