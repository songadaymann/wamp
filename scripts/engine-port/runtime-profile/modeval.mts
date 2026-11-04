// Top-level module evaluation time per chunk in the boot CPU profile, plus the game's boot phases.
//
//   node scripts/engine-port/runtime-profile/modeval.mts RUN_DIR
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: modeval.mts RUN_DIR'); process.exit(2); }
const prof = JSON.parse(fs.readFileSync(path.join(dir, 'boot-profile.cpuprofile'), 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map(); for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i + 1] ?? 0) / 1000);
const incl = (id) => (self.get(id) ?? 0) + (byId.get(id).children ?? []).reduce((a, c) => a + incl(c), 0);
const root = prof.nodes[0]; const agg = {};
for (const c of root.children ?? []) {
  const cf = byId.get(c).callFrame;
  if (!cf.url) continue;
  const f = cf.url.split('/').pop();
  const key = `${/phaser-vendor/.test(f) ? 'phaser-vendor' : /^main-/.test(f) ? 'main(app)' : f} top-level fn@${cf.lineNumber}:${cf.columnNumber} ${cf.functionName || '(module)'}`;
  if (cf.lineNumber === 0 && cf.columnNumber === 0) agg[key] = (agg[key] ?? 0) + incl(c);
}
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(v.toFixed(1).padStart(8), 'ms', k);
const page = JSON.parse(fs.readFileSync(path.join(dir, 'boot-page.json'), 'utf8'));
console.log('phases', (page.boot ?? []).filter((b, i, a) => a.findIndex((x) => x.phase === b.phase) === i).map((b) => `${b.phase}=${b.elapsedMs}`).join(' '));
console.log('firstGLdraw', page.firstDrawAt?.toFixed(0), 'wall firstDraw', page.firstDrawWall, 'wall ready', page.readyWall);
