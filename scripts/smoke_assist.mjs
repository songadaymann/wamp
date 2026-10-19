import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createApiFixtures } from './lib/apiFixtures.mjs';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
const base = process.argv[2] || 'http://127.0.0.1:4197', output = process.argv[3] || 'output/web-game/assist';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname)); mkdirSync(output, { recursive: true });
const reports = [];
for (const [device, engine, width, height, touch] of [ ['desktop', chromium, 1280, 800, false], ['phone', chromium, 390, 844, true], ['safari-phone', webkit, 390, 844, true] ]) {
  if (process.env.ASSIST_PROFILES && !process.env.ASSIST_PROFILES.split(',').includes(device)) continue;
  for (const kind of ['room', 'expanded', 'cooperative']) {
  if (process.env.ASSIST_KINDS && !process.env.ASSIST_KINDS.split(',').includes(kind)) continue;
  const name = `${device}-${kind}`;
  const file = `${output}/${name}.json.gz`; createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', file);
  const source = JSON.parse(gunzipSync(readFileSync(file)));
  const original = JSON.parse(source.entries.find(e => e.path === '/api/rooms/0%2C0/published').text);
  const pitRoom = structuredClone(original); for (let y = 19; y < 22; y++) for (let x = 26; x < 30; x++) pitRoom.tileData.terrain[y][x] = -1;
  let deathPhase = false;
  const goal = { type: 'reach_exit', exit: { x: 570, y: 304 }, timeLimitMs: null };
  const room = { ...original, goal: kind === 'expanded' ? null : goal, title: 'Assist test', spawnPoint: { x: 328, y: 304 },
    placedObjects: kind === 'cooperative' ? [{ id: 'floor_trigger', instanceId: 'assist-coop', x: 80, y: 288, layer: 'terrain', coopPlate: true }] : [] };
  const membership = { expandedRoomId: 'course:assist-expanded', title: 'Assist adventure', goalType: 'reach_exit', cellCount: 2, source: 'native_expanded_room', legacyCourseId: 'assist-expanded' };
  const snapshot = { id: 'assist-expanded', title: membership.title, version: 4, status: 'published', playerHearts: 1, pitsAreDeadly: true,
    roomRefs: [0, 1].map(x => ({ roomId: `${x},0`, coordinates: { x, y: 0 }, roomVersion: original.version, roomTitle: 'Assist test' })),
    startPoint: { roomId: '0,0', x: 328, y: 304 }, goal: { ...goal, exit: { ...goal.exit, roomId: '0,0' } }, objectLinks: [], pressurePlateLinks: [],
    createdAt: original.createdAt, updatedAt: original.updatedAt, publishedAt: original.publishedAt };
  function replace(v) { if (Array.isArray(v)) return v.map(replace); if (!v || typeof v !== 'object') return v;
    const next = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]));
    if (next.id === '0,0' && Object.hasOwn(next, 'goal')) return room;
    if (kind === 'expanded' && ['0,0', '1,0'].includes(next.id) && Object.hasOwn(next, 'state')) return { ...next, state: 'published', version: original.version,
      expandedRoom: membership, course: { courseId: snapshot.id, courseTitle: snapshot.title, goalType: 'reach_exit', roomCount: 2 } };
    return next; }
  writeFileSync(file, gzipSync(JSON.stringify({ ...source, entries: source.entries.map(e => e.text && e.contentType.includes('json') ? { ...e, text: JSON.stringify(replace(JSON.parse(e.text))) } : e) })));
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
  const context = await browser.newContext({ viewport: { width: Number(process.env.ASSIST_WIDTH || width), height }, hasTouch: touch, isMobile: touch });
  const api = createApiFixtures({ mode: 'replay', file }); await api.install(context);
  await context.routeWebSocket(u => new URL(u).port === '4197' && new URL(u).pathname === '/', s => s.connectToServer());
  const cors = r => ({ 'access-control-allow-origin': r.request().headers().origin || new URL(base).origin, 'access-control-allow-credentials': 'true' });
  await context.route(u => /^\/api\/rooms\/[^/]+\/published$/.test(u.pathname), r => {
    const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]), [x, y] = id.split(',').map(Number);
    return r.fulfill({ json: id === '0,0' ? (deathPhase ? { ...pitRoom, goal: room.goal, title: room.title, spawnPoint: room.spawnPoint } : room) : { ...room, id, coordinates: { x, y }, goal: null }, headers: cors(r) });
  });
  if (kind === 'expanded') {
    await context.route('**/api/courses/assist-expanded', r => r.fulfill({ json: { id: snapshot.id, published: snapshot, draft: null, versions: [] }, headers: cors(r) }));
    await context.route('**/api/world/chunks?*', r => {
      const value = replace(JSON.parse(source.entries.find(e => e.path === '/api/world/chunks/summary').text));
      value.chunks = value.chunks.map(c => ({ ...c, previewRooms: [] })); return r.fulfill({ json: value, headers: cors(r) });
    });
    await context.route('**/api/rooms/snapshots/query', r => r.fulfill({ json: { snapshots: r.request().postDataJSON().references.map(ref => ({ key: `${ref.kind}:${ref.roomId}${ref.version ? `:${ref.version}` : ''}`,
      snapshot: { ...(deathPhase ? pitRoom : room), id: ref.roomId, coordinates: { x: Number(ref.roomId.split(',')[0]), y: 0 }, goal: null } })), missing: [] }, headers: cors(r) }));
  }
  await context.route(u => u.pathname === '/api/world', r => r.fulfill({ json: { center: { x: 0, y: 0 }, radius: 1, rooms: [] }, headers: cors(r) }));
  await context.route('https://mann.cool/api/v1/plays', r => r.fulfill({ json: { success: true }, headers: cors(r) }));
  const writes = [];
  await context.route(u => u.pathname.startsWith('/api/'), r => { if (!['GET', 'OPTIONS'].includes(r.request().method())) writes.push(new URL(r.request().url()).pathname); return r.fallback(); });
  await context.addInitScript(({ readable }) => { if (!['http:', 'https:'].includes(location.protocol)) return;
    if (readable) { localStorage.setItem('wamp.settings.textStyle', 'readable'); localStorage.setItem('wamp.settings.textSize', 'large'); }
    for (const [k, v] of Object.entries({ wamp_welcome_modal_seen_v1: '1', wamp_replay_opt_out: '1', 'wamp.settings.musicVolume': '0', 'wamp.settings.sfxVolume': '0', 'wamp.settings.assist': JSON.stringify({ speed: 0.6, safeRespawn: true }) })) { if (k !== 'wamp.settings.assist' || !localStorage.getItem(k)) localStorage.setItem(k, v); } }, { readable: process.env.ASSIST_READABLE === '1' });
  const page = await context.newPage(), errors = []; context.setDefaultTimeout(60000);
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const state = async () => { const s = await page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene); return { ...s, goalRun: kind === 'expanded' ? s.courseRun : s.goalRun }; };
  const startPlay = async () => {
    // A room link can enter Play before its deferred intro owns pause. Wait for
    // actual goal progress, or dismiss the visible intro, rather than racing Play/Stop.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.waitForFunction(kind => {
        const s = JSON.parse(window.render_game_to_text()).activeScene;
        const run = kind === 'expanded' ? s.courseRun : s.goalRun;
        return !document.getElementById('room-goal-intro-modal').classList.contains('hidden')
          || (s.mode === 'play' && !s.displayHealth.scene.paused && run?.elapsedMs >= 100);
      }, kind);
      if (await page.locator('#btn-room-goal-intro-start').isVisible()) {
        await page.locator('#btn-room-goal-intro-start').click(); continue;
      }
      return;
    }
    throw new Error('Room did not leave its intro');
  };
  const waitRun = async (field, value) => page.waitForFunction(({ kind, field, value }) => {
    const s = JSON.parse(window.render_game_to_text()).activeScene; return (kind === 'expanded' ? s.courseRun : s.goalRun)?.[field] === value;
  }, { kind, field, value });
  try {
    await page.goto(`${base}/?welcome=0&x=0&y=0&renderer=${engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl'}`);
    await page.waitForFunction(() => document.body.dataset.appReady === 'true');
    await startPlay();
    if (kind === 'cooperative') {
      const s = await state(); assert.equal(s.assist.active, false); assert.equal(s.assist.speed, 1); assert.equal(s.goalRun.assisted, false);
      assert.equal(s.assist.checkpoint, null); await page.screenshot({ path: `${output}/${name}-excluded.png` });
      assert.deepEqual(errors, []); assert.deepEqual(api.report().misses, {}); reports.push({ name, accepted: true, excluded: true }); console.log(name + ' passed'); continue;
    }
    await waitRun('assisted', true);
    const before = await state(); assert.equal(before.assist.speed, 0.6); assert.equal(before.goalRun.leaderboardEligible, false);
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.assist?.checkpoint !== null);
    const start = await state(); await page.waitForTimeout(1000); const after = await state();
    const elapsed = after.goalRun.elapsedMs - start.goalRun.elapsedMs; const expected = (after.assist.frameElapsedMs - start.assist.frameElapsedMs) * 0.6; assert(Math.abs(elapsed - expected) <= 25, `60% goal clock: ${elapsed} expected ${expected}`);
    assert((await page.locator('#world-goal-panel').textContent()).includes('ASSIST'));
    await page.locator('#menu-toggle').click(); await page.locator('#btn-world-settings').click();
    assert.equal(await page.locator('#settings-assist-speed').inputValue(), '0.6'); assert(await page.locator('#settings-assist-respawn').isChecked());
    await page.locator('#settings-assist-speed').selectOption('1'); await page.locator('#settings-assist-respawn').uncheck();
    await page.locator('#btn-settings-close').click();
    const disabled = await state(); assert.equal(disabled.assist.speed, 1); assert.equal(disabled.goalRun.assisted, true);
    await page.screenshot({ path: `${output}/${name}-assist.png` });
    await page.keyboard.down('ArrowRight'); await waitRun('result', 'completed'); await page.keyboard.up('ArrowRight');
    console.log(name + ' local clear reached');
    const completed = await state(); assert.equal(completed.goalRun.assisted, true); assert.equal(completed.goalRun.submissionState, 'local-only');
    assert(writes.every(p => !/guest-runs|\/runs\/start|\/runs\/[^/]+\/finish|lost-songs/.test(p)), JSON.stringify(writes));
    writes.length = 0;
    // A fresh run at normal settings can rank again; stored preferences survive a full reload.
    await page.reload(); await page.waitForFunction(() => document.body.dataset.appReady === 'true');
    await startPlay();
    console.log(name + ' fresh normal run reached');
    assert.equal((await state()).goalRun.assisted, false); assert.equal((await state()).assist.speed, 1);
    await page.locator('#menu-toggle').click(); await page.locator('#btn-world-settings').click();
    await page.locator('#settings-assist-speed').selectOption('0.8'); await page.locator('#settings-assist-respawn').check();
    await page.locator('#settings-assist-speed').scrollIntoViewIfNeeded();
    assert(await page.locator('#settings-modal .settings-modal-panel').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    assert(await page.locator('#settings-assist-speed').evaluate(e => e.getBoundingClientRect().height >= 44));
    await page.screenshot({ path: `${output}/${name}-settings.png` });
    await page.locator('#btn-settings-close').click(); const mid = await state(); assert.equal(mid.goalRun.assisted, true); assert.equal(mid.assist.speed, 0.8);
    deathPhase = true; await page.reload(); await page.waitForFunction(() => document.body.dataset.appReady === 'true');
    await startPlay();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.assist?.checkpoint !== null);
    await page.keyboard.down('ArrowRight'); await page.waitForFunction(kind => { const s = JSON.parse(window.render_game_to_text()).activeScene; return (kind === 'expanded' ? s.courseRun : s.goalRun).deaths >= 1; }, kind); await page.keyboard.up('ArrowRight');
    await page.waitForFunction(() => {
      const s = JSON.parse(window.render_game_to_text()).activeScene;
      return s.player.x < 416 && Math.abs(s.player.bodyBottom - 304) <= 2 && s.gameFeel.phase === 'none' && s.assist.protected;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const respawned = await state(); assert(respawned.player.x > 328, 'Last safe ground must beat the authored spawn');
    assert.equal(respawned.assist.speed, 0.8); await page.screenshot({ path: `${output}/${name}-respawn.png` });
    assert(writes.every(p => !p.endsWith('/finish')), 'No assisted completion may be uploaded');
    assert.deepEqual(errors, []); assert.deepEqual(api.report().misses, {});
    reports.push({ name, accepted: true, elapsedAt60Percent: elapsed, localOnlyClear: true, respawnX: respawned.player.x, respawnY: respawned.player.y, respawnBottom: respawned.player.bodyBottom, respawnPhase: respawned.gameFeel.phase, respawnProtected: respawned.assist.protected, respawnDeaths: respawned.goalRun.deaths, writes, errors, fixtureMisses: api.report().misses }); console.log(name + ' passed');
  } catch (error) { await page.screenshot({ path: `${output}/${name}-failure.png` }); writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: error.stack, errors, writes, state: await state(), fixtures: api.report() }, null, 2)); throw error; }
  finally { await context.close(); await browser.close(); }
  }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, reports }, null, 2));
