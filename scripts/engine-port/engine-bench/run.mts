// Alternating A/B runs of the Phaser and minimal-engine bench pages, a fresh browser per run.
// Per run it records per-frame JS (update + render), draw calls, buffer bytes, frame interval,
// init timings and heap.
//
//   node scripts/engine-port/engine-bench/run.mts [--reps 3] [--warm 90] [--n 300]
//        [--throttles 1,4] [--scenarios play,playTilemap,worldmap,play&dens=4] [--out-root DIR]
//
// Writes <out-root>/engine-bench/results/runs.json after every run; aggregate.mts summarises it.
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium, parseArgs } from '../lib.mts';
import { benchPaths, withBenchServer } from './serve.mts';

const args = parseArgs();
const REPS = Number(args.reps ?? 3), WARM = Number(args.warm ?? 90), N = Number(args.n ?? 300);
const throttles = String(args.throttles ?? '1,4').split(',').map(Number);
const allConds = [
  { sc: 'play', engines: ['phaser', 'mini', 'mini&cull=0'] },
  { sc: 'playTilemap', engines: ['phaser', 'mini'] },
  { sc: 'worldmap', engines: ['phaser', 'mini'] },
  { sc: 'play&dens=4', engines: ['phaser', 'mini&cull=0'] },
];
const wanted = args.scenarios ? new Set(String(args.scenarios).split(',')) : null;
const conds = wanted ? allConds.filter((c) => wanted.has(c.sc)) : allConds;
const { results } = benchPaths(args);
fs.mkdirSync(results, { recursive: true });
const outFile = path.join(results, 'runs.json');
const out = [];

async function one(base, engine, sc, throttle) {
  const [eng, extra] = engine.split(/&(.*)/s);
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await cdp.send('Performance.enable');
    await page.goto(`${base}/${eng}.html?scenario=${sc}${extra ? '&' + extra : ''}&warm=${WARM}&n=${N}`);
    await page.waitForFunction(() => window.__benchResult, null, { timeout: 180000, polling: 500 });
    const r = await page.evaluate(() => window.__benchResult);
    await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    return { engine, sc, throttle, ...r, heapUsedMB: heap.usedSize / 1048576, heapTotalMB: heap.totalSize / 1048576, scriptDurationS: m.ScriptDuration, taskDurationS: m.TaskDuration, nodes: m.Nodes };
  } finally { await browser.close(); }
}

await withBenchServer(args, async (base) => {
  for (const throttle of throttles) for (const c of conds) for (let rep = 0; rep < REPS; rep++) for (const e of c.engines) {
    const t = Date.now();
    const r = await one(base, e, c.sc, throttle); r.rep = rep; out.push(r);
    console.log(`${throttle}x ${c.sc} ${e} rep${rep}: tot=${r.totMean.toFixed(3)}ms(med ${r.totMed.toFixed(2)}) upd=${r.updMed.toFixed(3)} rnd=${r.rndMed.toFixed(3)} dc=${r.dcMed} init=${(r.tFirstFrame - r.t0).toFixed(0)} heap=${r.heapUsedMB.toFixed(1)}MB int=${r.intervalMed.toFixed(1)} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  }
});
console.log('wrote', outFile);
