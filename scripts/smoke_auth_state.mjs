import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createApiFixtures } from './lib/apiFixtures.mjs';

// Exercise the actual auth UI and client event contract; every write is isolated.
const base = process.argv[2] || 'http://127.0.0.1:4198';
const output = process.argv[3] || 'output/web-game/auth-state';
mkdirSync(output, { recursive: true });
const recorded = JSON.parse(gunzipSync(readFileSync('scripts/fixtures/mobile-smoke-api.json.gz')));
const profile = JSON.parse(recorded.entries.find(e => e.path.includes('/profiles/') && e.path.endsWith('/summary')).text);
const reports = [];
for (const [name, engine, width, height, touch] of [
  ['desktop', chromium, 1280, 800, false], ['narrow-phone', chromium, 320, 568, true], ['safari-phone', webkit, 390, 844, true],
]) {
  if (process.env.AUTH_PROFILES && !process.env.AUTH_PROFILES.split(',').includes(name)) continue;
  let page = null;
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
  try {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    const api = createApiFixtures({ mode: 'replay', file: 'scripts/fixtures/mobile-smoke-api.json.gz' });
    await api.install(context);
    if (new URL(base).hostname === '127.0.0.1') await context.routeWebSocket(u => new URL(u).hostname === '127.0.0.1' && new URL(u).port === new URL(base).port && new URL(u).pathname === '/', s => s.connectToServer());
    const user = { id: 'auth-smoke-account', email: 'player@example.invalid', walletAddress: null, displayName: 'Auth player' };
    const guest = () => ({ authenticated: false, user: null, source: null, partykitHost: '', walletProjectId: null });
    let session = guest(), sessionFailed = false, rejectLink = true, rejectLogout = true;
    const writes = [], reads = [], expected = [], errors = [], failedRequests = [], unloadResourceReports = [];
    let schoolNavigationStarted = false, schoolRedirectPending = false;
    const cors = r => ({ 'access-control-allow-origin': r.request().headers().origin || new URL(base).origin,
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS' });
    await context.route(u => u.pathname.startsWith('/api/auth/'), async r => {
      const path = new URL(r.request().url()).pathname, method = r.request().method();
      const reply = (json, status = 200) => r.fulfill({ json, status, headers: cors(r) });
      if (method === 'OPTIONS') return reply({}, 204);
      if (path === '/api/auth/session') {
        reads.push(path);
        return sessionFailed ? reply({ error: 'Session unavailable.' }, 503) : reply(session);
      }
      const body = r.request().postDataJSON(); writes.push({ path, method, body });
      if (path === '/api/auth/request-link') {
        if (rejectLink) return reply({ error: 'Try sending again.' }, 429);
        assert.equal(body.email, 'player@example.invalid');
        return reply({ ok: true, purpose: session.authenticated ? 'link_email' : 'sign_in', delivery: 'email' });
      }
      if (path === '/api/auth/verify-code') {
        assert.equal(body.email, 'player@example.invalid');
        if (body.code !== '654321') return reply({ error: 'That code has expired.' }, 401);
        session = { ...session, authenticated: true, user: { ...(session.user || user), email: user.email }, source: 'session' };
        return reply({ ok: true });
      }
      if (path === '/api/auth/logout') {
        if (rejectLogout) return reply({ error: 'Try signing out again.' }, 503);
        session = guest(); return reply({ ok: true });
      }
      throw new Error(`Unexpected auth request ${method} ${path}`);
    });
    await context.route(u => /^\/api\/profiles\/auth-smoke-account\/summary$/.test(u.pathname), r =>
      r.fulfill({ json: { ...profile, ...session.user, userId: user.id, canEdit: true }, headers: cors(r) }));
    for (const [path, json] of [
      ['/api/settings/me', { settings: null, updatedAt: null }],
      ['/api/lost-songs/progress', { roomIds: [], total: 0 }],
      ['/api/me/activity', { entries: [], unreadCount: 0, latestId: 0, nextBefore: null, preferences: { weeklyDigest: false, dethroneAlerts: false, dailyFeatures: false, emailAvailable: false } }],
      ['/api/leaderboards/rooms/discover', { sort: 'unrated', results: [], totalCount: 0, difficultyFilter: null }],
    ]) await context.route(u => u.pathname === path, r => r.fulfill({ json, headers: cors(r) }));
    await context.route(u => u.pathname === '/api/rooms/mine', r => r.fulfill({ json: { rooms: [] }, headers: cors(r) }));
    await context.route('https://mann.cool/api/v1/plays', r => r.fulfill({ json: { success: true }, headers: cors(r) }));
    await context.route('**/school-login.html?*', r => r.fulfill({ contentType: 'text/html', body: '<title>Classroom sign-in target</title>' }));
    await context.addInitScript(() => {
      window.__authState = null;
      window.__summaryTouches = [];
      let lastTouchEndAt = 0;
      document.addEventListener('touchend', event => {
        if (event.target instanceof Element && event.target.closest('#account-signin-options > summary')) {
          window.__summaryTouches.push({ prevented: event.defaultPrevented, interval: event.timeStamp - lastTouchEndAt });
        }
        lastTouchEndAt = event.timeStamp;
      });
      window.addEventListener('auth-state-changed', e => { window.__authState = structuredClone(e.detail); });
      localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
      localStorage.setItem('wamp_replay_opt_out', '1');
      localStorage.setItem('wamp.settings.musicVolume', '0');
      localStorage.setItem('wamp.settings.sfxVolume', '0');
      localStorage.setItem('wamp.devicePerformanceMode.v1', JSON.stringify({ version: 1, mode: 'full-quality' }));
    });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(30_000);
    console.log(`${name}: opening`);
    const click = async selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
    const expectedMessages = ['Failed to request magic link', 'Failed to sign out', 'Failed to load auth session'];
    page.on('request', r => {
      if (r.isNavigationRequest() && new URL(r.url()).pathname === '/school-login.html') schoolNavigationStarted = true;
    });
    // The inert school target replaces the app. WebKit reports cancelled
    // old-document resources through either console or pageerror. Keep these
    // bounded reports only for this redirect; earlier and other errors are fatal.
    const collectTeardownReport = (text, channel) => {
      const oldOriginPath = text.split(new URL(base).host + '/')[1] || '';
      const oldResource = oldOriginPath.startsWith('assets/sfx/') || text.includes('tiles.wamp.land/world-tiles/')
        || /^[0-9a-f]{8}-[0-9a-f-]{27}\s/i.test(oldOriginPath);
      if (!schoolRedirectPending || !oldResource || !text.endsWith('due to access control checks.')) return false;
      unloadResourceReports.push({ channel, text }); return true;
    };
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text(), url = message.location().url;
      if (collectTeardownReport(text, 'console')) return;
      if (expectedMessages.some(prefix => text.startsWith(prefix)) ||
          (text.startsWith('Failed to load resource:') && url.includes('/api/auth/'))) expected.push(text);
      else errors.push(text);
    });
    page.on('pageerror', error => { if (!collectTeardownReport(error.message, 'pageerror')) errors.push(error.message); });
    page.on('response', r => { if (r.status() >= 400) failedRequests.push({ status: r.status(), url: r.url() }); });
    const waitState = async predicate => {
      try { await page.waitForFunction(predicate, undefined, { timeout: 30_000 }); }
      catch (error) { await page.screenshot({ path: `${output}/${name}-failed.png` });
        writeFileSync(`${output}/${name}-failed.json`, JSON.stringify({ predicate: String(predicate), state: await page.evaluate(() => window.__authState), writes, reads, errors, expected }, null, 2)); throw error; }
    };
    const refresh = async () => {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/session');
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await response;
    };
    const menu = async () => {
      if (!await page.locator('#btn-auth-email').isVisible() && !await page.locator('#btn-auth-logout').isVisible()) {
        await click('#menu-toggle');
        await page.waitForFunction(() => document.getElementById('auth-panel').classList.contains('menu-open'));
      }
    };
    const emailOptions = async () => {
      await menu();
      if (!await page.locator('#account-signin-options').evaluate(el => el.open)) {
        await click('#account-signin-options > summary');
        await page.waitForFunction(() => document.getElementById('account-signin-options').open);
      }
    };
    const sendCode = async () => {
      await emailOptions(); await page.locator('#auth-email-input').fill(user.email); await click('#btn-auth-email');
      await page.locator('#email-code-input').waitFor({ state: 'visible' });
    };
    const verifyCode = async code => {
      await page.locator('#email-code-input').fill(code); await click('#email-code-submit');
    };
    const renderer = engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl';
    await page.goto(`${base}/?welcome=0&renderer=${renderer}`);
    await page.waitForFunction(() => document.body.dataset.appMode === 'world', undefined, { timeout: 30_000 });
    await waitState(() => window.__authState?.status === 'Use email or wallet.');
    console.log(`${name}: guest ready`);
    await menu(); await page.locator('#auth-email-input').fill(user.email); await click('#btn-auth-email');
    await waitState(() => !window.__authState.loading && window.__authState.status === 'Try sending again.');
    assert.equal(await page.locator('#email-code-input').isVisible(), false);
    console.log(`${name}: link failure recovered`);
    rejectLink = false; await sendCode();
    await page.locator('#email-code-input').fill('12');
    const before = writes.length; await click('#email-code-submit');
    assert.equal(await page.locator('#email-code-input').evaluate(el => el.checkValidity()), false);
    assert.equal(writes.length, before);
    await verifyCode('123456'); await page.waitForFunction(() => document.querySelector('#email-code-status').textContent === 'That code has expired.');
    assert.equal(await page.locator('#email-code-submit').isEnabled(), true);
    console.log(`${name}: bad code recovered`);
    await verifyCode('654321'); await waitState(() => window.__authState?.authenticated && window.__authState.user?.email === 'player@example.invalid');
    await page.locator('#email-code-input').waitFor({ state: 'hidden' });
    assert.match(await page.locator('#auth-identity-name').innerText(), /Auth player/);
    session = { ...session, roomDailyClaimLimit: 5, roomClaimsUsedToday: 3, roomClaimsRemainingToday: 2 };
    await refresh(); await waitState(() => window.__authState.roomClaimsUsedToday === 3);
    console.log(`${name}: signed in`);
    sessionFailed = true; await refresh(); await waitState(() => window.__authState.status === 'Failed to load account session.');
    assert.equal(await page.evaluate(() => window.__authState.authenticated), true);
    console.log(`${name}: network failure retained identity`);
    sessionFailed = false; await refresh(); await waitState(() => window.__authState.roomClaimsUsedToday === 3);
    console.log(`${name}: network recovered`);
    await menu(); await click('#btn-auth-logout');
    await waitState(() => !window.__authState.loading && window.__authState.status === 'Try signing out again.');
    assert.equal(await page.evaluate(() => window.__authState.authenticated), true);
    rejectLogout = false; await menu(); await click('#btn-auth-logout');
    await waitState(() => !window.__authState.loading && !window.__authState.authenticated);
    assert.deepEqual(await page.evaluate(() => [window.__authState.roomDailyClaimLimit, window.__authState.roomClaimsUsedToday, window.__authState.roomClaimsRemainingToday]), [null, 0, null]);
    console.log(`${name}: signed out`);
    session = { ...guest(), authenticated: true, user: { ...user, email: null, walletAddress: '0x1234567890123456789012345678901234567890' }, source: 'session' };
    await refresh(); await waitState(() => window.__authState.authenticated && window.__authState.user.email === null);
    await emailOptions(); assert.equal(await page.locator('#btn-auth-email').textContent(), 'Add Email');
    await sendCode(); await verifyCode('654321');
    await waitState(() => window.__authState.user?.email === 'player@example.invalid');
    assert.equal(await page.evaluate(() => window.__authState.user.walletAddress), '0x1234567890123456789012345678901234567890');
    // Rapid native summary taps must keep their generated click. The game's
    // double-tap zoom guard used to cancel touchend here on WebKit.
    const summary = page.locator('#account-signin-options > summary');
    await summary.scrollIntoViewIfNeeded();
    const rect = await summary.boundingBox(); assert.ok(rect);
    // Use the already-visible target directly: locator actionability checks can
    // consume the entire rapid-tap interval on a slow software renderer.
    const toggle = async () => touch ? page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2) : summary.click();
    await toggle();
    await page.waitForFunction(() => !document.getElementById('account-signin-options').open);
    await toggle();
    await page.waitForFunction(() => document.getElementById('account-signin-options').open);
    const summaryTouches = await page.evaluate(() => window.__summaryTouches);
    if (touch) {
      assert.ok(summaryTouches.some(t => t.interval > 0 && t.interval < 320), JSON.stringify(summaryTouches));
      assert.ok(summaryTouches.every(t => !t.prevented), JSON.stringify(summaryTouches));
    }
    await page.screenshot({ path: `${output}/${name}-linked.png` });
    session = guest(); await refresh(); await waitState(() => !window.__authState.authenticated && window.__authState.user === null);
    session = { ...guest(), authenticated: true, user: { ...user, email: null }, source: 'session', schoolManaged: true,
      school: { classroomId: 'class', classroomSlug: 'music class', classroomName: 'Music', studentId: 'student', studentUsername: 'student1' } };
    await refresh(); await waitState(() => window.__authState.schoolManaged);
    await menu(); assert.equal(await page.locator('#auth-email-row').isVisible(), false);
    assert.equal(await page.locator('#btn-auth-wallet').isVisible(), false);
    await page.screenshot({ path: `${output}/${name}-classroom.png` });
    assert.deepEqual(errors, [], 'No application errors before the school redirect');
    // WebKit can cancel media before emitting the navigation request. Bound
    // teardown collection to this action, then require the actual target request.
    schoolRedirectPending = true;
    await click('#btn-auth-logout'); await page.waitForURL('**/school-login.html?classroom=music%20class');
    assert.equal(schoolNavigationStarted, true);
    const fixtures = api.report();
    writeFileSync(`${output}/${name}-diagnostics.json`, JSON.stringify({ errors, failedRequests, fixtures, expected, unloadResourceReports, schoolNavigationStarted }, null, 2));
    assert.equal(errors.length, 0, JSON.stringify(errors)); assert.deepEqual(fixtures.misses, {});
    assert.ok(expected.some(e => e.startsWith('Failed to request magic link')));
    assert.ok(expected.some(e => e.startsWith('Failed to sign out')));
    assert.ok(expected.some(e => e.startsWith('Failed to load auth session')));
    reports.push({ name, ok: true, emailSignIn: true, linkEmail: true, expiry: true, networkRecovery: true,
      failedAndSuccessfulLogout: true, schoolRedirect: true, summaryTouches, writes: writes.length, sessionReads: reads.length,
      errors, unloadResourceReports, fixtureMisses: fixtures.misses, expectedFailureReports: expected.length });
    console.log(`${name}: auth state flows passed`);
    await context.close();
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: `${output}/${name}-failure.png` });
      writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: String(error), state: await page.evaluate(() => window.__authState),
        menuOpen: await page.locator('#auth-panel').evaluate(el => el.className).catch(() => null),
        optionsOpen: await page.locator('#account-signin-options').evaluate(el => el.open).catch(() => null) }, null, 2));
    }
    throw error;
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
