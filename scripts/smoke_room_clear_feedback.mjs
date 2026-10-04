import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3033';
const output = process.argv[3] || 'output/web-game/room-clear-feedback/native';
const devices = [['desktop', 1280, 800, false], ['phone', 390, 844, true], ['narrow-phone', 320, 568, true], ['landscape', 844, 390, true]];
const report = { at: new Date().toISOString(), base, scenarios: [], documents: [], errors: [], expectedLocalErrors: [] };
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
let activePage, activeName;
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
const click = (page, selector, touch) => touch ? page.locator(selector).tap() : page.locator(selector).click();

async function start(page, touch) {
  await page.locator('#room-goal-intro-modal').waitFor({ state: 'visible' });
  await click(page, '#btn-room-goal-intro-start', touch);
  if (await page.locator('#auth-panel').evaluate(node => node.classList.contains('menu-open'))) await click(page, '#menu-toggle', touch);
  await page.waitForFunction(() => {
    const s = JSON.parse(window.render_game_to_text()).activeScene;
    return s.mode === 'play' && s.currentCollisionReady && s.goalRun?.elapsedMs > 0;
  });
}

async function clear(page, context, touch) {
  let release;
  if (!touch) {
    await page.keyboard.down('ArrowRight');
    release = () => page.keyboard.up('ArrowRight');
  } else {
    const box = await page.locator('#mobile-move-stick').boundingBox(); assert.ok(box);
    const cdp = await context.newCDPSession(page), x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 34, y, id: 1 }] });
    release = async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); };
  }
  try { await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.goalRun?.result === 'completed', null, { timeout: 20000 }); }
  finally { await release(); }
  await page.locator('#reward-sting-layer').waitFor({ state: 'visible' });
}

try {
  for (const [name, width, height, touch] of devices) {
    if (process.env.CASE && !name.includes(process.env.CASE)) continue;
    activeName = name;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
    await context.addInitScript(() => {
      localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
      localStorage.setItem('wamp.devicePerformanceMode.v1', JSON.stringify({ version: 1, mode: 'full-quality' }));
      window.clearFeedbackEvents = [];
      addEventListener('reward-stings', event => window.clearFeedbackEvents.push(...event.detail.rewards.filter(reward => reward.kind === 'room-clear')));
    });
    const page = await context.newPage(); activePage = page;
    let leaderboard;
    page.on('response', async response => {
      if (new URL(response.url()).pathname === '/api/leaderboards/rooms/-11%2C-6' && response.ok()) leaderboard = await response.json().catch(() => null);
    });
    page.on('pageerror', error => report.errors.push({ name, message: error.message }));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const entry = { name, message: message.text(), url: message.location().url };
      if (base.includes('127.0.0.1') && entry.url.includes('/api/presence/identity-token')) report.expectedLocalErrors.push(entry);
      else report.errors.push(entry);
    });
    // Delay the original local finish response to observe the pending-to-verified update.
    if (process.env.DELAY_FINISH === '1') {
      assert.ok(base.includes('127.0.0.1'), 'Delayed-response fixtures are local only');
      await page.route('**/api/guest-runs/*/finish', async route => {
        const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 1000)); await route.fulfill({ response });
      });
    }
    await page.goto(`${base}/r/-11/-6?welcome=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
    const entry = await page.locator('script[type="module"]').first().getAttribute('src'); report.documents.push({ name, entry });
    if (process.env.EXPECTED_ENTRY) assert.equal(entry, process.env.EXPECTED_ENTRY);
    await start(page, touch); await clear(page, context, touch);
    const completed = await state(page);
    assert.equal(completed.mode, 'play');
    assert.equal(await page.locator('#run-rating-modal').isVisible(), false, 'Claim interrupted play');
    assert.equal(await page.locator('#reward-sting-title').innerText(), 'ROOM CLEAR!');
    const detail = await page.locator('#reward-sting-detail').innerText();
    assert.ok(detail.includes('0 deaths'));
    assert.ok(leaderboard && leaderboard.roomVersion === completed.goalRun.roomVersion, 'Matching leaderboard did not load');
    if (leaderboard.entries.length) assert.ok(detail.includes('Best:'), `Missing matching best: ${detail}`);
    else assert.ok(!detail.includes('Best:'), 'Invented a best time without ranked clears');
    if (process.env.DELAY_FINISH === '1') assert.ok((await page.locator('#reward-sting-guest-progress').textContent()).includes('Waiting to verify'));
    await page.waitForTimeout(230);
    const card = await page.locator('#reward-sting-card').boundingBox(); assert.ok(card && card.x >= 0 && card.x + card.width <= width && card.y + card.height <= height);
    await page.screenshot({ path: `${output}/${name}-clear.png` });
    const progress = await page.locator('#reward-sting-guest-progress').textContent();
    assert.ok(progress === 'Verified clear · Sign in to earn XP' || progress.startsWith('Waiting to verify'), progress);
    assert.ok(!progress.includes('+20'));
    assert.equal((await state(page)).goalRun.elapsedMs, completed.goalRun.elapsedMs, 'Timer continued after the flag');
    assert.equal(await page.evaluate(() => window.clearFeedbackEvents.length), 1, 'Duplicate celebration');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.goalRun?.guestProgress?.status === 'saved', null, { timeout: 20000 });
    if (await page.locator('#reward-sting-layer').isVisible()) assert.equal(await page.locator('#reward-sting-guest-progress').textContent(), 'Verified clear · Sign in to earn XP');
    await page.locator('#reward-sting-layer').waitFor({ state: 'hidden' });
    await click(page, touch ? '#btn-mobile-world-stop' : '#btn-world-play', touch);
    await page.locator('#run-rating-modal').waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const text = document.getElementById('run-rating-leaderboard').textContent;
      return text.startsWith('Best:') || text === 'No ranked clears yet.';
    });
    assert.equal(await page.locator('#run-rating-result').isVisible(), true);
    assert.equal(await page.locator('#run-rating-result').textContent(), detail.split('\n')[0], 'Clear card and later results show different times');
    assert.ok((await page.locator('#run-rating-result').innerText()).includes('0 deaths'));
    assert.ok((await page.locator('#run-rating-meta').innerText()).toLowerCase().includes('de ja vu'));
    assert.ok((await page.locator('#run-guest-claim-copy').innerText()).includes('within 14 days'));
    const resultBounds = await page.evaluate(() => {
      const panel = document.querySelector('#run-rating-modal .run-rating-modal-panel');
      const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { title: rect('run-rating-title'), close: rect('btn-run-rating-close'), panelScrollTop: panel.scrollTop, panelScrollHeight: panel.scrollHeight, panelHeight: panel.clientHeight };
    });
    writeFileSync(`${output}/${name}-result-bounds.json`, JSON.stringify(resultBounds, null, 2));
    assert.ok(resultBounds.title.y >= 0 && resultBounds.close.y >= 0 && resultBounds.close.y + resultBounds.close.height <= height, JSON.stringify(resultBounds));
    await page.screenshot({ path: `${output}/${name}-results.png` });
    await click(page, '#btn-run-guest-claim-continue', touch);
    assert.equal(await page.locator('#run-rating-modal').isVisible(), false);
    const result = { name, passed: true, run: (await state(page)).goalRun ?? completed.goalRun, detail, progress, card, resultBounds };
    if (name === 'desktop') {
      await click(page, '#btn-world-play', false);
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.goalRun?.result === 'active');
      await clear(page, context, false);
      assert.equal(await page.evaluate(() => window.clearFeedbackEvents.length), 2, 'Replay did not celebrate once');
      result.replay = true;
    }
    report.scenarios.push(result); writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2)); await context.close();
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
} catch (error) {
  report.failure = { name: activeName, message: error.message };
  if (activePage) await activePage.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close();
}
console.log(JSON.stringify({ scenarios: report.scenarios.length, errors: report.errors.length, output }));
