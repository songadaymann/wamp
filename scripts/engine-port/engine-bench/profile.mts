// CDP CPU profile of the measured window on the unminified bundles, 1x and 4x. Each sample is put
// in a category by the bundle line range of its module (results/bundle-ranges.json from build.mts).
//
//   node scripts/engine-port/engine-bench/profile.mts [--warm 60] [--n 300] [--throttles 1,4]
//        [--scenarios play,worldmap,play&dens=4] [--out-root DIR]
//
// Writes <out-root>/engine-bench/results/profile.json.
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium, parseArgs } from '../lib.mts';
import { benchPaths, withBenchServer } from './serve.mts';

const args = parseArgs();
const WARM = Number(args.warm ?? 60), N = Number(args.n ?? 300);
const throttles = String(args.throttles ?? '1,4').split(',').map(Number);
const scenarios = String(args.scenarios ?? 'play,worldmap,play&dens=4').split(',');
const { results } = benchPaths(args);
const ranges = JSON.parse(fs.readFileSync(path.join(results, 'bundle-ranges.json'), 'utf8'));
const res = {};
await withBenchServer(args, async (base) => {
  for (const throttle of throttles) for (const sc of scenarios) for (const eng of ['phaser', 'mini']) {
    const browser = await launchChromium();
    let profile, r;
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      await page.goto(`${base}/${eng}.dev.html?scenario=${sc}&warm=${WARM}&n=${N}`);
      await page.waitForFunction((warm) => window.__bench && window.__bench.frame > warm, WARM, { polling: 50, timeout: 120000 });
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
      await page.waitForFunction(() => window.__benchResult, null, { polling: 500, timeout: 180000 });
      ({ profile } = await cdp.send('Profiler.stop'));
      r = await page.evaluate(() => window.__benchResult);
    } finally { await browser.close(); }
    const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i]; self.set(id, (self.get(id) || 0) + (profile.timeDeltas[i] || 0)); }
    const cat = {}, fn = {};
    for (const [id, us] of self) {
      const cf = byId.get(id).callFrame; let c;
      if (cf.functionName === '(idle)') c = 'idle'; else if (cf.functionName === '(garbage collector)') c = 'GC'; else if (cf.functionName === '(program)') c = '(program: browser/V8 native outside JS)';
      else if (!cf.url) c = 'native builtins/bindings (WebGL calls etc.)';
      else if (cf.url.includes(`/${eng}.dev.js`)) { const ln = cf.lineNumber + 1; c = (ranges[eng].find(([a, b]) => ln >= a && ln <= b) || [0, 0, 'other bundle'])[2]; }
      else c = 'other: ' + cf.url.slice(-40);
      cat[c] = (cat[c] || 0) + us / 1000;
      if (c !== 'idle') { const k = `${cf.functionName || '(anon)'} [${c.split(' ')[0]}${cf.url ? ':' + (cf.lineNumber + 1) : ''}]`; fn[k] = (fn[k] || 0) + us / 1000; }
    }
    const key = `${throttle}x ${sc} ${eng}`;
    res[key] = {
      windowMs: (profile.endTime - profile.startTime) / 1000, frames: N, totMean: r.totMean,
      perFrameMsByCategory: Object.fromEntries(Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / N).toFixed(4)])),
      topFunctionsMsPerFrame: Object.entries(fn).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${k} ${(v / N).toFixed(4)}`),
    };
    console.log(key, JSON.stringify(res[key].perFrameMsByCategory));
    fs.writeFileSync(path.join(results, 'profile.json'), JSON.stringify(res, null, 1));
  }
});
