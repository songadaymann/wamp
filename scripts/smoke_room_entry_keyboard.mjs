import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:3051';
const output = process.argv[3] ?? 'output/web-game/room-entry-keyboard';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const report = { cases: [], pageErrors: [] };
try {
  for (const startWith of ['mouse', 'Enter']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => {
      localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
      localStorage.setItem('wamp_replay_opt_out', '1');
      localStorage.setItem('wamp.devicePerformanceMode.v1', JSON.stringify({ version: 1, mode: 'full-quality' }));
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    // Keep the probe local: snapshot queries read content; don't save runs or drafts.
    await page.route('**/api/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      return ['GET', 'OPTIONS'].includes(request.method()) || path === '/api/rooms/snapshots/query'
        ? route.continue() : route.abort();
    });
    await page.goto(`${base}/r/-11/-6?renderer=canvas`);
    await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
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
