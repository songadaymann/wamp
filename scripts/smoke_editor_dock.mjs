import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://localhost:3000/';
const outputDir = process.env.EDITOR_DOCK_SMOKE_OUTPUT_DIR || 'output/web-game/editor-dock';
const viewports = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
];
const summary = {
  url: baseUrl,
  outputDir,
  viewports: [],
  consoleErrors: [],
  pageErrors: [],
  httpErrors: [],
  knownBaselineHttpErrors: [],
  knownBaselineConsoleErrors: [],
};

mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

function targetUrl(renderer = 'canvas') {
  const url = new URL(baseUrl);
  url.searchParams.set('previewSmoke', '1');
  url.searchParams.set('renderer', renderer);
  return url.toString();
}

function countGridColumns(value) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function isCloudflareInsightsRumCorsNoise(message) {
  const combined = `${message.text()} ${message.location().url ?? ''}`;
  return combined.includes('cloudflareinsights.com/cdn-cgi/rum')
    && (combined.includes('CORS policy') || combined.includes('net::ERR_FAILED'));
}

function isKnownBackgroundThumbnail404(response) {
  if (response.status() !== 404) return false;
  const url = new URL(response.url());
  return url.pathname.startsWith('/assets/cache-v2/assets/backgrounds/');
}

function isGeneric404ConsoleError(message) {
  return message.includes('Failed to load resource: the server responded with a status of 404');
}

async function activeScene(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? '{}').activeScene ?? null);
}

async function runEditorCommands(page, editorCommands) {
  const result = await page.evaluate((commands) => (
    window.run_preview_smoke_action?.('runEditorCommands', { editorCommands: commands })
  ), editorCommands);
  assert.equal(result?.ok, true, `Editor preview-smoke command failed: ${JSON.stringify(result)}`);
  return result.captures ?? {};
}

async function clickConfirmed(page, button, expectedMessage, accept) {
  const dialogPromise = page.waitForEvent('dialog');
  const clickPromise = button.click();
  const dialog = await dialogPromise;
  assert.equal(dialog.message(), expectedMessage);
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await clickPromise;
}

function countTiles(tileData) {
  return Object.values(tileData).reduce((total, rows) => (
    total + rows.reduce((layerTotal, row) => (
      layerTotal + row.filter((value) => value >= 0).length
    ), 0)
  ), 0);
}

async function navigateToTarget(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.goto(targetUrl(), { waitUntil: 'domcontentloaded' });
      break;
    } catch (error) {
      const message = String(error);
      const transientNavigationError = message.includes('ERR_NETWORK_CHANGED')
        || message.includes('ERR_ADDRESS_UNREACHABLE');
      if (attempt === 4 || !transientNavigationError) throw error;
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
}

async function openSyntheticEditor(page) {
  await navigateToTarget(page);
  await page.waitForFunction(
    () => document.body.dataset.appReady === 'true',
    undefined,
    { timeout: 120_000 },
  );
  await page.evaluate(() => {
    window.__wampEarlyWorldTiles?.release('editor-dock-smoke');
  });
  const result = await page.evaluate(() => window.run_preview_smoke_action?.('openSyntheticEditor'));
  assert.equal(result?.ok, true);
  await page.waitForFunction(() => (
    document.body.dataset.appMode === 'editor'
      && document.body.dataset.editorDockShell === 'true'
  ));
  await page.waitForTimeout(250);
}

async function resizeDrawer(page, deltaX) {
  const handle = page.locator('#editor-sidebar-resize-handle');
  const box = await handle.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  return page.locator('#sidebar').evaluate((element) => element.getBoundingClientRect().width);
}

async function verifyCommonShell(page, viewport, viewportOutputDir) {
  const tools = page.locator('.editor-shell-tools [data-tool]');
  assert.equal(await tools.count(), 7);
  for (const tool of await tools.all()) assert.equal(await tool.isVisible(), true);
  for (const selector of ['#btn-world-settings', '#btn-guestbook-open', '#btn-world-controls']) {
    assert.equal(await page.locator(selector).isVisible(), true, `${selector} should remain in the editor footer`);
    assert.match(
      await page.locator(selector).evaluate((button) => getComputedStyle(button).fontFamily),
      /Early GameBoy/i,
      `${selector} should use the GameBoy footer font`,
    );
  }
  assert.match(
    await page.locator('#world-online-count').evaluate((button) => getComputedStyle(button).fontFamily),
    /Early GameBoy/i,
    'the online footer button should use the GameBoy footer font',
  );
  for (const selector of [
    '.world-online-popover',
    '.world-online-popover-title',
    '.world-online-popover-summary',
    '.world-online-popover-section-title',
    '.world-online-popover-entry',
    '.world-online-popover-entry-name',
    '.world-online-popover-room',
  ]) {
    const target = page.locator(selector).first();
    if (await target.count()) {
      assert.match(
        await target.evaluate((element) => getComputedStyle(element).fontFamily),
        /IBM Plex Mono/i,
        `${selector} should use the legible interface font`,
      );
    }
  }
  const onlineTrigger = page.locator('#world-online-count');
  if (await onlineTrigger.isVisible()) {
    await onlineTrigger.click();
    await page.waitForFunction(() => !document.getElementById('world-online-popover')?.classList.contains('hidden'));
    await page.screenshot({ path: path.join(viewportOutputDir, 'players-online.png') });
    await onlineTrigger.click();
    await page.waitForFunction(() => document.getElementById('world-online-popover')?.classList.contains('hidden'));
  }

  const saveStatus = page.locator('#editor-top-save-status');
  const originalSaveStatus = await saveStatus.textContent();
  assert.equal(/claimed by/i.test(originalSaveStatus ?? ''), false, 'editor status should not identify the room claimer');
  await saveStatus.evaluate((element) => { element.textContent = 'Claimed by Doinggreat.'; });
  await page.waitForFunction(() => document.querySelector('#editor-top-save-status')?.classList.contains('editor-shell-status-suppressed'));
  assert.equal(await saveStatus.isVisible(), false);
  await saveStatus.evaluate((element) => {
    element.textContent = 'Recovered local guest draft. Draft only. Not visible in the world until published.';
  });
  await page.waitForFunction(() => document.querySelector('#editor-top-save-status')?.classList.contains('editor-shell-status-suppressed'));
  assert.equal(await saveStatus.isVisible(), false);
  await saveStatus.evaluate((element) => {
    element.textContent = 'Draft only. Not visible in the world until published.';
  });
  await page.waitForFunction(() => document.querySelector('#editor-top-save-status')?.classList.contains('editor-shell-status-suppressed'));
  assert.equal(await saveStatus.isVisible(), false);
  await saveStatus.evaluate((element) => { element.textContent = 'Saving draft...'; });
  await page.waitForFunction(() => !document.querySelector('#editor-top-save-status')?.classList.contains('editor-shell-status-suppressed'));
  assert.equal(await saveStatus.isVisible(), true);
  await saveStatus.evaluate((element, text) => { element.textContent = text; }, originalSaveStatus ?? '');

  const game = page.locator('#game-container');
  const terrain = page.locator('[data-editor-dock="terrain"]');
  assert.match(await terrain.evaluate((button) => getComputedStyle(button).fontFamily), /IBM Plex Mono/i);
  const dockIconAssets = {
    terrain: 'tileset_forest.png',
    stuff: 'key.png',
    characters: 'penguin.png',
    hazards: 'spikes.png',
    deco: 'sign.png',
    markers: 'flag-green.png',
  };
  for (const [dockItem, asset] of Object.entries(dockIconAssets)) {
    const backgroundImage = await page.locator(`[data-editor-dock="${dockItem}"] .editor-game-icon`)
      .evaluate((icon) => getComputedStyle(icon).backgroundImage);
    assert.ok(backgroundImage.includes(asset), `${dockItem} should use ${asset}`);
  }
  const penguinIconStyle = await page.locator('[data-editor-dock="characters"] .editor-game-icon')
    .evaluate((icon) => {
      const style = getComputedStyle(icon);
      return {
        backgroundPosition: style.backgroundPosition,
        backgroundSize: style.backgroundSize,
        width: style.width,
        height: style.height,
      };
    });
  assert.equal(penguinIconStyle.backgroundPosition, '-77px -32px');
  assert.equal(penguinIconStyle.backgroundSize, '256px 64px');
  assert.equal(penguinIconStyle.width, '36px');
  assert.equal(penguinIconStyle.height, '32px');
  const signIconStyle = await page.locator('[data-editor-dock="deco"] .editor-game-icon')
    .evaluate((icon) => {
      const style = getComputedStyle(icon);
      return {
        backgroundPosition: style.backgroundPosition,
        backgroundSize: style.backgroundSize,
        width: style.width,
        height: style.height,
      };
    });
  assert.equal(signIconStyle.backgroundPosition, '1px -26px');
  assert.equal(signIconStyle.backgroundSize, '32px 64px');
  assert.equal(signIconStyle.width, '32px');
  assert.equal(signIconStyle.height, '38px');
  const dockColors = await page.locator('.editor-shell-dock-grid > button').evaluateAll((buttons) => (
    buttons.map((button) => getComputedStyle(button).backgroundColor)
  ));
  assert.ok(new Set(dockColors).size >= 5, 'dock should use the established WAMP accent palette');
  assert.equal(await page.evaluate(() => document.body.dataset.editorShellPanel), 'terrain');
  assert.equal(await page.locator('#sidebar').isVisible(), true);
  assert.equal(await page.locator('#btn-editor-drawer-close').count(), 0);
  assert.equal(await terrain.getAttribute('aria-pressed'), 'true');
  assert.equal(await terrain.getAttribute('aria-expanded'), 'true');
  const initialGameBox = await game.boundingBox();
  assert.ok(initialGameBox && initialGameBox.width < viewport.width - 250);

  await terrain.click();
  await page.waitForFunction(() => document.body.dataset.editorShellPanel === 'terrain');
  const repeatedTerrainGameBox = await game.boundingBox();
  assert.ok(repeatedTerrainGameBox);
  assert.ok(Math.abs(repeatedTerrainGameBox.width - initialGameBox.width) <= 1);
  assert.equal(await terrain.getAttribute('aria-pressed'), 'true');
  assert.equal(await terrain.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('[data-builder-mode-choice="beginner"]').isVisible(), true);
  assert.equal(await page.locator('[data-builder-mode-choice="advanced"]').isVisible(), true);
  assert.equal(await page.locator('[data-smart-theme-id]').count(), 5);
  assert.ok(await page.locator('[data-smart-brush-id]').count() >= 4);
  assert.equal(await page.locator('[data-smart-brush-id]').allTextContents().then((labels) => labels.includes('Tree Canopy')), true);
  const drawerHeaderBox = await page.locator('#editor-drawer-header').boundingBox();
  assert.ok(drawerHeaderBox && drawerHeaderBox.height <= 54, `drawer header should stay compact, received ${drawerHeaderBox?.height}px`);
  const firstPreview = page.locator('.smart-preview-canvas').first();
  const firstPreviewBox = await firstPreview.boundingBox();
  assert.ok(firstPreviewBox);
  assert.ok(Math.abs((firstPreviewBox.width / firstPreviewBox.height) - (5 / 3)) < 0.03);
  assert.deepEqual(await firstPreview.evaluate((canvas) => [canvas.width, canvas.height]), [160, 96]);
  await page.screenshot({ path: path.join(viewportOutputDir, 'terrain-beginner.png') });

  const shellEraser = page.locator('#btn-editor-shell-eraser');
  const eraserSizePicker = page.locator('#editor-shell-eraser-size-picker');
  const nukeTerrainButton = page.locator('#btn-editor-shell-nuke-terrain');
  const nukeObjectsButton = page.locator('#btn-editor-shell-nuke-objects');
  await shellEraser.click();
  assert.equal(await shellEraser.getAttribute('aria-expanded'), 'true');
  assert.equal(await eraserSizePicker.isVisible(), true);
  assert.equal(await nukeTerrainButton.isVisible(), true);
  assert.equal(await nukeObjectsButton.isVisible(), true);
  for (const size of ['3', '5', '1']) {
    const sizeButton = eraserSizePicker.locator(`[data-erase-brush-size="${size}"]`);
    await sizeButton.click();
    assert.equal(await sizeButton.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#editor-top-erase-brush-select').inputValue(), size);
  }
  const [eraserPickerBox, nukeTerrainBox, nukeObjectsBox] = await Promise.all([
    eraserSizePicker.boundingBox(),
    nukeTerrainButton.boundingBox(),
    nukeObjectsButton.boundingBox(),
  ]);
  assert.ok(eraserPickerBox && nukeTerrainBox && nukeObjectsBox);
  assert.ok(eraserPickerBox.x >= 0 && eraserPickerBox.x + eraserPickerBox.width <= viewport.width + 1);
  assert.ok(nukeTerrainBox.x >= eraserPickerBox.x && nukeTerrainBox.x + nukeTerrainBox.width <= eraserPickerBox.x + eraserPickerBox.width + 1);
  assert.ok(nukeObjectsBox.x >= eraserPickerBox.x && nukeObjectsBox.x + nukeObjectsBox.width <= eraserPickerBox.x + eraserPickerBox.width + 1);
  assert.notEqual(
    await nukeTerrainButton.evaluate((button) => getComputedStyle(button).backgroundColor),
    await page.locator('[data-erase-brush-size="1"]').evaluate((button) => getComputedStyle(button).backgroundColor),
    'destructive actions should be visually distinct from Erase sizes',
  );
  await page.screenshot({ path: path.join(viewportOutputDir, 'terrain-erase-sizes.png') });
  await page.keyboard.press('b');
  assert.equal(await eraserSizePicker.isVisible(), false);
  assert.equal(await shellEraser.getAttribute('aria-expanded'), 'false');

  const markerTrigger = page.locator('[data-editor-dock="markers"]');
  await markerTrigger.click();
  await page.evaluate(async () => {
    const image = new Image();
    image.src = '/assets/objects/flag-checkered.png';
    await image.decode();
  });
  const [markersPopoverBox, spawnButtonBox, goalButtonBox] = await Promise.all([
    page.locator('#editor-markers-popover').boundingBox(),
    page.locator('[data-editor-marker-action="spawn"]').boundingBox(),
    page.locator('[data-editor-marker-action="goal"]').boundingBox(),
  ]);
  assert.ok(markersPopoverBox && spawnButtonBox && goalButtonBox);
  assert.ok(markersPopoverBox.x >= 0 && markersPopoverBox.x + markersPopoverBox.width <= viewport.width + 1);
  assert.ok(spawnButtonBox.height >= 82 && spawnButtonBox.width > spawnButtonBox.height);
  assert.ok(goalButtonBox.height >= 82 && goalButtonBox.width > goalButtonBox.height);
  await page.screenshot({ path: path.join(viewportOutputDir, 'markers-responsive.png') });
  await page.locator('#btn-editor-markers-close').click();

  const shareTrigger = page.locator('[data-editor-shell-action="share"]');
  await shareTrigger.click();
  const sharePopoverBox = await page.locator('#editor-share-popover').boundingBox();
  assert.ok(sharePopoverBox);
  assert.ok(sharePopoverBox.x >= 0 && sharePopoverBox.x + sharePopoverBox.width <= viewport.width + 1);
  assert.equal(await page.locator('#editor-share-popover .editor-share-icon').count(), 4);
  await page.screenshot({ path: path.join(viewportOutputDir, 'share-responsive.png') });
  await page.keyboard.press('Escape');

  await page.locator('[data-smart-theme-id="cyber"]').click();
  assert.equal(await page.locator('[data-smart-brush-id="cyber.concrete"]').isVisible(), true);
  await terrain.click();
  assert.equal(await terrain.getAttribute('aria-pressed'), 'true');
  assert.equal(await terrain.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.body.dataset.editorShellPanel), 'terrain');
  assert.equal(await page.locator('[data-smart-theme-id="cyber"]').getAttribute('aria-pressed'), 'true');

  const fitButton = page.locator('#btn-fit-screen');
  await fitButton.click();
  const fittedDefaultZoom = (await activeScene(page)).zoom;

  const deviceClass = await page.evaluate(() => document.body.dataset.deviceClass);
  const expectedMax = Math.min(560, viewport.width - (deviceClass === 'tablet' ? 420 : 520));
  const minWidth = await resizeDrawer(page, -1000);
  assert.ok(Math.abs(minWidth - 280) <= 1, `expected 280px drawer, received ${minWidth}`);
  const fittedMinZoom = (await activeScene(page)).zoom;
  assert.ok(fittedMinZoom >= fittedDefaultZoom);
  await page.screenshot({ path: path.join(viewportOutputDir, 'drawer-min.png') });

  const canvas = page.locator('#game-container canvas').last();
  await canvas.hover();
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(100);
  const manualZoom = (await activeScene(page)).zoom;
  await page.locator('[data-editor-dock="stuff"]').click();
  await terrain.click();
  await page.waitForTimeout(200);
  assert.equal((await activeScene(page)).zoom, manualZoom);

  await page.locator('[data-editor-dock="stuff"]').click();
  const twoColumnCount = countGridColumns(await page.locator('#object-grid').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns
  )));
  assert.equal(twoColumnCount, 2);

  const maxWidth = await resizeDrawer(page, 1000);
  assert.ok(Math.abs(maxWidth - expectedMax) <= 1, `expected ${expectedMax}px drawer, received ${maxWidth}`);
  const threeColumnCount = countGridColumns(await page.locator('#object-grid').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns
  )));
  assert.equal(threeColumnCount, 3);
  assert.equal(await page.locator('#editor-fixed-stack').isVisible(), false);
  const [drawerScrollBox, objectPaletteBox] = await Promise.all([
    page.locator('#editor-sidebar-scroll').boundingBox(),
    page.locator('#object-palette-section').boundingBox(),
  ]);
  assert.ok(drawerScrollBox && objectPaletteBox);
  const unusedPickerHeight = drawerScrollBox.y + drawerScrollBox.height - objectPaletteBox.y - objectPaletteBox.height;
  assert.ok(unusedPickerHeight <= 4, `object picker should fill drawer; found ${unusedPickerHeight}px unused`);
  await page.screenshot({ path: path.join(viewportOutputDir, 'stuff-max.png') });

  const roomTrigger = page.locator('[data-editor-shell-action="room"]');
  await roomTrigger.click();
  await page.locator('[data-editor-room-section="music"]').click();
  await page.waitForFunction(() => document.body.dataset.editorMusicMode === 'true');
  const [musicHeadingBox, musicCloseBox, musicStripBox, musicSwingBox] = await Promise.all([
    page.locator('#editor-music-overlay .editor-workbench-heading').boundingBox(),
    page.locator('#btn-editor-music-close').boundingBox(),
    page.locator('.editor-music-strip').boundingBox(),
    page.locator('#editor-music-swing-controls').boundingBox(),
  ]);
  assert.ok(musicHeadingBox && musicCloseBox && musicStripBox && musicSwingBox);
  assert.ok(musicCloseBox.y < musicStripBox.y, 'Music exit should sit above the editing toolbar');
  assert.ok(musicCloseBox.x + musicCloseBox.width <= musicHeadingBox.x + musicHeadingBox.width + 1);
  assert.ok(musicSwingBox.x >= musicStripBox.x && musicSwingBox.x + musicSwingBox.width <= musicStripBox.x + musicStripBox.width + 1);
  assert.ok(musicSwingBox.y >= musicStripBox.y && musicSwingBox.y + musicSwingBox.height <= musicStripBox.y + musicStripBox.height + 1);
  await page.screenshot({ path: path.join(viewportOutputDir, 'music-workbench.png') });
  await page.locator('#btn-editor-music-close').click();
  await page.waitForFunction(() => document.body.dataset.editorMusicMode === 'false');

  return {
    initialGameWidth: Math.round(initialGameBox.width),
    repeatedTerrainGameWidth: Math.round(repeatedTerrainGameBox.width),
    fittedDefaultZoom,
    fittedMinZoom,
    manualZoom,
    minDrawerWidth: Math.round(minWidth),
    maxDrawerWidth: Math.round(maxWidth),
    minGridColumns: twoColumnCount,
    maxGridColumns: threeColumnCount,
  };
}

async function verifyDetailedWorkflows(page, viewportOutputDir) {
  const terrain = page.locator('[data-editor-dock="terrain"]');
  await terrain.click();
  const { beforeNukeTerrain } = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: [{ x: 3, y: 3 }, { x: 4, y: 3 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'beforeNukeTerrain' },
  ]);
  assert.ok(countTiles(beforeNukeTerrain.tileData) > 0);
  await page.locator('#btn-editor-shell-eraser').click();
  const nukeTerrainButton = page.locator('#btn-editor-shell-nuke-terrain');
  await clickConfirmed(
    page,
    nukeTerrainButton,
    'Remove all tiles from Back, Gameplay, and Front?',
    false,
  );
  const { afterCancelledNukeTerrain } = await runEditorCommands(page, [
    { op: 'capture', name: 'afterCancelledNukeTerrain' },
  ]);
  assert.deepEqual(afterCancelledNukeTerrain.tileData, beforeNukeTerrain.tileData);
  assert.deepEqual(afterCancelledNukeTerrain.smartTerrain, beforeNukeTerrain.smartTerrain);
  await clickConfirmed(
    page,
    nukeTerrainButton,
    'Remove all tiles from Back, Gameplay, and Front?',
    true,
  );
  const { afterNukeTerrain, afterNukeTerrainUndo } = await runEditorCommands(page, [
    { op: 'capture', name: 'afterNukeTerrain' },
    { op: 'undo' },
    { op: 'capture', name: 'afterNukeTerrainUndo' },
  ]);
  assert.equal(countTiles(afterNukeTerrain.tileData), 0);
  assert.deepEqual(afterNukeTerrainUndo.tileData, beforeNukeTerrain.tileData);
  assert.deepEqual(afterNukeTerrainUndo.smartTerrain, beforeNukeTerrain.smartTerrain);
  await page.screenshot({ path: path.join(viewportOutputDir, 'nuke-actions.png') });
  await page.keyboard.press('b');

  const stuff = page.locator('[data-editor-dock="stuff"]');
  if (await stuff.getAttribute('aria-expanded') !== 'true') await stuff.click();
  await page.locator('.obj-cat-tab[data-category="collectible"]').click();
  const { beforeObjectPlacement } = await runEditorCommands(page, [
    { op: 'capture', name: 'beforeObjectPlacement' },
  ]);
  await page.locator('.object-item[data-object-id="coin_gold"]').click();
  const objectCanvas = page.locator('#game-container canvas').last();
  const objectCanvasBox = await objectCanvas.boundingBox();
  assert.ok(objectCanvasBox);
  await page.mouse.click(
    objectCanvasBox.x + objectCanvasBox.width * 0.52,
    objectCanvasBox.y + objectCanvasBox.height * 0.52,
  );
  const { beforeNukeObjects } = await runEditorCommands(page, [
    { op: 'capture', name: 'beforeNukeObjects' },
  ]);
  assert.equal(
    beforeNukeObjects.placedObjects.length,
    beforeObjectPlacement.placedObjects.length + 1,
  );
  await page.locator('#btn-editor-shell-eraser').click();
  assert.equal(await page.locator('#editor-shell-eraser-size-picker').isVisible(), true);
  assert.equal(await page.locator('#btn-editor-shell-nuke-terrain').isVisible(), false);
  const nukeObjectsButton = page.locator('#btn-editor-shell-nuke-objects');
  assert.equal(await nukeObjectsButton.isVisible(), true);
  await page.screenshot({ path: path.join(viewportOutputDir, 'nuke-objects.png') });
  await clickConfirmed(
    page,
    nukeObjectsButton,
    'Remove all placed objects from this room?',
    true,
  );
  const { afterNukeObjects, afterNukeObjectsUndo } = await runEditorCommands(page, [
    { op: 'capture', name: 'afterNukeObjects' },
    { op: 'undo' },
    { op: 'capture', name: 'afterNukeObjectsUndo' },
  ]);
  assert.equal(afterNukeObjects.placedObjects.length, 0);
  assert.deepEqual(afterNukeObjectsUndo.placedObjects, beforeNukeObjects.placedObjects);
  await page.keyboard.press('b');
  const visibleStuffFilters = await page.locator('.obj-cat-tab:visible').allTextContents();
  assert.deepEqual(visibleStuffFilters, ['Community', 'Mine', 'Collect', 'Utility']);
  await page.locator('.obj-cat-tab[data-category="collectible"]').click();
  await page.locator('#object-search-input').fill('coin');
  const rememberedScroll = await page.locator('#object-grid').evaluate((element) => {
    element.scrollTop = Math.min(48, Math.max(0, element.scrollHeight - element.clientHeight));
    return element.scrollTop;
  });

  await page.locator('[data-editor-dock="characters"]').click();
  assert.deepEqual(await page.locator('.obj-cat-tab:visible').allTextContents(), ['Enemy', 'NPC']);
  await page.locator('[data-editor-dock="stuff"]').click();
  assert.equal(await page.locator('#object-search-input').inputValue(), 'coin');
  assert.equal(await page.locator('.obj-cat-tab[data-category="collectible"]').getAttribute('class').then((value) => value?.includes('active')), true);
  assert.equal(await page.locator('#object-grid').evaluate((element) => element.scrollTop), rememberedScroll);

  await page.locator('[data-editor-dock="hazards"]').click();
  assert.equal(await page.locator('.obj-cat-tab:visible').count(), 0);
  assert.ok(await page.locator('#object-grid .object-item').count() > 0);
  await page.locator('[data-editor-dock="deco"]').click();
  assert.equal(await page.locator('#decoration-object-group-tabs').isVisible(), true);

  await page.locator('.editor-shell-tools [data-tool="fill"]').click();
  const markerTrigger = page.locator('[data-editor-dock="markers"]');
  const panelBeforeMarkers = await page.evaluate(() => document.body.dataset.editorShellPanel);
  await markerTrigger.click();
  assert.equal(await page.locator('#sidebar').isVisible(), true);
  assert.equal(await page.evaluate(() => document.body.dataset.editorShellPanel), panelBeforeMarkers);
  assert.deepEqual(
    await page.locator('#editor-markers-popover [data-editor-marker-action] > span:last-child').allTextContents(),
    ['Place Spawn', 'Goal'],
  );
  const [spawnMarkerBox, goalMarkerBox] = await Promise.all([
    page.locator('[data-editor-marker-action="spawn"]').boundingBox(),
    page.locator('[data-editor-marker-action="goal"]').boundingBox(),
  ]);
  assert.ok(spawnMarkerBox && goalMarkerBox);
  assert.ok(spawnMarkerBox.height >= 82 && spawnMarkerBox.width > spawnMarkerBox.height);
  assert.ok(goalMarkerBox.height >= 82 && goalMarkerBox.width > goalMarkerBox.height);
  assert.ok((await page.locator('[data-editor-marker-action="spawn"] .editor-game-icon')
    .evaluate((icon) => getComputedStyle(icon).backgroundImage)).includes('flag-green.png'));
  assert.ok((await page.locator('[data-editor-marker-action="goal"] .editor-game-icon')
    .evaluate((icon) => getComputedStyle(icon).backgroundImage)).includes('flag-checkered.png'));
  assert.equal((await page.locator('#editor-markers-popover').textContent()).toLowerCase().includes('checkpoint'), false);
  await page.screenshot({ path: path.join(viewportOutputDir, 'markers-over-panel.png') });

  const originalSpawn = (await activeScene(page)).spawnPoint;
  await page.locator('[data-editor-marker-action="spawn"]').click();
  assert.equal((await activeScene(page)).activeTool, 'pencil');
  const canvas = page.locator('#game-container canvas').last();
  const canvasBox = await canvas.boundingBox();
  assert.ok(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width * 0.36, canvasBox.y + canvasBox.height * 0.56);
  await page.waitForFunction(() => document.body.dataset.editorSpawnPlacement === 'false');
  const afterSpawn = await activeScene(page);
  assert.equal(afterSpawn.activeTool, 'fill');
  assert.notDeepEqual(afterSpawn.spawnPoint, originalSpawn);

  await markerTrigger.click();
  await page.locator('[data-editor-marker-action="spawn"]').click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.body.dataset.editorSpawnPlacement === 'false');
  assert.equal((await activeScene(page)).activeTool, 'fill');
  assert.deepEqual((await activeScene(page)).spawnPoint, afterSpawn.spawnPoint);

  await markerTrigger.click();
  await page.locator('[data-editor-marker-action="goal"]').click();
  assert.equal(await page.locator('[data-goal-type-value]').count(), 8);
  await page.locator('[data-goal-type-value="npc_quest"]').click();
  assert.equal(await page.locator('#goal-npc-quest-type-row').isVisible(), true);
  assert.deepEqual(await page.locator('#goal-npc-quest-type option').allTextContents(), ['Protect', 'Escort', 'Give']);
  await page.locator('[data-goal-type-value="checkpoint_sprint"]').click();
  assert.equal(await page.locator('#btn-goal-add-checkpoint').isVisible(), true);
  await page.locator('#btn-goal-add-checkpoint').click();
  assert.equal((await activeScene(page)).goalPlacementMode, 'checkpoint');
  await page.keyboard.press('Escape');
  assert.equal((await activeScene(page)).goalPlacementMode, null);
  assert.equal(await page.evaluate(() => document.body.dataset.editorShellPanel), 'goal');
  await page.screenshot({ path: path.join(viewportOutputDir, 'goal-checkpoints.png') });

  const roomTrigger = page.locator('[data-editor-shell-action="room"]');
  await roomTrigger.click();
  await page.locator('[data-editor-room-section="background"]').click();
  assert.equal(await page.locator('#background-card-grid').isVisible(), true);
  assert.ok(await page.locator('#background-card-grid .background-card').count() > 5);
  assert.equal(await page.locator('#background-upload-controls').isVisible(), true);
  await page.locator('[data-editor-room-section="environment"]').click();
  assert.deepEqual(await page.locator('[data-lighting-mode-value]').allTextContents(), ['Normal', 'Dark Aura']);
  assert.deepEqual(await page.locator('[data-weather-mode-value]').allTextContents(), ['Clear', 'Rain', 'Snow', 'Fog']);
  await page.screenshot({ path: path.join(viewportOutputDir, 'room-environment.png') });

  await page.locator('[data-editor-room-section="music"]').click();
  await page.waitForFunction(() => document.body.dataset.editorMusicMode === 'true');
  assert.equal(await page.locator('#editor-music-overlay').isVisible(), true);
  assert.equal(await page.locator('#btn-editor-music-close').isVisible(), true);
  assert.equal(await page.locator('#btn-editor-music-close').getAttribute('aria-label'), 'Back to Room settings');
  assert.equal(await page.locator('#editor-music-overlay .editor-workbench-heading-title').textContent(), 'Music Editor');
  await page.screenshot({ path: path.join(viewportOutputDir, 'music-workbench.png') });
  await page.locator('#btn-editor-music-close').click();
  await page.waitForFunction(() => document.body.dataset.editorMusicMode === 'false');
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('button[data-editor-room-section="music"]').getAttribute('aria-pressed'), 'true');

  await page.locator('[data-editor-room-section="sprite"]').click();
  await page.waitForFunction(() => document.body.dataset.editorSpriteMode === 'true');
  assert.equal(await page.locator('#editor-sprite-overlay').isVisible(), true);
  assert.equal(await page.locator('#btn-editor-sprite-close').getAttribute('aria-label'), 'Back to Room settings');
  assert.equal(await page.locator('#editor-sprite-overlay .editor-workbench-heading-title').textContent(), 'Sprite Editor');
  const [spriteCloseBox, spriteStripBox] = await Promise.all([
    page.locator('#btn-editor-sprite-close').boundingBox(),
    page.locator('.editor-sprite-strip').boundingBox(),
  ]);
  assert.ok(spriteCloseBox && spriteStripBox);
  assert.ok(spriteCloseBox.y < spriteStripBox.y, 'Sprite exit should sit above the editing toolbar');
  await page.screenshot({ path: path.join(viewportOutputDir, 'sprite-workbench.png') });
  await page.locator('#btn-editor-sprite-close').click();
  await page.waitForFunction(() => document.body.dataset.editorSpriteMode === 'false');
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('button[data-editor-room-section="sprite"]').getAttribute('aria-pressed'), 'true');

  const share = page.locator('[data-editor-shell-action="share"]');
  await share.click();
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(
    await page.locator('#editor-share-popover [data-editor-share-label]').allTextContents(),
    ['Wamp-O-Gram', 'Copy Room Link', 'Collect Room', 'Version History'],
  );
  assert.equal(await page.locator('#editor-share-popover .editor-share-icon').count(), 4);
  const shareColors = await page.locator('#editor-share-popover [data-editor-share-action]')
    .evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).backgroundColor));
  assert.equal(new Set(shareColors).size, 4);
  await page.screenshot({ path: path.join(viewportOutputDir, 'share-popover.png') });
  await page.evaluate(() => {
    document.getElementById('btn-mint-room')?.classList.add('hidden');
    document.getElementById('btn-refresh-room-metadata')?.classList.remove('hidden');
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-editor-share-action="collect"] [data-editor-share-label]')?.textContent?.trim()
      === 'Refresh Room Metadata'
  ));
  assert.equal(await page.locator('[data-editor-share-action="collect"] .editor-share-icon').count(), 1);
  assert.equal(
    await page.locator('[data-editor-share-action="collect"]').isDisabled(),
    await page.locator('#btn-refresh-room-metadata').isDisabled(),
  );
  await page.keyboard.press('Escape');
  assert.equal(await share.getAttribute('aria-expanded'), 'false');
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'true');
  await roomTrigger.click();
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'true');

  await page.locator('[data-editor-dock="terrain"]').click();
  await page.locator('[data-builder-mode-choice="advanced"]').click();
  assert.equal(await page.evaluate(() => window.localStorage.getItem('wamp.settings.builderMode')), 'advanced');
  assert.equal(await page.locator('.palette-tab[data-mode="smart"]').isVisible(), true);
  assert.equal(await page.locator('.palette-tab[data-mode="tiles"]').isVisible(), true);
  const [builderModeBox, paletteTabsBox] = await Promise.all([
    page.locator('.builder-mode-switch').boundingBox(),
    page.locator('#palette-mode-section .palette-tabs').boundingBox(),
  ]);
  assert.ok(builderModeBox && paletteTabsBox);
  assert.ok(
    paletteTabsBox.y >= builderModeBox.y + builderModeBox.height + 12,
    'Auto-Tile and Tilesets should occupy a padded row below Beginner and Advanced',
  );
  await page.locator('.palette-tab[data-mode="tiles"]').click();
  assert.equal(await page.locator('#tileset-select').isVisible(), true);
  assert.equal(await page.locator('#btn-tile-flip-x').isVisible(), true);
  assert.equal(await page.locator('#btn-tile-flip-y').isVisible(), true);
  assert.equal(await page.locator('#palette-canvas').isVisible(), true);
  assert.equal(await page.locator('#layers-section').isVisible(), true);
  const layerLayout = await page.locator('#layers-section').evaluate((section) => {
    const label = section.querySelector(':scope > .section-label');
    const body = section.querySelector(':scope > .sidebar-section-body');
    const firstRow = section.querySelector('.layer-row');
    const firstButton = section.querySelector('.layer-btn');
    const infoButton = section.querySelector('.layer-info-button');
    const guidesButton = section.querySelector('#btn-editor-layer-guides');
    if (!label || !body || !firstRow || !firstButton || !infoButton || !guidesButton) return null;
    const labelBox = label.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const rowBox = firstRow.getBoundingClientRect();
    const buttonBox = firstButton.getBoundingClientRect();
    const infoBox = infoButton.getBoundingClientRect();
    const guidesBox = guidesButton.getBoundingClientRect();
    return {
      display: getComputedStyle(section).display,
      columns: getComputedStyle(section).gridTemplateColumns,
      labelRight: labelBox.right,
      bodyLeft: bodyBox.left,
      labelTop: labelBox.top,
      rowTop: rowBox.top,
      bodyWidth: bodyBox.width,
      rowWidth: rowBox.width,
      buttonHeight: buttonBox.height,
      infoHeight: infoBox.height,
      guidesWidth: guidesBox.width,
      labelFont: getComputedStyle(label).fontFamily,
      summaryFont: getComputedStyle(firstButton.querySelector('.layer-btn-summary')).fontFamily,
    };
  });
  assert.ok(layerLayout);
  assert.equal(layerLayout.display, 'grid');
  assert.equal(countGridColumns(layerLayout.columns), 2);
  assert.ok(layerLayout.bodyLeft >= layerLayout.labelRight + 8, 'Layers label should occupy its own column');
  assert.ok(Math.abs(layerLayout.labelTop - layerLayout.rowTop) <= 12, 'Layers label should align with the layer controls');
  assert.ok(Math.abs(layerLayout.bodyWidth - layerLayout.rowWidth) <= 1, 'Layer rows should fill their control column');
  assert.ok(layerLayout.buttonHeight >= 44 && layerLayout.infoHeight >= 44, 'Layer controls should remain chunky');
  assert.ok(Math.abs(layerLayout.bodyWidth - layerLayout.guidesWidth) <= 1, 'See Layers should fill the control column');
  assert.match(layerLayout.labelFont, /IBM Plex Mono/i);
  assert.match(layerLayout.summaryFont, /IBM Plex Mono/i);

  const { beforeCancelledShape } = await runEditorCommands(page, [
    { op: 'capture', name: 'beforeCancelledShape' },
  ]);
  await page.keyboard.press('r');
  const shapeCanvasBox = await page.locator('#game-container canvas').last().boundingBox();
  assert.ok(shapeCanvasBox);
  await page.mouse.move(shapeCanvasBox.x + shapeCanvasBox.width * 0.42, shapeCanvasBox.y + shapeCanvasBox.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(shapeCanvasBox.x + shapeCanvasBox.width * 0.55, shapeCanvasBox.y + shapeCanvasBox.height * 0.62, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const { afterCancelledShape } = await runEditorCommands(page, [
    { op: 'capture', name: 'afterCancelledShape' },
  ]);
  assert.deepEqual(afterCancelledShape.tileData, beforeCancelledShape.tileData);
  assert.equal(await page.evaluate(() => document.body.dataset.editorShellPanel), 'terrain');

  const keyMap = [
    ['b', 'pencil'], ['e', 'eraser'], ['c', 'copy'], ['f', 'fill'],
    ['r', 'rect'], ['o', 'ellipse'], ['l', 'line'], ['g', 'fill'],
  ];
  for (const [key, tool] of keyMap) {
    await page.keyboard.press(key);
    assert.equal((await activeScene(page)).activeTool, tool);
  }
  await page.locator('#room-title-input').focus();
  await page.keyboard.press('e');
  assert.equal((await activeScene(page)).activeTool, 'fill');
  await page.locator('[data-editor-dock="terrain"]').focus();

  await page.locator('.palette-tab[data-mode="smart"]').click();
  assert.equal(await page.locator('#smart-theme-select').isVisible(), true);
  await page.screenshot({ path: path.join(viewportOutputDir, 'terrain-advanced.png') });

  await page.evaluate(() => {
    document.body.dataset.editorCourseMode = 'true';
  });
  await page.waitForFunction(() => document.body.dataset.editorDockShell !== 'true');
  assert.equal(await page.locator('#editor-shell-top').isVisible(), false);
  await page.evaluate(() => {
    delete document.body.dataset.editorCourseMode;
  });
  await page.waitForFunction(() => document.body.dataset.editorDockShell === 'true');
  assert.equal(await page.evaluate(() => document.body.dataset.editorShellPanel), 'terrain');
  assert.equal(await page.locator('#sidebar').isVisible(), true);
  assert.equal(await page.evaluate(() => document.body.dataset.builderMode), 'advanced');
}

try {
  for (const viewport of viewports) {
    const viewportName = `${viewport.width}x${viewport.height}`;
    const viewportOutputDir = path.join(outputDir, viewportName);
    mkdirSync(viewportOutputDir, { recursive: true });
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
        window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
        window.localStorage.setItem('wamp.settings.builderMode', 'beginner');
        window.localStorage.setItem('wamp_replay_opt_out', '1');
      } catch {
        // A transient browser network error can briefly create an inaccessible error document.
      }
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error' && !isCloudflareInsightsRumCorsNoise(message)) {
        summary.consoleErrors.push(`${viewportName}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => summary.pageErrors.push(`${viewportName}: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        const formatted = `${viewportName}: ${response.status()} ${response.url()}`;
        if (isKnownBackgroundThumbnail404(response)) {
          summary.knownBaselineHttpErrors.push(formatted);
        } else {
          summary.httpErrors.push(formatted);
        }
      }
    });
    await openSyntheticEditor(page);
    const viewportResult = await verifyCommonShell(page, viewport, viewportOutputDir);
    if (viewport.width === 1440) await verifyDetailedWorkflows(page, viewportOutputDir);
    summary.viewports.push({ viewport, ...viewportResult });
    await context.close();
  }

  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phoneContext.addInitScript(() => {
    try {
      window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
      window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
      window.localStorage.setItem('wamp_replay_opt_out', '1');
    } catch {
      // A transient browser network error can briefly create an inaccessible error document.
    }
  });
  const phonePage = await phoneContext.newPage();
  await navigateToTarget(phonePage);
  await phonePage.waitForFunction(
    () => document.body.dataset.appReady === 'true',
    undefined,
    { timeout: 120_000 },
  );
  await phonePage.evaluate(() => {
    window.__wampEarlyWorldTiles?.release('editor-dock-phone-smoke');
    return window.run_preview_smoke_action?.('openSyntheticEditor');
  });
  await phonePage.waitForFunction(() => document.body.dataset.appMode === 'editor');
  assert.equal(await phonePage.evaluate(() => document.body.dataset.editorDockShell ?? null), null);
  assert.equal(await phonePage.locator('#mobile-editor-nav').isVisible(), true);
  await phonePage.screenshot({ path: path.join(outputDir, 'phone-editor-unchanged.png') });
  await phoneContext.close();

  const generic404ConsoleErrors = summary.consoleErrors.filter(isGeneric404ConsoleError);
  if (
    generic404ConsoleErrors.length > 0
    && generic404ConsoleErrors.length === summary.knownBaselineHttpErrors.length
  ) {
    summary.knownBaselineConsoleErrors.push(...generic404ConsoleErrors);
    summary.consoleErrors = summary.consoleErrors.filter((message) => !isGeneric404ConsoleError(message));
  }

  assert.deepEqual(summary.consoleErrors, []);
  assert.deepEqual(summary.pageErrors, []);
  assert.deepEqual(summary.httpErrors, []);
  summary.ok = true;
} catch (error) {
  summary.ok = false;
  summary.error = error instanceof Error ? error.stack ?? error.message : String(error);
} finally {
  writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
}

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
