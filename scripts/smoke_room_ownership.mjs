// Actual controls and isolated API responses; never a real account, transfer or write.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
import { installMobileSignedFixture } from './lib/mobileSignedFixture.mjs';
const base = process.argv[2] || 'http://127.0.0.1:4198';
const output = process.argv[3] || 'output/web-game/room-ownership';
mkdirSync(output, { recursive: true });
createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/api.json.gz`);
const recorded = JSON.parse(gunzipSync(readFileSync(`${output}/api.json.gz`)));
const snapshot = JSON.parse(recorded.entries.find(e => e.path === '/api/rooms/0%2C0/published').text);
const originalSummary = JSON.parse(recorded.entries.find(e => e.path === '/api/rooms/0%2C0/summary').text);
const template = JSON.parse(recorded.entries.find(e => e.path === '/api/world/chunks/summary').text).chunks[0].rooms[0];
const profileTemplate = JSON.parse(recorded.entries.find(e => e.path.includes('/profiles/') && e.path.endsWith('/summary')).text);
const buyer = '0x2222222222222222222222222222222222222222', seller = '0x1111111111111111111111111111111111111111';
const refreshPath = '/api/rooms/0%2C0/ownership/refresh';
const reports = [];
for (const [device, engine, width, height, touch] of [
  ['desktop', chromium, 1280, 800, false], ['narrow-phone', chromium, 320, 568, true],
  ['safari-phone', webkit, 390, 844, true], ['tablet', chromium, 768, 1024, true],
]) {
  if (process.env.OWNERSHIP_PROFILES && !process.env.OWNERSHIP_PROFILES.split(',').includes(device)) continue;
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
  try {
    for (const kind of ['buyer', 'seller', 'outsider', 'failure-retry', 'expanded-buyer', 'auth-cancel', 'unminted', 'metadata-current', 'metadata-stale', 'metadata-unknown']) {
      if (process.env.OWNERSHIP_CASES && !process.env.OWNERSHIP_CASES.split(',').includes(kind)) continue;
      const artworkCase = kind.startsWith('metadata-');
      const roomSnapshot = artworkCase ? { ...snapshot, version: 8 } : snapshot;
      const name = `${device}-${kind}`, expanded = kind === 'expanded-buyer', minted = kind !== 'unminted';
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
      const api = createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/${name}-api.json.gz`);
      await api.install(context);
      const local = new URL(base);
      if (local.hostname === '127.0.0.1') await context.routeWebSocket(u => u.hostname === local.hostname && u.port === local.port && u.pathname === '/', s => s.connectToServer());
      await installMobileSignedFixture(context, { roomEditor: true });
      const wallet = kind === 'seller' ? seller : kind === 'outsider' ? `0x${'33'.repeat(20)}` : buyer;
      const user = { id: 'mobile-smoke-fixture', walletAddress: wallet, email: null, displayName: 'Ownership test' };
      let session = { authenticated: true, source: 'session', user, schoolManaged: false, school: null, partykitHost: '', chatModeration: { role: 'none', banned: false } };
      let fresh = false, fail = kind === 'failure-retry', release = () => {}, started;
      const start = new Promise(resolve => { started = resolve; });
      const requests = [], errors = [], consoleErrors = [], failedResponses = [], groupWrites = [];
      const membership = { expandedRoomId: 'course:ownership-fixture', title: 'Ownership adventure', goalType: null, cellCount: 2, source: 'native_expanded_room', legacyCourseId: 'ownership-fixture' };
      const course = { id: 'ownership-fixture', title: membership.title, roomRefs: [0, 1].map(x => ({ roomId: `${x},0`, coordinates: { x, y: 0 }, roomVersion: snapshot.version, roomTitle: `Cell ${x}`, protectedMinted: x === 0 })), objectLinks: [], pressurePlateLinks: [], startPoint: { roomId: '0,0', x: 328, y: 304 }, goal: null, version: 1, status: 'published', createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt, publishedAt: snapshot.publishedAt };
      const summary = () => ({ ...originalSummary, draftVersion: roomSnapshot.version, publishedVersion: roomSnapshot.version,
        ...(artworkCase ? { canonicalVersion: 8, mintedMetadataRoomVersion: fresh ? kind === 'metadata-current' ? 8 : kind === 'metadata-stale' ? 3 : null : null, mintedMetadataHash: fresh ? 'a'.repeat(64) : null, mintedMetadataUpdatedAt: fresh ? '2026-10-20T00:00:00Z' : null } : {}), ...(minted ? {} : { claimerUserId: user.id }),
        mintedChainId: minted ? 8453 : null, mintedContractAddress: minted ? seller : null, mintedTokenId: minted ? '42' : null,
        mintedOwnerWalletAddress: minted ? fresh ? buyer : seller : null,
        permissions: { canSaveDraft: !minted || wallet === (fresh ? buyer : seller), canPublish: !minted || wallet === (fresh ? buyer : seller), canRevert: false, canMint: false } });
      const cors = r => ({ 'access-control-allow-origin': r.request().headers().origin || local.origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
      const reply = (r, json, status = 200) => r.fulfill({ status, json, headers: cors(r) });
      await context.route(u => u.pathname === '/api/auth/session', r => reply(r, session));
      await context.route(u => u.pathname === `/api/profiles/${originalSummary.claimerUserId}/summary`, r => reply(r, { ...profileTemplate, userId: originalSummary.claimerUserId, displayName: originalSummary.claimerDisplayName }));
      await context.route(u => u.pathname === '/api/rooms/0%2C0/summary', r => reply(r, summary()));
      await context.route(u => u.pathname === '/api/rooms/0%2C0/current', r => reply(r, { summary: summary(), draft: roomSnapshot, published: roomSnapshot }));
      if (artworkCase) {
        await context.route(u => u.pathname === '/api/rooms/0%2C0/versions', r => reply(r, { versions: [{ version: 8, title: roomSnapshot.title, createdAt: roomSnapshot.publishedAt || roomSnapshot.updatedAt, publishedByUserId: originalSummary.claimerUserId, publishedByPrincipalKind: 'user', publishedByAgentId: null, publishedByDisplayName: originalSummary.claimerDisplayName, revertedFromVersion: null, leaderboardSourceVersion: null }] }));
        await context.route(u => u.pathname === '/api/rooms/snapshots/query', r => {
          const references = r.request().postDataJSON()?.references;
          if (!Array.isArray(references) || !references.length || !references.every(ref => ref.kind === 'version' && ref.roomId === '0,0' && ref.version === 8)) return r.fallback();
          return reply(r, { snapshots: [{ key: 'version:0,0:8', snapshot: roomSnapshot }], missing: [] });
        });
      }
      await context.route(u => u.pathname === '/api/courses/ownership-fixture', r => reply(r, { published: course, draft: null, versions: [], ownerUserId: originalSummary.claimerUserId, permissions: { canSaveDraft: false, canPublish: false, canUnpublish: false } }));
      await context.route(u => /^\/api\/world\/chunks(?:\/summary)?$/.test(u.pathname), r => {
        const params = new URL(r.request().url()).searchParams;
        const bounds = Object.fromEntries(['minChunkX', 'maxChunkX', 'minChunkY', 'maxChunkY'].map(key => [key, Number(params.get(key))]));
        const chunks = [];
        for (let y = bounds.minChunkY; y <= bounds.maxChunkY; y++) for (let x = bounds.minChunkX; x <= bounds.maxChunkX; x++) {
          const rooms = y === 0 && x === 0 ? (expanded ? [0, 1] : [0]).map(rx => ({ ...template, id: `${rx},0`, coordinates: { x: rx, y: 0 }, state: 'published', version: snapshot.version, title: 'Ownership room', creatorUserId: originalSummary.claimerUserId, creatorDisplayName: originalSummary.claimerDisplayName,
            course: expanded ? { courseId: course.id, courseTitle: course.title, goalType: null, roomCount: 2 } : null, expandedRoom: expanded ? membership : null })) : [];
          chunks.push({ id: `${x},${y}`, coordinates: { x, y }, roomBounds: { minX: x * 8, maxX: x * 8 + 7, minY: y * 8, maxY: y * 8 + 7 }, rooms, previewRooms: [], chunkPreviewHash: 'ownership-fixture' });
        }
        return reply(r, { chunkBounds: bounds, roomBounds: { minX: bounds.minChunkX * 8, maxX: (bounds.maxChunkX + 1) * 8 - 1, minY: bounds.minChunkY * 8, maxY: (bounds.maxChunkY + 1) * 8 - 1 }, chunks });
      });
      await context.route(u => u.pathname === refreshPath, async r => {
        if (r.request().method() === 'OPTIONS') return reply(r, {}, 204);
        assert.equal(r.request().method(), 'POST'); requests.push('POST'); started();
        if (kind === 'auth-cancel') await new Promise(resolve => { release = resolve; });
        if (fail) { fail = false; return reply(r, { error: 'Isolated provider outage' }, 503); }
        fresh = true; return reply(r, summary());
      });
      await context.route(u => /\/(?:courses|expanded-rooms)\//.test(u.pathname) && u.pathname.startsWith('/api/'), r => {
        if (!['GET', 'OPTIONS'].includes(r.request().method())) { groupWrites.push(r.request().url()); return reply(r, { error: 'Unexpected group write' }, 403); }
        return r.fallback();
      });
      await context.route('https://mann.cool/api/v1/plays', r => reply(r, { success: true }));
      await context.route('https://cloudflareinsights.com/cdn-cgi/rum', r => r.fulfill({ status: 204, headers: cors(r) }));
      await context.route(u => u.pathname.startsWith('/api/'), r => r.request().method() === 'OPTIONS' ? reply(r, {}, 204) : r.fallback());
      await context.addInitScript(() => {
        localStorage.setItem('crypto-override', '1'); // Ownership/artwork cases use the documented wallet-present override.
        localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
        localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
      });
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: m.location().url }); });
      page.on('response', r => { if (r.status() >= 400) failedResponses.push({ path: new URL(r.url()).pathname, status: r.status() }); });
      const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
      const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
      try {
        const renderer = engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl';
        await page.goto(`${base}/?welcome=0&renderer=${renderer}`);
        await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120_000 });
        if (touch) { await click('#btn-world-jump-sheet'); await page.locator('#mobile-world-jump-input').fill('0,0'); await click('#btn-mobile-world-jump-go'); }
        else { await page.locator('#world-jump-input').fill('0,0'); await click('#btn-world-jump'); }
        await page.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text()).activeScene; return s?.mode === 'browse' && s.selected.x === 0 && s.selected.y === 0; });
        await page.locator('#btn-world-edit').waitFor({ state: 'visible' });
        await page.waitForFunction(expected => document.querySelector('#btn-world-edit')?.textContent === expected, kind === 'seller' ? 'Edit Room' : minted ? 'Check ownership' : 'Edit Room');
        if (touch) { const box = await page.locator('#btn-world-edit').boundingBox(); assert(box.width >= 44 && box.height >= 44, JSON.stringify(box)); }
        await page.screenshot({ path: `${output}/${name}-before.png` }); await click('#btn-world-edit');
        if (kind === 'failure-retry') {
          await page.locator('#busy-overlay[data-busy-state="error"]').waitFor(); assert.equal(await page.locator('#busy-overlay-status').textContent(), 'Could not check room ownership. Please try again.');
          await click('#btn-busy-retry');
        }
        if (kind === 'seller' || kind === 'outsider') {
          await page.locator('#busy-overlay[data-busy-state="error"]').waitFor();
          assert.equal(await page.locator('#busy-overlay-status').textContent(), 'Your linked wallet does not own this room.'); assert.equal((await state()).scene, 'overworld-play');
          await click('#btn-busy-close'); assert.equal(await page.locator('#btn-world-edit').textContent(), 'Check ownership');
        } else if (kind === 'auth-cancel') {
          let deadline; try { await Promise.race([start, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Refresh did not start')), 30_000); })]); } finally { clearTimeout(deadline); }
          session = { ...session, authenticated: false, user: null };
          await page.evaluate(() => window.dispatchEvent(new Event('focus')));
          await page.locator('#busy-overlay').waitFor({ state: 'hidden' }); release();
          assert.equal((await state()).scene, 'overworld-play'); await page.waitForTimeout(150); assert.equal((await state()).mode, 'browse');
          await page.locator('#btn-world-edit').waitFor({ state: 'hidden' });
        } else {
          await page.waitForFunction(({ minted, buyer, version }) => { const s = JSON.parse(window.render_game_to_text()).activeScene; return s?.scene === 'editor' && s.canSaveDraft === true && s.canPublish === true && s.roomVersion === version && s.publishedVersion === version && (!minted || s.mintedOwnerWalletAddress === buyer); }, { minted, buyer, version: roomSnapshot.version });
          if (artworkCase) {
            const expected = kind === 'metadata-current' ? 'NFT metadata is current at v8.' : kind === 'metadata-stale' ? 'NFT metadata is stale (on-chain v3, room v8).' : 'Artwork status has not been recorded here.';
            await page.waitForFunction(expected => document.body.textContent.includes(expected), expected);
            const body = await page.locator('body').textContent(); assert(!body.includes('NFT metadata is not on-chain yet'));
            if (!await page.locator('[data-editor-room-action="history"]').isVisible()) await click('[data-editor-shell-action="room"]');
            await click('[data-editor-room-action="history"]');
            await page.locator('#room-history-modal').waitFor({ state: 'visible' });
            const historyExpected = kind === 'metadata-current' ? 'NFT metadata current at v8' : kind === 'metadata-stale' ? 'NFT metadata stale at v3' : 'Artwork status unknown';
            const history = page.locator('#room-history-meta'); await history.waitFor({ state: 'visible' });
            await page.waitForFunction(expected => document.getElementById('room-history-meta').textContent.includes(expected), historyExpected);
            assert(!((await history.textContent()).includes('NFT metadata not set')));
            assert(await history.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Artwork details must wrap inside the dialog');
            const box = await history.boundingBox(); assert(box && box.width > 0 && box.height > 0 && box.y >= 0 && box.y + box.height <= height);

          }
          const editor = await state(); if (expanded) assert.equal(editor.courseEdit, null, 'A room token must not grant group editing');
        }
        assert.equal(requests.length, kind === 'unminted' ? 0 : kind === 'failure-retry' ? 2 : 1); assert.deepEqual(groupWrites, []); assert.deepEqual(errors, []); assert.deepEqual(api.report().misses, {});
        const expected = consoleErrors.filter(e => kind === 'failure-retry' && /Failed to load resource.*503|503.*Service Unavailable/.test(e.text) && (!e.url || new URL(e.url).pathname === refreshPath));
        assert.deepEqual(consoleErrors.filter(e => !expected.includes(e)), []); assert.deepEqual(failedResponses, kind === 'failure-retry' ? [{ path: refreshPath, status: 503 }] : []);
        await page.screenshot({ path: `${output}/${name}-after.png` }); reports.push({ name, ok: true, refreshRequests: requests.length, errors, expectedConsoleErrors: expected.length, fixtureMisses: api.report().misses, groupWrites, realTransfers: 0, realAccountWrites: 0 });
        console.log(`${name}: room ownership passed`);
      } catch (error) { await page.screenshot({ path: `${output}/${name}-failure.png` }); writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: String(error), errors, consoleErrors, failedResponses, requests, fixtures: api.report(), state: await state() }, null, 2)); throw error; }
      finally { release(); await context.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, cases: reports, realTransactions: 0 }, null, 2));
