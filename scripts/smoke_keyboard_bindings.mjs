import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
import { createApiFixtures } from './lib/apiFixtures.mjs';

const base = process.argv[2] || 'http://127.0.0.1:4197', output = process.argv[3] || 'output/web-game/keyboard-bindings';
mkdirSync(output, { recursive: true });
const reports = [];
for (const [device, engine, width, height, touch] of [
  ['desktop', chromium, 1280, 800, false], ['narrow-phone', chromium, 320, 568, true], ['safari-phone', webkit, 390, 844, true],
]) {
  if (process.env.KEYBOARD_PROFILES && !process.env.KEYBOARD_PROFILES.split(',').includes(device)) continue;
  for (const kind of ['room', 'expanded']) {
    if (process.env.KEYBOARD_KINDS && !process.env.KEYBOARD_KINDS.split(',').includes(kind)) continue;
    const name = `${device}-${kind}`, file = `${output}/${name}.json.gz`;
    createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', file);
    const source = JSON.parse(gunzipSync(readFileSync(file)));
    const original = JSON.parse(source.entries.find(e => e.path === '/api/rooms/0%2C0/published').text);
    const goal = { type: 'reach_exit', exit: { x: 600, y: 304 }, timeLimitMs: null };
    const room = { ...original, goal: kind === 'expanded' ? null : goal };
    const membership = { expandedRoomId: 'course:keyboard-expanded', title: 'Keyboard adventure', goalType: 'reach_exit', cellCount: 2, source: 'native_expanded_room', legacyCourseId: 'keyboard-expanded' };
    const snapshot = { id: 'keyboard-expanded', title: membership.title, version: 4, status: 'published', playerHearts: 1, pitsAreDeadly: true,
      roomRefs: [0, 1].map(x => ({ roomId: `${x},0`, coordinates: { x, y: 0 }, roomVersion: original.version, roomTitle: room.title })),
      startPoint: { roomId: '0,0', x: 328, y: 304 }, goal: { ...goal, exit: { ...goal.exit, roomId: '0,0' } }, objectLinks: [], pressurePlateLinks: [],
      createdAt: original.createdAt, updatedAt: original.updatedAt, publishedAt: original.publishedAt };
    function replace(value) {
      if (Array.isArray(value)) return value.map(replace);
      if (!value || typeof value !== 'object') return value;
      const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
      if (next.id === '0,0' && Object.hasOwn(next, 'goal')) return room;
      if (kind === 'expanded' && ['0,0', '1,0'].includes(next.id) && Object.hasOwn(next, 'state')) return { ...next, state: 'published', version: original.version,
        expandedRoom: membership, course: { courseId: snapshot.id, courseTitle: snapshot.title, goalType: 'reach_exit', roomCount: 2 } };
      return next;
    }
    writeFileSync(file, gzipSync(JSON.stringify({ ...source, entries: source.entries.map(e => e.text && e.contentType.includes('json') ? { ...e, text: JSON.stringify(replace(JSON.parse(e.text))) } : e) })));
    const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
    try {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      const api = createApiFixtures({ mode: 'replay', file }); await api.install(context);
      if (new URL(base).hostname === '127.0.0.1') await context.routeWebSocket(u => new URL(u).origin === base && new URL(u).pathname === '/', s => s.connectToServer());
      const cors = r => ({ 'access-control-allow-origin': r.request().headers().origin || new URL(base).origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': r.request().headers()['access-control-request-headers'] || 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
      await context.route(u => /^\/api\/rooms\/[^/]+\/published$/.test(u.pathname), r => {
        const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]), [x, y] = id.split(',').map(Number);
        return r.fulfill({ json: { ...room, id, coordinates: { x, y }, goal: id === '0,0' ? room.goal : null }, headers: cors(r) });
      });
      if (kind === 'expanded') {
        await context.route('**/api/courses/keyboard-expanded', r => r.fulfill({ json: { id: snapshot.id, published: snapshot, draft: null, versions: [] }, headers: cors(r) }));
        await context.route('**/api/rooms/snapshots/query', r => r.fulfill({ json: { snapshots: r.request().postDataJSON().references.map(ref => ({ key: `${ref.kind}:${ref.roomId}${ref.version ? `:${ref.version}` : ''}`,
          snapshot: { ...room, id: ref.roomId, coordinates: { x: Number(ref.roomId.split(',')[0]), y: 0 }, goal: null } })), missing: [] }, headers: cors(r) }));
      }
      // Replay windows must honor the requested bounds. Reusing the recording's
      // unrelated negative-coordinate rectangle can strand a restarted room off-window.
      await context.route(u => /^\/api\/world\/chunks(?:\/summary)?$/.test(u.pathname), r => {
        const params = new URL(r.request().url()).searchParams;
        const bounds = Object.fromEntries(['minChunkX', 'maxChunkX', 'minChunkY', 'maxChunkY'].map(key => [key, Number(params.get(key))]));
        const chunks = [], cell = 8;
        const template = JSON.parse(source.entries.find(e => e.path === '/api/world/chunks/summary').text).chunks[0].rooms[0];
        for (let y = bounds.minChunkY; y <= bounds.maxChunkY; y++) for (let x = bounds.minChunkX; x <= bounds.maxChunkX; x++) {
          const rooms = [0, 1].filter(rx => Math.floor(rx / cell) === x && y === 0).map(rx => ({ ...template, id: `${rx},0`, coordinates: { x: rx, y: 0 },
            state: 'published', title: room.title, version: room.version, goalType: kind === 'room' && rx === 0 ? 'reach_exit' : null,
            expandedRoom: kind === 'expanded' ? membership : null,
            course: kind === 'expanded' ? { courseId: snapshot.id, courseTitle: snapshot.title, goalType: 'reach_exit', roomCount: 2 } : null }));
          chunks.push({ id: `${x},${y}`, coordinates: { x, y }, roomBounds: { minX: x * cell, maxX: x * cell + cell - 1, minY: y * cell, maxY: y * cell + cell - 1 }, rooms, previewRooms: [], chunkPreviewHash: 'keyboard-fixture' });
        }
        return r.fulfill({ json: { chunkBounds: bounds, roomBounds: { minX: bounds.minChunkX * cell, maxX: (bounds.maxChunkX + 1) * cell - 1, minY: bounds.minChunkY * cell, maxY: (bounds.maxChunkY + 1) * cell - 1 }, chunks }, headers: cors(r) });
      });
      await context.route(u => u.pathname === '/api/world', r => r.fulfill({ json: { center: { x: 0, y: 0 }, radius: 1, rooms: [] }, headers: cors(r) }));
      await context.route(u => u.pathname.startsWith('/api/'), r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors(r) }) : r.fallback());
      await context.route('https://mann.cool/api/v1/plays', r => r.fulfill({ json: { success: true }, headers: cors(r) }));
      await context.route('https://cloudflareinsights.com/cdn-cgi/rum', r => r.fulfill({ status: 204, headers: cors(r) }));
      await context.addInitScript(() => {
        for (const [key, value] of Object.entries({ wamp_welcome_modal_seen_v1: '1', wamp_replay_opt_out: '1', 'wamp.settings.musicVolume': '0', 'wamp.settings.sfxVolume': '0', 'wamp.settings.textStyle': 'readable', 'wamp.settings.textSize': 'large' })) localStorage.setItem(key, value);
      });
      let page = await context.newPage(); context.setDefaultTimeout(60000); const errors = [];
      const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); }; watch(page);
      const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
      const focusCanvas = async () => {
        await page.locator('#menu-toggle').focus(); await page.locator('#game-container > canvas').click();
        assert(await page.evaluate(() => document.activeElement?.id !== 'menu-toggle'));
      };
      const ready = async (custom = false) => {
        await page.waitForFunction(() => document.body.dataset.appReady === 'true');
        await page.waitForFunction(() => {
          const s = JSON.parse(window.render_game_to_text()).activeScene;
          return !document.getElementById('room-goal-intro-modal').classList.contains('hidden') || (s.mode === 'play' && !s.displayHealth.scene.paused && (s.goalRun?.elapsedMs > 100 || s.courseRun?.elapsedMs > 100));
        });
        if (await page.locator('#room-goal-intro-modal').isVisible()) {
          if (custom && !touch) { const hints = await page.locator('#room-goal-intro-controls').innerText(); for (const key of ['V', 'B', 'N']) assert(hints.includes(key), hints); }
          await page.locator('#btn-room-goal-intro-start').click();
        }
        await page.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text()).activeScene; return s.mode === 'play' && s.currentCollisionReady && !s.displayHealth.scene.paused; });
        await focusCanvas(); await page.waitForTimeout(200);
      };
      const controls = async () => { await page.locator('#menu-toggle').click(); await page.locator('#btn-world-controls').click(); await page.locator('#controls-modal').waitFor({ state: 'visible' }); };
      const physicsTime = async ms => {
        const before = (await state()).physicsCadence.totalSteps;
        await page.waitForFunction(target => JSON.parse(window.render_game_to_text()).activeScene.physicsCadence.totalSteps >= target,
          before + Math.ceil(ms / (1000 / 60)));
      };
      const hold = async (key, duration = 140) => {
        await page.keyboard.down(key); try { await physicsTime(duration); } finally { await page.keyboard.up(key); }
      };
      const jump = async key => {
        const y = (await state()).player.y;
        await page.evaluate(y => {
          window.__keyboardJumpObserved = null;
          const sample = () => {
            const p = JSON.parse(window.render_game_to_text()).activeScene.player;
            if (p && p.y < y - 4 && p.animation.startsWith('jump')) window.__keyboardJumpObserved = p;
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, y);
        await page.keyboard.down(key);
        try { await page.waitForFunction(() => window.__keyboardJumpObserved !== null); }
        finally { await page.keyboard.up(key); }
      };
      const combatAction = async (key, field) => {
        await page.evaluate(field => {
          window.__keyboardCombatObserved = null;
          const sample = () => {
            const value = JSON.parse(window.render_game_to_text()).activeScene.combat[field];
            if (value > 0) window.__keyboardCombatObserved = { field, value };
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, field);
        await page.keyboard.press(key); await page.waitForFunction(() => window.__keyboardCombatObserved !== null);
      };
      const edit = async (action, key) => { await page.locator(`[data-binding-action="${action}"]`).click(); await page.keyboard.press(key); assert.equal(await page.locator(`[data-binding-action="${action}"]`).textContent(), 'Change'); };
      const renderer = engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl';
      try {
        await page.goto(`${base}/?welcome=0&x=0&y=0&renderer=${renderer}`); await ready(); console.log(name + ' ready');
        const initial = await state();
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyA', keyCode: 81, bubbles: true, cancelable: true })));
        await page.waitForFunction(x => JSON.parse(window.render_game_to_text()).activeScene.player.x < x - 4, initial.player.x);
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'q', code: 'KeyA', keyCode: 81, bubbles: true })));
        const azerty = await state(); assert(azerty.player.x < initial.player.x - 2); assert.equal(azerty.combat.meleeCooldownMs, 0);
        await jump('z'); await physicsTime(700);
        await combatAction('x', 'meleeCooldownMs'); await physicsTime(500);
        await controls(); console.log(name + ' controls open');
        await page.locator('[data-binding-action="jump"]').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('a');
        assert((await page.locator('#keyboard-binding-status').textContent()).includes('used for Move left'));
        await page.keyboard.press('Escape'); assert(await page.locator('#controls-modal').isVisible());
        const mapping = { left: 'h', right: 'l', up: 'i', down: 'k', jump: 'v', slash: 'b', shoot: 'n', camera: 'o', restart: 'u', stop: 'm' };
        for (const [action, key] of Object.entries(mapping)) await edit(action, key);
        console.log(name + ' remapped');
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wamp.settings.keyboard')));
        for (const [action, key] of Object.entries(mapping)) assert.deepEqual(stored[action], [`Key${key.toUpperCase()}`]);
        assert(await page.locator('#controls-modal .controls-modal-panel').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
        for (const button of await page.locator('.keyboard-binding-change').all()) assert(await button.evaluate(e => e.getBoundingClientRect().height >= 44));
        await page.locator('[data-binding-action="jump"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/${name}-controls.png` });
        await page.locator('#btn-controls-close').click(); await focusCanvas();
        console.log(name + ' gameplay');
        const before = await state(); await hold('l'); const right = await state(); assert(right.player.x > before.player.x + 2);
        await hold('h'); assert((await state()).player.x < right.player.x - 2);
        await page.keyboard.down('k'); await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.combat.crouching); await page.keyboard.up('k');
        await jump('v'); await physicsTime(700);
        await jump('i'); await physicsTime(700);
        await combatAction('b', 'meleeCooldownMs'); await physicsTime(500);
        await combatAction('n', 'rangedCooldownMs');
        const camera = (await state()).cameraMode; await page.keyboard.press('o'); await page.waitForFunction(c => JSON.parse(window.render_game_to_text()).activeScene.cameraMode !== c, camera);
        await page.keyboard.press('o'); await page.waitForFunction(c => JSON.parse(window.render_game_to_text()).activeScene.cameraMode === c, camera);
        await page.keyboard.down('l'); await physicsTime(80); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('l');
        await physicsTime(150); const stopped = await state(); await physicsTime(150); assert(Math.abs((await state()).player.x - stopped.player.x) <= 1);
        const elapsedBeforeRestart = ((await state()).goalRun || (await state()).courseRun).elapsedMs;
        await page.keyboard.press('u'); await page.waitForFunction(previous => {
          const s = JSON.parse(window.render_game_to_text()).activeScene;
          return s.player && s.currentCollisionReady && Math.abs(s.player.x - 328) < 2 && (s.goalRun || s.courseRun).elapsedMs < previous - 200;
        }, elapsedBeforeRestart);
        await page.keyboard.press('m'); await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.mode === 'browse');
        await page.evaluate(() => localStorage.removeItem('wamp:play-controls-seen:v1:keyboard'));
        const old = page; page = await context.newPage(); watch(page); await page.goto(old.url()); await ready(true); await old.close();
        const persisted = await state(); await hold('l'); assert((await state()).player.x > persisted.player.x + 2);
        await controls(); assert.equal(await page.locator('[data-binding-keys="jump"]').textContent(), 'V');
        await page.locator('#btn-keyboard-reset').click(); assert((await page.locator('[data-binding-keys="jump"]').textContent()).includes('Space'));
        await page.locator('#btn-controls-close').click(); await focusCanvas();
        const reset = await state(); await hold('ArrowRight'); assert((await state()).player.x > reset.player.x + 2);
        await page.keyboard.press('Escape'); await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.mode === 'browse');
        assert.deepEqual(errors, []); assert.deepEqual(api.report().misses, {});
        reports.push({ name, ok: true, azertyPhysicalLeft: true, aliases: true, remapped: Object.keys(mapping), persisted: true, reset: true, blurReleased: true, fixtureMisses: api.report().misses, errors });
        console.log(`${name} keyboard controls passed`);
      } catch (error) { await page.screenshot({ path: `${output}/${name}-failure.png` }); writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ state: await state().catch(() => null), errors, fixtures: api.report() }, null, 2)); throw error; }
      finally { await context.close(); }
    } finally { await browser.close(); }
  }
}
writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
