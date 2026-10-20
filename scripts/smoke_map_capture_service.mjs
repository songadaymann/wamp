// Actual Worker bundles connected through a native named-entrypoint service binding.
// All storage is ephemeral; the browser binding is an explicit failure trap.
import { Miniflare } from 'miniflare';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { verifyMapCaptureRender } from './lib/mapCaptureRender.mjs';
const output = process.argv.slice(2).find(argument => !argument.startsWith('--')) || 'output/web-game/map-capture-service'; mkdirSync(output, { recursive: true });
const run = (args, file) => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env, maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(`${output}/${file}`, (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, `${file}: ${result.error || result.stderr?.slice(-1000)}`);
};
const freshBuild = !process.argv.includes('--skip-build');
if (freshBuild) {
const build = spawnSync('npm', ['run', 'build'], { encoding: 'utf8', env: process.env, maxBuffer: 20 * 1024 * 1024 });
writeFileSync(`${output}/production-build.log`, (build.stdout || '') + (build.stderr || '')); assert.equal(build.status, 0, 'Production build failed');
run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', `${output}/api`], 'bundle-api.log');
run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'wrangler.map-screenshot.jsonc', '--dry-run', '--outdir', `${output}/map`], 'bundle-map.log');
}
let browserCalls = 0, outboundCalls = 0, mf;
const database = 'ephemeral-map-capture-database';
const noOutbound = () => { throw new Error('Unexpected outbound network request'); };
mf = new Miniflare({ workers: [
  { name: 'api-fixture', modules: [{ type: 'ESModule', path: resolve(output, 'api/worker.js') }], compatibilityDate: '2026-03-08', compatibilityFlags: ['global_fetch_strictly_public'],
    unsafeDirectSockets: [{ host: '127.0.0.1', port: 0 }], bindings: { ADMIN_API_KEY: 'fixture-map-admin-key' }, d1Databases: { DB: database, JAM_DB: database },
    serviceBindings: { MAP_SCREENSHOTS: { name: 'map-fixture', entrypoint: 'MapScreenshotAdmin' }, ASSETS: () => new Response('Not found', { status: 404 }) }, outboundService: noOutbound },
  { name: 'map-fixture', modules: [{ type: 'ESModule', path: resolve(output, 'map/worker.js') }], compatibilityDate: '2026-07-19', compatibilityFlags: ['nodejs_compat'],
    bindings: { WORLD_TILE_PUBLIC_BASE_URL: 'https://fixture.invalid', MAP_SCREENSHOT_ADMIN_BASE_URL: 'https://fixture.invalid' }, d1Databases: { DB: database }, r2Buckets: { SCREENSHOTS: 'ephemeral-map-capture-images' },
    serviceBindings: { MAP_SCREENSHOT_BROWSER: () => { browserCalls++; throw new Error('Browser must not launch'); } }, outboundService: noOutbound },
  { name: 'pages-fixture', modules: [{ type: 'ESModule', path: resolve('dist/_worker.js') }], compatibilityDate: '2026-03-08',
    serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
    outboundService: async request => { outboundCalls++; assert.equal(new URL(request.url).hostname, 'everybodys-platformer-map-screenshots.novox-robot.workers.dev'); assert(!request.headers.has('Cookie')); assert(!request.headers.has('Authorization')); return (await mf.getWorker('map-fixture')).fetch(request); } },
] });
try {
  await mf.ready; const db = await mf.getD1Database('DB', 'map-fixture');
  const migration = readFileSync('migrations/0067_map_screenshot_capture_budget.sql', 'utf8').replace(/^--.*$/gm, '');
  await db.batch(migration.split(';').map(s => s.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  await db.prepare('CREATE TABLE rooms (x INTEGER,y INTEGER,published_json TEXT)').run();
  const apiURL = await mf.unsafeGetDirectURL('api-fixture');
  const api = { fetch: (url, init) => fetch(new URL(new URL(url).pathname, apiURL), init) }, map = await mf.getWorker('map-fixture'), pages = await mf.getWorker('pages-fixture');
  const cases = [];
  for (const path of ['/api/capture', '/api/capture/daily']) {
    const response = await map.fetch('https://raw-map.example' + path, { method: 'POST', headers: { 'x-admin-key': 'fixture-map-admin-key', 'X-WAMP-Public-Base-Path': '/capture' } });
    assert.equal(response.status, 403); cases.push({ name: 'raw-denial-' + path, status: response.status });
  }
  for (const [key, origin] of [['', 'https://wamp.land'], ['wrong', 'https://wamp.land'], ['fixture-map-admin-key', 'https://untrusted.example']]) {
    const response = await api.fetch('https://api.example/api/admin/map-screenshot/capture', { method: 'POST', headers: { 'x-admin-key': key, Origin: origin }, body: '{}' });
    assert.equal(response.status, 403); cases.push({ name: 'admin-denial-' + cases.length, status: response.status });
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM map_screenshot_capture_attempts').first()).n, 0);
  const headers = { 'x-admin-key': 'fixture-map-admin-key', Origin: 'https://wamp.land' };
  const result = await api.fetch('https://api.example/api/admin/map-screenshot/capture', { method: 'POST', headers, body: '{}' });
  const resultBody = await result.json(); assert.equal(result.status, 502, JSON.stringify(resultBody)); assert.match(resultBody.reason, /No published rooms/);
  assert.deepEqual((await db.prepare('SELECT slot FROM map_screenshot_capture_attempts').all()).results, [{ slot: 1 }]);
  assert.equal((await db.prepare('SELECT token FROM map_screenshot_capture_lease').first()).token, null);
  cases.push({ name: 'authorized-native-rpc-spends-and-cleans', status: result.status });
  await db.prepare('UPDATE map_screenshot_capture_lease SET token=?,expires_at=?').bind('busy-fixture', Date.now() + 60000).run();
  const busy = await api.fetch('https://api.example/api/admin/map-screenshot/capture', { method: 'POST', headers, body: '{}' });
  assert.equal(busy.status, 429); assert.equal((await busy.json()).busy, true); cases.push({ name: 'native-rpc-busy', status: busy.status });
  await db.prepare('UPDATE map_screenshot_capture_lease SET token=NULL,expires_at=0').run();
  for (let slot = 2; slot <= 9; slot++) {
    const attempt = await api.fetch('https://api.example/api/admin/map-screenshot/capture', { method: 'POST', headers, body: '{}' });
    assert.equal(attempt.status, 502); assert.match((await attempt.json()).reason, /No published rooms/);
  }
  const capped = await api.fetch('https://api.example/api/admin/map-screenshot/capture', { method: 'POST', headers, body: '{}' });
  assert.equal(capped.status, 429); assert.equal((await capped.json()).skipped, true);
  assert.deepEqual((await db.prepare('SELECT slot FROM map_screenshot_capture_attempts ORDER BY slot').all()).results, Array.from({ length: 9 }, (_, n) => ({ slot: n + 1 })));
  cases.push({ name: 'native-d1-nine-attempt-cap', status: capped.status });
  const deniedProxy = await pages.fetch('https://wamp.land/capture/api/capture', { method: 'POST' }); assert.equal(deniedProxy.status, 405); assert.equal(outboundCalls, 0);
  const health = await pages.fetch('https://wamp.land/capture/api/health', { headers: { Cookie: 'must-not-forward', Authorization: 'Bearer must-not-forward' } });
  assert.equal(health.status, 200); assert.equal((await health.json()).ok, true); assert.equal(outboundCalls, 1); assert.equal(browserCalls, 0);
  writeFileSync(`${output}/report.json`, JSON.stringify({ ok: true, freshBuild, cases, proxyRead: true, proxyWriteDenied: true, browserCalls, productionWrites: 0 }, null, 2));
  console.log('map capture service: native RPC passed');
} finally { await mf.dispose(); }
await verifyMapCaptureRender(output + '/render');
