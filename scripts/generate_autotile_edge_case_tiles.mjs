import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const TILE_SIZE = 16;
const sourcePath = 'public/assets/tilesets/tileset_desert.png';
const authoredSourceDir = 'public/assets/tilesets/autotile-edge-cases/desert';
const outputPath = 'public/assets/tilesets/autotile-edge-cases-desert.png';

const colors = {
  desertSand: '255,248,207,255',
  desertSandEdge: '249,146,82,255',
};

const tiles = [
  // Local 0: artist-authored finished replacement for Desert B4/local 15.
  { source: `${authoredSourceDir}/horizontal-ledge-middle-b4.png` },
  // Local 1: artist-authored finished replacement for Desert B5/local 16.
  { source: `${authoredSourceDir}/horizontal-ledge-middle-b5.png` },
  // Local 2: Desert C3/local 26 with only the sand surface retained.
  { column: 2, row: 2, keep: new Set([colors.desertSand, colors.desertSandEdge]) },
  // Local 3: Desert C6/local 29 with only the sand surface retained.
  { column: 5, row: 2, keep: new Set([colors.desertSand, colors.desertSandEdge]) },
];

const atlas = Buffer.alloc(tiles.length * TILE_SIZE * TILE_SIZE * 4);

for (const [tileIndex, tile] of tiles.entries()) {
  const image = sharp(tile.source ?? sourcePath);
  if (!tile.source) {
    image.extract({
      left: tile.column * TILE_SIZE,
      top: tile.row * TILE_SIZE,
      width: TILE_SIZE,
      height: TILE_SIZE,
    });
  }
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== TILE_SIZE || info.height !== TILE_SIZE) {
    throw new Error(`${tile.source ?? sourcePath} must resolve to a ${TILE_SIZE} x ${TILE_SIZE} tile`);
  }

  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const sourceOffset = (y * TILE_SIZE + x) * 4;
      const targetOffset = (y * tiles.length * TILE_SIZE + tileIndex * TILE_SIZE + x) * 4;
      const rgba = `${data[sourceOffset]},${data[sourceOffset + 1]},${data[sourceOffset + 2]},${data[sourceOffset + 3]}`;
      if (tile.keep && !tile.keep.has(rgba)) continue;
      data.copy(atlas, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
await sharp(atlas, {
  raw: {
    width: tiles.length * TILE_SIZE,
    height: TILE_SIZE,
    channels: 4,
  },
}).png().toFile(outputPath);

console.log(`Wrote ${outputPath}`);
