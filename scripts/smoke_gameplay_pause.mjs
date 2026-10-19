import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
import { createApiFixtures } from './lib/apiFixtures.mjs';

const base = process.argv[2] || 'http://127.0.0.1:4197';
const output = process.argv[3] || 'output/web-game/gameplay-pause';
mkdirSync(output, { recursive: true });
createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/base.json.gz`);
const source = JSON.parse(gunzipSync(readFileSync(`${output}/base.json.gz`)));
const original = JSON.parse(source.entries.find(e => e.path === '/api/rooms/0%2C0/published').text);
const reports = [];
for (const [device, engine, width, height, touch] of [
  ['desktop', chromium, 1280, 800, false], ['phone', chromium, 390, 844, true], ['safari-phone', webkit, 390, 844, true],
]) {
  const renderer = process.env.GAMEPLAY_PAUSE_RENDERER || (engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl');
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
  try {
    for (const kind of ['solo', 'cooperative']) {
      const name = `${device}-${kind}`;
      const snapshot = { ...original, spawnPoint: { x: 128, y: 304 }, goal: { type: 'reach_exit', exit: { x: 600, y: 304 }, timeLimitMs: 60000 },
        placedObjects: [{ id: 'bat', instanceId: 'pause-bat', x: 80, y: 80, layer: 'terrain' },
          ...(kind === 'cooperative' ? [{ id: 'floor_trigger', instanceId: 'pause-coop', x: 80, y: 288, layer: 'terrain', coopPlate: true }] : [])] };
      function replace(value) {
        if (Array.isArray(value)) return value.map(replace);
        if (!value || typeof value !== 'object') return value;
        const next = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
        if (next.id === '0,0' && Object.hasOwn(next, 'goal')) return snapshot;
        return next;
      }
      const file = `${output}/${name}.json.gz`;
      writeFileSync(file, gzipSync(JSON.stringify({ ...source, entries: source.entries.map(e => e.text && e.contentType.includes('json')
        ? { ...e, text: JSON.stringify(replace(JSON.parse(e.text))) } : e) })));
      const fixtures = createApiFixtures({ mode: 'replay', file });
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      await fixtures.install(context);
      await context.route(u => /^\/api\/rooms\/[^/]+\/published$/.test(u.pathname) && u.pathname !== '/api/rooms/0%2C0/published', r => {
        const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
        const [x, y] = id.split(',').map(Number);
        return r.fulfill({ json: { ...original, id, coordinates: { x, y }, goal: null, music: null, placedObjects: [] } });
      });
      if (base.includes('127.0.0.1')) await context.routeWebSocket(u => new URL(u).port === '4197' && new URL(u).pathname === '/', s => s.connectToServer());
      await context.route('https://mann.cool/api/v1/plays', r => r.fulfill({ json: { success: true }, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' } }));
      await context.route('https://cloudflareinsights.com/cdn-cgi/rum', r => r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }));
      await context.addInitScript(() => {
        localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
        localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
      });
      const page = await context.newPage(), errors = []; let resumeProof = null, restartProof = null;
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
      const state = () => page.evaluate(() => window.render_game_to_text ? JSON.parse(window.render_game_to_text()).activeScene : null);
      const waitPaused = paused => page.waitForFunction(expected => JSON.parse(window.render_game_to_text()).activeScene.displayHealth.scene.paused === expected, paused);
      const stable = s => ({ player: s.player, elapsedMs: s.goalRun?.elapsedMs, deaths: s.goalRun?.deaths,
        enemies: s.liveObjects.filter(o => o.room.x === 0 && o.room.y === 0).map(o => ({ id: o.id, x: o.x, y: o.y })),
        meleeCooldownMs: s.combat?.meleeCooldownMs, rangedCooldownMs: s.combat?.rangedCooldownMs, projectiles: s.combat?.projectileCount });
      try {
        await page.goto(`${base}/?welcome=0&x=0&y=0&renderer=${renderer}`);
        await page.waitForFunction(() => document.body.dataset.appReady === 'true');
        await page.locator('#room-goal-intro-modal').waitFor({ state: 'visible' });
        await waitPaused(true); // Closing one owner must not override another pause owner.
        await click('#btn-room-goal-intro-start');
        await waitPaused(false);
        await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.goalRun?.elapsedMs > 200);
        await page.locator('#game-container > canvas').click();
        // Open the real menu handler in the first frame containing a projectile.
        // Remote automation latency can exceed the bullet's 720ms lifetime.
        await page.evaluate(() => {
          window.__pauseShotObserved = false;
          const sample = () => {
            if (JSON.parse(window.render_game_to_text()).activeScene.combat.projectileCount > 0) {
              document.getElementById('menu-toggle').click();
              window.__pauseShotObserved = true;
            } else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        if (touch) await click('#btn-mobile-shoot'); else await page.keyboard.press('e');
        await page.waitForFunction(() => window.__pauseShotObserved);
        if (kind === 'cooperative') {
          assert.equal((await state()).displayHealth.scene.paused, false);
          assert.equal(await page.locator('#game-pause-status').textContent(), 'Multiplayer keeps running');
          const before = await state();
          await page.waitForFunction(min => JSON.parse(window.render_game_to_text()).activeScene.goalRun.elapsedMs > min, before.goalRun.elapsedMs + 200);
          const after = await state();
          assert(after.goalRun.elapsedMs > before.goalRun.elapsedMs + 200);
          assert.notDeepEqual(stable(after).enemies, stable(before).enemies);
          await page.screenshot({ path: `${output}/${name}-menu.png` });
          await click('#menu-toggle');
        } else {
          await waitPaused(true);
          const before = stable(await state()); assert(before.enemies.length > 0); assert(before.projectiles > 0); await page.waitForTimeout(800);
          assert.deepEqual(stable(await state()), before, 'Player, enemies and timer must freeze together');
          await page.screenshot({ path: `${output}/${name}-menu.png` });
          // The deferred controls dialog replaces the menu without resuming gameplay.
          await click('#btn-world-controls'); await page.locator('#controls-modal').waitFor({ state: 'visible' });
          await waitPaused(true); const dialogBefore = stable(await state());
          assert.deepEqual(dialogBefore, before, 'Loading a deferred dialog must retain the menu pause');
          await page.keyboard.press('Space');
          await page.waitForTimeout(500); assert.deepEqual(stable(await state()), dialogBefore);
          // Stack a second real modal, then close it: the first still owns the pause.
          await page.evaluate(() => {
            const modal = document.getElementById('settings-modal');
            modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); modal.style.zIndex = '99999';
          });
          await page.keyboard.press('Escape'); await waitPaused(true);
          assert(await page.locator('#controls-modal').isVisible());
          await page.screenshot({ path: `${output}/${name}-dialog.png` });
          // Capture the first resumed frame in the browser. A CI automation round trip
          // can take longer than the bullet's entire 720ms lifetime after Close.
          await page.evaluate(() => {
            window.__pauseResumeProof = null;
            const sample = () => {
              const scene = JSON.parse(window.render_game_to_text()).activeScene;
              if (!scene.displayHealth.scene.paused) {
                window.__pauseResumeProof = { elapsedMs: scene.goalRun.elapsedMs, projectileCount: scene.combat.projectileCount };
              } else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          await click('#btn-controls-close'); await waitPaused(false);
          await page.waitForFunction(() => window.__pauseResumeProof !== null);
          resumeProof = { beforeElapsedMs: before.elapsedMs, ...await page.evaluate(() => window.__pauseResumeProof) };
          assert(resumeProof.projectileCount > 0, 'A paused projectile must survive the first resumed frame');
          assert(resumeProof.elapsedMs - before.elapsedMs <= 250, 'Resume must not add the menu break to simulation time');
          const resumed = await state();
          await page.waitForFunction(min => JSON.parse(window.render_game_to_text()).activeScene.goalRun.elapsedMs > min, resumed.goalRun.elapsedMs + 100);
          await click('#menu-toggle'); await waitPaused(true); await click('#menu-toggle'); await waitPaused(false);
          // A native menu focus must be released even when Phaser cancels the canvas pointer's default focus change.
          await page.locator('#menu-toggle').focus();
          // Actual gameplay still responds after repeated pause/resume.
          await page.locator('#game-container > canvas').click();
          assert(await page.evaluate(() => document.activeElement?.id !== 'menu-toggle'));
          const x = (await state()).player.x;
          await page.keyboard.down('ArrowRight');
          try {
            await page.waitForFunction(startX => JSON.parse(window.render_game_to_text()).activeScene.player.x > startX + 5, x);
          } finally { await page.keyboard.up('ArrowRight'); }
          assert((await state()).player.x > x + 5, 'Movement must work after resume');
          // Observe the new run inside the browser so a slow automation round trip
          // cannot miss the reset timer, just as for the first resumed frame above.
          await page.evaluate(() => {
            const previousRunId = JSON.parse(window.render_game_to_text()).activeScene.goalRun.guestProgress.clientRunId;
            window.__pauseRestartProof = null;
            const sample = () => {
              const scene = JSON.parse(window.render_game_to_text()).activeScene;
              const runId = scene.goalRun?.guestProgress?.clientRunId;
              if (runId && runId !== previousRunId) {
                window.__pauseRestartProof = { previousRunId, runId, elapsedMs: scene.goalRun.elapsedMs, x: scene.player.x };
              } else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          await click(touch ? '#btn-mobile-world-restart' : '#btn-world-restart');
          await page.waitForFunction(() => window.__pauseRestartProof !== null);
          restartProof = await page.evaluate(() => window.__pauseRestartProof);
          assert(restartProof.elapsedMs < 300, 'Restart must reset the goal timer');
          assert.equal(restartProof.x, snapshot.spawnPoint.x, 'Restart must return the player to the spawn point');
        }
        // Reporting must compose with the menu pause and never freeze a live shared room.
        await click('#menu-toggle'); await click('#btn-world-report-bug');
        await page.locator('#bug-report-modal').waitFor({ state: 'visible' });
        if (kind === 'solo') {
          await waitPaused(true); const frozen = stable(await state()); await page.waitForTimeout(300);
          assert.deepEqual(stable(await state()), frozen);
        } else {
          assert.equal((await state()).displayHealth.scene.paused, false);
          const live = (await state()).goalRun.elapsedMs;
          await page.waitForFunction(min => JSON.parse(window.render_game_to_text()).activeScene.goalRun.elapsedMs > min, live + 100);
        }
        await click('#btn-bug-report-close'); await waitPaused(false);
        await click(touch ? '#btn-mobile-world-stop' : '#btn-world-play');
        await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.mode === 'browse');
        assert.equal((await state()).displayHealth.scene.paused, false);
        assert.deepEqual(errors, []); assert.deepEqual(fixtures.report().misses, {});
        reports.push({ name, renderer, resumeProof, restartProof, errors, fixtureMisses: fixtures.report().misses, accepted: true });
        console.log(`${name} passed`);
      } catch (error) {
        await page.screenshot({ path: `${output}/${name}-failure.png` });
        writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: error.stack, resumeProof, restartProof, errors, fixtures: fixtures.report(), state: await state() }, null, 2));
        throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, base, reports }, null, 2));
