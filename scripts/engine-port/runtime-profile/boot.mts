// Boot trace breakdown from a measure.mts run: compile/evaluate time per chunk, all trace events
// by name, script timings and the game's own boot phases.
//
//   node scripts/engine-port/runtime-profile/boot.mts RUN_DIR
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: boot.mts RUN_DIR'); process.exit(2); }
const { traceEvents } = JSON.parse(fs.readFileSync(path.join(dir, 'boot-trace.json'), 'utf8'));
const page = JSON.parse(fs.readFileSync(path.join(dir, 'boot-page.json'), 'utf8'));
const names = {}; const byUrl = {};
const urlOf = (e) => e.args?.data?.url || e.args?.fileName || e.args?.data?.fileName || e.args?.url || '';
const short = (u) => { const f = u.split('/').pop().split('?')[0]; return /phaser-vendor/.test(f) ? 'phaser-vendor' : /^main-/.test(f) ? 'main(app)' : f || '(none)'; };
const interesting = /compile|evaluate|EvaluateScript|parse|v8\.run|FunctionCall|CompileScript|ScriptStreamer|deserialize/i;
// pair B/E events too
const open = new Map();
for (const e of traceEvents) {
  if (!interesting.test(e.name)) continue;
  let dur = null;
  if (e.ph === 'X') dur = (e.dur ?? 0) / 1000;
  else if (e.ph === 'B') { open.set(`${e.tid}:${e.name}`, e); continue; }
  else if (e.ph === 'E') { const b = open.get(`${e.tid}:${e.name}`); if (!b) continue; dur = (e.ts - b.ts) / 1000; e.args = { ...b.args, ...e.args }; }
  else continue;
  const u = short(urlOf(e));
  names[e.name] = (names[e.name] ?? 0) + dur;
  if (/phaser-vendor|main\(app\)|room-data/.test(u)) { const kk = `${u} | ${e.name}`; byUrl[kk] = (byUrl[kk] ?? 0) + dur; }
}
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(1).padStart(9)} ms  ${k}`).join('\n');
console.log('firstDraw(ms since nav)', page.firstDrawAt?.toFixed?.(0), 'ready', page.readyAt.toFixed(0), 'paints', JSON.stringify(page.paints), 'DCL', page.nav?.domContentLoadedEventEnd?.toFixed(0), 'load', page.nav?.loadEventEnd?.toFixed(0));
console.log('--- by chunk/event'); console.log(fmt(byUrl));
console.log('--- all events by name (any url)'); console.log(fmt(names));
console.log(JSON.stringify(page.scripts.filter((x) => /phaser-vendor|main-|room-data/.test(x.name))));
console.log('boot phases', JSON.stringify((page.boot ?? []).slice(0, 40).map((b) => [b.phase, Math.round(b.atMs ?? b.at ?? b.ms ?? b.time ?? -1)])));
