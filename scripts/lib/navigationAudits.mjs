import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** New destinations use empty synthetic reads; never submit a guestbook entry or edit an account. */
export async function installNavigationFixtures(context) {
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  const data = JSON.parse(gunzipSync(readFileSync('scripts/fixtures/mobile-smoke-api.json.gz')).toString());
  const snapshot = JSON.parse(data.entries.find(e => e.path === '/api/rooms/0%2C0/published').text);
  await context.route(url => /^\/api\/rooms\/(?:-1|1)%2C(?:-1|1)\/published$/.test(url.pathname), route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
    const [x, y] = id.split(',').map(Number);
    return json(route, { ...snapshot, id, coordinates: { x, y }, title: 'Fixture neighbor', music: null, goal: null });
  });
  await context.route(url => url.pathname === '/api/auth/display-name-availability', route => json(route, { available: true, claimedByCurrentUser: false }));
  await context.route(url => url.pathname === '/api/guestbook', route => route.request().method() === 'GET'
    ? json(route, { entries: [], config: { turnstileSiteKey: null, turnstileRequired: false } }) : route.fallback());
  await context.route(url => url.pathname === '/api/leaderboards/rooms/discover', route => route.request().method() === 'GET'
    ? json(route, { sort: new URL(route.request().url()).searchParams.get('sort') ?? 'newest', results: [], totalCount: 0, difficultyFilter: null }) : route.fallback());
}

export async function auditNavigation(page, { signed = true, editor = true, capture = async () => {} } = {}) {
  const visible = async selector => page.locator(selector).waitFor({ state: 'visible' });
  const hidden = async selector => assert(!await page.locator(selector).isVisible(), `${selector} should be hidden`);
  const mode = async value => page.waitForFunction(v => document.body.dataset.appMode === v, value);
  const intro = async () => {
    if (await page.locator('#btn-room-goal-intro-start').isVisible()) {
      await page.locator('#btn-room-goal-intro-start').click(); await page.locator('#room-goal-intro-modal').waitFor({ state: 'hidden' });
    }
  };
  const stop = async () => {
    await page.locator(await page.locator('#btn-world-play').isVisible() ? '#btn-world-play' : '#btn-mobile-world-stop').click();
    await mode('world');
  };
  await page.locator('#btn-room-goal-intro-start').waitFor({ state: 'visible', timeout: 30000 });
  await intro(); await stop();
  const openMenu = async () => {
    if (await page.locator('#menu-toggle').isVisible()) await page.locator('#menu-toggle').click();
    else { await page.locator('#btn-editor-phone-menu').click(); await page.locator('#btn-editor-phone-account').click(); }
    await page.waitForFunction(() => document.getElementById('auth-panel').classList.contains('menu-open'));
    const bounds = await page.locator('#menu-body').evaluate(e => { const r = e.getBoundingClientRect(); return { bottom: r.bottom, viewport: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--visible-vh')) || innerHeight }; });
    assert(bounds.bottom <= bounds.viewport + 1, `menu must fit its visible viewport: ${JSON.stringify(bounds)}`);
  };
  const menuClosed = async () => assert.equal(await page.locator('#auth-panel').evaluate(e => e.classList.contains('menu-open')), false);
  const destination = async (button, modal, close) => {
    await page.locator(button).click(); await page.locator(modal).waitFor({ state: 'visible' });
    await page.locator(close).click(); await page.locator(modal).waitFor({ state: 'hidden' });
  };
  await visible('#world-navigation');
  for (const selector of ['#btn-world-explore', '#btn-world-worlds', '#btn-auth-leaderboard']) {
    await visible(selector);
    assert.equal(await page.locator(selector).evaluate(e => e.closest('#world-hud') === null && e.closest('#world-navigation') !== null), true);
  }
  const bounds = await page.locator('#bottom-bar .bar-btn, #world-online-count').evaluateAll(nodes => nodes.filter(e => e.getClientRects().length).map(e => {
    const r = e.getBoundingClientRect(); return { id: e.id, x: r.x, right: r.right, bottom: r.bottom, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  }));
  assert(bounds.every(r => r.x >= -1 && r.right <= r.viewportWidth + 1 && r.bottom <= r.viewportHeight + 1), JSON.stringify(bounds));
  await capture('browse-navigation');
  await destination('#btn-world-explore', '#explore-modal', '#btn-explore-close');
  await destination('#btn-world-worlds', '.worlds-modal', '[data-world-action="close"]');
  await page.locator('#btn-auth-leaderboard').click(); await visible('#leaderboard-modal');
  assert.equal(await page.locator('#btn-leaderboard-tab-global').evaluate(e => e.classList.contains('active')), true);
  await page.locator('#btn-leaderboard-close').click();
  const revealRoomActions = !await page.locator('#btn-world-leaderboard').isVisible();
  if (revealRoomActions) await page.locator('#btn-mobile-world-hud-details').click();
  await page.locator('#btn-world-leaderboard').click(); await visible('#leaderboard-modal');
  assert.equal(await page.locator('#btn-leaderboard-tab-room').evaluate(e => e.classList.contains('active')), true, 'the room card still opens this room');
  await page.locator('#btn-leaderboard-close').click();
  if (revealRoomActions) await page.locator('#btn-mobile-world-hud-details').click();

  await hidden('#btn-world-settings'); await openMenu();
  assert.equal(await page.locator('#auth-status').evaluate(e => e.closest('#account-signin-options') === null), true, 'account errors remain outside collapsed linking options');
  for (const id of ['#btn-world-settings', '#btn-world-controls', '#btn-guestbook-open']) await visible(id);
  const adminExpected = await page.evaluate(() => { const auth = JSON.parse(window.render_game_to_text()).auth; return auth.testResetEnabled || ['moderator', 'admin'].includes(auth.chatModeration.role); });
  assert.equal(await page.locator('.game-menu-admin').isVisible(), adminExpected, 'Admin follows existing permissions and the explicit test-build flag');
  if (signed) {
    await visible('#btn-menu-profile'); await visible('#btn-menu-my-rooms'); await hidden('#auth-signin-reason');
    await page.locator('#btn-menu-my-rooms').click(); await page.locator('#profile-modal').waitFor({ state: 'visible' }); await menuClosed();
    await page.waitForFunction(() => document.getElementById('profile-display-name').textContent === 'Mobile Test');
    assert.equal(await page.locator('#btn-profile-tab-rooms').getAttribute('aria-selected'), 'true');
    await capture('my-rooms'); await page.locator('#btn-profile-close').click();
    await openMenu(); await page.locator('#btn-menu-profile').click(); await visible('#profile-modal');
    await page.waitForFunction(() => document.getElementById('btn-profile-tab-progress').getAttribute('aria-selected') === 'true');
    await page.locator('#btn-profile-close').click(); await openMenu();
    await page.locator('#btn-menu-my-rooms').click(); await visible('#profile-modal');
    assert.equal(await page.locator('#btn-profile-tab-rooms').getAttribute('aria-selected'), 'true', 'My Rooms retains the chosen tab with a cached profile');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('profile-invalidated', { detail: { userId: JSON.parse(window.render_game_to_text()).auth.user.id } })));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#btn-profile-tab-rooms').getAttribute('aria-selected'), 'true', 'profile refresh keeps the requested rooms tab');
    await page.locator('#btn-profile-close').click(); await openMenu();
  } else {
    await hidden('#btn-menu-profile'); await hidden('#btn-menu-my-rooms'); await visible('#auth-signin-reason');
    const email = page.locator('#auth-email-input'); await email.fill('navigation-test@example.invalid');
    assert.equal(await email.inputValue(), 'navigation-test@example.invalid');
    assert(await page.locator('#auth-panel').evaluate(e => e.classList.contains('menu-open')), 'typing keeps the account menu open');
  }
  await capture('account-menu');
  if (signed) {
    await page.locator('#account-signin-options > summary').click(); await visible('#auth-email-input');
    await page.locator('#auth-email-input').fill('navigation-test@example.invalid');
    assert.equal(await page.locator('#account-signin-options').evaluate(e => e.open), true, 'account linking stays open while typing');
    await capture('account-options'); await page.locator('#account-signin-options > summary').click(); await hidden('#auth-email-input');
  }
  await destination('#btn-guestbook-open', '#guestbook-modal', '#btn-guestbook-close'); await menuClosed();
  await openMenu(); await destination('#btn-world-settings', '#settings-modal', '#btn-settings-close'); await menuClosed();
  await openMenu(); await destination('#btn-world-controls', '#controls-modal', '#btn-controls-close'); await menuClosed();
  await page.locator('#btn-world-play').click(); await page.waitForTimeout(200); await intro(); await mode('play-world');
  await hidden('#world-navigation');
  const footer = await page.locator('#bottom-bar').evaluate(e => getComputedStyle(e).display !== 'none');
  if (footer) {
    await visible('#btn-chat-toggle'); await hidden('#btn-world-zoom-out-footer'); await hidden('#btn-fit-screen');
  }
  await openMenu(); await destination('#btn-world-controls', '#controls-modal', '#btn-controls-close');
  await mode('play-world'); await menuClosed(); await page.waitForTimeout(250); await capture('play-navigation');
  await stop();
  if (signed && editor) {
    await page.locator('#btn-world-edit').click(); await mode('editor');
    await openMenu();
    for (const id of ['#btn-world-settings', '#btn-world-controls', '#btn-guestbook-open']) assert.match(await page.locator(id).evaluate(e => getComputedStyle(e).fontFamily), /Early GameBoy/i);
    await capture('editor-account-menu');
    await page.locator('#menu-body').evaluate(e => { e.scrollTop = e.scrollHeight; });
    const logoutTap = await page.locator('#btn-auth-logout').evaluate(e => {
      const r = e.getBoundingClientRect();
      return { bottom: r.bottom, reachable: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    assert(logoutTap.reachable, `editor toolbar must not intercept the final menu action: ${JSON.stringify(logoutTap)}`);
    await capture('editor-menu-bottom');
    await page.locator('#menu-body').evaluate(e => { e.scrollTop = 0; });
    await destination('#btn-world-settings', '#settings-modal', '#btn-settings-close'); await mode('editor');
    await openMenu(); await destination('#btn-world-controls', '#controls-modal', '#btn-controls-close'); await mode('editor');
    await capture('editor-menu');
  }
  return { bounds, signed, editor: signed && editor, cases: ['browse destinations', 'global vs room leaderboard', 'account menu', 'guestbook', 'settings', 'controls', 'quiet play footer', 'play menu', ...(signed ? ['profile vs rooms', 'cached rooms tab', 'profile refresh'] : []), ...(signed && editor ? ['editor menu'] : [])] };
}
