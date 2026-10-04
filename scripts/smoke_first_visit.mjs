import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3031';
const output = process.argv[3] || 'output/web-game/first-visit/fixed';
mkdirSync(output, { recursive: true });
const report = { scenarios: [], errors: [], consoleErrors: [] };
const browser = await chromium.launch();
try {
  for (const [device, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    for (const shared of [true, false]) {
      const context = await browser.newContext({ viewport, hasTouch: device === 'phone', isMobile: device === 'phone' });
      const page = await context.newPage();
      const name = `${device}-${shared ? 'shared' : 'home'}`;
      const passed = [];
      page.on('pageerror', error => report.errors.push({ name, error: error.message }));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ name, text: message.text() }); });
      await page.addInitScript(() => {
        window.__firstVisitTrace = [];
        setInterval(() => {
          if (!document.body) return;
          const visible = id => { const node = document.getElementById(id); return !!node && !node.classList.contains('hidden'); };
          window.__firstVisitTrace.push({ ready: document.body.dataset.appReady === 'true', mode: document.body.dataset.appMode,
            welcome: visible('welcome-modal'), goal: visible('room-goal-intro-modal') });
        }, 30);
      });
      let delayed = false;
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (!['GET', 'OPTIONS'].includes(route.request().method()) && path !== '/api/rooms/snapshots/query') {
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Read-only first-visit probe.' }) });
        }
        if (!delayed && path.startsWith('/api/world/chunks')) {
          delayed = true;
          await new Promise(resolve => setTimeout(resolve, 2200));
        }
        return route.continue();
      });
      const tap = async selector => device === 'phone' ? page.locator(selector).tap() : page.locator(selector).click();
      const state = () => page.evaluate(() => {
        const s = JSON.parse(window.render_game_to_text());
        return { scene: s.activeScene?.scene, mode: s.activeScene?.mode, goalRun: s.activeScene?.goalRun,
          graphics: s.graphics?.status, ready: document.body.dataset.appReady,
          modals: [...document.querySelectorAll('.history-modal:not(.hidden)')].map(node => node.id) };
      });
      await page.goto(`${base}${shared ? '/r/-5/3' : '/'}?renderer=canvas`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
      if (shared) {
        await page.locator('#room-goal-intro-modal').waitFor({ state: 'visible', timeout: 45000 });
        await page.waitForTimeout(800);
        const intro = await state();
        assert.deepEqual(intro.modals, ['room-goal-intro-modal'], JSON.stringify(intro));
        assert.ok(!intro.goalRun || intro.goalRun.elapsedMs === 0, JSON.stringify(intro));
        await page.screenshot({ path: `${output}/${name}-intro.png` });
        passed.push('fresh delayed boot shows exactly the goal intro; run has not started');
        await tap('#btn-room-goal-intro-start');
        await page.waitForTimeout(1300);
        const playing = await state();
        assert.deepEqual(playing.modals, [], JSON.stringify(playing));
        assert.ok(playing.goalRun?.elapsedMs > 0, JSON.stringify(playing));
        await page.screenshot({ path: `${output}/${name}-playing.png` });
        passed.push('native Start starts the timer without Welcome over the run');
        await tap(device === 'phone' ? '#btn-mobile-world-stop' : '#btn-world-play');
        await page.locator('#welcome-modal').waitFor({ state: 'visible', timeout: 10000 });
        assert.deepEqual((await state()).modals, ['welcome-modal']);
        assert.equal(await page.evaluate(() => localStorage.getItem('wamp_welcome_modal_seen_v1')), null);
        await page.screenshot({ path: `${output}/${name}-stopped.png` });
        passed.push('Stop presents deferred Welcome without persisting a dismissal');
      } else {
        await page.locator('#welcome-modal').waitFor({ state: 'visible', timeout: 15000 });
        assert.deepEqual((await state()).modals, ['welcome-modal']);
        await page.screenshot({ path: `${output}/${name}-welcome.png` });
        passed.push('normal home visit still presents Welcome after readiness');
      }
      const firstTrace = await page.evaluate(() => window.__firstVisitTrace);
      assert.equal(firstTrace.some(entry => entry.welcome && !entry.ready), false);
      assert.equal(firstTrace.some(entry => entry.welcome && entry.goal), false);
      await tap('#btn-welcome-close');
      assert.equal(await page.evaluate(() => localStorage.getItem('wamp_welcome_modal_seen_v1')), '1');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
      await page.waitForTimeout(1000);
      assert.equal(await page.locator('#welcome-modal').isVisible(), false);
      passed.push('explicit dismissal persists across reload');
      const trace = await page.evaluate(() => window.__firstVisitTrace);
      assert.equal(trace.some(entry => entry.welcome && !entry.ready), false);
      assert.equal(trace.some(entry => entry.welcome && entry.goal), false);
      report.scenarios.push({ name, passed, final: await state(), firstTrace, reloadTrace: trace });
      console.log(`${name}: ${passed.length} workflows passed`);
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  report.ok = true;
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
