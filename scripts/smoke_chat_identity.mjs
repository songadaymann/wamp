import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createApiFixtures } from './lib/apiFixtures.mjs';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
const base = process.argv[2] || 'http://127.0.0.1:4198';
const output = process.argv[3] || 'output/web-game/chat-identity';
mkdirSync(output, { recursive: true });
createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/api.json.gz`);
const recorded = JSON.parse(gunzipSync(readFileSync(`${output}/api.json.gz`)));
const original = JSON.parse(recorded.entries.find(e => e.path === '/api/rooms/0%2C0/published').text);
const profile = JSON.parse(recorded.entries.find(e => e.path.includes('/profiles/') && e.path.endsWith('/summary')).text);
const reports = [];
for (const [name, engine, width, height, touch] of [
  ['desktop', chromium, 1280, 800, false], ['narrow-phone', chromium, 320, 568, true], ['safari-phone', webkit, 390, 844, true], ['readable-phone', chromium, 390, 844, true],
]) {
  if (process.env.IDENTITY_PROFILES && !process.env.IDENTITY_PROFILES.split(',').includes(name)) continue;
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] }); let page, lastDialog = null, diagnostics = {};
  try {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    const api = createApiFixtures({ mode: 'replay', file: `${output}/api.json.gz` }); await api.install(context);
    if (new URL(base).hostname === '127.0.0.1') await context.routeWebSocket(u => new URL(u).hostname === '127.0.0.1' && new URL(u).port === new URL(base).port && new URL(u).pathname === '/', s => s.connectToServer());
    const first = { userId: 'first-id', displayName: 'Same display name', username: 'first_' + 'x'.repeat(18) };
    const second = { userId: 'second-id', displayName: 'Same display name', username: 'other_' + 'x'.repeat(18) };
    const owner = { id: 'auth-smoke-account', email: 'owner@example.invalid', walletAddress: null, displayName: 'Owner', username: 'owner_account' };
    let session = { authenticated: true, user: owner, source: 'session', partykitHost: '', chatModeration: { role: 'owner', banned: false } };
    let admins = [{ userId: 'legacy-id', displayName: 'Legacy admin', username: null, createdAt: '2026-10-19T00:00:00Z', grantedByDisplayName: 'Owner', grantedByUsername: 'owner_account' }];
    let bans = [{ ...first, createdAt: '2026-10-19T00:00:00Z', bannedByDisplayName: 'Owner', bannedByUsername: 'owner_account' }];
    let messages = [first, second, { userId: 'unsafe-id', displayName: '<svg/onload=bad()>', username: 'plain_account' }].map((u, n) => ({ id: `message-${n}`, userId: u.userId,
      userDisplayName: u.displayName, userUsername: u.username, body: `Identity message ${n}`, createdAt: `2026-10-19T00:00:0${n}Z` }));
    const writes = [], searches = [], errors = [], expected = [], failedRequests = []; let rejectGrant = true;
    diagnostics = { writes, searches, errors, expected, failedRequests };
    const cors = r => ({ 'access-control-allow-origin': r.request().headers().origin || new URL(base).origin,
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' });
    const reply = (r, json, status = 200) => r.fulfill({ json, status, headers: cors(r) });
    await context.route(u => u.pathname === '/api/auth/session', r => reply(r, session));
    await context.route(u => u.pathname === '/api/profiles/auth-smoke-account/summary', r => reply(r, { ...profile, ...owner, userId: owner.id, canEdit: true }));
    await context.route(u => u.pathname.startsWith('/api/chat/'), async r => {
      const q = r.request(), u = new URL(q.url()), path = u.pathname, method = q.method();
      if (method === 'OPTIONS') return reply(r, {}, 204);
      if (path === '/api/chat/mention-users') {
        const query = u.searchParams.get('q') || ''; searches.push(query);
        if (query === 'offline') return reply(r, { error: 'Offline test' }, 503);
        return reply(r, { users: query === 'none' ? [] : [first, second] });
      }
      if (method === 'GET') {
        if (path === '/api/chat/moderation/admins') return reply(r, { admins, viewer: session.chatModeration });
        if (path === '/api/chat/moderation/bans') return reply(r, { bans, viewer: session.chatModeration });
        if (path === '/api/chat/messages') return reply(r, { messages, viewer: session.chatModeration });
      }
      const body = q.postData() ? q.postDataJSON() : null; writes.push({ path, method, body });
      if (path === '/api/chat/moderation/admins' && method === 'POST') {
        assert.deepEqual(body, { userId: second.userId });
        if (rejectGrant) return reply(r, { error: 'Could not grant access. Try again.' }, 503);
        admins.push({ ...second, grantedByDisplayName: 'Owner', grantedByUsername: 'owner_account', createdAt: '2026-10-19T00:00:00Z' });
        return reply(r, { ok: true, userId: second.userId, viewer: session.chatModeration }, 201);
      }
      if (path === `/api/chat/moderation/admins/${second.userId}` && method === 'DELETE') {
        admins = admins.filter(a => a.userId !== second.userId); return reply(r, { ok: true, userId: second.userId, viewer: session.chatModeration });
      }
      if (path === `/api/chat/moderation/bans/${first.userId}` && method === 'DELETE') {
        bans = []; return reply(r, { ok: true, userId: first.userId, viewer: session.chatModeration });
      }
      if (path === '/api/chat/moderation/bans' && method === 'POST') {
        assert.deepEqual(body, { userId: first.userId }); return reply(r, { ok: true, userId: first.userId, viewer: session.chatModeration });
      }
      if (path === '/api/chat/messages/message-0' && method === 'DELETE') {
        messages = messages.filter(m => m.id !== 'message-0'); return reply(r, { ok: true, messageId: 'message-0', viewer: session.chatModeration });
      }
      throw new Error(`Unexpected chat request ${method} ${path}`);
    });
    await context.route(u => /^\/api\/rooms\/[^/]+\/published$/.test(u.pathname) && u.pathname !== '/api/rooms/0%2C0/published', r => {
      const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]), [x, y] = id.split(',').map(Number);
      return reply(r, { ...original, id, coordinates: { x, y }, goal: null, music: null, placedObjects: [] });
    });
    await context.route(u => /^\/api\/rooms\/[^/]+\/comments$/.test(u.pathname), r => {
      const u = new URL(r.request().url()), id = decodeURIComponent(u.pathname.split('/')[3]);
      return reply(r, { comments: id === '0,0' ? [{ id: 'identity-comment', roomId: id, roomVersion: Number(u.searchParams.get('version') || 1), roomCoordinates: { x: 0, y: 0 },
        position: { x: 200, y: 260 }, authorUserId: second.userId, authorDisplayName: second.displayName,
        authorUsername: second.username, body: 'A comment from the second account.', createdAt: '2026-10-19T00:00:00Z' }] : [], commentArea: null });
    });
    for (const [path, json] of [
      ['/api/settings/me', { settings: null, updatedAt: null }],
      ['/api/lost-songs/progress', { roomIds: [], total: 0 }],
      ['/api/me/activity', { entries: [], unreadCount: 0, latestId: 0, nextBefore: null, preferences: { weeklyDigest: false, dethroneAlerts: false, dailyFeatures: false, emailAvailable: true } }],
      ['/api/leaderboards/rooms/discover', { sort: 'unrated', results: [], totalCount: 0, difficultyFilter: null }],
      ['/api/rooms/mine', { rooms: [] }],
    ]) await context.route(u => u.pathname === path, r => reply(r, json));
    await context.route('https://mann.cool/api/v1/plays', r => reply(r, { success: true }));
    await context.route('https://cloudflareinsights.com/cdn-cgi/rum', r => r.fulfill({ status: 204, headers: cors(r) }));
    await context.addInitScript(() => {
      localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
      localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
      localStorage.setItem('wamp.devicePerformanceMode.v1', JSON.stringify({ version: 1, mode: 'full-quality' }));
      window.__identityAuth = null; window.__openedIdentityProfile = null;
      window.addEventListener('auth-state-changed', e => { window.__identityAuth = structuredClone(e.detail); });
      window.addEventListener('profile-open-request', e => { window.__openedIdentityProfile = e.detail.userId; e.stopImmediatePropagation(); });
    });
    if (name === 'readable-phone') await context.addInitScript(() => {
      localStorage.setItem('wamp.settings.textStyle', 'readable'); localStorage.setItem('wamp.settings.textSize', 'large');
    });
    page = await context.newPage(); page.setDefaultTimeout(30_000);
    page.on('dialog', dialog => { lastDialog = dialog; });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const text = m.text(), path = new URL(m.location().url || base).pathname;
      if (text.startsWith('Failed to grant chat admin') || (text.startsWith('Failed to load resource:') && ['/api/chat/mention-users', '/api/chat/moderation/admins'].includes(path))) expected.push(text);
      else errors.push(text);
    });
    page.on('response', r => { if (r.status() >= 400) failedRequests.push({ status: r.status(), path: new URL(r.url()).pathname }); });
    const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
    const renderer = engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl';
    await page.goto(`${base}/?welcome=0&x=0&y=0&renderer=${renderer}`);
    await page.waitForFunction(() => document.body.dataset.appReady === 'true');
    await page.locator('#room-goal-intro-modal').waitFor({ state: 'visible' }); await click('#btn-room-goal-intro-start');
    await page.waitForFunction(() => window.__identityAuth?.chatModeration.role === 'owner');
    const menu = async () => {
      if (!await page.locator('#btn-chat-moderation-open').isVisible()) {
        await click('#menu-toggle');
        const admin = page.locator('#menu-body details').filter({ has: page.locator('#btn-chat-moderation-open') });
        if (!await admin.evaluate(el => el.open)) await (touch ? admin.locator('summary').tap() : admin.locator('summary').click());
      }
    };
    const open = async () => { await menu(); await click('#btn-chat-moderation-open'); await page.locator('#chat-moderation-modal').waitFor({ state: 'visible' }); await page.locator('#chat-moderation-admin-input').waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.getElementById('chat-moderation-admin-input').disabled); };
    const input = page.locator('#chat-moderation-admin-input'), results = page.locator('#chat-moderation-admin-results button');
    const search = async query => { await input.fill(query); await page.waitForFunction(() => document.querySelectorAll('#chat-moderation-admin-results button').length === 2); };
    const confirm = async (selector, accepted, handle) => {
      const opened = page.waitForEvent('dialog', { timeout: 30_000 }), action = click(selector);
      const dialog = await Promise.race([opened, action.then(() => opened)]);
      assert.equal(dialog.type(), 'confirm'); assert(dialog.message().includes(`@${handle}`));
      if (accepted) await dialog.accept(); else await dialog.dismiss(); lastDialog = null; await action;
    };
    await open(); assert.equal(await page.locator('#btn-chat-moderation-admin-add').isDisabled(), true);
    await search('Same display name'); assert.deepEqual(await results.allTextContents(), [first, second].map(u => `${u.displayName} (@${u.username})`));
    for (const target of [input, results.nth(0), results.nth(1), page.locator('#btn-chat-moderation-close'), page.locator('#btn-chat-moderation-admin-add')]) { const box = await target.boundingBox(); assert(box && box.height >= 44, JSON.stringify({ box, element: await target.evaluate(el => el.id || el.className) })); }
    await input.press('Enter'); assert.equal(writes.length, 0);
    await (touch ? results.nth(1).tap() : results.nth(1).press('Enter')); assert.equal(await page.locator('#btn-chat-moderation-admin-add').isEnabled(), true);
    await input.fill('Changed'); assert.equal(await page.locator('#btn-chat-moderation-admin-add').isDisabled(), true); await input.press('Enter'); assert.equal(writes.length, 0);
    await search('Same display name'); await (touch ? results.nth(1).tap() : results.nth(1).press('Enter'));
    assert.equal(await page.locator('#chat-moderation-admin-search-status').innerText(), `Selected: ${second.displayName} (@${second.username})`);
    await page.screenshot({ path: `${output}/${name}-selected.png` });
    await click('#btn-chat-moderation-admin-add'); await page.waitForFunction(() => document.getElementById('chat-moderation-status').textContent === 'Could not grant access. Try again.');
    assert.equal(await page.locator('#btn-chat-moderation-admin-add').isEnabled(), true); rejectGrant = false;
    await click('#btn-chat-moderation-admin-add'); await page.waitForFunction(handle => document.getElementById('chat-moderation-status').textContent === `Same display name (@${handle}) is now a chat admin.`, second.username);
    assert.equal(writes.filter(w => w.path === '/api/chat/moderation/admins').length, 2);
    const adminRow = page.locator('#chat-moderation-admin-list .chat-moderation-item').filter({ hasText: `@${second.username}` });
    assert.equal(await adminRow.count(), 1); assert.match(await page.locator('#chat-moderation-admin-list').innerText(), /Legacy admin/);
    await page.screenshot({ path: `${output}/${name}-admin.png` });
    const remove = '#chat-moderation-admin-list .chat-moderation-item:last-child button';
    await confirm(remove, false, second.username); assert.equal(writes.filter(w => w.method === 'DELETE').length, 0);
    await confirm(remove, true, second.username); await page.waitForFunction(() => document.getElementById('chat-moderation-status').textContent.includes('no longer'));
    assert(writes.some(w => w.path === `/api/chat/moderation/admins/${second.userId}`));
    await confirm('#chat-moderation-ban-list button', true, first.username); await page.waitForFunction(() => document.getElementById('chat-moderation-status').textContent.includes('was unbanned'));
    await input.fill('offline'); await page.waitForFunction(() => document.getElementById('chat-moderation-admin-search-status').textContent === 'Search failed. Try again.');
    await input.fill('none'); await page.waitForFunction(() => document.getElementById('chat-moderation-admin-search-status').textContent === 'No matching accounts.');
    await input.fill('cancelled'); await click('#btn-chat-moderation-close'); const afterClose = searches.length;
    await page.waitForTimeout(250); assert.equal(searches.length, afterClose);
    await open(); assert.equal(await input.inputValue(), ''); assert.equal(await results.count(), 0);
    session = { ...session, chatModeration: { role: 'admin', banned: false } };
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForFunction(() => window.__identityAuth.chatModeration.role === 'admin');
    assert.equal(await page.locator('#chat-moderation-admin-section').isVisible(), false);
    await click('#btn-chat-moderation-close');
    session = { ...session, chatModeration: { role: 'owner', banned: false } };
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForFunction(() => window.__identityAuth.chatModeration.role === 'owner');
    await menu(); await click('#btn-menu-chat'); await page.locator('#global-chat-body').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('#chat-messages .chat-message-author').length === 3);
    const authors = page.locator('#chat-messages .chat-message-author');
    assert.deepEqual((await authors.allTextContents()).slice(0, 2), [first, second].map(u => `${u.displayName} (@${u.username})`));
    assert.equal(await page.locator('#chat-messages svg, #chat-messages img').count(), 0);
    await (touch ? authors.nth(1).tap() : authors.nth(1).click()); assert.equal(await page.evaluate(() => window.__openedIdentityProfile), second.userId);
    assert.equal(await page.locator('#global-chat-body').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: `${output}/${name}-chat.png` });
    await confirm('#chat-messages .chat-message:first-child .chat-message-action:last-child', true, first.username);
    assert(writes.some(w => w.path === '/api/chat/moderation/bans' && w.body.userId === first.userId));
    await page.waitForFunction(() => window.get_chat_debug_state().moderationActionMessageId === null);
    assert.equal(await page.locator('#chat-messages .chat-message:first-child .chat-message-action:first-child').isEnabled(), true);
    await confirm('#chat-messages .chat-message:first-child .chat-message-action:first-child', true, first.username);
    await page.waitForFunction(() => document.querySelectorAll('#chat-messages .chat-message-author').length === 2); await click('#btn-chat-close');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.roomComments.authors.length === 1);
    const current = await state(), author = current.roomComments.authors[0];
    assert.equal(author.label, `${second.displayName} (@${second.username})`); assert(author.width <= author.contentWidth + 1); assert(author.bodyY >= author.authorY + author.height);
    const canvas = await page.locator('#game-container > canvas').boundingBox(); assert(canvas);
    const x = canvas.x + (author.x - current.camera.worldView.x) / current.camera.worldView.width * canvas.width;
    const y = canvas.y + (author.y - current.camera.worldView.y) / current.camera.worldView.height * current.camera.height * canvas.width / current.camera.width;
    assert(x >= 0 && x < width && y >= 0 && y < height, JSON.stringify({ x, y, author, camera: current.camera }));
    if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.roomComments.authors[0].visible);
    await page.screenshot({ path: `${output}/${name}-comment.png` });
    assert.deepEqual(errors, []); const fixtures = api.report(); assert.deepEqual(fixtures.misses, {});
    assert(expected.some(e => e.startsWith('Failed to grant chat admin')));
    assert(failedRequests.every(r => r.status === 503 && ['/api/chat/mention-users', '/api/chat/moderation/admins'].includes(r.path)), JSON.stringify(failedRequests));
    reports.push({ name, ok: true, exactGrant: second.userId, duplicateNames: true, changedInputRejected: true, failedGrantRecovery: true,
      cancelCloseSearch: true, permissionChange: true, uniqueConfirmations: true, stableProfileLink: true, escapedNames: true,
      commentLayout: author, errors, fixtureMisses: fixtures.misses, expectedFailures: failedRequests, searches: searches.length, isolatedWrites: writes });
    console.log(`${name}: chat identity passed`); await context.close();
  } catch (error) {
    if (lastDialog) await lastDialog.dismiss().catch(() => undefined);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: `${output}/${name}-failure.png` });
      writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: String(error), diagnostics, chat: await page.evaluate(() => window.get_chat_debug_state?.()), state: await page.evaluate(() => window.render_game_to_text ? JSON.parse(window.render_game_to_text()).activeScene : null) }, null, 2));
    }
    throw error;
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
