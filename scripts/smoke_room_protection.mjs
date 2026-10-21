// Actual public controls and native-D1-produced metadata; all HTTP writes and play counters stay isolated.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
import { installMobileSignedFixture } from './lib/mobileSignedFixture.mjs';

const base = process.argv[2] || 'http://127.0.0.1:4199';
const output = process.argv[3] || 'output/web-game/room-protection';
const dataFile = process.argv[4] || 'output/web-game/room-protection-service/browser-data-indexed.json';
const data = JSON.parse(readFileSync(dataFile)), recorded = JSON.parse(gunzipSync(readFileSync('scripts/fixtures/mobile-smoke-api.json.gz')));
const profile = JSON.parse(recorded.entries.find(e => e.path.includes('/profiles/') && e.path.endsWith('/summary')).text);
const reports = [];
mkdirSync(output, { recursive: true });
for (const [device, engine, width, height, touch] of [
  ['desktop', chromium, 1280, 800, false], ['narrow-phone', chromium, 320, 568, true],
  ['safari-phone', webkit, 390, 844, true], ['tablet', chromium, 768, 1024, true],
]) {
  if (process.env.PROTECTION_PROFILES && !process.env.PROTECTION_PROFILES.split(',').includes(device)) continue;
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
  try {
    for (const gate of ['0', '1']) {
      const name = `${device}-wallet-${gate}`, errors = [], consoleErrors = [], failedResponses = [], writes = [], counters = [], settingsWrites = [];
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
      const api = createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/${name}-api.json.gz`);
      await api.install(context); await installMobileSignedFixture(context, { roomEditor: true });
      const local = new URL(base), cors = route => ({ 'access-control-allow-origin': route.request().headers().origin || local.origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
      const reply = (route, json, status = 200) => route.fulfill({ status, json, headers: cors(route) });
      if (local.hostname === '127.0.0.1') await context.routeWebSocket(u => u.hostname === local.hostname && u.port === local.port && u.pathname === '/', socket => socket.connectToServer());
      await context.route(u => u.pathname === '/api/leaderboards/rooms/discover', r => reply(r, data.discovery));
      await context.route(u => u.pathname === '/api/profiles/builder/rooms', r => reply(r, data.profile));
      await context.route(u => u.pathname === '/api/profiles/builder/summary', r => reply(r, { ...profile, userId: 'builder', displayName: 'Original builder', username: null, avatarUrl: null, avatarChoices: [], isSelf: false, canEdit: false }));
      await context.route(u => u.pathname === '/api/profiles/builder', r => reply(r, { ...profile, userId: 'builder', displayName: 'Original builder', username: null, avatarUrl: null, avatarChoices: [], isSelf: false, canEdit: false, publishedRooms: data.profile.results, playlists: [] }));
      await context.route(u => u.pathname === '/api/rooms/1%2C0/summary', r => reply(r, data.summary));
      await context.route(u => /^\/api\/world\/chunks(?:\/summary)?$/.test(u.pathname), r => {
        const q = new URL(r.request().url()).searchParams;
        const bounds = Object.fromEntries(['minChunkX', 'maxChunkX', 'minChunkY', 'maxChunkY'].map(key => [key, Number(q.get(key))]));
        const chunks = [];
        for (let y = bounds.minChunkY; y <= bounds.maxChunkY; y++) for (let x = bounds.minChunkX; x <= bounds.maxChunkX; x++) {
          chunks.push(data.world.chunks.find(c => c.coordinates.x === x && c.coordinates.y === y) || {
            id: `${x},${y}`, coordinates: { x, y }, roomBounds: { minX: x * 8, maxX: x * 8 + 7, minY: y * 8, maxY: y * 8 + 7 }, rooms: [], chunkPreviewHash: 'empty-protection-fixture',
          });
        }
        return reply(r, { chunkBounds: bounds, roomBounds: { minX: bounds.minChunkX * 8, maxX: (bounds.maxChunkX + 1) * 8 - 1, minY: bounds.minChunkY * 8, maxY: (bounds.maxChunkY + 1) * 8 - 1 }, chunks });
      });
      await context.route(u => u.pathname.startsWith('/api/'), r => {
        const url = new URL(r.request().url()), method = r.request().method();
        if (url.origin === 'https://mann.cool' && url.pathname === '/api/v1/plays' && ['POST', 'OPTIONS'].includes(method)) {
          counters.push(method); return reply(r, { success: true });
        }
        if (method === 'OPTIONS') return reply(r, {}, 204);
        if (url.pathname === '/api/settings/me' && method === 'PUT') { settingsWrites.push(method); return r.fallback(); }
        if (!['GET', 'HEAD'].includes(method) && url.pathname !== '/api/rooms/snapshots/query') { writes.push({ method, path: url.pathname }); return reply(r, { error: 'Unexpected write' }, 503); }
        return r.fallback();
      });
      await context.route('https://cloudflareinsights.com/cdn-cgi/rum', r => r.fulfill({ status: 204, headers: cors(r) }));
      await context.addInitScript(gate => {
        localStorage.setItem('crypto-override', gate); localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
        localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
      }, gate);
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: m.location().url }); });
      page.on('response', r => { if (r.status() >= 400) failedResponses.push({ path: new URL(r.url()).pathname, status: r.status() }); });
      const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
      const checkBadges = async root => {
        const badges = page.locator(`${root} .room-protection-badge`);
        assert.deepEqual((await badges.allTextContents()).sort(), ['1/2 cells protected', '2/2 cells protected', 'Protected']);
        for (const badge of await badges.all()) {
          await badge.scrollIntoViewIfNeeded();
          assert(await badge.evaluate(el => {
          const r = el.getBoundingClientRect(), s = getComputedStyle(el);
          return el.scrollWidth <= el.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth + 1 && s.opacity === '1' && s.borderRadius === '0px' && s.backgroundColor === 'rgb(252, 234, 124)' && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
          }), 'Protection badge must fit, remain reachable and use opaque WAMP colors');
        }
        await badges.first().scrollIntoViewIfNeeded();
        if (gate === '0') assert.equal(await page.locator('[data-crypto]:visible').count(), 0);
      };
      try {
        const renderer = engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl';
        await page.goto(`${base}/?welcome=0&renderer=${renderer}`);
        await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120_000 });
        if (touch) { await click('#btn-world-jump-sheet'); await page.locator('#mobile-world-jump-input').fill('1,0'); await click('#btn-mobile-world-jump-go'); }
        else { await page.locator('#world-jump-input').fill('1,0'); await click('#btn-world-jump'); }
        await page.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text()).activeScene; return s?.mode === 'browse' && s.selected.x === 1 && s.selected.y === 0; });
        await page.locator('#world-selected-state-info-wrap').waitFor({ state: 'visible' });
        assert.match(await page.locator('#world-selected-state-info-tooltip').textContent(), /Only (?:the|its) owner can edit or revert (?:this protected room|it)/);
        await page.screenshot({ path: `${output}/${name}-world.png` });
        await click('#btn-world-explore');
        await page.locator('#explore-modal .room-protection-badge').first().waitFor(); await checkBadges('#explore-modal');
        await page.screenshot({ path: `${output}/${name}-explore.png` });
        const builder = page.locator('#explore-modal .profile-trigger').first();
        if (touch) await builder.tap(); else await builder.click();
        await page.locator('#profile-modal .room-protection-badge').first().waitFor(); await checkBadges('#profile-modal');
        await page.screenshot({ path: `${output}/${name}-profile.png` });
        assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(failedResponses, []); assert.deepEqual(writes, []); assert.deepEqual(api.report().misses, {});
        reports.push({ name, ok: true, errors, consoleErrors, failedResponses, writes, countersIntercepted: counters.length, settingsWritesIntercepted: settingsWrites.length, fixtureMisses: api.report().misses, productionWrites: 0 });
        console.log(`room protection: ${name} passed`);
      } catch (error) { writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ errors, consoleErrors, failedResponses, writes, fixture: api.report(), message: error.message }, null, 2)); await page.screenshot({ path: `${output}/${name}-failure.png` }).catch(() => {}); throw error; }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, cases: reports, base, dataFile, transactionsSubmitted: 0, productionTestRecordsCreated: 0 }, null, 2));
