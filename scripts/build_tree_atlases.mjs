// Pack each authored tree family without changing any visible pixel or its original anchor.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import sharp from 'sharp';

const root = 'public/assets/objects/trees/devkidd';
const output = 'public/assets/objects/trees/atlases';
const check = process.argv.includes('--check');
mkdirSync(output, { recursive: true });
const manifestPath = 'src/assets/treeAtlasManifest.json';
const previousManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const manifest = {};
for (const family of readdirSync(root).sort()) {
  const entries = [];
  for (const filename of readdirSync(`${root}/${family}`).filter(f => f.endsWith('.png')).sort()) {
    const { data, info } = await sharp(`${root}/${family}/${filename}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = info.width, top = info.height, right = -1, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    }
    if (right < left) throw new Error(`Empty tree: ${family}/${filename}`);
    const trim = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    const image = await sharp(data, { raw: info }).extract({ left, top, width: trim.w, height: trim.h }).png().toBuffer();
    entries.push({ id: `tree_pack_${family.replaceAll('-', '_')}_${filename.slice(5, -4)}`, trim, width: info.width, height: info.height, image });
  }
  // Test bounded shelf widths and retain the smallest decoded texture. Preserve anchors
  // through sourceSize / spriteSourceSize rather than putting the transparent margins back.
  entries.sort((a, b) => b.trim.h - a.trim.h || a.id.localeCompare(b.id));
  let best;
  for (let limit = 256; limit <= 1024; limit += 32) {
    let x = 1, y = 1, rowHeight = 0, width = 0;
    const placements = [];
    for (const entry of entries) {
      if (x + entry.trim.w + 1 > limit) { x = 1; y += rowHeight + 2; rowHeight = 0; }
      placements.push({ entry, x, y });
      width = Math.max(width, x + entry.trim.w + 1);
      x += entry.trim.w + 2; rowHeight = Math.max(rowHeight, entry.trim.h);
    }
    const height = y + rowHeight + 1;
    if (height <= 2048 && (!best || width * height < best.width * best.height)) best = { width, height, placements };
  }
  if (!best) throw new Error(`Tree family exceeds mobile texture bounds: ${family}`);
  const { width, height, placements } = best;
  const frames = {}, composites = [];
  for (const { entry, x, y } of placements) {
    composites.push({ input: entry.image, left: x, top: y });
    frames[entry.id] = { frame: { x, y, w: entry.trim.w, h: entry.trim.h }, rotated: false, trimmed: true, spriteSourceSize: entry.trim, sourceSize: { w: entry.width, h: entry.height } };
  }
  const pixels = await sharp({ create: { width, height, channels: 4, background: '#00000000' } }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
  const atlas = Buffer.from(JSON.stringify({ frames, meta: { size: { w: width, h: height }, scale: '1' } }) + '\n');
  const version = createHash('sha256').update(pixels).update(atlas).digest('hex').slice(0, 12);
  const stem = `${family}-${version}`;
  for (const [suffix, bytes] of [['png', pixels], ['json', atlas]]) {
    const path = `${output}/${stem}.${suffix}`;
    if (check) { if (!readFileSync(path).equals(bytes)) throw new Error(`Stale tree atlas: ${path}`); }
    else writeFileSync(path, bytes);
  }
  manifest[family.replaceAll('-', '_')] = { key: `tree-atlas:${family}:${version}`, texturePath: `assets/objects/trees/atlases/${stem}.png`, atlasPath: `assets/objects/trees/atlases/${stem}.json` };
  console.log(`${family}: ${entries.length} trees, ${width}x${height}, ${pixels.length} bytes`);
}
const manifestText = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
if (check) { if (!readFileSync(manifestPath).equals(manifestText)) throw new Error('Stale tree atlas manifest'); }
else writeFileSync(manifestPath, manifestText);

if (!check) for (const asset of Object.values(previousManifest)) {
  for (const path of [asset.texturePath, asset.atlasPath]) {
    if (!Object.values(manifest).some(next => next.texturePath === path || next.atlasPath === path)) rmSync(`public/${path}`, { force: true });
  }
}
