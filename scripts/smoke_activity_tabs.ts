import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { award, fixture, NOW, top1 } from '../src/cloudflare/worker/activity/testDatabase';
import { handleAllActivity, handleMyActivity } from '../src/cloudflare/worker/activity/routes';
import { loadActivity } from '../src/cloudflare/worker/activity/store';
import { createSession } from '../src/cloudflare/worker/auth/store';
import { createSessionResponse, loadOptionalRequestAuth } from '../src/cloudflare/worker/auth/request';
import { loadUserProfile } from '../src/cloudflare/worker/profiles/store';

const base = process.argv[2] ?? 'http://127.0.0.1:3041';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a local frontend for this isolated activity fixture.');
const output = 'output/web-game/activity-tabs';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const report: { layouts: unknown[]; errors: string[]; expectedErrors: string[] } = { layouts: [], errors: [], expectedErrors: [] };
try {
  for (const [name, width, height] of [['desktop', 1280, 800], ['phone', 390, 844], ['narrow-phone', 320, 568], ['landscape', 844, 390]] as const) {
    const f = fixture();
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900 });
    try {
      for (let i = 0; i < 34; i++) award(f, `clear-${i}`, 'unique_completion_room', `p${i % 3 + 1}`);
      award(f, 'rating', 'unique_rating_room'); top1(f, 'winner');
      f.sqlite.exec(`INSERT INTO rooms (id,x,y,draft_json,published_json,published_title,claimer_user_id)
        VALUES ('1,0',1,0,'{}','{}','Moon Bounce','p3')`);
      for (const [id, room] of [['guest-first', '0,0'], ['guest-second', '1,0']]) {
        f.sqlite.prepare(`INSERT INTO guest_run_attempts
          (attempt_id,guest_user_id,recovery_token_hash,client_run_id,content_type,content_id,content_version,progress_source_type,progress_source_id,snapshot_json,verification_nonce,snapshot_hash,started_at,expires_at)
          VALUES (?,'guest-activity-browser','private-fixture',?,'room',?,1,'room',?,'{}','nonce','hash',?,?)`)
          .run(id, id, room, room, NOW, '2026-10-18T00:00:00.000Z');
      }
      f.sqlite.exec(`UPDATE guest_run_attempts SET result='completed',verification_status='passed',finished_at='${NOW}'`);
      const token = await createSession(f.env, 'builder');
      const requestHeaders = { Cookie: `ep_session=${token}`, Origin: 'https://wamp.land' };
      const authRequest = new Request('https://api.wamp.land/api/auth/session', { headers: requestHeaders });
      const session = createSessionResponse(await loadOptionalRequestAuth(f.env, authRequest));
      const profile = await loadUserProfile(f.env, 'builder', 'builder');
      const privateBefore = await loadActivity(f.env.DB, 'builder', true);
      const page = await context.newPage();
      let deliberateError = false, failNextAll = false, seenWrites = 0;
      const requests: string[] = [];
      await context.addInitScript(() => {
        localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
        localStorage.setItem('wamp_replay_opt_out', '1');
      });
      page.on('pageerror', error => report.errors.push(`${name}: ${error.message}`));
      page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = `${message.text()} ${message.location().url ?? ''}`;
        if (/presence\/identity|Failed to authenticate multiplayer presence/.test(text) || deliberateError && /\/api\/activity/.test(text)) report.expectedErrors.push(text);
        else report.errors.push(`${name}: ${text}`);
      });
      await page.route('**/api/**', async route => {
        const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
        if (path === '/api/auth/session') return route.fulfill({ json: session });
        if (path.startsWith('/api/profiles/builder')) return route.fulfill({ json: profile });
        if (path === '/api/settings/me') return route.fulfill({ json: { settings: null, updatedAt: null } });
        if (path === '/api/me/guest-progress') return route.fulfill({ json: { clears: [], claims: [] } });
        if (path === '/api/lost-songs/progress') return route.fulfill({ json: { roomIds: [], total: 0, nextCursor: null } });
        if (path === '/api/leaderboards/rooms/discover' && url.searchParams.get('sort') === 'unrated') {
          return route.fulfill({ json: { sort: 'unrated', results: [], nextCursor: null } });
        }
        if (path.startsWith('/api/presence/identity')) return route.fulfill({ status: 403, json: { error: 'Fixture presence disabled.' } });
        if (path === '/api/activity' || path.startsWith('/api/me/activity')) {
          requests.push(path + url.search);
          if (path === '/api/activity' && failNextAll) { failNextAll = false; return route.fulfill({ status: 503, json: { error: 'Deliberate retry fixture.' } }); }
          if (path.endsWith('/seen')) seenWrites++;
          const workerUrl = new URL(path + url.search, 'https://api.wamp.land');
          const request = new Request(workerUrl, { method: req.method(), headers: requestHeaders, body: req.postData() ?? undefined });
          const response = path === '/api/activity' ? await handleAllActivity(request, workerUrl, f.env) : await handleMyActivity(request, workerUrl, f.env);
          return route.fulfill({ status: response.status, json: await response.json() });
        }
        if (!['GET', 'OPTIONS'].includes(req.method()) && path !== '/api/rooms/snapshots/query') return route.fulfill({ status: 403, json: { error: 'Activity fixture cannot write to production.' } });
        return route.continue();
      });
      await page.goto(`${base}/?welcome=0`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
      await page.locator('#btn-activity-open').waitFor({ state: 'visible' });
      await page.locator('#btn-activity-open').click();
      await page.waitForFunction(() => document.querySelectorAll('#activity-list li').length === 30);
      await page.waitForFunction(() => document.getElementById('activity-unread-count')?.classList.contains('hidden'));
      const panel = await page.locator('.activity-panel').boundingBox();
      assert.ok(panel && panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= width + 1 && panel.y + panel.height <= height + 1);
      assert.ok(await page.locator('.activity-panel').evaluate(el => el.scrollWidth <= el.clientWidth));
      assert.equal(await page.locator('.activity-panel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 243, 219)');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${output}/${name}-my.png` });
      const nameInMy = await page.locator('#activity-list li').first().textContent();
      await page.locator('#btn-activity-more').click();
      await page.waitForFunction(expected => document.querySelectorAll('#activity-list li').length === expected, privateBefore.entries.length + 7);
      const watermark = f.sqlite.prepare("SELECT seen_id FROM builder_activity_preferences WHERE user_id='builder'").get();
      const seenAtSwitch = seenWrites;
      await page.locator('#activity-tab-all').click();
      await page.waitForFunction(() => document.getElementById('activity-feed')?.getAttribute('aria-busy') === 'false');
      assert.ok((await page.locator('#activity-list').textContent())?.includes('Moon Bounce'));
      assert.ok((await page.locator('#activity-list li').first().textContent())?.split(' cleared')[0] === nameInMy?.split(' cleared')[0]);
      assert.equal(await page.locator('#activity-email-options').isVisible(), false);
      assert.equal(seenWrites, seenAtSwitch);
      assert.deepEqual(f.sqlite.prepare("SELECT seen_id FROM builder_activity_preferences WHERE user_id='builder'").get(), watermark);
      await page.screenshot({ path: `${output}/${name}-all.png` });
      await page.locator('#activity-tab-all').focus(); await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => document.getElementById('activity-tab-my')?.getAttribute('aria-selected') === 'true' && document.getElementById('activity-feed')?.getAttribute('aria-busy') === 'false');
      await page.locator('#activity-email-options summary').click();
      await page.locator('#activity-weekly-digest').check(); await page.locator('#btn-activity-save').click();
      await page.waitForFunction(() => document.getElementById('activity-preferences-status')?.textContent === 'Email preferences saved.');
      assert.equal((f.sqlite.prepare("SELECT weekly_digest FROM builder_activity_preferences WHERE user_id='builder'").get() as { weekly_digest: number }).weekly_digest, 1);
      deliberateError = true; failNextAll = true; await page.locator('#activity-tab-all').click();
      await page.locator('#btn-activity-retry').waitFor({ state: 'visible' }); await page.locator('#btn-activity-retry').click();
      await page.waitForFunction(() => document.querySelectorAll('#activity-list li').length === 30);
      await page.keyboard.press('Escape'); await page.locator('#activity-modal').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#btn-activity-open').evaluate(el => el === document.activeElement), true);
      report.layouts.push({ name, width, height, privateRows: privateBefore.unreadCount, requests, seenWrites, tabs: true, guestContinuity: true, privateReadState: true, emailPreferences: true, retry: true, keyboard: true });
    } finally { await context.close(); f.sqlite.close(); }
  }
} finally {
  await browser.close(); writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
}
assert.deepEqual(report.errors, []);
console.log(JSON.stringify(report, null, 2));
