// Call chains (up to 9 frames) that lead to one function's self time in a measure.mts profile.
//
//   node scripts/engine-port/runtime-profile/chain.mts RUN_DIR boot|play FUNCTION [--dist DIR]
//
// FUNCTION is either a bare V8 function name or the "name@source:line" form this script prints.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT, outRoot, parseArgs } from '../lib.mts';

const require = createRequire(path.join(REPO_ROOT, 'package.json'));
const { SourceMapConsumer } = require('source-map-js');
const args = parseArgs();
const DIST = path.resolve(String(args.dist ?? path.join(outRoot(args), 'dist-perf')));
const [dir, which, fname] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!dir || !which || !fname) { console.error('usage: chain.mts RUN_DIR boot|play FUNCTION [--dist DIR]'); process.exit(2); }
const prof = JSON.parse(fs.readFileSync(path.join(dir, `${which}-profile.cpuprofile`), 'utf8'));
const maps = new Map();
const cons = (u) => {
  const f = u.replace(/^https?:\/\/[^/]+\//, '');
  if (!maps.has(f)) { try { maps.set(f, new SourceMapConsumer(JSON.parse(fs.readFileSync(path.join(DIST, f + '.map'), 'utf8')))); } catch { maps.set(f, null); } }
  return maps.get(f);
};
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map(); for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i + 1] ?? 0) / 1000);
const d = (cf) => {
  const c = cf.url && cons(cf.url);
  if (c) { const p = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber }); if (p.source) return `${cf.functionName || '?'}@${p.source.replace(/^(\.\.\/)+/, '').replace(/.*node_modules\/phaser\/dist\/phaser-arcade-physics.js/, 'PH')}:${p.line}`; }
  return cf.functionName;
};
const agg = {};
for (const [id, ms] of self) {
  const n = byId.get(id); if (d(n.callFrame) !== fname && n.callFrame.functionName !== fname) continue;
  const chain = []; let p = parent.get(id); while (p && chain.length < 9) { const s = d(byId.get(p).callFrame); if (s && s !== '(root)') chain.push(s); p = parent.get(p); }
  const k = chain.join(' < '); agg[k] = (agg[k] ?? 0) + ms;
}
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(v.toFixed(0).padStart(6), 'ms', k);
