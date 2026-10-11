// Losslessly recompresses committed PNG art. A file is rewritten only when a re-encode
// decodes to byte-identical RGBA pixels and is smaller. The original's colour-management
// chunks (gAMA, cHRM, iCCP, sRGB) are copied into the new file unchanged, so browsers
// display it exactly as before; 16-bit files are left alone.
//
//   node scripts/optimize_png_assets.mjs [dir ...]          rewrite in place
//   node scripts/optimize_png_assets.mjs --check [dir ...]  fail if any PNG would shrink > 10%
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const check = args.includes('--check');
const roots = args.filter((arg) => !arg.startsWith('--'));
const CHECK_THRESHOLD = 0.1;
const COLOUR_CHUNKS = new Set(['gAMA', 'cHRM', 'iCCP', 'sRGB']);
// Delivered artist files whose exact bytes are pinned by a test.
const KEEP_BYTES = new Set([
  'public/assets/tilesets/rr_extras.png', // src/config/autotileEdgeCaseAsset.test.ts
]);

function listPngs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listPngs(path);
    return name.toLowerCase().endsWith('.png') ? [path] : [];
  });
}

function chunks(bytes) {
  const list = [];
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    list.push({ type: bytes.toString('latin1', offset + 4, offset + 8), bytes: bytes.subarray(offset, offset + 12 + length) });
    offset += 12 + length;
  }
  return list;
}

/** The encoded PNG with the original's colour chunks (whole, CRC included) right after IHDR. */
function withOriginalColourChunks(original, encoded) {
  const colour = chunks(original).filter((chunk) => COLOUR_CHUNKS.has(chunk.type)).map((chunk) => chunk.bytes);
  const [ihdr, ...rest] = chunks(encoded).filter((chunk) => !COLOUR_CHUNKS.has(chunk.type));
  return Buffer.concat([encoded.subarray(0, 8), ihdr.bytes, ...colour, ...rest.map((chunk) => chunk.bytes)]);
}

async function rgba(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function bestLosslessEncode(bytes) {
  const original = await rgba(bytes);
  const candidates = (await Promise.all([
    sharp(bytes).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer(),
    sharp(bytes).png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 256, dither: 0, effort: 10 }).toBuffer().catch(() => null),
  ])).map((candidate) => candidate && withOriginalColourChunks(bytes, candidate));
  let best = null;
  for (const candidate of candidates) {
    if (!candidate || candidate.length >= (best?.length ?? bytes.length)) continue;
    const decoded = await rgba(candidate);
    if (decoded.width === original.width && decoded.height === original.height && decoded.data.equals(original.data)) best = candidate;
  }
  return best;
}

let before = 0;
let after = 0;
let rewritten = 0;
const oversized = [];
for (const path of (roots.length ? roots : ['public/assets']).flatMap(listPngs).sort()) {
  const bytes = readFileSync(path);
  before += bytes.length;
  const meta = await sharp(bytes).metadata();
  if (meta.depth === 'ushort' || KEEP_BYTES.has(path)) { after += bytes.length; continue; }
  const best = await bestLosslessEncode(bytes);
  if (!best) { after += bytes.length; continue; }
  after += best.length;
  if (check) {
    if (1 - best.length / bytes.length > CHECK_THRESHOLD) oversized.push(`${path} ${bytes.length} -> ${best.length}`);
  } else {
    writeFileSync(path, best);
    rewritten += 1;
  }
}
console.log(`${check ? 'Could save' : 'Saved'} ${((before - after) / 1024).toFixed(0)} KB (${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB)${check ? '' : `, ${rewritten} files rewritten`}.`);
if (check && oversized.length) {
  console.error(`${oversized.length} PNGs shrink by more than ${CHECK_THRESHOLD * 100}% losslessly. Run: node scripts/optimize_png_assets.mjs`);
  for (const line of oversized.slice(0, 20)) console.error(`  ${line}`);
  process.exit(1);
}
