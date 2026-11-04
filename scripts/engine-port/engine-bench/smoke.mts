// Quick check that every bench page runs: prints the GL renderer and a short result per page and
// saves a screenshot of each to <out-root>/engine-bench/results/shot-<engine>-<scenario>.png.
//
//   node scripts/engine-port/engine-bench/smoke.mts [--warm 30] [--n 60] [--out-root DIR]
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium, parseArgs } from '../lib.mts';
import { benchPaths, withBenchServer } from './serve.mts';

const args = parseArgs();
const WARM = Number(args.warm ?? 30), N = Number(args.n ?? 60);
const { results } = benchPaths(args);
fs.mkdirSync(results, { recursive: true });
let failed = 0;
await withBenchServer(args, async (base) => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => console.log('console:', m.text()));
    page.on('pageerror', (e) => { failed++; console.log('pageerror:', e.message); });
    for (const eng of ['phaser', 'mini']) for (const sc of ['play', 'playTilemap', 'worldmap']) {
      await page.goto(`${base}/${eng}.html?scenario=${sc}&warm=${WARM}&n=${N}`);
      await page.waitForFunction(() => window.__benchResult, null, { timeout: 30000 });
      const r = await page.evaluate(() => window.__benchResult);
      const gl = await page.evaluate(() => { const c = document.querySelector('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : String(!!g); });
      console.log(eng, sc, gl, JSON.stringify(r));
      await page.screenshot({ path: path.join(results, `shot-${eng}-${sc}.png`) });
    }
  } finally { await browser.close(); }
});
if (failed) process.exit(1);
