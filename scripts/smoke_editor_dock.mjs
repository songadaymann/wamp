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

async function openSyntheticEditor(page) {
  await page.goto(targetUrl(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.appReady === 'true');
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

  const game = page.locator('#game-container');
  const closedGameBox = await game.boundingBox();
  assert.ok(closedGameBox);
  await page.screenshot({ path: path.join(viewportOutputDir, 'drawer-closed.png') });

  const terrain = page.locator('[data-editor-dock="terrain"]');
  await terrain.click();
  await page.waitForFunction(() => document.body.dataset.editorShellPanel === 'terrain');
  const openGameBox = await game.boundingBox();
  assert.ok(openGameBox && openGameBox.width < closedGameBox.width - 200);
  assert.equal(await terrain.getAttribute('aria-pressed'), 'true');
  assert.equal(await terrain.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('[data-builder-mode-choice="beginner"]').isVisible(), true);
  assert.equal(await page.locator('[data-builder-mode-choice="advanced"]').isVisible(), true);
  assert.equal(await page.locator('[data-smart-theme-id]').count(), 5);
  assert.ok(await page.locator('[data-smart-brush-id]').count() >= 4);
  await page.screenshot({ path: path.join(viewportOutputDir, 'terrain-beginner.png') });

  await page.locator('[data-smart-theme-id="cyber"]').click();
  assert.equal(await page.locator('[data-smart-brush-id="cyber.concrete"]').isVisible(), true);
  await terrain.click();
  assert.equal(await terrain.getAttribute('aria-pressed'), 'true');
  assert.equal(await terrain.getAttribute('aria-expanded'), 'false');
  assert.equal(documentHasPanel(await page.evaluate(() => document.body.dataset.editorShellPanel)), false);
  await terrain.click();
  assert.equal(await page.locator('[data-smart-theme-id="cyber"]').getAttribute('aria-pressed'), 'true');

  const fitButton = page.locator('#btn-fit-screen');
  await fitButton.click();
  const fittedOpenZoom = (await activeScene(page)).zoom;
  await terrain.click();
  await page.waitForTimeout(200);
  const fittedClosedZoom = (await activeScene(page)).zoom;
  assert.ok(fittedClosedZoom >= fittedOpenZoom);

  const canvas = page.locator('#game-container canvas').last();
  await canvas.hover();
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(100);
  const manualZoom = (await activeScene(page)).zoom;
  await terrain.click();
  await page.waitForTimeout(200);
  assert.equal((await activeScene(page)).zoom, manualZoom);

  const deviceClass = await page.evaluate(() => document.body.dataset.deviceClass);
  const expectedMax = Math.min(560, viewport.width - (deviceClass === 'tablet' ? 420 : 520));
  const minWidth = await resizeDrawer(page, -1000);
  assert.ok(Math.abs(minWidth - 280) <= 1, `expected 280px drawer, received ${minWidth}`);
  await page.screenshot({ path: path.join(viewportOutputDir, 'drawer-min.png') });

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
  await page.screenshot({ path: path.join(viewportOutputDir, 'stuff-max.png') });

  return {
    closedGameWidth: Math.round(closedGameBox.width),
    openGameWidth: Math.round(openGameBox.width),
    fittedOpenZoom,
    fittedClosedZoom,
    manualZoom,
    minDrawerWidth: Math.round(minWidth),
    maxDrawerWidth: Math.round(maxWidth),
    minGridColumns: twoColumnCount,
    maxGridColumns: threeColumnCount,
  };
}

function documentHasPanel(value) {
  return Boolean(value && value !== 'none');
}

async function verifyDetailedWorkflows(page, viewportOutputDir) {
  const stuff = page.locator('[data-editor-dock="stuff"]');
  if (await stuff.getAttribute('aria-expanded') !== 'true') await stuff.click();
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
  await markerTrigger.click();
  assert.equal(await page.locator('#sidebar').isVisible(), false);
  assert.deepEqual(
    await page.locator('#editor-markers-popover [data-editor-marker-action]').allTextContents(),
    ['🚩 Place Spawn', '⚑ Goal'],
  );
  assert.equal((await page.locator('#editor-markers-popover').textContent()).toLowerCase().includes('checkpoint'), false);

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
  await page.locator('#btn-editor-music-close').click();
  await page.waitForFunction(() => document.body.dataset.editorMusicMode === 'false');
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('button[data-editor-room-section="music"]').getAttribute('aria-pressed'), 'true');

  await page.locator('[data-editor-room-section="sprite"]').click();
  await page.waitForFunction(() => document.body.dataset.editorSpriteMode === 'true');
  assert.equal(await page.locator('#editor-sprite-overlay').isVisible(), true);
  await page.locator('#btn-editor-sprite-close').click();
  await page.waitForFunction(() => document.body.dataset.editorSpriteMode === 'false');
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('button[data-editor-room-section="sprite"]').getAttribute('aria-pressed'), 'true');

  const share = page.locator('[data-editor-shell-action="share"]');
  await share.click();
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(
    await page.locator('#editor-share-popover [data-editor-share-action]').allTextContents(),
    ['Wamp-O-Gram', 'Copy Room Link', 'Collect Room', 'Version History'],
  );
  await page.evaluate(() => {
    document.getElementById('btn-mint-room')?.classList.add('hidden');
    document.getElementById('btn-refresh-room-metadata')?.classList.remove('hidden');
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-editor-share-action="collect"]')?.textContent?.trim()
      === 'Refresh Room Metadata'
  ));
  assert.equal(
    await page.locator('[data-editor-share-action="collect"]').isDisabled(),
    await page.locator('#btn-refresh-room-metadata').isDisabled(),
  );
  await page.keyboard.press('Escape');
  assert.equal(await share.getAttribute('aria-expanded'), 'false');
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await roomTrigger.getAttribute('aria-expanded'), 'false');

  await page.locator('[data-editor-dock="terrain"]').click();
  await page.locator('[data-builder-mode-choice="advanced"]').click();
  assert.equal(await page.locator('.palette-tab[data-mode="smart"]').isVisible(), true);
  assert.equal(await page.locator('.palette-tab[data-mode="tiles"]').isVisible(), true);
  await page.locator('.palette-tab[data-mode="tiles"]').click();
  assert.equal(await page.locator('#tileset-select').isVisible(), true);
  assert.equal(await page.locator('#btn-tile-flip-x').isVisible(), true);
  assert.equal(await page.locator('#btn-tile-flip-y').isVisible(), true);
  assert.equal(await page.locator('#palette-canvas').isVisible(), true);
  assert.equal(await page.locator('#layers-section').isVisible(), true);

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
}

try {
  for (const viewport of viewports) {
    const viewportName = `${viewport.width}x${viewport.height}`;
    const viewportOutputDir = path.join(outputDir, viewportName);
    mkdirSync(viewportOutputDir, { recursive: true });
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => {
      window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
      window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
      window.localStorage.setItem('wamp.settings.builderMode', 'beginner');
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') summary.consoleErrors.push(`${viewportName}: ${message.text()}`);
    });
    page.on('pageerror', (error) => summary.pageErrors.push(`${viewportName}: ${error.message}`));
    await openSyntheticEditor(page);
    const viewportResult = await verifyCommonShell(page, viewport, viewportOutputDir);
    if (viewport.width === 1440) await verifyDetailedWorkflows(page, viewportOutputDir);
    summary.viewports.push({ viewport, ...viewportResult });
    await context.close();
  }

  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phoneContext.addInitScript(() => {
    window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
    window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
  });
  const phonePage = await phoneContext.newPage();
  await phonePage.goto(targetUrl(), { waitUntil: 'domcontentloaded' });
  await phonePage.waitForFunction(() => document.body.dataset.appReady === 'true');
  await phonePage.evaluate(() => {
    window.__wampEarlyWorldTiles?.release('editor-dock-phone-smoke');
    return window.run_preview_smoke_action?.('openSyntheticEditor');
  });
  await phonePage.waitForFunction(() => document.body.dataset.appMode === 'editor');
  assert.equal(await phonePage.evaluate(() => document.body.dataset.editorDockShell ?? null), null);
  assert.equal(await phonePage.locator('#mobile-editor-nav').isVisible(), true);
  await phonePage.screenshot({ path: path.join(outputDir, 'phone-editor-unchanged.png') });
  await phoneContext.close();

  assert.deepEqual(summary.consoleErrors, []);
  assert.deepEqual(summary.pageErrors, []);
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
