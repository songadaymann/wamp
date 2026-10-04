import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3033';
const output = process.argv[3] || 'output/web-game/builder-activity/native';
const fixtures = process.env.ACTIVITY_FIXTURE === '1';
const local = new URL(base).hostname === '127.0.0.1';
if (!local && !fixtures) throw new Error('Use ACTIVITY_FIXTURE=1 for read-only production UI verification.');
const data = JSON.parse(readFileSync('output/web-game/builder-activity/local-api-fixtures.json', 'utf8'));
const auth = local ? JSON.parse(readFileSync('output/web-game/builder-activity/local-auth.json', 'utf8')) : null;
const devices = [['desktop', 1280, 800, false], ['phone', 390, 844, true], ['narrow-phone', 320, 568, true], ['landscape', 844, 390, true]];
const report = { at: new Date().toISOString(), base, mode: fixtures ? 'live-assets-private-api-fixture' : 'real-local-api', scenarios: [], documents: [], errors: [], expectedErrors: [] };
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
let activePage;
const click = (page, selector, touch) => touch ? page.locator(selector).tap() : page.locator(selector).click();
try {
  for (const [name, width, height, touch] of devices) {
    if (process.env.CASE && !name.includes(process.env.CASE)) continue;
    if (local) {
      const db = new DatabaseSync('/tmp/wamp-guest-progress-local-20261004/v3/d1/miniflare-D1DatabaseObject/5c526945b13db5d5f4f5d4b43b018d693648c43c70b68f27d45cfcceaa34799c.sqlite');
      db.exec('PRAGMA busy_timeout=5000');
      db.prepare("UPDATE builder_activity_preferences SET seen_id=0,weekly_digest=0,dethrone_alerts=0 WHERE user_id='f123-builder'").run(); db.close();
    }
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
    if (auth) await context.addCookies([{ name: 'ep_session', value: auth.cookie, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(() => {
      localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
      localStorage.setItem('wamp.devicePerformanceMode.v1', JSON.stringify({ version: 1, mode: 'full-quality' }));
    });
    const page = await context.newPage(); activePage = page;
    let deliberateError = false, seen = false;
    let prefs = { weeklyDigest: false, dethroneAlerts: false, emailAvailable: true };
    if (fixtures) {
      await page.route('**/api/auth/session', route => route.fulfill({ json: data.session }));
      await page.route('**/api/profiles/f123-builder*', route => route.fulfill({ json: data.profile }));
      await page.route('**/api/me/activity**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/preferences')) { prefs = { ...route.request().postDataJSON(), emailAvailable: true }; await route.fulfill({ json: prefs }); }
        else if (url.pathname.endsWith('/seen')) { seen = true; await route.fulfill({ json: { ok: true } }); }
        else if (url.searchParams.has('before')) await route.fulfill({ json: { ...data.activity, entries: data.activity.entries.slice(0, 6).map((entry, index) => ({ ...entry, id: index + 1 })), nextBefore: null, preferences: prefs, unreadCount: seen ? 0 : 36 } });
        else await route.fulfill({ json: { ...data.activity, preferences: prefs, unreadCount: seen ? 0 : 36 } });
      });
      // Synthetic private sessions never request a real multiplayer identity or perform game writes.
      await page.route('**/api/presence/identity*', route => route.fulfill({ status: 403, json: { error: 'Fixture presence disabled.' } }));
      await page.route('**/api/settings/me', route => route.fulfill({ json: { settings: null, updatedAt: null } }));
      await page.route('**/api/me/guest-progress', route => route.fulfill({ json: { clears: [], claims: [] } }));
    }
    page.on('pageerror', error => report.errors.push({ name, message: error.message }));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const entry = { name, message: message.text(), url: message.location().url };
      if (/presence\/identity|Failed to authenticate multiplayer presence/.test(entry.url + ' ' + entry.message)
        || deliberateError && /api\/me\/activity/.test(entry.url)) report.expectedErrors.push(entry);
      else report.errors.push(entry);
    });
    await page.goto(`${base}/?welcome=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
    const entry = await page.locator('script[type="module"]').first().getAttribute('src'); report.documents.push({ name, entry });
    if (process.env.EXPECTED_ENTRY) assert.equal(entry, process.env.EXPECTED_ENTRY);
    await page.waitForFunction(() => document.getElementById('activity-unread-count')?.textContent === '36');
    const bell = await page.locator('#btn-activity-open').boundingBox();
    assert.ok(bell && bell.x >= 0 && bell.x + bell.width <= width && bell.y >= 0 && bell.width >= 44 && bell.height >= 44, 'Activity bell must fit and be tappable');
    await page.screenshot({ path: `${output}/${name}-bell.png` });
    await click(page, '#btn-activity-open', touch);
    await page.waitForFunction(() => document.querySelectorAll('#activity-list li').length === 30);
    assert.ok((await page.locator('#activity-list').textContent()).includes('tkinter'));
    assert.ok((await page.locator('#activity-list').textContent()).includes('de ja vu 1'));
    await page.waitForFunction(() => document.getElementById('activity-unread-count').classList.contains('hidden'));
    const panel = await page.locator('.activity-panel').boundingBox();
    const close = await page.locator('#btn-activity-close').boundingBox();
    assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= width && panel.y >= 0 && panel.y + panel.height <= height + 1);
    assert.ok(close && close.y >= 0 && close.y + close.height <= height, 'Close must stay visible above scrolling history');
    assert.equal(await page.locator('.activity-panel').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    await page.screenshot({ path: `${output}/${name}-inbox.png` });
    await page.locator('#btn-activity-more').scrollIntoViewIfNeeded(); await click(page, '#btn-activity-more', touch);
    await page.waitForFunction(() => document.querySelectorAll('#activity-list li').length === 36);
    await page.locator('#activity-weekly-digest').scrollIntoViewIfNeeded(); await page.locator('#activity-weekly-digest').check();
    await page.locator('#activity-dethrone-alerts').check();
    await click(page, '#btn-activity-save', touch); await page.waitForFunction(() => document.getElementById('activity-preferences-status')?.textContent === 'Email preferences saved.');
    await page.screenshot({ path: `${output}/${name}-preferences.png` });
    await click(page, '#btn-activity-close', touch); await click(page, '#btn-activity-open', touch);
    await page.waitForFunction(() => document.getElementById('activity-weekly-digest')?.checked && document.getElementById('activity-dethrone-alerts')?.checked);
    await page.locator('#activity-weekly-digest').uncheck(); await page.locator('#activity-dethrone-alerts').uncheck();
    await click(page, '#btn-activity-save', touch); await page.waitForFunction(() => document.getElementById('activity-preferences-status')?.textContent === 'Email preferences saved.');
    await page.keyboard.press('Escape'); await page.locator('#activity-modal').waitFor({ state: 'hidden' });
    await click(page, '#auth-identity', touch); await page.locator('#btn-profile-activity').waitFor({ state: 'visible' });
    await click(page, '#btn-profile-activity', touch); await page.waitForFunction(() => document.querySelectorAll('#activity-list li').length === 30);
    assert.equal(await page.locator('#profile-modal').isVisible(), false);
    await click(page, '#btn-activity-close', touch);
    let failOnce = true; deliberateError = true;
    const match = /\/api\/me\/activity(?:\?.*)?$/;
    const failure = async route => {
      if (failOnce) { failOnce = false; await route.fulfill({ status: 503, json: { error: 'Deliberate offline probe' } }); }
      else await route.fallback();
    };
    await page.route(match, failure); await click(page, '#btn-activity-open', touch);
    await page.locator('#btn-activity-retry').waitFor({ state: 'visible' }); assert.ok((await page.locator('#activity-status').textContent()).includes('could not load'));
    await click(page, '#btn-activity-retry', touch); await page.waitForFunction(() => document.querySelectorAll('#activity-list li').length === 30);
    await page.unroute(match, failure);
    await page.goto(`${base}/?welcome=0&activity=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#activity-list li').length === 30);
    assert.equal(await page.locator('#activity-modal').isVisible(), true, 'Email link must open the signed-in inbox');
    const link = page.locator('#activity-list a').first(); await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400); await (touch ? link.tap() : link.click());
    await page.waitForURL('**/r/-11/-6'); await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
    await page.locator('#room-goal-intro-modal').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#room-goal-intro-title').textContent()).includes('de ja vu 1'));
    await page.screenshot({ path: `${output}/${name}-room-link.png` });
    report.scenarios.push({ name, pass: true, checks: ['44px bell', 'private history', 'snapshot read', 'pagination', 'saved opt-in/out', 'profile entry', 'Escape', 'offline retry', 'email inbox link', 'real public room link'], unexpectedErrors: report.errors.filter(error => error.name === name).length });
    await context.close();
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
} catch (error) {
  report.failure = error.stack || String(error);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close();
}
