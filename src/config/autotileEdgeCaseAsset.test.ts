import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AUTOTILE_EDGE_CASES_DESERT_TILESET_KEY,
  getTilesetByKey,
} from './tilesets';

const TILE_SIZE = 16;

function opaqueColorsForTile(data: Buffer, width: number, localIndex: number): Set<string> {
  const colors = new Set<string>();
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = localIndex * TILE_SIZE; x < (localIndex + 1) * TILE_SIZE; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] === 0) continue;
      colors.add([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
      ].join(','));
    }
  }
  return colors;
}

describe('Desert autotile edge-case atlas', () => {
  it('contains only the exact alpha-isolated E5, C3, and C6 source colors', async () => {
    const { data, info } = await sharp(
      'public/assets/tilesets/autotile-edge-cases-desert.png',
    ).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    expect([info.width, info.height]).toEqual([48, 16]);
    expect([...opaqueColorsForTile(data, info.width, 0)]).toEqual(['189,155,132,255']);
    expect([...opaqueColorsForTile(data, info.width, 1)].sort()).toEqual([
      '249,146,82,255',
      '255,248,207,255',
    ]);
    expect([...opaqueColorsForTile(data, info.width, 2)].sort()).toEqual([
      '249,146,82,255',
      '255,248,207,255',
    ]);
  });

  it('registers the atlas for rendering but hides it from manual editor selection', () => {
    const tileset = getTilesetByKey(AUTOTILE_EDGE_CASES_DESERT_TILESET_KEY);
    expect(tileset).toMatchObject({
      imageWidth: 48,
      imageHeight: 16,
      columns: 3,
      rows: 1,
      tileCount: 3,
      editorHidden: true,
    });
  });
});
