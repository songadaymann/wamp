// Medians across reps of run.mts results, one row per throttle | scenario | engine.
//
//   node scripts/engine-port/engine-bench/aggregate.mts [RUNS_JSON] [--out-root DIR]
//
// RUNS_JSON defaults to <out-root>/engine-bench/results/runs.json; writes summary.json beside it.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../lib.mts';
import { benchPaths } from './serve.mts';

const args = parseArgs();
const file = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--')) ?? path.join(benchPaths(args).results, 'runs.json');
const runs = JSON.parse(fs.readFileSync(file, 'utf8'));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const groups = {};
for (const r of runs) (groups[`${r.throttle}x | ${r.sc} | ${r.engine}`] ||= []).push(r);
const f = (x, d = 3) => x.toFixed(d);
const rows = [];
for (const [k, g] of Object.entries(groups)) {
  const m = (fn) => med(g.map(fn));
  rows.push({ k, n: g.length, totMean: f(m((r) => r.totMean)), totMed: f(m((r) => r.totMed)), totP95: f(m((r) => r.totP95)), upd: f(m((r) => r.updMed)), rnd: f(m((r) => r.rndMed)), dc: m((r) => r.dcMed), bufKB: f(m((r) => r.bufBytesMed) / 1024, 1), interval: f(m((r) => r.intervalMed), 1),
    parse: f(m((r) => r.tEvalStart - r.t0), 0), libEval: f(m((r) => r.tImported - r.tEvalStart), 0), gen: f(m((r) => r.genMs), 0), engineInitToFirstFrame: f(m((r) => r.tFirstFrame - r.tImported - r.genMs), 0), firstFrame: f(m((r) => r.tFirstFrame - r.t0), 0), heapMB: f(m((r) => r.heapUsedMB), 1), spread: `${f(Math.min(...g.map((r) => r.totMean)))}-${f(Math.max(...g.map((r) => r.totMean)))}` });
}
console.table(rows);
fs.writeFileSync(path.join(path.dirname(file), 'summary.json'), JSON.stringify(rows, null, 1));
