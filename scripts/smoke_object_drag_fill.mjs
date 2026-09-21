import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3002/';
const outputDir = process.env.OBJECT_BRUSH_SMOKE_OUTPUT_DIR ?? '/tmp/wamp-object-drag-fill-browser';
mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
  window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
  window.localStorage.setItem('wamp_replay_opt_out', '1');
  window.localStorage.setItem('wamp.settings.builderMode', 'advanced');
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('cloudflareinsights.com')) {
    errors.push(message.text());
  }
});

try {
  const target = new URL(url);
  target.searchParams.set('previewSmoke', '1');
  target.searchParams.set('renderer', 'canvas');
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120_000 });
  assert.equal((await page.evaluate(() => window.run_preview_smoke_action('openSyntheticEditor'))).ok, true);
  await page.waitForFunction(() => document.body.dataset.appMode === 'editor');
  await page.waitForTimeout(250);

  const commands = async (editorCommands) => {
    const result = await page.evaluate((steps) => window.run_preview_smoke_action('runEditorCommands', { editorCommands: steps }), editorCommands);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.captures;
  };
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
  const canvas = page.locator('#game-container canvas:visible').last();
  const box = await canvas.boundingBox();
  assert.ok(box?.width > 500, 'visible game canvas missing');
  const tileScreen = async (x, y) => {
    const scene = await state();
    const roomLeft = box.x + (box.width - 40 * 16 * scene.zoom) / 2;
    const roomTop = box.y + (box.height - 22 * 16 * scene.zoom) / 2;
    return {
      x: roomLeft + (x + 0.5) * 16 * scene.zoom,
      y: roomTop + (y + 0.5) * 16 * scene.zoom,
    };
  };

  const terrainDock = page.locator('[data-editor-dock="terrain"]');
  if (await terrainDock.getAttribute('aria-expanded') !== 'true') await terrainDock.click();
  await page.locator('button[data-mode="tiles"]:visible').click();
  await commands([{ op: 'placeCells', cells: [
    { x: 9, y: 4 }, { x: 10, y: 4 }, { x: 11, y: 4 },
    { x: 9, y: 5 }, { x: 10, y: 5 }, { x: 11, y: 5 },
  ] }]);
  const stuff = page.locator('[data-editor-dock="stuff"]');
  if (await stuff.getAttribute('aria-expanded') !== 'true') await stuff.click();
  await page.locator('.obj-cat-tab[data-category="collectible"]').click();
  await page.locator('.object-item[data-object-id="coin_gold"]').click();
  assert.equal(await page.locator('button[data-tool="fill"]:visible').last().isEnabled(), true);

  const from = await tileScreen(15, 8);
  const to = await tileScreen(19, 8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up();
  const afterDrag = (await commands([{ op: 'capture', name: 'afterDrag' }])).afterDrag;
  assert.equal(afterDrag.placedObjects.length, 5, 'drag should interpolate five cells');
  await page.screenshot({ path: `${outputDir}/drag.png` });
  const afterUndo = (await commands([{ op: 'undo' }, { op: 'capture', name: 'afterUndo' }])).afterUndo;
  assert.equal(afterUndo.placedObjects.length, 0, 'one Undo should remove the whole drag');

  await page.locator('button[data-tool="fill"]:visible').last().click();
  const fillPoint = await tileScreen(10, 4);
  await page.mouse.click(fillPoint.x, fillPoint.y);
  const afterFill = (await commands([{ op: 'capture', name: 'afterFill' }])).afterFill;
  assert.equal(afterFill.placedObjects.length, 6, 'Fill should cover only the six matching terrain cells');
  await page.screenshot({ path: `${outputDir}/fill.png` });
  const fillUndo = (await commands([{ op: 'undo' }, { op: 'capture', name: 'fillUndo' }])).fillUndo;
  assert.equal(fillUndo.placedObjects.length, 0, 'one Undo should remove the whole Fill');

  await page.locator('[data-editor-dock="deco"]').click();
  await page.locator('.object-item[data-object-id="rock"]').click();
  assert.equal(await page.locator('button[data-tool="fill"]:visible').last().isEnabled(), true);
  const rockFrom = await tileScreen(24, 8);
  const rockTo = await tileScreen(26, 8);
  await page.mouse.move(rockFrom.x, rockFrom.y);
  await page.mouse.down();
  await page.mouse.move(rockTo.x, rockTo.y, { steps: 2 });
  await page.mouse.up();
  const afterDecoDrag = (await commands([{ op: 'capture', name: 'afterDecoDrag' }])).afterDecoDrag;
  assert.equal(afterDecoDrag.placedObjects.length, 3, 'decoration drag should paint three cells');
  await page.screenshot({ path: `${outputDir}/decoration-drag.png` });
  await commands([{ op: 'undo' }]);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, collectibleDrag: 5, collectibleFill: 6, decorationDrag: 3, errors }, null, 2));
} finally {
  await browser.close();
}
