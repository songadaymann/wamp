import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3033';
const output = process.argv[3] || 'output/web-game/first-play-controls/native';
const rendererQuery = process.env.F104_RENDERER ? `?renderer=${process.env.F104_RENDERER}` : '';
const expandedPath = process.env.F104_EXPANDED_PATH || '/r/12/0';
const devices = [
  ['desktop', 1280, 800, false], ['tablet', 1024, 768, true],
  ['phone', 390, 844, true], ['landscape', 844, 390, true], ['narrow-phone', 320, 568, true],
  ['touch-laptop', 1280, 800, false],
];
mkdirSync(output, { recursive: true });
const report = { checkedAt: new Date().toISOString(), base, scenarios: [], pageErrors: [], unexpectedConsoleErrors: [], expectedLocalErrors: [], navigationAborts: [], expectedNavigationErrors: [] };
const browser = await chromium.launch();
let activePage, activeName;
let navigating = false;
const pendingChat = new WeakMap();
const visit = async (page, path) => {
  await Promise.all([...(pendingChat.get(page) || [])].map(async request => {
    const response = await request.response();
    if (response) await response.finished();
  }));
  navigating = true;
  try { await page.goto(`${base}${path}${rendererQuery}`, { waitUntil: 'domcontentloaded' }); }
  finally { navigating = false; }
};
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
const ready = async page => {
  await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
  await page.waitForTimeout(500);
};
const intro = page => page.locator('#room-goal-intro-modal');
async function checkGuide(page, touch) {
  const controls = page.locator('#room-goal-intro-controls');
  assert.equal(await controls.getAttribute('data-play-controls-input'), touch ? 'touch' : 'keyboard');
  const text = await controls.innerText();
  for (const word of touch ? ['Left stick', 'Jump', 'Sword', 'Shoot'] : ['A D', 'Space', 'W', 'Q', 'E']) assert.ok(text.includes(word), text);
  for (const selector of ['#room-goal-intro-controls', '#btn-room-goal-intro-start']) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width + 1 && box.y + box.height <= page.viewportSize().height + 1, `${selector} clipped: ${JSON.stringify(box)}`);
  }
  return text;
}
async function moveAndJump(page, context, touch) {
  await page.waitForFunction(() => {
    const s = JSON.parse(window.render_game_to_text()).activeScene;
    return s?.mode === 'play' && s.currentCollisionReady;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(350);
  const before = await state(page);
  if (touch) {
    const box = await page.locator('#mobile-move-stick').boundingBox(); assert.ok(box);
    const cd = await context.newCDPSession(page), x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cd.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cd.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 32, y, id: 1 }] });
    await page.waitForTimeout(140);
    await cd.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cd.detach();
  } else {
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(140); await page.keyboard.up('ArrowRight');
  }
  const moved = await state(page); assert.ok(moved.player.x > before.player.x + 2, `Move failed: ${JSON.stringify({ before: before.player, moved: moved.player })}`);
  await page.waitForTimeout(250);
  const ground = await state(page);
  if (touch) {
    await page.locator('#btn-mobile-jump').tap();
  } else {
    await page.keyboard.down('w'); await page.waitForTimeout(60); await page.keyboard.up('w');
  }
  await page.waitForTimeout(100);
  const jumped = await state(page); assert.ok(jumped.player.y < ground.player.y - 2, `Jump failed: ${JSON.stringify({ ground: ground.player, jumped: jumped.player })}`);
  return { moved: true, jumped: true };
}

try {
  for (const [device, width, height, touch] of devices) {
    for (const kind of ['shared', 'home', 'goal-less', 'expanded']) {
      const name = `${device}-${kind}`;
      if (process.env.CASE && !name.includes(process.env.CASE)) continue;
      activeName = name;
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      await context.addInitScript(({ home, laptop }) => {
        if (laptop) Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
        if (!home) localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
        localStorage.setItem('wamp_replay_opt_out', '1');
        localStorage.setItem('wamp.devicePerformanceMode.v1', JSON.stringify({ version: 1, mode: 'full-quality' }));
      }, { home: kind === 'home', laptop: device === 'touch-laptop' });
      const page = await context.newPage(); activePage = page;
      const chatRequests = new Set(); pendingChat.set(page, chatRequests);
      page.on('request', request => { if (new URL(request.url()).pathname === '/api/chat/messages') chatRequests.add(request); });
      page.on('requestfinished', request => chatRequests.delete(request));
      page.on('requestfailed', request => chatRequests.delete(request));
      page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
      page.on('requestfailed', request => {
        if (navigating && new URL(request.url()).pathname === '/api/chat/messages' && request.failure()?.errorText === 'net::ERR_ABORTED') {
          report.navigationAborts.push({ name, at: Date.now(), url: request.url() });
        }
      });
      page.on('console', message => {
        if (message.type() !== 'error') return;
        const entry = { name, at: Date.now(), message: message.text(), url: message.location().url };
        if (!base.startsWith('https:') && entry.url.includes('/api/presence/identity-token')) report.expectedLocalErrors.push(entry);
        else report.unexpectedConsoleErrors.push(entry);
      });
      if (kind === 'goal-less') {
        // A read-only content fixture exercises a published room with no goal, without editing it.
        await page.route('**/api/**', async route => {
          const request = route.request(), path = new URL(request.url()).pathname;
          if (!['GET', 'OPTIONS'].includes(request.method()) && path !== '/api/rooms/snapshots/query') return route.continue();
          const response = await route.fetch();
          if (!response.headers()['content-type']?.includes('application/json')) return route.fulfill({ response });
          const body = await response.json();
          const rewrite = value => {
            if (!value || typeof value !== 'object') return;
            if (value.id === '-11,-6' && value.tileData) { value.goal = null; value.goalIntroText = null; }
            Object.values(value).forEach(rewrite);
          };
          rewrite(body); return route.fulfill({ response, json: body });
        });
      }
      await visit(page, kind === 'home' ? '/' : kind === 'expanded' ? expandedPath : '/r/-11/-6');
      await ready(page);
      const nativeTap = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
      const tap = async selector => {
        if (selector.startsWith('#btn-world-') && await page.locator('#auth-panel').evaluate(node => node.classList.contains('menu-open'))) {
          await nativeTap('#menu-toggle');
        }
        return nativeTap(selector);
      };
      if (kind === 'home') {
        await page.locator('#welcome-modal').waitFor({ state: 'visible' });
        await tap('#btn-welcome-play');
      }
      await intro(page).waitFor({ state: 'visible', timeout: 30000 });
      const guide = await checkGuide(page, touch), paused = await state(page);
      assert.equal(await page.locator('#welcome-modal').isVisible(), false, 'Welcome stacked over controls');
      if (kind === 'expanded') assert.equal(paused.mode, 'browse', 'Expanded run started before controls');
      else {
        if (kind === 'goal-less') assert.equal(paused.goalRun, null, 'Goal-less fixture still has a goal');
        else assert.equal(paused.goalRun?.elapsedMs ?? 0, 0);
        await page.waitForTimeout(500);
        const still = await state(page);
        assert.equal(still.goalRun?.elapsedMs ?? 0, 0);
        assert.equal(still.player.x, paused.player.x);
        assert.equal(still.player.y, paused.player.y);
      }
      await page.screenshot({ path: `${output}/${name}-intro.png` });
      if (kind === 'shared' && (device === 'phone' || device === 'tablet')) {
        await page.setViewportSize({ width: height, height: width });
        await page.waitForTimeout(350);
        await checkGuide(page, touch);
        assert.equal((await state(page)).goalRun?.elapsedMs ?? 0, 0);
        await page.screenshot({ path: `${output}/${name}-rotated-intro.png` });
        await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
      }
      await tap('#btn-room-goal-intro-start');
      await intro(page).waitFor({ state: 'hidden' });
      const controls = await moveAndJump(page, context, touch);
      await page.screenshot({ path: `${output}/${name}-playing.png` });
      const key = `wamp:play-controls-seen:v1:${touch ? 'touch' : 'keyboard'}`;
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '1');
      await tap(touch ? '#btn-mobile-world-stop' : '#btn-world-play');
      if (kind === 'shared' || kind === 'goal-less' || kind === 'expanded') {
        await tap('#btn-world-play');
        await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.mode === 'play', null, { timeout: 30000 });
        assert.equal(await intro(page).isVisible(), false, 'Acknowledged controls interrupted repeat Play');
        assert.equal((await state(page)).mode, 'play');
        await tap(touch ? '#btn-mobile-world-stop' : '#btn-world-play');
      }
      if (kind === 'shared') {
        // An old room-intro acknowledgement must not suppress the newly added input guide.
        await page.evaluate(key => localStorage.removeItem(key), key);
        await visit(page, '/'); await ready(page);
        await tap('#btn-world-play'); await intro(page).waitFor({ state: 'visible' });
        await checkGuide(page, touch); assert.equal((await state(page)).goalRun?.elapsedMs ?? 0, 0);
        await tap('#btn-room-goal-intro-start');
        await tap(touch ? '#btn-mobile-world-stop' : '#btn-world-play');
        await visit(page, '/'); await ready(page); await tap('#btn-world-play');
        await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.goalRun?.elapsedMs > 0);
        assert.equal(await intro(page).isVisible(), false, 'Acknowledgement did not survive navigation');
        await tap(touch ? '#btn-mobile-world-stop' : '#btn-world-play');
        if (await page.locator('#btn-world-room-rush').isVisible()) {
          await tap('#btn-world-room-rush');
          assert.equal(await page.locator('#room-rush-controls').getAttribute('data-play-controls-input'), touch ? 'touch' : 'keyboard');
          await page.screenshot({ path: `${output}/${name}-rush-guide.png` });
          await tap('#btn-room-rush-close');
        }
        const version = paused.goalRun.roomVersion;
        await page.evaluate(version => dispatchEvent(new CustomEvent('room-sequence-start', { detail: {
          mode: 'play', kind: 'playlist', sourceLabel: 'Controls verification', kickerLabel: 'Tutorial', showDesktopControlsIntro: true,
          entries: [{ roomId: '-11,-6', roomCoordinates: { x: -11, y: -6 }, roomVersion: version, roomTitle: 'De ja vu 1' }],
        } })), version);
        await page.locator('#playlist-intro-modal').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#playlist-intro-controls').getAttribute('data-play-controls-input'), touch ? 'touch' : 'keyboard');
        assert.equal((await state(page)).mode, 'browse');
        await page.screenshot({ path: `${output}/${name}-playlist-guide.png` });
        await tap('#btn-playlist-intro-start');
        await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.mode === 'play');
      }
      report.scenarios.push({ name, guide, pausedMode: paused.mode, timerHeld: true, ...controls, acknowledgement: true });
      console.log(`${name}: guide, held timer, native movement/jump and acknowledgement pass`);
      await context.close();
    }
  }
  report.unexpectedConsoleErrors = report.unexpectedConsoleErrors.filter(entry => {
    const interruptedPoll = entry.message.startsWith('Failed to poll chat messages TypeError: Failed to fetch')
      && report.navigationAborts.some(abort => abort.name === entry.name && Math.abs(abort.at - entry.at) < 1000);
    if (interruptedPoll) report.expectedNavigationErrors.push(entry);
    return !interruptedPoll;
  });
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.unexpectedConsoleErrors, []);
  report.ok = true;
} catch (error) {
  report.failure = { name: activeName, message: String(error) };
  if (activePage && !activePage.isClosed()) {
    try {
      await activePage.screenshot({ path: `${output}/failure.png` });
      writeFileSync(`${output}/failure-state.json`, JSON.stringify(await state(activePage), null, 2));
    } catch (captureError) { report.captureFailure = String(captureError); }
  }
  throw error;
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
