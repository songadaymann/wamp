// Self time from a measure.mts CPU profile: by chunk, by source file (through the build's hidden
// source maps), top functions, and native self time attributed to the nearest JS caller.
//
//   node scripts/engine-port/runtime-profile/analyze.mts RUN_DIR [boot|play] [--dist DIR]
//
// --dist defaults to <out-root>/dist-perf, the build the profile ran against. Writes
// RUN_DIR/<which>-analysis.txt and prints the same text.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT, outRoot, parseArgs } from '../lib.mts';

const require = createRequire(path.join(REPO_ROOT, 'package.json'));
const { SourceMapConsumer } = require('source-map-js');
const args = parseArgs();
const DIST = path.resolve(String(args.dist ?? path.join(outRoot(args), 'dist-perf')));
const [dir, which = 'play'] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!dir) { console.error('usage: analyze.mts RUN_DIR [boot|play] [--dist DIR]'); process.exit(2); }
const prof = JSON.parse(fs.readFileSync(path.join(dir, `${which}-profile.cpuprofile`), 'utf8'));
const maps = new Map();
function consumer(url) {
  const file = url.replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
  if (maps.has(file)) return maps.get(file);
  let c = null;
  try { c = new SourceMapConsumer(JSON.parse(fs.readFileSync(path.join(DIST, file + '.map'), 'utf8'))); } catch { /* no map for this file */ }
  maps.set(file, c);
  return c;
}
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < prof.samples.length; i++) {
  const dt = (prof.timeDeltas[i + 1] ?? 0) / 1000; // the delta after sample i is the time spent in it
  self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + dt);
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
function category(cf) {
  const u = cf.url;
  if (!u) return cf.functionName.startsWith('(') ? cf.functionName : '(native/no-url)';
  if (/phaser-vendor/.test(u)) return 'phaser-vendor';
  if (/main-.*\.js/.test(u)) return 'app:main';
  if (/room-data/.test(u)) return 'app:room-data';
  if (/127\.0\.0\.1|localhost/.test(u)) return 'app:other-chunks';
  return 'other:' + u.slice(0, 60);
}
const cats = {}; const fns = new Map(); const srcFiles = {};
for (const [id, ms] of self) {
  const cf = byId.get(id).callFrame;
  const cat = category(cf); cats[cat] = (cats[cat] ?? 0) + ms;
  let src = '', name = cf.functionName || '(anonymous)';
  if (cf.url && cf.lineNumber >= 0) {
    const c = consumer(cf.url);
    if (c) {
      const p = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
      if (p.source) { src = `${p.source.replace(/^(\.\.\/)+/, '').replace(/.*node_modules\//, 'node_modules/')}:${p.line}`; if (p.name) name = `${name}~${p.name}`; }
    }
  }
  const file = src.split(':')[0] || cat;
  const key = `${name} @ ${src || cat}`;
  fns.set(key, (fns.get(key) ?? 0) + ms);
  // group app/phaser by source dir
  const grp = file.startsWith('node_modules/phaser/src/') ? 'phaser/' + file.split('/').slice(3, 5).join('/') : file.startsWith('src/') ? file.split('/').slice(0, 3).join('/') : file.startsWith('node_modules/') ? file.split('/').slice(0, 2).join('/') : file;
  srcFiles[grp] = (srcFiles[grp] ?? 0) + ms;
}
const fmt = (o, k = 30) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([n, v]) => `${v.toFixed(1).padStart(8)} ms ${(100 * v / total).toFixed(1).padStart(5)}%  ${n}`).join('\n');
const text = [`profile ${which} total sampled ${total.toFixed(0)} ms, samples ${prof.samples.length}`, '--- by category', fmt(cats), '--- by source group', fmt(srcFiles, 35), '--- top functions (self)', fmt(Object.fromEntries(fns), 30)].join('\n');
fs.writeFileSync(path.join(dir, `${which}-analysis.txt`), text);
console.log(text);
// native self time attributed to the nearest JS caller with a URL
const parent = new Map(); for (const n of prof.nodes) for (const ch of n.children ?? []) parent.set(ch, n.id);
function describe(cf) {
  const c = cf.url ? consumer(cf.url) : null;
  if (c && cf.lineNumber >= 0) { const p = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber }); if (p.source) return `${cf.functionName}~${p.name ?? ''} @ ${p.source.replace(/^(\.\.\/)+/, '').replace(/.*node_modules\//, 'node_modules/')}:${p.line}`; }
  return `${cf.functionName} @ ${cf.url}`;
}
const nat = {}; const natCat = {};
for (const [id, ms] of self) {
  const cf = byId.get(id).callFrame;
  if (cf.url || cf.functionName.startsWith('(')) continue;
  let p = parent.get(id); while (p && !byId.get(p).callFrame.url) p = parent.get(p);
  const caller = p ? describe(byId.get(p).callFrame) : '(none)';
  const key = `${cf.functionName} <- ${caller}`; nat[key] = (nat[key] ?? 0) + ms;
  const cc = p ? category(byId.get(p).callFrame) : '(none)'; natCat[cc] = (natCat[cc] ?? 0) + ms;
}
const text2 = ['--- native self time by calling chunk', fmt(natCat), '--- native self time by caller', fmt(nat, 25)].join('\n');
fs.appendFileSync(path.join(dir, `${which}-analysis.txt`), '\n' + text2);
console.log(text2);
