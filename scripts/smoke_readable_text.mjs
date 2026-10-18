import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
import { installMobileSignedFixture } from './lib/mobileSignedFixture.mjs';
import { auditReadableText, auditReadableFonts } from './lib/textAudits.mjs';
const base = process.argv[2] || 'http://127.0.0.1:4197';
const output = process.argv[3] || 'output/web-game/readable-text';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
mkdirSync(output, { recursive: true });
const reports = [];
for (const [name, engine, width, height, touch, signed] of [
  ['desktop', chromium, 1280, 800, false, true], ['phone', chromium, 390, 844, true, false],
  ['narrow', chromium, 320, 568, true, false], ['landscape', chromium, 844, 390, true, false],
  ['tablet', chromium, 1024, 768, true, false], ['safari-phone', webkit, 390, 844, true, false],
  ['safari-landscape', webkit, 844, 390, true, false],
]) {
  if (process.env.TEXT_PROFILES && !process.env.TEXT_PROFILES.split(',').includes(name)) continue;
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const fixtures = createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/${name}.json.gz`);
  await fixtures.install(context);
  await context.routeWebSocket(u => new URL(u).port === '4197' && new URL(u).pathname === '/', s => s.connectToServer());
  let remoteSettings = null; const saves = [], errors = [];
  await context.route(u => u.pathname === '/api/world', r => r.fulfill({ json: { center: { x: Number(new URL(r.request().url()).searchParams.get('x') || 0), y: Number(new URL(r.request().url()).searchParams.get('y') || 0) }, radius: 1, rooms: [] }, headers: { 'access-control-allow-origin': r.request().headers().origin || new URL(base).origin, 'access-control-allow-credentials': 'true' } }));
  const cors = r => ({ 'access-control-allow-origin': r.request().headers().origin || new URL(base).origin, 'access-control-allow-credentials': 'true' });
  if (signed) {
    await installMobileSignedFixture(context);
    await context.route('**/api/settings/me', r => {
      if (r.request().method() === 'OPTIONS') return r.fallback();
      if (r.request().method() === 'PUT') { remoteSettings = r.request().postDataJSON().settings; saves.push(remoteSettings); }
      return r.fulfill({ json: { ok: true, settings: remoteSettings, updatedAt: '2026-10-18T22:00:00Z' }, headers: cors(r) });
    });
  }
  const original = JSON.parse(JSON.parse(gunzipSync(readFileSync(`${output}/${name}.json.gz`))).entries.find(e => e.path === '/api/rooms/0%2C0/published').text);
  await context.route(u => /^\/api\/rooms\/[^/]+\/published$/.test(u.pathname) && u.pathname !== '/api/rooms/0%2C0/published', r => {
    const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]); const [x, y] = id.split(',').map(Number);
    return r.fulfill({ json: { ...original, id, coordinates: { x, y }, goal: null, placedObjects: [], music: null }, headers: cors(r) });
  });
  await context.route('https://mann.cool/api/v1/plays', r => r.fulfill({ json: { success: true }, headers: { 'access-control-allow-origin': '*' } }));
  await context.addInitScript(() => {
    if (!['http:', 'https:'].includes(location.protocol)) return;
    localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
    localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
  });
  let page = await context.newPage();
  context.on('page', p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const renderer = engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl';
  try {
    await page.goto(`${base}/?welcome=0&x=0&y=0&renderer=${renderer}&previewSmoke=1`);
    const capture = (label, target = page) => target.screenshot({ path: `${output}/${name}-${label}.png` });
    const audit = await auditReadableText(page, capture);
    if (signed) { await page.waitForTimeout(650); assert.equal(remoteSettings?.textStyle, 'readable'); assert.equal(remoteSettings?.textSize, 'large'); }
    const old = page; page = await context.newPage();
    if (signed) await page.addInitScript(() => { if (!['http:', 'https:'].includes(location.protocol)) return; localStorage.removeItem('wamp.settings.textStyle'); localStorage.removeItem('wamp.settings.textSize'); });
    await page.goto(old.url()); await page.waitForFunction(() => document.body.dataset.appReady === 'true'); await old.close();
    await page.waitForFunction(() => document.body.dataset.textStyle === 'readable' && document.body.dataset.textSize === 'large');
    await page.locator('#btn-room-goal-intro-start').click();
    await page.locator('#menu-toggle').click(); await page.locator('#btn-world-settings').click();
    await page.locator('#settings-modal').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#settings-text-style').inputValue(), 'readable');
    assert.equal(await page.locator('#settings-text-size').inputValue(), 'large');
    await capture('reloaded'); await page.locator('#btn-settings-close').click();
    if (await page.evaluate(() => typeof window.run_preview_smoke_action === 'function')) {
      for (const action of ['openSyntheticEditor', 'openSyntheticCourseEditor']) {
        const opened = await page.evaluate(action => window.run_preview_smoke_action(action), action); assert(opened.ok);
        await auditReadableFonts(page);
        if (await page.locator('body').evaluate(e => e.dataset.editorPhoneDock === 'true')) {
          const actions = await page.locator('#editor-shell-phone-bar > button').evaluateAll(nodes => nodes.filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), x: r.x, right: r.right, height: r.height, width: innerWidth }; }));
          assert(actions.every(b => b.x >= 0 && b.right <= b.width && b.height >= 44), JSON.stringify(actions));
          for (const category of ['stuff', 'terrain']) {
            const button = page.locator(`[data-editor-dock="${category}"]`);
            await button.scrollIntoViewIfNeeded(); await button.click();
            await page.waitForFunction(expected => document.body.dataset.editorShellPanel === expected, category);
          }
        }
        const clipped = await page.locator('.editor-shell-tools .tool-btn').evaluateAll(buttons => buttons.filter(b => b.getClientRects().length && [...b.querySelectorAll('.tool-label')].some(l => l.getBoundingClientRect().width > b.clientWidth)).map(b => b.textContent.trim()));
        assert.deepEqual(clipped, [], 'Editor tool labels must fit their buttons');
        const clippedCategories = await page.locator('.editor-shell-dock-grid > button').evaluateAll(buttons => buttons.filter(b => b.getClientRects().length && b.scrollWidth > b.clientWidth + 1).map(b => b.textContent.trim()));
        assert.deepEqual(clippedCategories, [], 'Editor category labels must fit their buttons');
        const advanced = page.locator('[data-builder-mode-choice="advanced"]');
        if (!await advanced.isVisible()) await page.locator('[data-editor-dock="terrain"]').click();
        await advanced.scrollIntoViewIfNeeded(); await advanced.click();
        await page.locator('#palette-mode-section .palette-tab[data-mode="tiles"]').click();
        const tool = page.locator('#btn-editor-shell-eraser');
        await tool.scrollIntoViewIfNeeded(); await tool.click();
        await page.locator('#editor-shell-eraser-size-picker').waitFor({ state: 'visible' });
        const brush = page.locator('#editor-shell-eraser-size-picker [data-erase-brush-size="3"]');
        await brush.scrollIntoViewIfNeeded();
        assert(await brush.evaluate(e => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'Eraser options must escape toolbar clipping');
        await brush.click();
        assert(await brush.evaluate(e => e.classList.contains('active')));
        await capture(action + '-eraser-options');
        await page.locator('.editor-shell-tools [data-tool="pencil"]').click();
        await capture(action);
        assert(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth + 1));
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(fixtures.report().misses, {});
    reports.push({ name, audit, signed, editorsTested: await page.evaluate(() => typeof window.run_preview_smoke_action === 'function'), saves: saves.length, errors, fixtureMisses: fixtures.report().misses, accepted: true });
    console.log(name + ' passed');
  } catch (e) {
    await page.screenshot({ path: `${output}/${name}-failure.png` });
    writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: e.stack, errors, fixtures: fixtures.report(), state: await page.evaluate(() => window.render_game_to_text?.()) }, null, 2));
    throw e;
  } finally { await context.close(); await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, reports }, null, 2));
