import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES,
  AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID,
  AUTOTILE_EDGE_CASES_DESERT_TILESET_KEY,
  getTerrainCollisionProfileForGid,
  getTilesetByKey,
} from './tilesets';

const TILE_SIZE = 16;
const atlasPath = 'public/assets/tilesets/autotile-edge-cases-desert.png';
const authoredSourceDir = 'public/assets/tilesets/autotile-edge-cases/desert';

async function readRawTile(path: string, left = 0): Promise<Buffer> {
  const { data, info } = await sharp(path)
    .extract({ left, top: 0, width: TILE_SIZE, height: TILE_SIZE })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([info.width, info.height, info.channels]).toEqual([16, 16, 4]);
  return data;
}

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
  it('packs the artist-authored B4/B5 replacements without changing a pixel', async () => {
    const b4 = await readRawTile(`${authoredSourceDir}/horizontal-ledge-middle-b4.png`);
    const b5 = await readRawTile(`${authoredSourceDir}/horizontal-ledge-middle-b5.png`);
    const packedB4 = await readRawTile(
      atlasPath,
      AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.horizontalLedgeMiddleB4 * TILE_SIZE,
    );
    const packedB5 = await readRawTile(
      atlasPath,
      AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.horizontalLedgeMiddleB5 * TILE_SIZE,
    );

    expect(packedB4).toEqual(b4);
    expect(packedB5).toEqual(b5);
  });

  it('contains only the exact alpha-isolated C3 and C6 seam colors', async () => {
    const { data, info } = await sharp(atlasPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect([info.width, info.height]).toEqual([64, 16]);
    expect([...opaqueColorsForTile(
      data,
      info.width,
      AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.thickBodySeamC3,
    )].sort()).toEqual([
      '249,146,82,255',
      '255,248,207,255',
    ]);
    expect([...opaqueColorsForTile(
      data,
      info.width,
      AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.thickBodySeamC6,
    )].sort()).toEqual([
      '249,146,82,255',
      '255,248,207,255',
    ]);
  });

  it('registers the atlas for rendering but hides it from manual editor selection', () => {
    const tileset = getTilesetByKey(AUTOTILE_EDGE_CASES_DESERT_TILESET_KEY);
    expect(tileset).toMatchObject({
      imageWidth: 64,
      imageHeight: 16,
      columns: 4,
      rows: 1,
      tileCount: 4,
      editorHidden: true,
    });
    expect(getTerrainCollisionProfileForGid(
      AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID
        + AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.horizontalLedgeMiddleB4,
    ).id).toBe('decoratedTop');
    expect(getTerrainCollisionProfileForGid(
      AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID
        + AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.thickBodySeamC3,
    ).id).toBe('none');
  });
});
