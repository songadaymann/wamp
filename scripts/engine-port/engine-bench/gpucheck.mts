// Does Phaser's multi-texture batching shader explain its slower frame interval on SwiftShader?
// Compares Phaser with maxTextures -1 (all units) and 1 against the minimal engine without culling.
//
//   node scripts/engine-port/engine-bench/gpucheck.mts [--reps 2] [--warm 60] [--n 200] [--out-root DIR]
import { launchChromium, parseArgs } from '../lib.mts';
import { withBenchServer } from './serve.mts';

const args = parseArgs();
const REPS = Number(args.reps ?? 2), WARM = Number(args.warm ?? 60), N = Number(args.n ?? 200);
await withBenchServer(args, async (base) => {
  for (let rep = 0; rep < REPS; rep++) for (const q of ['phaserx.html?maxTextures=-1', 'phaserx.html?maxTextures=1', 'mini.html?cull=0']) {
    const browser = await launchChromium();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`${base}/${q}&scenario=play&warm=${WARM}&n=${N}`);
      await page.waitForFunction(() => window.__benchResult, null, { timeout: 120000, polling: 500 });
      const r = await page.evaluate(() => window.__benchResult);
      console.log(rep, q, 'intervalMed', r.intervalMed.toFixed(1), 'jsMean', r.totMean.toFixed(3), 'dc', r.dcMed);
    } finally { await browser.close(); }
  }
});
