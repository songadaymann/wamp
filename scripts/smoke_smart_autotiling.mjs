import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:3000/';
const outputDir = process.env.SMART_AUTOTILING_SMOKE_OUTPUT_DIR || 'output/web-game/smart-autotiling';
const url = new URL(baseUrl);
url.searchParams.set('previewSmoke', '1');
mkdirSync(outputDir, { recursive: true });

const summary = { url: url.toString(), consoleErrors: [], pageErrors: [], checks: {} };
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addInitScript(() => {
  window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
  window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
  window.localStorage.setItem('wamp.settings.builderMode', 'beginner');
});
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes("ws://127.0.0.1:1999/parties/")) {
    summary.consoleErrors.push(message.text());
  }
});
page.on('pageerror', (error) => summary.pageErrors.push(error.message));

try {
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.run_preview_smoke_action === 'function');
  await page.waitForFunction(() => document.body.dataset.appReady === 'true');
  const opened = await page.evaluate(() => window.run_preview_smoke_action?.('openSyntheticEditor'));
  assert.equal(opened?.ok, true);
  await page.waitForFunction(() => document.body.dataset.appMode === 'editor');

  assert.equal(await page.locator('.palette-tab[data-mode="smart"]').getAttribute('class').then((value) => value?.includes('active')), true);
  assert.equal(await page.locator('.palette-tab[data-mode="tiles"]').isVisible(), false);
  assert.equal(await page.locator('[data-tool="copy"]').first().isVisible(), false);
  summary.checks.beginnerUi = true;

  const painted = await page.evaluate(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene;
    const runtime = scene?.editRuntime;
    runtime.beginTileBatch();
    for (const [x, y] of [[8, 12], [9, 12], [10, 12], [8, 13], [9, 13], [10, 13]]) {
      runtime.placeTileAt(x * 16 + 1, y * 16 + 1);
    }
    runtime.commitTileBatch();
    return runtime.exportRoomSnapshot();
  });
  assert.equal(Object.keys(painted.smartTerrain.cells).length, 6);
  assert.ok(Object.keys(painted.smartTerrain.generatedDecorations).length > 0);
  assert.ok(painted.tileData.terrain[12][8] > 0);
  summary.checks.paintAndDetails = true;

  const history = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.undo();
    const undone = runtime.exportRoomSnapshot();
    runtime.redo();
    const redone = runtime.exportRoomSnapshot();
    return {
      undoneCells: Object.keys(undone.smartTerrain.cells).length,
      redoneCells: Object.keys(redone.smartTerrain.cells).length,
    };
  });
  assert.deepEqual(history, { undoneCells: 0, redoneCells: 6 });
  summary.checks.undoRedo = true;

  const copied = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.copyTilesToClipboard(8, 12, 10, 13);
    runtime.beginTileBatch();
    runtime.pasteClipboardAt(14, 12);
    runtime.commitTileBatch();
    const snapshot = runtime.exportRoomSnapshot();
    return Object.keys(snapshot.smartTerrain.cells).length;
  });
  assert.equal(copied, 12);
  summary.checks.smartCopyPaste = true;

  await page.locator('[data-builder-mode-choice="advanced"]').click();
  assert.equal(await page.locator('.palette-tab[data-mode="tiles"]').isVisible(), true);
  assert.equal(await page.locator('.palette-tab[data-mode="tiles"]').getAttribute('class').then((value) => value?.includes('active')), true);
  assert.equal(await page.locator('[data-tool="copy"]').first().isVisible(), true);
  await page.locator('.palette-tab[data-mode="smart"]').click();
  const smartBox = await page.locator('#smart-palette-section').boundingBox();
  summary.checks.smartPanelHeight = smartBox?.height ?? 0;
  assert.ok(smartBox && smartBox.height > 120);
  assert.equal(await page.locator('#smart-theme-select').isVisible(), true);
  summary.checks.advancedUi = true;

  await page.screenshot({ path: path.join(outputDir, 'smart-editor.png') });

  await page.evaluate(() => {
    window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime.clearCurrentLayer();
  });
  await page.evaluate(() => {
    const theme = document.querySelector('#smart-theme-select');
    const material = document.querySelector('#smart-material-select');
    theme.value = 'forest';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    material.value = 'ground';
    material.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const groundFixtures = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    for (let y = 4; y <= 10; y += 1) runtime.placeTileAt(4 * 16 + 1, y * 16 + 1);
    for (let y = 3; y <= 9; y += 1) {
      for (let x = 10; x <= 18; x += 1) runtime.placeTileAt(x * 16 + 1, y * 16 + 1);
    }
    const ordinarySteps = [
      [3, 33, 34],
      [4, 33, 35],
      [5, 32, 35],
      [6, 31, 35],
      [7, 30, 35],
      [8, 30, 34],
      [9, 30, 33],
      [10, 30, 32],
      [11, 30, 31],
    ];
    for (const [y, startX, endX] of ordinarySteps) {
      for (let x = startX; x <= endX; x += 1) runtime.placeTileAt(x * 16 + 1, y * 16 + 1);
    }
    runtime.commitTileBatch();
    runtime.beginTileBatch();
    for (const [x, y] of [[12, 5], [16, 6], [17, 6], [17, 7]]) {
      runtime.eraseTileAt(x * 16 + 1, y * 16 + 1);
    }
    runtime.commitTileBatch();
    return runtime.exportRoomSnapshot();
  });
  assert.deepEqual(
    groundFixtures.tileData.terrain.slice(4, 11).map((row) => row[4]),
    Array(7).fill(38),
  );
  assert.equal(groundFixtures.tileData.terrain[7][16], (1 << 21) + 55);
  assert.equal(groundFixtures.tileData.terrain[4][34], 30);
  assert.equal(groundFixtures.tileData.terrain[7][34], (1 << 21) + 34);
  summary.checks.verticalAndCaveTopology = true;
  summary.checks.ordinaryGroundTies = true;

  await page.evaluate(() => {
    const material = document.querySelector('#smart-material-select');
    material.value = 'tunnel';
    material.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.locator('#smart-theme-select').inputValue(), 'water');
  assert.equal(await page.locator('#smart-theme-select').isDisabled(), true);
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'background');
  const tunnelFixture = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    for (let y = 3; y <= 11; y += 1) {
      for (let x = 20; x <= 28; x += 1) runtime.placeTileAt(x * 16 + 1, y * 16 + 1);
    }
    runtime.commitTileBatch();
    runtime.beginTileBatch();
    for (let y = 6; y <= 8; y += 1) {
      for (let x = 23; x <= 25; x += 1) runtime.eraseTileAt(x * 16 + 1, y * 16 + 1);
    }
    runtime.commitTileBatch();
    return runtime.exportRoomSnapshot();
  });
  assert.equal(Object.keys(tunnelFixture.smartTerrain.backdropCells).length, 72);
  assert.equal(tunnelFixture.tileData.terrain[4][21], -1);
  assert.ok(tunnelFixture.tileData.background[4][21] > 0);
  assert.equal(tunnelFixture.tileData.background[7][22], 430);
  assert.equal(tunnelFixture.tileData.background[7][26], 425);
  assert.equal(tunnelFixture.tileData.background[5][22], (1 << 21) + 421);
  assert.equal(tunnelFixture.tileData.background[7][24], -1);
  summary.checks.tunnelBackdrop = true;
  const tunnelKeepBuilding = page.locator('#btn-guest-builder-claim-continue');
  if (await tunnelKeepBuilding.isVisible()) await tunnelKeepBuilding.click();
  await page.screenshot({ path: path.join(outputDir, 'tunnel-backdrop.png') });

  await page.evaluate(() => {
    const material = document.querySelector('#smart-material-select');
    material.value = 'feature';
    material.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.locator('#smart-theme-select').inputValue(), 'forest');
  assert.equal(await page.locator('#smart-theme-select').isEnabled(), true);
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'terrain');
  const featureFixture = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    for (const [x, y] of [[25, 5], [24, 6], [25, 7]]) runtime.placeTileAt(x * 16 + 1, y * 16 + 1);
    runtime.commitTileBatch();
    const before = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.eraseTileAt(25 * 16 + 1, 6 * 16 + 1);
    runtime.commitTileBatch();
    const erased = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.eraseTileAt(25 * 16 + 1, 6 * 16 + 1);
    runtime.placeTileAt(24 * 16 + 1, 6 * 16 + 1);
    runtime.commitTileBatch();
    return { before, erased, restored: runtime.exportRoomSnapshot() };
  });
  assert.ok(featureFixture.before.smartTerrain.generatedDecorations['25,6']);
  assert.ok(featureFixture.before.smartTerrain.generatedBackgroundDecorations['25,6']);
  assert.equal(featureFixture.erased.tileData.foreground[6][25], -1);
  assert.notEqual(featureFixture.erased.tileData.background[6][25], -1);
  assert.ok(featureFixture.restored.smartTerrain.generatedDecorations['25,6']);
  assert.ok(featureFixture.restored.smartTerrain.generatedBackgroundDecorations['25,6']);
  summary.checks.featureCornersAndErase = true;
  const keepBuilding = page.locator('#btn-guest-builder-claim-continue');
  if (await keepBuilding.isVisible()) await keepBuilding.click();
  await page.screenshot({ path: path.join(outputDir, 'topology-fixtures.png') });

  const welcomeContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await welcomeContext.addInitScript(() => {
    window.localStorage.setItem('wamp.settings.builderMode', 'unselected');
    window.localStorage.removeItem('wamp_welcome_modal_seen_v1');
  });
  const welcomePage = await welcomeContext.newPage();
  welcomePage.on('console', (message) => {
    if (message.type() === 'error') summary.consoleErrors.push(message.text());
  });
  welcomePage.on('pageerror', (error) => summary.pageErrors.push(error.message));
  const welcomeUrl = new URL(url);
  welcomeUrl.searchParams.set('welcome', '1');
  await welcomePage.goto(welcomeUrl.toString(), { waitUntil: 'domcontentloaded' });
  await welcomePage.locator('#welcome-modal:not(.hidden)').waitFor();
  await welcomePage.locator('#btn-welcome-build').click();
  await welcomePage.locator('#welcome-builder-choice:not(.hidden)').waitFor();
  assert.equal(await welcomePage.locator('#welcome-builder-choice').isVisible(), true);
  await welcomePage.screenshot({ path: path.join(outputDir, 'builder-choice.png') });
  await welcomeContext.close();
  summary.checks.firstBuildChoice = true;

  summary.ok = summary.consoleErrors.length === 0 && summary.pageErrors.length === 0;
} catch (error) {
  summary.ok = false;
  summary.error = error instanceof Error ? error.message : String(error);
} finally {
  writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
}

if (!summary.ok) {
  throw new Error(`Smart auto-tiling smoke failed: ${JSON.stringify(summary)}`);
}

console.log(JSON.stringify(summary, null, 2));
