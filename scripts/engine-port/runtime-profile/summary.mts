// One JSON summary of a measure.mts play/map window: frame times, long tasks, WebGL calls per
// frame, CDP metric deltas, per-process CPU, heap, texture census, display list.
//
//   node scripts/engine-port/runtime-profile/summary.mts RUN_DIR > RUN_DIR/summary.json
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: summary.mts RUN_DIR'); process.exit(2); }
const d = JSON.parse(fs.readFileSync(path.join(dir, 'play-captured.json'), 'utf8'));
const c = d.captured;
const ft = c.ft.slice(5); const s = [...ft].sort((a, b) => a - b);
const p = (x) => s[Math.min(s.length - 1, Math.ceil(s.length * x) - 1)];
const m0 = Object.fromEntries(d.metrics0.map((m) => [m.name, m.value])), m1 = Object.fromEntries(d.metrics1.map((m) => [m.name, m.value]));
const dm = (k) => +(m1[k] - m0[k]).toFixed(3);
const frames = c.glFrames.slice(5); const n = frames.length;
const perFrame = (i) => { const v = frames.map((f) => f[i]).sort((a, b) => a - b); return { avg: +(v.reduce((a, b) => a + b, 0) / n).toFixed(2), p50: v[Math.floor(n / 2)], max: v[n - 1], framesNonZero: v.filter((x) => x > 0).length }; };
const lt = c.longTasks;
const out = {
  run: dir, throttle: d.throttle, dpr: d.dpr, scenario: d.scenario, elapsedMs: d.elapsed,
  frames: { count: ft.length, fps: +(c.ft.length / (d.elapsed / 1000)).toFixed(1), p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), p99: +p(0.99).toFixed(1), max: +s[s.length - 1].toFixed(1), over16_7: ft.filter((x) => x > 16.7).length, over33: ft.filter((x) => x > 33.4).length, over50: ft.filter((x) => x > 50).length },
  longTasks: { count: lt.length, totalMs: Math.round(lt.reduce((a, b) => a + b.dur, 0)), maxMs: Math.round(Math.max(0, ...lt.map((x) => x.dur))) },
  wampProfiler: c.perf && { updateMs: c.perf.updateMs, top: c.perf.topSegments.slice(0, 6).map((x) => `${x.label} avg ${x.avgMs} p95 ${x.p95Ms} max ${x.maxMs}`) },
  gl: { ...c.glDelta, perFrame: { draw: perFrame(0), texUploads: perFrame(1), bufUploads: perFrame(2) }, vertsPerFrame: c.glDelta.verts ? +(c.glDelta.verts / c.ft.length).toFixed(0) : null, bindTexturePerFrame: +(c.glDelta.bindTexture / c.ft.length).toFixed(1), bufferBytesPerFrame: Math.round(c.glDelta.bufferBytes / c.ft.length), texMBTotal: +(c.glDelta.texBytes / 1e6).toFixed(1) },
  cdpMetricsDelta: { TaskDuration: dm('TaskDuration'), ThreadTime: dm('ThreadTime'), ScriptDuration: dm('ScriptDuration'), RecalcStyleDuration: dm('RecalcStyleDuration'), LayoutDuration: dm('LayoutDuration'), RecalcStyleCount: dm('RecalcStyleCount'), LayoutCount: dm('LayoutCount'), mainThreadCpuMsPerFrame: +(1000 * dm('ThreadTime') / c.ft.length).toFixed(2), scriptMsPerFrame: +(1000 * dm('ScriptDuration') / c.ft.length).toFixed(2) },
  procCpuMs: d.procMs,
  heap: { usedMB0: +(d.heap0.usedSize / 1e6).toFixed(1), usedMB1: +(d.heap1.usedSize / 1e6).toFixed(1), totalMB1: +(d.heap1.totalSize / 1e6).toFixed(1), embedderMB0: +(d.heap0.embedderHeapUsedSize / 1e6).toFixed(1), embedderMB1: +(d.heap1.embedderHeapUsedSize / 1e6).toFixed(1), backingMB1: +(d.heap1.backingStorageSize / 1e6).toFixed(1) },
  textures: c.tex && { ...c.tex, totalMB: +(c.tex.totalBytesRGBA / 1e6).toFixed(1), canvasMB: +(c.tex.canvasBytes / 1e6).toFixed(1), top: c.tex.top.slice(0, 6) },
  display: c.display, renderer: c.renderer, domNodes: c.domNodes,
  rooms: [...new Set((d.rooms || []).map((r) => r?.split('|')[0]))], blocked: d.blocked, replayMisses: d.replay && Object.keys(d.replay.misses || {}), errors: d.errors, enter: d.enterInfo?.zoom,
};
console.log(JSON.stringify(out, null, 1));
