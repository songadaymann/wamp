import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createMapCaptureFixture } from './lib/mapCaptureFixture.mjs';
const base = process.argv[2] || 'http://127.0.0.1:4198', output = process.argv[3] || 'output/web-game/map-capture';
mkdirSync(output, { recursive: true }); const reports = [];
for (const [name, engine, width, height, touch] of [
  ['desktop', chromium, 1280, 800, false], ['narrow-phone', chromium, 320, 568, true], ['safari-phone', webkit, 390, 844, true], ['tablet', chromium, 768, 1024, true],
]) {
  if (process.env.MAP_CAPTURE_PROFILES && !process.env.MAP_CAPTURE_PROFILES.split(',').includes(name)) continue;
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] }); let fixture, page;
  const errors = [], responses = [];
  try {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    fixture = await createMapCaptureFixture(context, base); page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !(message.text().startsWith('Failed to load resource:') && message.location().url.includes('/api/admin/map-screenshot/capture'))) errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) responses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
    const noOverflow = async () => { const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth })); assert(layout.scroll <= width + 1 && layout.inner <= width + 1, JSON.stringify(layout)); };
    await page.goto(fixture.galleryBase + '/capture'); await page.getByRole('heading', { name: 'WAMP map screenshots' }).waitFor();
    assert.equal(await page.locator('#capture').count(), 0); assert.equal(await page.getByRole('link', { name: 'Capture in Launch Admin' }).getAttribute('href'), '/launch-admin#map-capture');
    await noOverflow();
    const downloadLink = page.getByRole('link', { name: 'Download all (ZIP)' });
    const [zip] = await Promise.all([page.waitForEvent('download'), touch ? downloadLink.tap() : downloadLink.click()]);
    const zipPath = `${output}/${name}-maps.zip`; await zip.saveAs(zipPath); execFileSync('unzip', ['-t', zipPath]);
    await noOverflow(); await page.screenshot({ path: `${output}/${name}-gallery.png`, fullPage: true });
    await page.goto(base + '/launch-admin.html#map-capture'); await page.locator('#map-capture-button').waitFor();
    assert(await page.locator('#map-capture-button').isDisabled());
    await page.locator('#admin-key-input').fill(fixture.state.key); await click('#save-key-button');
    const button = page.locator('#map-capture-button'), status = page.locator('#map-capture-status');
    await page.waitForFunction(() => !document.querySelector('#map-capture-button').disabled);
    fixture.state.mode = 'busy'; await click('#map-capture-button'); await page.waitForFunction(() => document.querySelector('#map-capture-status').textContent.includes('already running'));
    assert(await button.isEnabled()); fixture.state.mode = 'failure'; await click('#map-capture-button');
    await page.waitForFunction(() => document.querySelector('#map-capture-status').textContent.includes('attempt remains used'));
    fixture.state.mode = 'delayed'; const before = fixture.state.calls; await click('#map-capture-button');
    await page.waitForFunction(() => document.querySelector('#map-capture-button').disabled);
    const box = await button.boundingBox(); assert(box && box.height >= 44);
    if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    for (let n = 0; n < 300 && !fixture.state.pending; n++) await new Promise(resolve => setTimeout(resolve, 10));
    assert(fixture.state.pending, 'Capture request must reach the fixture');
    assert.equal(fixture.state.calls, before + 1); fixture.state.expectedAbort = true; await click('#clear-key-button');
    assert(await button.isDisabled()); fixture.state.pending(); await fixture.idle();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert((await status.textContent()).includes('admin key')); assert(await page.locator('#map-capture-result').isHidden());
    fixture.state.expectedAbort = false; fixture.state.mode = 'success';
    await page.locator('#admin-key-input').fill(fixture.state.key); await click('#save-key-button');
    if (touch) await click('#map-capture-button'); else { await button.focus(); await page.keyboard.press('Enter'); }
    await page.waitForFunction(() => document.querySelector('#map-capture-status').textContent.includes('Saved 2026_10_19_1.png'));
    await page.waitForFunction(() => !document.querySelector('#map-capture-button').disabled);
    const result = page.locator('#map-capture-result'); assert.equal(await result.getAttribute('href'), '/capture/files/2026_10_19_1.png');
    for (const control of [button, result, page.locator('#map-capture a[href="/capture"]')]) { const bounds = await control.boundingBox(); assert(bounds && bounds.height >= 44); }
    await button.scrollIntoViewIfNeeded(); await noOverflow(); await page.screenshot({ path: `${output}/${name}-saved.png`, fullPage: false });
    await fixture.idle(); assert.deepEqual(fixture.state.errors, []); assert.deepEqual(errors, []);
    assert(responses.every(r => r.path === '/api/admin/map-screenshot/capture' && [429, 502].includes(r.status)), JSON.stringify(responses));
    reports.push({ name, ok: true, publicGallery: true, publicCaptureRemoved: true, validZipDownload: true, requiresKey: true, busyFailureSuccess: true, duplicateClickBlocked: true, staleResultFenced: true, targetHeight44: true, errors, fixtureErrors: fixture.state.errors, expectedResponses: responses, isolatedCaptureCalls: fixture.state.calls, productionCaptures: 0 });
    console.log(`${name}: map capture passed`);
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true });
    writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: String(error), errors, responses, fixture: fixture?.state }, null, 2)); throw error;
  } finally { if (fixture) fixture.state.closing = true; await browser.close(); await fixture?.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
