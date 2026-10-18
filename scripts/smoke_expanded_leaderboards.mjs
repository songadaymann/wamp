import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createApiFixtures } from './lib/apiFixtures.mjs';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';

const base = process.argv[2] || 'http://127.0.0.1:4197';
const output = process.argv[3] || 'output/f250-expanded-leaderboards-2026-10-18/browser';
mkdirSync(output, { recursive: true });
createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/base.json.gz`);
const source = JSON.parse(gunzipSync(readFileSync(`${output}/base.json.gz`)));
const original = JSON.parse(source.entries.find(e => e.path === '/api/rooms/0%2C0/published').text);
const reports = [];
for (const [device, engine, width, height, touch] of [
  ['desktop', chromium, 1280, 800, false], ['phone', chromium, 390, 844, true], ['safari-phone', webkit, 390, 844, true],
]) {
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
  try {
    for (const kind of ['native', 'legacy', 'no-goal']) {
      const name = `${device}-${kind}`;
      const courseId = 'leaderboard-fixture', expandedRoomId = `course:${courseId}`;
      const goal = kind === 'no-goal' ? null : { type: 'reach_exit', exit: { roomId: '1,0', x: 550, y: 304 }, timeLimitMs: null };
      const membership = { expandedRoomId, title: 'The Whole Adventure', goalType: goal?.type ?? null,
        cellCount: 2, source: 'native_expanded_room', legacyCourseId: courseId };
      const courseSummary = { courseId, courseTitle: membership.title, goalType: goal?.type ?? null, roomCount: 2 };
      const refs = [0, 1].map(x => ({ roomId: `${x},0`, coordinates: { x, y: 0 }, roomVersion: 12, roomTitle: `Cell ${x}`, protectedMinted: false }));
      const snapshot = { id: courseId, title: membership.title, roomRefs: refs, pitsAreDeadly: true, playerHearts: 1,
        objectLinks: [], pressurePlateLinks: [], startPoint: { roomId: '0,0', x: 328, y: 304 }, goal,
        version: 4, status: 'published', createdAt: original.createdAt, updatedAt: original.updatedAt, publishedAt: original.publishedAt };
      const room = id => ({ ...original, id, coordinates: { x: Number(id.split(',')[0]), y: 0 }, version: 12, goal: null, title: `Cell ${id}` });
      function replace(value) {
        if (Array.isArray(value)) return value.map(replace);
        if (!value || typeof value !== 'object') return value;
        const next = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
        if (next.id === '0,0' || next.id === '1,0') {
          if (Object.hasOwn(next, 'goal')) return room(next.id);
          if (Object.hasOwn(next, 'state')) return { ...next, state: 'published', version: 12, title: `Cell ${next.id}`,
            creatorUserId: null, creatorDisplayName: null, course: courseSummary, expandedRoom: kind === 'legacy' ? null : membership };
        }
        return next;
      }
      const file = `${output}/${name}.json.gz`;
      writeFileSync(file, gzipSync(JSON.stringify({ ...source, entries: source.entries.map(e => e.text && e.contentType.includes('json')
        ? { ...e, text: JSON.stringify(replace(JSON.parse(e.text))) } : e) })));
      const fixtures = createApiFixtures({ mode: 'replay', file });
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      await fixtures.install(context);
      if (base.includes('127.0.0.1')) await context.routeWebSocket(url => new URL(url).port === '4197' && new URL(url).pathname === '/', socket => socket.connectToServer());
      const cors = r => ({ 'access-control-allow-origin': r.request().headers().origin || new URL(base).origin,
        'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
      const reply = (r, json, status = 200) => r.fulfill({ status, json, headers: cors(r) });
      await context.route(u => /^\/api\/rooms\/[^/]+\/summary$/.test(u.pathname), r => reply(r, JSON.parse(source.entries.find(e => e.path === '/api/rooms/0%2C0/summary').text)));
      await context.route('**/api/world/chunks?*', r => {
        const entry = source.entries.find(e => e.path === '/api/world/chunks/summary');
        const value = replace(JSON.parse(entry.text));
        value.chunks = value.chunks.map(chunk => ({ ...chunk, previewRooms: [] }));
        return reply(r, value);
      });
      await context.route('**/api/courses/leaderboard-fixture', r => reply(r, { published: snapshot, draft: null, versions: [], id: courseId }));
      await context.route(u => /^\/api\/rooms\/[^/]+\/published$/.test(u.pathname), r => reply(r, room(decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]))));
      await context.route('**/api/rooms/snapshots/query', r => reply(r, { snapshots: r.request().postDataJSON().references.map(ref => ({
        key: `${ref.kind}:${ref.roomId}${ref.version ? `:${ref.version}` : ''}`, snapshot: room(ref.roomId),
      })), missing: [] }));
      const reads = []; let result = 'ranked', errorExpected = false, releaseOld;
      let delayNext = false;
      const board = () => ({ expandedRoomId, expandedRoomVersion: 4, courseId, courseVersion: 4, courseTitle: membership.title,
        goalType: 'reach_exit', rankingMode: 'time', quality: { adjustedAverage: null, average: null, totalVotes: 0, counts: {} },
        difficulty: { consensus: null, totalVotes: 0, counts: {} }, viewerRating: null, trophy: null,
        entries: result === 'empty' ? [] : [{ rank: 1, userId: 'fixture-player', userDisplayName: 'Whole Room Runner',
          attemptId: 'saved-fixture', elapsedMs: 12345, deaths: 1, score: 0, finishedAt: original.publishedAt }], viewerBest: null, viewerRank: null });
      await context.route(u => /\/api\/leaderboards\/(courses|expanded-rooms)\//.test(u.pathname), async r => {
        reads.push(new URL(r.request().url()).pathname + new URL(r.request().url()).search);
        if (delayNext) {
          delayNext = false;
          const old = board(); old.entries[0].userDisplayName = 'Stale Runner';
          await new Promise(resolve => { releaseOld = resolve; });
          return reply(r, old);
        }
        return reply(r, result === 'error' ? { error: 'Temporary fixture outage' } : board(), result === 'error' ? 503 : 200);
      });
      await context.route('https://mann.cool/api/v1/plays', r => reply(r, { success: true }));
      await context.route(u => u.pathname.startsWith('/api/'), r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors(r) }) : r.fallback());
      await context.addInitScript(() => {
        localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
        localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
      });
      const page = await context.newPage(), errors = [], expected = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') {
        if (errorExpected && (/Temporary fixture outage|Failed to load expanded room leaderboard|503/.test(m.text()))) expected.push(m.text());
        else if (!/\[Report Only\]|report-only/i.test(m.text())) errors.push(m.text());
      } });
      const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
      const close = () => click('#btn-leaderboard-close');
      const openFromMenu = async () => { await click('#menu-toggle'); await click('#btn-menu-room-leaderboard'); };
      try {
        // Warp in Browse to the nonentry cell through the real desktop/phone controls.
        await page.goto(`${base}/?welcome=0&renderer=webgl`);
        await page.waitForFunction(() => document.body.dataset.appReady === 'true');
        if (await page.locator('#room-goal-intro-modal').isVisible()) await click('#btn-room-goal-intro-start');
        if (await page.locator('#btn-mobile-world-stop').isVisible()) await click('#btn-mobile-world-stop');
        else if ((await page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene.mode)) === 'play') await click('#btn-world-play');
        if (touch) {
          await click('#btn-world-jump-sheet'); await page.locator('#mobile-world-jump-input').fill('1,0'); await click('#btn-mobile-world-jump-go');
        } else { await page.locator('#world-jump-input').fill('1,0'); await click('#btn-world-jump'); }
        await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.selected.x === 1);
        const more = page.locator('#btn-mobile-world-hud-details');
        if (await more.isVisible()) await click('#btn-mobile-world-hud-details');
        await click('#btn-world-leaderboard');
        await page.locator('#leaderboard-course-panel').waitFor({ state: 'visible' });
        assert(await page.locator('#btn-leaderboard-tab-room').isDisabled());
        if (kind === 'no-goal') {
          await page.waitForFunction(() => document.getElementById('leaderboard-course-summary').textContent.includes('no goal'));
          assert.equal(reads.length, 0);
        } else {
          await page.waitForFunction(() => document.getElementById('leaderboard-course-list').textContent.includes('Whole Room Runner'));
          assert(reads.every(path => path.includes(kind === 'legacy' ? '/courses/leaderboard-fixture' : '/expanded-rooms/course%3Aleaderboard-fixture')));
          assert(reads.every(path => !path.includes('version=12')));
          result = 'empty'; await click('#btn-leaderboard-course-refresh');
          await page.waitForFunction(() => document.getElementById('leaderboard-course-list').textContent.includes('No ranked clears yet'));
          errorExpected = true; result = 'error'; await click('#btn-leaderboard-course-refresh');
          await page.waitForFunction(() => document.getElementById('leaderboard-course-summary').textContent.includes('unavailable'));
          result = 'ranked'; await click('#btn-leaderboard-course-refresh');
          await page.waitForFunction(() => document.getElementById('leaderboard-course-list').textContent.includes('Whole Room Runner'));
          errorExpected = false;
          assert(await page.locator('#leaderboard-modal-error').isHidden());
        }
        await page.screenshot({ path: `${output}/${name}-board.png` });
        const bounds = await page.locator('#leaderboard-modal .history-modal-panel').boundingBox();
        assert(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, 'Leaderboard exceeds phone width');
        if (name === 'desktop-native') {
          delayNext = true; await click('#btn-leaderboard-course-refresh');
          while (!releaseOld) await page.waitForTimeout(10);
          await close(); await openFromMenu();
          await page.waitForFunction(() => document.getElementById('leaderboard-course-list').textContent.includes('Whole Room Runner'));
          releaseOld();
          await page.waitForResponse(response => response.url().includes('/api/leaderboards/expanded-rooms/'));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert(!(await page.locator('#leaderboard-course-list').textContent()).includes('Stale Runner'));
        }
        await close();
        // The same board remains reachable during Play through the menu.
        if (kind !== 'no-goal') {
          await click('#btn-world-play');
          if (await page.locator('#room-goal-intro-modal').isVisible()) await click('#btn-room-goal-intro-start');
          await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.mode === 'play');
          await openFromMenu();
          await page.waitForFunction(() => document.getElementById('leaderboard-course-list').textContent.includes('Whole Room Runner'));
          assert(reads.at(-1).includes('version=4'), 'Play must rank the exact Expanded Room version');
          await page.screenshot({ path: `${output}/${name}-play-board.png` });
          await close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(fixtures.report().misses, {});
        reports.push({ name, reads, errors, expectedErrors: expected.length, fixtureMisses: fixtures.report().misses });
        console.log(`${name} passed`);
      } catch (e) {
        await page.screenshot({ path: `${output}/${name}-failure.png` });
        writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: e.stack, reads, errors, fixtures: fixtures.report(), state: await page.evaluate(() => window.render_game_to_text?.()) }, null, 2));
        throw e;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, base, reports }, null, 2));
