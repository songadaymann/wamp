import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import './lib/mutedBrowsers.mjs';
import { chromium, webkit } from 'playwright';
import { installSmokeApiReplay } from './lib/smokeApiReplay.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:3051';
const engine = process.env.ROOM_ENTRY_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const output = process.argv[3] ?? `output/web-game/room-entry-keyboard/${engine}`;
mkdirSync(output, { recursive: true });
const browser = await ({ chromium, webkit }[engine]).launch();
const report = { engine, cases: [], restartCases: [], pageErrors: [] };
try {
  for (const startWith of ['mouse', 'Enter']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => {
      localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
      localStorage.setItem('wamp_replay_opt_out', '1');
      localStorage.setItem('wamp.devicePerformanceMode.v1', JSON.stringify({ version: 1, mode: 'full-quality' }));
    });
    // Recorded rooms stand in for the live world (F480).
    await installSmokeApiReplay(context);
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    // Keep the probe local: snapshot queries read content; don't save runs or drafts.
    await page.route('**/api/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      return ['GET', 'OPTIONS'].includes(request.method()) || path === '/api/rooms/snapshots/query'
        ? route.fallback() : route.abort();
    });
    await page.goto(`${base}/r/-11/-6?renderer=canvas`);
    await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
    await page.evaluate(() => {
      window.restartClicks = 0;
      document.getElementById('btn-world-restart').addEventListener('click', () => window.restartClicks++);
    });
    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
    for (let entry = 0; entry < 3; entry++) {
      const intro = page.locator('#room-goal-intro-modal');
      await intro.waitFor({ state: 'visible', timeout: 30000 });
      if (startWith === 'mouse') await page.locator('#btn-room-goal-intro-start').click();
      else {
        await page.waitForFunction(() => document.activeElement?.id === 'btn-room-goal-intro-start');
        await page.keyboard.press('Enter');
      }
      await intro.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => {
        const s = JSON.parse(window.render_game_to_text()).activeScene;
        return s?.mode === 'play' && s.currentCollisionReady && s.player;
      });
      await page.waitForTimeout(350);
      const before = await state();
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(250);
      await page.keyboard.up('ArrowRight');
      const moved = await state();
      assert.ok(moved.player.x > before.player.x + 5, `Movement frozen after ${startWith}, entry ${entry}`);
      await page.keyboard.down('w');
      await page.waitForTimeout(100);
      await page.keyboard.up('w');
      const jumped = await state();
      assert.ok(jumped.player.y < moved.player.y - 5, `Jump frozen after ${startWith}, entry ${entry}`);
      report.cases.push({ startWith, entry, movedPx: moved.player.x - before.player.x, jumpedPx: moved.player.y - jumped.player.y });
      await page.screenshot({ path: `${output}/${startWith}-${entry}.png` });
      // Match speedrunning: jump, restart, repeatedly jump, then restart the same
      // button again after Space has changed the browser's focus-visible state.
      for (let restart = 0; restart < 3; restart++) {
        await page.waitForTimeout(600);
        const clicksBefore = await page.evaluate(() => window.restartClicks);
        if (restart === 1) {
          await page.locator('#btn-world-play').focus();
          // Safari's default macOS navigation uses Option-Tab to include buttons.
          await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
          assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-world-restart');
          await page.keyboard.press('Enter');
        } else {
          await page.locator('#btn-world-restart').click();
        }
        await page.waitForTimeout(250);
        const ground = await state();
        await page.keyboard.down('Space');
        await page.waitForTimeout(100);
        const air = await state();
        await page.keyboard.up('Space');
        assert.ok(air.player.y < ground.player.y - 5, `Space didn't jump after restart ${restart}, ${startWith}`);
        for (let press = 0; press < 3; press++) await page.keyboard.press('Space');
        const clicksAfter = await page.evaluate(() => window.restartClicks);
        assert.equal(clicksAfter, clicksBefore + 1, 'Space activated Restart instead of jumping');
        assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'btn-world-restart');
        report.restartCases.push({ startWith, entry, restart, activation: restart === 1 ? 'Tab/Enter' : 'mouse', jumpedPx: ground.player.y - air.player.y, extraRestartClicks: 0 });
      }
      await page.screenshot({ path: `${output}/${startWith}-${entry}-restarts.png` });
      if (entry < 2) {
        await page.locator('#btn-world-play').click();
        await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.mode === 'browse');
        await page.locator('#btn-world-play').click();
      }
    }
    await context.close();
  }
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
