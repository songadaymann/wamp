import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:3000/';
const outputDir = process.env.SMART_AUTOTILING_SMOKE_OUTPUT_DIR || 'output/web-game/smart-autotiling';
const FLIP_X = 1 << 20;
const FLIP_Y = 1 << 21;
const url = new URL(baseUrl);
url.searchParams.set('previewSmoke', '1');
mkdirSync(outputDir, { recursive: true });

async function readLocalEditorState(page) {
  return page.evaluate(async () => {
    if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') return null;
    const { editorState } = await import('/src/config/editorState.ts');
    return {
      theme: editorState.smartTheme,
      brush: editorState.smartMaterial,
      style: editorState.smartStyle,
      layer: editorState.activeLayer,
    };
  });
}

async function assertLocalEditorState(page, expected) {
  const actual = await readLocalEditorState(page);
  if (actual !== null) assert.deepEqual(actual, expected);
}

async function dismissKeepBuilding(page) {
  const button = page.locator('#btn-guest-builder-claim-continue');
  if (await button.isVisible()) await button.click();
}

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

  await page.locator('#smart-theme-select').selectOption('cyber');
  assert.deepEqual(
    await page.locator('#smart-material-select option').all().then((options) =>
      Promise.all(options.map((option) => option.getAttribute('value')))
    ),
    [
      'cyber.structure',
      'cyber.platform',
      'cyber.rubble',
      'cyber.support',
      'cyber.neon-strip',
      'cyber.framed-panel',
    ],
  );
  assert.equal(await page.locator('#smart-style-row').isVisible(), true);
  assert.deepEqual(
    await page.locator('#smart-style-select option').all().then((options) =>
      Promise.all(options.map(async (option) => ({
        value: await option.getAttribute('value'),
        label: await option.textContent(),
      })))
    ),
    [
      { value: 'cyber-yellow', label: 'Yellow' },
      { value: 'cyber-pink', label: 'Pink' },
    ],
  );
  await page.locator('#smart-style-select').selectOption('cyber-pink');
  assert.equal(await page.locator('#smart-style-select').inputValue(), 'cyber-pink');

  await page.locator('#smart-material-select').selectOption('cyber.support');
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'background');
  await assertLocalEditorState(page, {
    theme: 'cyber',
    brush: 'cyber.support',
    style: 'cyber-pink',
    layer: 'background',
  });
  assert.equal(await page.locator('[data-tool="rect"]').first().isEnabled(), true);
  assert.equal(await page.locator('[data-tool="ellipse"]').first().isDisabled(), true);
  assert.equal(await page.locator('[data-tool="fill"]').first().isDisabled(), true);
  assert.match(await page.locator('#smart-palette-hint').textContent() ?? '', /Ellipse and Fill are unavailable/);
  await page.locator('#btn-editor-top-tool-more').click();
  await page.screenshot({ path: path.join(outputDir, 'cyber-support-tools.png') });
  await page.locator('#btn-editor-top-tool-more').click();

  await page.locator('#smart-material-select').selectOption('cyber.framed-panel');
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'foreground');
  await assertLocalEditorState(page, {
    theme: 'cyber',
    brush: 'cyber.framed-panel',
    style: 'cyber-pink',
    layer: 'foreground',
  });
  await page.locator('#smart-material-select').selectOption('cyber.structure');
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'terrain');
  await assertLocalEditorState(page, {
    theme: 'cyber',
    brush: 'cyber.structure',
    style: 'cyber-pink',
    layer: 'terrain',
  });
  assert.equal(await page.locator('[data-tool="ellipse"]').first().isEnabled(), true);
  assert.equal(await page.locator('[data-tool="fill"]').first().isEnabled(), true);
  await page.screenshot({ path: path.join(outputDir, 'cyber-smart-palette.png') });
  summary.checks.cyberRegistryUi = true;

  await page.locator('#smart-style-select').selectOption('cyber-yellow');
  const cyberFill = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.clearAllTiles();
    runtime.beginTileBatch();
    runtime.floodFill(0, 0);
    runtime.commitTileBatch();
    const filled = runtime.exportRoomSnapshot();
    runtime.clearAllTiles();
    return filled;
  });
  assert.equal(Object.keys(cyberFill.smartTerrain.semanticCells).length, 40 * 22);
  assert.ok(cyberFill.tileData.terrain.every((row) => row.every((value) => value > 0)));
  summary.checks.cyberFill = true;
  await dismissKeepBuilding(page);

  const cyberStructure = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.clearAllTiles();
    runtime.beginTileBatch();
    runtime.stampShape('rect', 32, 2, 39, 17, { outline: false, erase: false });
    runtime.stampShape('ellipse', 4, 10, 10, 16, { outline: false, erase: false });
    runtime.commitTileBatch();
    return runtime.exportRoomSnapshot();
  });
  assert.equal(cyberStructure.smartTerrain.version, 2);
  assert.equal(cyberStructure.smartTerrain.semanticCells['terrain:32,2'].brushId, 'cyber.structure');
  assert.equal(cyberStructure.tileData.terrain[2][32], 1633 + 25);
  assert.equal(cyberStructure.tileData.terrain[4][35], 1633 + 83 + FLIP_X + FLIP_Y);
  assert.equal(cyberStructure.tileData.terrain[17][33], 1633 + 15 + FLIP_Y);
  assert.ok(Object.keys(cyberStructure.smartTerrain.semanticCells).length > 128);
  const structureCellCount = Object.values(cyberStructure.smartTerrain.semanticCells)
    .filter(({ brushId }) => brushId === 'cyber.structure').length;
  const structureEmitterCount = Object.values(cyberStructure.smartTerrain.ownedOutputs)
    .filter(({ partId, value }) => {
      const baseValue = value & ~(FLIP_X | FLIP_Y);
      return partId === 'detail' && (baseValue === 1633 + 2 || baseValue === 1633 + 3);
    }).length;
  assert.ok(structureEmitterCount <= Math.ceil(structureCellCount / 64));
  summary.checks.cyberStructureAndShapes = true;
  summary.checks.cyberEmitterCap = true;
  await dismissKeepBuilding(page);

  const cyberCopyHistoryRepair = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.copyTilesToClipboard(32, 2, 33, 3);
    runtime.beginTileBatch();
    runtime.pasteClipboardAt(12, 2);
    runtime.commitTileBatch();
    const copied = runtime.exportRoomSnapshot();
    runtime.undo();
    const undone = runtime.exportRoomSnapshot();
    runtime.redo();
    const redone = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.eraseTileAt(35 * 16 + 1, 8 * 16 + 1);
    runtime.commitTileBatch();
    const carved = runtime.exportRoomSnapshot();
    return {
      copiedCount: Object.keys(copied.smartTerrain.semanticCells).length,
      undoneCount: Object.keys(undone.smartTerrain.semanticCells).length,
      redoneCount: Object.keys(redone.smartTerrain.semanticCells).length,
      carved,
    };
  });
  assert.equal(cyberCopyHistoryRepair.copiedCount, cyberCopyHistoryRepair.undoneCount + 4);
  assert.equal(cyberCopyHistoryRepair.redoneCount, cyberCopyHistoryRepair.copiedCount);
  assert.equal(cyberCopyHistoryRepair.carved.smartTerrain.semanticCells['terrain:35,8'], undefined);
  assert.equal(cyberCopyHistoryRepair.carved.tileData.terrain[8][35], -1);
  assert.ok(cyberCopyHistoryRepair.carved.tileData.terrain[7][34] > 0);
  summary.checks.cyberCopyUndoEraseRepair = true;

  await page.locator('#smart-style-select').selectOption('cyber-pink');
  await page.locator('#smart-material-select').selectOption('cyber.platform');
  const cyberPlatform = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    runtime.placeTileAt(20 * 16 + 1, 18 * 16 + 1);
    const belowMinimum = runtime.exportRoomSnapshot();
    for (let x = 21; x <= 24; x += 1) runtime.placeTileAt(x * 16 + 1, 18 * 16 + 1);
    runtime.commitTileBatch();
    const complete = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.eraseTileAt(22 * 16 + 1, 18 * 16 + 1);
    runtime.commitTileBatch();
    const repaired = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.placeTileAt(22 * 16 + 1, 18 * 16 + 1);
    runtime.commitTileBatch();
    return { belowMinimum, complete, repaired, restored: runtime.exportRoomSnapshot() };
  });
  assert.equal(cyberPlatform.belowMinimum.tileData.terrain[18][20], -1);
  assert.ok(cyberPlatform.belowMinimum.smartTerrain.semanticCells['terrain:20,18']);
  assert.deepEqual(cyberPlatform.complete.tileData.terrain[18].slice(20, 25), [
    1717 + 71 + FLIP_X, 1717 + 69, 1717 + 70, 1717 + 68, 1717 + 71,
  ]);
  assert.deepEqual(cyberPlatform.repaired.tileData.terrain[18].slice(20, 25), [
    1717 + 71 + FLIP_X, 1717 + 71, -1, 1717 + 71 + FLIP_X, 1717 + 71,
  ]);
  assert.deepEqual(cyberPlatform.restored.tileData.terrain[18].slice(20, 25), [
    1717 + 71 + FLIP_X, 1717 + 69, 1717 + 70, 1717 + 68, 1717 + 71,
  ]);

  await page.locator('#smart-style-select').selectOption('cyber-yellow');
  await page.locator('#smart-material-select').selectOption('cyber.support');
  const cyberSupport = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    for (let y = 4; y <= 7; y += 1) runtime.placeTileAt(18 * 16 + 1, y * 16 + 1);
    runtime.commitTileBatch();
    const complete = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.eraseTileAt(18 * 16 + 1, 5 * 16 + 1);
    runtime.commitTileBatch();
    const repaired = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.placeTileAt(18 * 16 + 1, 5 * 16 + 1);
    runtime.commitTileBatch();
    runtime.beginTileBatch();
    runtime.stampShape('rect', 32, 18, 35, 20, { outline: false, erase: false });
    runtime.commitTileBatch();
    return { complete, repaired, bank: runtime.exportRoomSnapshot() };
  });
  assert.deepEqual(cyberSupport.complete.tileData.background.slice(4, 8).map((row) => row[18]), [
    1633 + 36, 1633 + 48, 1633 + 60, 1633 + 72,
  ]);
  assert.deepEqual(cyberSupport.repaired.tileData.background.slice(4, 8).map((row) => row[18]), [
    1633 + 36, -1, 1633 + 36, 1633 + 60,
  ]);
  assert.deepEqual(cyberSupport.bank.tileData.background.slice(18, 21).map((row) => row.slice(32, 36)), [
    [1633 + 36, 1633 + 36 + FLIP_X, 1633 + 36 + FLIP_X, 1633 + 36],
    [1633 + 60, 1633 + 60 + FLIP_X, 1633 + 60, 1633 + 60 + FLIP_X],
    [1633 + 72, 1633 + 72 + FLIP_X, 1633 + 72, 1633 + 72 + FLIP_X],
  ]);
  assert.deepEqual(cyberSupport.bank.tileData.terrain.slice(4, 8).map((row) => row[18]), [-1, -1, -1, -1]);

  await page.locator('#smart-material-select').selectOption('cyber.neon-strip');
  const cyberNeon = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    for (let x = 20; x <= 24; x += 1) runtime.placeTileAt(x * 16 + 1, 8 * 16 + 1);
    runtime.commitTileBatch();
    const complete = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.eraseTileAt(22 * 16 + 1, 8 * 16 + 1);
    runtime.commitTileBatch();
    const repaired = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.placeTileAt(22 * 16 + 1, 8 * 16 + 1);
    runtime.commitTileBatch();
    return { complete, repaired, restored: runtime.exportRoomSnapshot() };
  });
  assert.deepEqual(cyberNeon.complete.tileData.terrain[8].slice(20, 25), [
    1633 + 49, 1633 + 50, 1633 + 73, 1633 + 74, 1633 + 51,
  ]);
  assert.deepEqual(cyberNeon.repaired.tileData.terrain[8].slice(20, 25), [-1, -1, -1, -1, -1]);
  assert.deepEqual(cyberNeon.restored.tileData.terrain[8].slice(20, 25), [
    1633 + 49, 1633 + 50, 1633 + 73, 1633 + 74, 1633 + 51,
  ]);

  await page.locator('#smart-material-select').selectOption('cyber.rubble');
  const cyberRubble = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    runtime.stampShape('rect', 20, 10, 22, 11, { outline: false, erase: false });
    runtime.commitTileBatch();
    const complete = runtime.exportRoomSnapshot();
    runtime.beginTileBatch();
    runtime.eraseTileAt(21 * 16 + 1, 10 * 16 + 1);
    runtime.commitTileBatch();
    return { complete, repaired: runtime.exportRoomSnapshot() };
  });
  assert.deepEqual(cyberRubble.complete.tileData.terrain.slice(10, 12).map((row) => row.slice(20, 23)), [
    [1645, 1645, 1645], [1645, 1645, 1645],
  ]);
  assert.deepEqual(cyberRubble.repaired.tileData.terrain.slice(10, 12).map((row) => row.slice(20, 23)), [
    [1645, -1, 1645], [1645, 1645, 1645],
  ]);
  summary.checks.cyberPathMinimumsAndRepair = true;

  await page.locator('#smart-style-select').selectOption('cyber-pink');
  await page.locator('#smart-material-select').selectOption('cyber.framed-panel');
  const cyberPanelClipboard = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    for (let x = 26; x <= 30; x += 1) runtime.placeTileAt(x * 16 + 1, 3 * 16 + 1);
    runtime.commitTileBatch();
    runtime.copyTilesToClipboard(26, 3, 30, 4);
    runtime.beginTileBatch();
    runtime.pasteClipboardAt(26, 12);
    runtime.commitTileBatch();
    const complete = runtime.exportRoomSnapshot();
    runtime.copyTilesToClipboard(26, 3, 30, 3);
    runtime.beginTileBatch();
    runtime.pasteClipboardAt(33, 12);
    runtime.commitTileBatch();
    const partial = runtime.exportRoomSnapshot();
    return { complete, partial };
  });
  assert.equal(Object.keys(cyberPanelClipboard.complete.smartTerrain.recipes).length, 2);
  assert.equal(Object.keys(cyberPanelClipboard.partial.smartTerrain.recipes).length, 2);
  assert.deepEqual(cyberPanelClipboard.complete.tileData.foreground[3].slice(26, 31), [
    1717 + 44, 1717 + 45, 1717 + 45, 1717 + 45, 1717 + 46,
  ]);
  assert.deepEqual(cyberPanelClipboard.complete.tileData.foreground[12].slice(26, 31), [
    1717 + 44, 1717 + 45, 1717 + 45, 1717 + 45, 1717 + 46,
  ]);
  assert.deepEqual(cyberPanelClipboard.partial.tileData.foreground[12].slice(33, 38), [
    1717 + 44, 1717 + 45, 1717 + 45, 1717 + 45, 1717 + 46,
  ]);
  summary.checks.cyberBrushesAndRecipeClipboard = true;

  await page.locator('.palette-tab[data-mode="tiles"]').click();
  await page.locator('.layer-btn[data-layer="foreground"]').click();
  const suppressed = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    runtime.eraseTileAt(27 * 16 + 1, 3 * 16 + 1);
    runtime.commitTileBatch();
    return runtime.exportRoomSnapshot();
  });
  await page.locator('.palette-tab[data-mode="smart"]').click();
  await page.locator('#smart-theme-select').selectOption('cyber');
  await page.locator('#smart-style-select').selectOption('cyber-pink');
  await page.locator('#smart-material-select').selectOption('cyber.framed-panel');
  const smartErasureAndReload = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    runtime.eraseTileAt(28 * 16 + 1, 4 * 16 + 1);
    runtime.commitTileBatch();
    const smartErased = runtime.exportRoomSnapshot();
    const serialized = JSON.parse(JSON.stringify(smartErased));
    runtime.applyRoomSnapshot(serialized);
    const reloaded = runtime.exportRoomSnapshot();
    return { smartErased, reloaded };
  });
  const cyberSuppressionAndReload = { suppressed, ...smartErasureAndReload };
  assert.ok(cyberSuppressionAndReload.suppressed.smartTerrain.suppressedOutputParts.some(
    (entry) => entry.endsWith(':row-0:column-1'),
  ));
  assert.equal(Object.keys(cyberSuppressionAndReload.smartErased.smartTerrain.recipes).length, 1);
  assert.deepEqual(cyberSuppressionAndReload.reloaded.smartTerrain, cyberSuppressionAndReload.smartErased.smartTerrain);
  assert.deepEqual(cyberSuppressionAndReload.reloaded.tileData, cyberSuppressionAndReload.smartErased.tileData);
  assert.equal(cyberSuppressionAndReload.reloaded.tileData.terrain[4][35], 1633 + 83 + FLIP_X + FLIP_Y);
  summary.checks.cyberSuppressionAndReload = true;
  summary.checks.cyberFixedLayers = true;
  await dismissKeepBuilding(page);
  await page.evaluate(() => {
    window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.fitToScreen();
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, 'cyber-recipes.png') });

  await page.locator('#smart-theme-select').selectOption('forest');
  assert.equal(await page.locator('#smart-material-select').inputValue(), 'forest.ground');
  assert.equal(await page.locator('#smart-style-row').isVisible(), false);

  await page.locator('#btn-editor-top-tool-more').click();
  const ellipseButton = page.locator('#editor-top-more-tools-panel [data-tool="ellipse"]');
  await ellipseButton.click();
  assert.equal(await ellipseButton.getAttribute('class').then((value) => value?.includes('active')), true);
  const smartEllipse = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.beginTileBatch();
    runtime.stampShape('ellipse', 22, 14, 28, 20, { outline: false, erase: false });
    runtime.commitTileBatch();
    return runtime.exportRoomSnapshot();
  });
  assert.ok(smartEllipse.smartTerrain.cells['25,17']);
  assert.equal(smartEllipse.smartTerrain.cells['22,14'], undefined);
  assert.ok(smartEllipse.tileData.terrain[17][25] > 0);

  const shapeKeepBuilding = page.locator('#btn-guest-builder-claim-continue');
  if (await shapeKeepBuilding.isVisible()) await shapeKeepBuilding.click();
  await ellipseButton.click();
  assert.equal(await ellipseButton.locator('.tool-label').textContent(), 'Ellipse Outline');
  const smartOutlines = await page.evaluate(() => {
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.clearCurrentLayer();
    runtime.beginTileBatch();
    runtime.stampShape('rect', 4, 12, 12, 20, { outline: true, erase: false });
    runtime.stampShape('ellipse', 20, 10, 30, 20, { outline: true, erase: false });
    runtime.commitTileBatch();
    return runtime.exportRoomSnapshot();
  });
  assert.equal(smartOutlines.tileData.terrain[16][8], -1);
  assert.ok([16, 17].includes(smartOutlines.tileData.terrain[12][8]));
  assert.ok([51, 52, 53, 54].includes(smartOutlines.tileData.terrain[20][8]));
  assert.equal(smartOutlines.tileData.terrain[16][4], 38);
  assert.equal(smartOutlines.tileData.terrain[16][12], 43);
  assert.equal(smartOutlines.tileData.terrain[15][25], -1);
  const ellipseGids = Object.entries(smartOutlines.smartTerrain.cells)
    .filter(([key]) => {
      const [x, y] = key.split(',').map(Number);
      return x >= 20 && x <= 30 && y >= 10 && y <= 20;
    })
    .map(([key]) => {
      const [x, y] = key.split(',').map(Number);
      return smartOutlines.tileData.terrain[y][x];
    });
  assert.ok(ellipseGids.length > 20);
  assert.equal(ellipseGids.includes(48), false);
  assert.equal(smartOutlines.smartTerrain.generatedDecorations['8,19'], undefined);
  summary.checks.smartShapeTools = true;
  summary.checks.smartOutlineTopology = true;
  await page.evaluate(() => {
    window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.fitToScreen();
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, 'smart-outlines.png') });

  await page.screenshot({ path: path.join(outputDir, 'smart-editor.png') });

  await page.evaluate(() => {
    window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime.clearCurrentLayer();
  });
  await page.evaluate(() => {
    const theme = document.querySelector('#smart-theme-select');
    const material = document.querySelector('#smart-material-select');
    theme.value = 'forest';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    material.value = 'forest.ground';
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
    const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
    runtime.clearCurrentLayer();
    const theme = document.querySelector('#smart-theme-select');
    theme.value = 'gothic';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    runtime.beginTileBatch();
    for (let y = 5; y <= 9; y += 1) {
      for (let x = 5; x <= 9; x += 1) runtime.placeTileAt(x * 16 + 1, y * 16 + 1);
    }
    runtime.commitTileBatch();
    runtime.beginTileBatch();
    runtime.eraseTileAt(7 * 16 + 1, 7 * 16 + 1);
    runtime.commitTileBatch();
  });
  assert.equal(await page.locator('#smart-material-select').inputValue(), 'gothic.ground');
  const gothicTunnelFloor = await page.evaluate(() => (
    window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime.exportRoomSnapshot()
  ));
  assert.equal(gothicTunnelFloor.tileData.terrain[8][7], (1 << 21) + 783);
  summary.checks.gothicTunnelFloor = true;
  await page.evaluate(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene;
    scene.cameras.main.setZoom(3);
    scene.cameras.main.centerOn(7.5 * 16, 7.5 * 16);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, 'gothic-tunnel-floor.png') });
  await page.evaluate(() => {
    window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.fitToScreen();
  });

  await page.evaluate(() => {
    const theme = document.querySelector('#smart-theme-select');
    theme.value = 'forest';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.evaluate(() => {
    const material = document.querySelector('#smart-material-select');
    material.value = 'water.tunnel';
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
    material.value = 'forest.feature';
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

  const decorationPools = {
    forest: { firstGid: 1, expected: [2, 3, 4, 5, 56, 58, 59] },
    desert: { firstGid: 73, expected: [4, 5, 7, 8] },
    cave: { firstGid: 145, expected: [2, 3, 4, 5, 6, 57, 61] },
    gothic: { firstGid: 733, expected: [2, 3, 4, 5] },
  };
  for (const [themeName, pool] of Object.entries(decorationPools)) {
    const decorationFixture = await page.evaluate(({ theme }) => {
      const runtime = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.editRuntime;
      runtime.clearCurrentLayer();
      const material = document.querySelector('#smart-material-select');
      const themeSelect = document.querySelector('#smart-theme-select');
      themeSelect.value = theme;
      themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      material.value = `${theme}.ground`;
      material.dispatchEvent(new Event('change', { bubbles: true }));
      runtime.beginTileBatch();
      for (const y of [2, 5, 8, 11, 14, 17, 20]) {
        for (let x = 0; x < 40; x += 1) runtime.placeTileAt(x * 16 + 1, y * 16 + 1);
      }
      runtime.commitTileBatch();
      return runtime.exportRoomSnapshot();
    }, { theme: themeName });
    const variants = new Set(Object.values(decorationFixture.smartTerrain.generatedDecorations)
      .map(({ gid }) => gid - pool.firstGid));
    assert.deepEqual([...variants].sort((a, b) => a - b), pool.expected);
    const decorationKeepBuilding = page.locator('#btn-guest-builder-claim-continue');
    if (await decorationKeepBuilding.isVisible()) await decorationKeepBuilding.click();
    await page.evaluate(() => {
      window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene?.fitToScreen();
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outputDir, `decorations-${themeName}.png`) });
  }
  summary.checks.themeDecorationPools = true;
  await context.close();

  const courseContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await courseContext.addInitScript(() => {
    window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
    window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
    window.localStorage.setItem('wamp.settings.builderMode', 'advanced');
  });
  const coursePage = await courseContext.newPage();
  coursePage.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('ws://127.0.0.1:1999/parties/')) {
      summary.consoleErrors.push(message.text());
    }
  });
  coursePage.on('pageerror', (error) => summary.pageErrors.push(error.message));
  await coursePage.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await coursePage.waitForFunction(() => typeof window.run_preview_smoke_action === 'function');
  await coursePage.waitForFunction(() => document.body.dataset.appReady === 'true');
  const courseOpened = await coursePage.evaluate(() => (
    window.run_preview_smoke_action?.('openSyntheticCourseEditor')
  ));
  assert.equal(courseOpened?.ok, true);
  await coursePage.waitForFunction(() => document.body.dataset.editorCourseMode === 'true');
  await coursePage.locator('#smart-theme-select').selectOption('cyber');
  await coursePage.locator('#smart-style-select').selectOption('cyber-pink');
  await coursePage.locator('#smart-material-select').selectOption('cyber.support');
  assert.equal(await coursePage.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'background');
  await assertLocalEditorState(coursePage, {
    theme: 'cyber',
    brush: 'cyber.support',
    style: 'cyber-pink',
    layer: 'background',
  });
  assert.equal(await coursePage.locator('[data-tool="ellipse"]').first().isDisabled(), true);
  assert.match(
    await coursePage.locator('#smart-palette-hint').textContent() ?? '',
    /Ellipse and Fill are unavailable/,
  );
  await coursePage.locator('#btn-editor-top-tool-more').click();
  await coursePage.screenshot({ path: path.join(outputDir, 'cyber-course-support-tools.png') });
  await courseContext.close();
  summary.checks.cyberCourseRegistryUi = true;

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
