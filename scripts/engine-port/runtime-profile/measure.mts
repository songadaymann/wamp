// Runtime attribution for the real WAMP client: boot trace and CPU profile, then a measured play
// or world-map window with CPU profile, frame times, WebGL call counts, heap and texture census.
//
//   node scripts/engine-port/runtime-profile/measure.mts [--scenario play|map] [--throttle 1|4]
//        [--dpr 2] [--play-ms 20000] [--out DIR] [--out-root DIR] [--base-url URL]
//        [--start-preview] [--boot-only] [--chrome-args a,b] [--cdp ENDPOINT]
//
// Needs the scratch build (build.mts) served on --base-url (default http://127.0.0.1:3000);
// --start-preview starts and stops that server for you. /api/* is answered by the repo's
// hermetic replay (scripts/lib/smokeApiReplay.mjs); every request to a host other than
// 127.0.0.1/localhost is aborted before it leaves the machine.
//
// --cdp ENDPOINT attaches to an already running Chrome (for example an Android phone over
// remote debugging, see README.md) instead of launching headless Chromium. Untested here.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, ensureDir, launchChromium, outRoot, parseArgs, procDelta, procTimes, waitForServer } from '../lib.mts';
import { startPreview } from './preview.mts';

const args = parseArgs();
const throttle = Number(args.throttle ?? 1);
const scenario = args.scenario ?? 'play';
const playMs = Number(args['play-ms'] ?? 20000);
const dpr = Number(args.dpr ?? 2);
const baseUrl = String(args['base-url'] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const out = ensureDir(path.resolve(String(args.out ?? path.join(outRoot(args), 'runs', `${scenario}-${throttle}x-dpr${dpr}-${new Date().toISOString().replace(/[:.]/g, '-')}`))));
const URL_ = `${baseUrl}/?previewSmoke=1&perf=1&mobilePerfHud=0`;
const extraArgs = typeof args['chrome-args'] === 'string' ? args['chrome-args'].split(',') : [];
const cdpEndpoint = typeof args.cdp === 'string' ? args.cdp : null;

// The replay helper reads scripts/fixtures/ relative to the working directory.
process.chdir(REPO_ROOT);
const { installSmokeApiReplay } = await import(path.join(REPO_ROOT, 'scripts/lib/smokeApiReplay.mjs'));

let preview = null;
if (args['start-preview']) {
  // The server's own messages (vite tries to open a browser; /api beacons sent as the page closes
  // reach it and fail to proxy, since no local API runs) go to a log beside the run.
  const log = fs.openSync(path.join(out, 'preview.log'), 'a');
  preview = startPreview({ port: Number(new URL(baseUrl).port || 80), root: outRoot(args), stdout: log, stderr: log });
}
let browser = null;
try {
  await waitForServer(`${baseUrl}/`, 30000);
  let context;
  if (cdpEndpoint) {
    const { chromium } = await import('playwright');
    browser = await chromium.connectOverCDP(cdpEndpoint);
    context = browser.contexts()[0] ?? await browser.newContext();
  } else {
    browser = await launchChromium({ args: extraArgs });
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  }
  await runMeasurement(context);
} finally {
  if (browser) await (cdpEndpoint ? browser.close().catch(() => {}) : browser.close());
  if (preview) preview.kill();
}

async function runMeasurement(context) {
  const replay = await installSmokeApiReplay(context);
  const blocked = new Map();
  // Registered last, so it runs first: anything not on 127.0.0.1 is aborted before it leaves the box.
  await context.route(() => true, (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.protocol === 'data:' || u.protocol === 'blob:') return route.fallback();
    blocked.set(u.hostname, (blocked.get(u.hostname) ?? 0) + 1);
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); } catch { /* storage blocked */ }
    const c = { verts: 0, draw: 0, texImage2D: 0, texSubImage2D: 0, texBytes: 0, bufferData: 0, bufferSubData: 0, bufferBytes: 0, useProgram: 0, bindTexture: 0, uniform: 0, firstDrawAt: null, frames: [] };
    window.__glc = c;
    const wrap = (proto, name, fn) => {
      const orig = proto[name];
      if (typeof orig !== 'function') return;
      proto[name] = function (...a) { fn(a); return orig.apply(this, a); };
    };
    for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
      const p = P.prototype;
      for (const n of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) wrap(p, n, (a) => { c.draw++; c.verts += (n.startsWith('drawArrays') ? a[2] : a[1]) || 0; if (c.firstDrawAt === null) c.firstDrawAt = performance.now(); });
      wrap(p, 'texImage2D', (a) => { c.texImage2D++; const s = a[5] ?? a[a.length - 1]; const w = a.length >= 9 ? a[3] * a[4] : (s?.width ?? 0) * (s?.height ?? 0); c.texBytes += (w || 0) * 4; });
      wrap(p, 'texSubImage2D', (a) => { c.texSubImage2D++; const s = a[a.length - 1]; const w = a.length >= 9 ? a[4] * a[5] : (s?.width ?? 0) * (s?.height ?? 0); c.texBytes += (w || 0) * 4; });
      wrap(p, 'bufferData', (a) => { c.bufferData++; c.bufferBytes += a[1]?.byteLength ?? (typeof a[1] === 'number' ? a[1] : 0); });
      wrap(p, 'bufferSubData', (a) => { c.bufferSubData++; c.bufferBytes += a[2]?.byteLength ?? 0; });
      wrap(p, 'useProgram', () => { c.useProgram++; });
      wrap(p, 'bindTexture', () => { c.bindTexture++; });
      for (const n of ['uniform1f', 'uniform1i', 'uniform2f', 'uniform4f', 'uniformMatrix4fv', 'uniform1iv', 'uniform1fv']) wrap(p, n, () => { c.uniform++; });
    }
    window.__longTasks = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* not supported */ }
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  const readProc = cdpEndpoint ? () => ({}) : procTimes;

  // ---------- BOOT ----------
  const traceEvents = [];
  cdp.on('Tracing.dataCollected', (d) => traceEvents.push(...d.value));
  await cdp.send('Tracing.start', {
    traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: ['devtools.timeline', 'v8', 'v8.execute', 'disabled-by-default-v8.compile', 'blink.user_timing', 'loading', 'toplevel', 'disabled-by-default-devtools.timeline'] },
    transferMode: 'ReportEvents',
  });
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__glc?.firstDrawAt !== null, null, { timeout: 120000 });
  const firstDrawWall = Date.now() - t0;
  await page.waitForFunction(() => { try { const s = JSON.parse(window.render_game_to_text?.() ?? '{}'); return s?.activeScene?.scene === 'overworld-play' && s?.appFeedback?.ready; } catch { return false; } }, null, { timeout: 120000 });
  const readyWall = Date.now() - t0;
  const bootProfile = (await cdp.send('Profiler.stop')).profile;
  const tracingDone = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await tracingDone;
  const bootPage = await page.evaluate(() => ({
    firstDrawAt: window.__glc.firstDrawAt,
    nav: performance.getEntriesByType('navigation')[0]?.toJSON?.(),
    paints: performance.getEntriesByType('paint').map((e) => [e.name, e.startTime]),
    readyAt: performance.now(),
    boot: JSON.parse(window.render_game_to_text?.() ?? '{}')?.bootDiagnostics?.entries?.slice(0, 80) ?? null,
    scripts: performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.js')).map((e) => ({ name: e.name.split('/').pop(), start: e.startTime, end: e.responseEnd, size: e.transferSize })),
  }));
  fs.writeFileSync(path.join(out, 'boot-profile.cpuprofile'), JSON.stringify(bootProfile));
  fs.writeFileSync(path.join(out, 'boot-trace.json'), JSON.stringify({ traceEvents }));
  fs.writeFileSync(path.join(out, 'boot-page.json'), JSON.stringify({ firstDrawWall, readyWall, ...bootPage }, null, 1));
  if (args['boot-only']) {
    await page.close();
    console.log('done (boot only)', out, { firstDrawWall, readyWall, errors: errors.length, blocked: [...blocked], replayMisses: Object.keys(replay?.report?.()?.misses ?? {}).length });
    return;
  }

  // ---------- SCENARIO SETUP ----------
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? '{}'));
  const enterInfo = {};
  if (scenario === 'play') {
    await page.waitForFunction(() => typeof window.run_preview_smoke_action === 'function', null, { timeout: 60000 });
    enterInfo.sel = await page.evaluate(() => window.run_preview_smoke_action('selectEditableRoom', { roomId: '0,0' }));
    await page.waitForTimeout(1500);
    enterInfo.play = await page.evaluate(() => window.run_preview_smoke_action('playSelectedRoom'));
    await page.waitForFunction(() => { try { const s = JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene; return s?.mode === 'play' && s?.player && s?.currentCollisionReady === true; } catch { return false; } }, null, { timeout: 60000 });
    const goal = page.locator('#room-goal-intro-modal:not(.hidden) #btn-room-goal-intro-start');
    if (await goal.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) await goal.click();
    await page.waitForTimeout(2000);
  } else {
    // zoomed-out world map in browse mode
    await page.waitForFunction(() => !!window.__EVERYBODYS_PLATFORMER_GAME__, null, { timeout: 60000 });
    enterInfo.zoom = await page.evaluate(async () => {
      const g = window.__EVERYBODYS_PLATFORMER_GAME__;
      const sc = g.scene.getScenes(true).find((s) => typeof s.zoomOut === 'function');
      if (!sc) return 'no scene';
      for (let i = 0; i < 30; i++) { sc.zoomOut(); await new Promise((r) => setTimeout(r, 120)); }
      return { zoom: sc.cameras.main.zoom, key: sc.sys.settings.key };
    });
    await page.waitForTimeout(4000);
  }
  const s0 = await state();

  // ---------- MEASURED WINDOW ----------
  const metrics0 = (await cdp.send('Performance.getMetrics')).metrics;
  const heap0 = await cdp.send('Runtime.getHeapUsage');
  await page.evaluate(() => {
    window.wampMobilePerf?.reset();
    const c = window.__glc; window.__glBase = { ...c, frames: undefined };
    c.frames = []; window.__longTasks = []; window.__ft = [];
    let prev = performance.now();
    let last = { draw: c.draw, tex: c.texImage2D + c.texSubImage2D, buf: c.bufferData + c.bufferSubData };
    const tick = (now) => {
      window.__ft.push(now - prev); prev = now;
      const cur = { draw: c.draw, tex: c.texImage2D + c.texSubImage2D, buf: c.bufferData + c.bufferSubData };
      c.frames.push([cur.draw - last.draw, cur.tex - last.tex, cur.buf - last.buf]); last = cur;
      window.__ftReq = requestAnimationFrame(tick);
    };
    window.__ftReq = requestAnimationFrame(tick);
  });
  const proc0 = readProc();
  await cdp.send('Profiler.start');
  const tStart = Date.now();
  const rooms = [];
  if (scenario === 'play') {
    // Run right with periodic jumps; reverse every 6 s so the player crosses seams and returns.
    let dir = 'ArrowRight';
    let flip = Date.now() + 6000;
    await page.keyboard.down(dir);
    while (Date.now() - tStart < playMs) {
      await page.keyboard.down('Space'); await page.waitForTimeout(260); await page.keyboard.up('Space');
      await page.waitForTimeout(340);
      if (Date.now() > flip) { await page.keyboard.up(dir); dir = dir === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(dir); flip = Date.now() + 6000; }
      if (rooms.length < 200) {
        rooms.push(await page.evaluate(() => { const s = JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene; return s?.currentRoom ? `${s.currentRoom.x},${s.currentRoom.y}|${Math.round(s.player?.x ?? 0)},${Math.round(s.player?.y ?? 0)}` : null; }));
      }
    }
    await page.keyboard.up(dir);
  } else {
    // pan the zoomed-out map with arrow keys (browse camera)
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    let i = 0;
    while (Date.now() - tStart < playMs) { await page.keyboard.down(keys[i % 4]); await page.waitForTimeout(1500); await page.keyboard.up(keys[i % 4]); i++; }
  }
  const elapsed = Date.now() - tStart;
  const procMs = procDelta(proc0, readProc());
  const playProfile = (await cdp.send('Profiler.stop')).profile;
  const metrics1 = (await cdp.send('Performance.getMetrics')).metrics;
  const heap1 = await cdp.send('Runtime.getHeapUsage');
  const captured = await page.evaluate(() => {
    cancelAnimationFrame(window.__ftReq);
    const c = window.__glc, b = window.__glBase;
    const delta = {}; for (const k of Object.keys(b)) if (typeof b[k] === 'number') delta[k] = c[k] - b[k];
    const g = window.__EVERYBODYS_PLATFORMER_GAME__;
    let tex = null, display = null, renderer = null;
    if (g) {
      const list = g.textures.list; let px = 0, n = 0, canv = 0, canvPx = 0; const big = [];
      for (const key of Object.keys(list)) {
        if (key === '__DEFAULT' || key === '__MISSING' || key === '__WHITE' || key === '__NORMAL') continue;
        const t = list[key]; n++;
        for (const s of t.source ?? []) {
          const p = (s.width || 0) * (s.height || 0); px += p;
          if (s.isCanvas || s.image instanceof HTMLCanvasElement) { canv++; canvPx += p; }
          big.push([key, s.width, s.height, !!s.isCanvas]);
        }
      }
      big.sort((x, y) => y[1] * y[2] - x[1] * x[2]);
      tex = { count: n, totalPixels: px, totalBytesRGBA: px * 4, canvasSources: canv, canvasBytes: canvPx * 4, top: big.slice(0, 12) };
      const count = (objs) => { let k = 0, vis = 0; const types = {}; const walk = (o) => { k++; if (o.visible !== false) vis++; types[o.type] = (types[o.type] ?? 0) + 1; if (o.list && Array.isArray(o.list)) o.list.forEach(walk); }; objs.forEach(walk); return { total: k, visible: vis, types }; };
      display = g.scene.getScenes(true).map((s) => ({ key: s.sys.settings.key, top: s.sys.displayList.length, updateList: s.sys.updateList?.length, ...count(s.sys.displayList.list), bodies: s.physics?.world?.bodies?.size, staticBodies: s.physics?.world?.staticBodies?.size, colliders: s.physics?.world?.colliders?.length, tweens: s.tweens?.getTweens?.().length }));
      renderer = { type: g.renderer.type, w: g.canvas.width, h: g.canvas.height, fpsTarget: g.loop.targetFps, actualFps: g.loop.actualFps };
    }
    return { ft: window.__ft, glFrames: c.frames, glDelta: delta, longTasks: window.__longTasks, perf: window.wampMobilePerf?.get('measure') ?? null, tex, display, renderer, domNodes: document.getElementsByTagName('*').length };
  });
  const s1 = await state();
  fs.writeFileSync(path.join(out, 'play-profile.cpuprofile'), JSON.stringify(playProfile));
  fs.writeFileSync(path.join(out, 'play-captured.json'), JSON.stringify({ throttle, dpr, extraArgs, cdp: Boolean(cdpEndpoint), procMs, scenario, elapsed, enterInfo, rooms, metrics0, metrics1, heap0, heap1, captured, errors, blocked: [...blocked], replay: replay?.report?.() ?? null, startState: { mode: s0?.activeScene?.mode, room: s0?.activeScene?.currentRoom }, endState: { mode: s1?.activeScene?.mode, room: s1?.activeScene?.currentRoom } }, null, 1));
  await page.close();
  console.log('done', out, { procMs, firstDrawWall, readyWall, elapsed, frames: captured.ft.length, errors: errors.length });
}
