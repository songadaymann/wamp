// Builds the two bench bundles (Phaser 3.90 and the throwaway minimal WebGL2 engine) with the same
// shared workload, records their sizes, and writes the HTML pages the runners load.
//
//   node scripts/engine-port/engine-bench/build.mts [--out-root DIR]
//
// Output: <out-root>/engine-bench/dist/{phaser,mini}{,.dev}.{js,html}, phaserx.{js,html}
// (minified Phaser with esbuild's default legal comments, used by gpucheck.mts), and
// <out-root>/engine-bench/results/{sizes,bundle-ranges}.json.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { build } from 'esbuild';
import { REPO_ROOT, parseArgs } from '../lib.mts';
import { benchPaths } from './serve.mts';

const here = path.dirname(new URL(import.meta.url).pathname);
const { dist, results } = benchPaths(parseArgs());
// Same alias WAMP uses (vite.config.ts): the Arcade-physics build of Phaser.
const phaserPath = path.join(REPO_ROOT, 'node_modules/phaser/dist/phaser-arcade-physics.js');
const phaserVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules/phaser/package.json'), 'utf8')).version;
const common = { bundle: true, format: 'iife', target: 'es2020', alias: { phaser: phaserPath }, logLevel: 'warning', absWorkingDir: REPO_ROOT };
const sizeOf = (buf) => ({ raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length, brotli: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length });
const sizes = {};
for (const [name, entry] of [['phaser', 'phaser/main.mts'], ['mini', 'mini/main.mts']]) {
  for (const minify of [true, false]) {
    const out = `${name}${minify ? '' : '.dev'}.js`;
    await build({ ...common, entryPoints: [path.join(here, entry)], minify, outfile: path.join(dist, out), legalComments: 'none' });
    sizes[`dist/${out}`] = sizeOf(fs.readFileSync(path.join(dist, out)));
  }
}
await build({ ...common, entryPoints: [path.join(here, 'phaser/main.mts')], minify: true, outfile: path.join(dist, 'phaserx.js') });
// common.mts alone (shared workload code present in both bundles)
const commonOnly = await build({ ...common, entryPoints: [path.join(here, 'common/common.mts')], minify: true, write: false });
const cb = Buffer.from(commonOnly.outputFiles[0].contents);
sizes['common-only(min)'] = { raw: cb.length, brotli: zlib.brotliCompressSync(cb).length };
fs.mkdirSync(results, { recursive: true });
fs.writeFileSync(path.join(results, 'sizes.json'), JSON.stringify(sizes, null, 2));
console.log(sizes);
const page = (src) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}</style></head><body><script>window.__t0=performance.now()</script><script src="${src}"></script></body></html>`;
for (const n of ['phaser', 'mini', 'phaserx']) for (const dev of n === 'phaserx' ? [''] : ['', '.dev']) fs.writeFileSync(path.join(dist, `${n}${dev}.html`), page(`${n}${dev}.js`));

// Line ranges of each module in the unminified bundles, so profile.mts can say whether a sample
// was in the engine or in the bench code. esbuild marks each module with a "// path" line.
const label = (file) => {
  if (file.includes('node_modules/phaser/')) return `Phaser ${phaserVersion} library`;
  if (file.endsWith('mini/engine.mts')) return 'mini engine core';
  if (file.endsWith('mini/main.mts')) return 'bench scene/workload code (incl. mini render submission)';
  return 'bench scene/workload code';
};
const ranges = {};
for (const name of ['phaser', 'mini']) {
  const lines = fs.readFileSync(path.join(dist, `${name}.dev.js`), 'utf8').split('\n');
  const marks = [];
  lines.forEach((l, i) => { const m = /^\s*\/\/ ((?:node_modules|scripts)\/\S+\.(?:js|mjs|mts))$/.exec(l); if (m) marks.push([i + 1, m[1]]); });
  ranges[name] = marks.map(([start, file], i) => [start, i + 1 < marks.length ? marks[i + 1][0] - 1 : 1e9, label(file), file]);
}
fs.writeFileSync(path.join(results, 'bundle-ranges.json'), JSON.stringify(ranges, null, 1));
console.log('bundle ranges', Object.fromEntries(Object.entries(ranges).map(([k, v]) => [k, v.map(([a, b, l]) => `${a}-${b} ${l}`)])));
