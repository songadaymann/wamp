import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:4517/';
const outputDir = process.env.BOYGAME_SMOKE_OUTPUT_DIR || 'output/web-game/boygame-tileset';
const url = new URL(baseUrl);
url.searchParams.set('previewSmoke', '1');
url.searchParams.set('renderer', 'webgl');

mkdirSync(outputDir, { recursive: true });

const summary = {
  url: url.toString(),
  outputDir,
  consoleErrors: [],
  pageErrors: [],
  palette: null,
  objects: null,
  runtime: null,
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addInitScript(() => {
  window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
  window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
});
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') {
    summary.consoleErrors.push(message.text());
  }
});
page.on('pageerror', (error) => summary.pageErrors.push(error.message));

try {
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.run_preview_smoke_action === 'function');
  await waitForState(
    page,
    (state) => state?.appFeedback?.ready === true && state?.activeScene?.scene === 'overworld-play',
    'overworld boot',
  );

  const fixture = await page.evaluate(
    () => window.run_preview_smoke_action?.('openSyntheticBoygameEditor') ?? null,
  );
  assert.equal(fixture?.ok, true, `Boygame editor fixture failed: ${JSON.stringify(fixture)}`);
  await waitForState(page, (state) => state?.activeScene?.scene === 'editor', 'editor');

  await page.selectOption('#tileset-select', 'boygame');
  await page.waitForFunction(() => {
    const select = document.querySelector('#tileset-select');
    const canvas = document.querySelector('#palette-canvas');
    return select?.value === 'boygame'
      && canvas instanceof HTMLCanvasElement
      && canvas.width > 0
      && canvas.height > 0;
  });

  const texture = await page.evaluate(() => {
    const game = window.__EVERYBODYS_PLATFORMER_GAME__;
    const source = game?.textures.get('boygame')?.getSourceImage();
    return source ? { width: source.width, height: source.height } : null;
  });
  assert.deepEqual(texture, { width: 128, height: 112 });

  const paletteCanvas = page.locator('#palette-canvas');
  const paletteBox = await paletteCanvas.boundingBox();
  assert.ok(paletteBox, 'Boygame palette canvas was not visible.');
  summary.palette = {
    selectedKey: await page.inputValue('#tileset-select'),
    selectedLabel: await page.locator('#tileset-select option:checked').textContent(),
    texture,
    canvas: await paletteCanvas.evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      background: canvas.style.background,
    })),
  };
  assert.equal(summary.palette.selectedLabel, 'Boygame');

  // The synthetic fixture bypasses the normal Browse-to-Editor transition that retires this DOM layer.
  await setEarlyWorldTilesVisibility(page, false);
  await page.screenshot({ path: path.join(outputDir, 'boygame-editor.png') });
  await page.locator('#tile-palette-section').screenshot({
    path: path.join(outputDir, 'boygame-palette-panel.png'),
  });

  await page.click('.palette-tab[data-mode="objects"]');
  await page.fill('#object-search-input', 'Boygame');
  await page.waitForFunction(
    () => document.querySelectorAll('.object-item[data-object-id^="boygame_"]').length === 16,
  );
  summary.objects = await page.locator('.object-item[data-object-id^="boygame_"]').evaluateAll(
    (items) => items.map((item) => item.getAttribute('data-object-id')),
  );
  assert.ok(summary.objects.includes('boygame_coin'));
  assert.ok(summary.objects.includes('boygame_heart'));
  assert.ok(summary.objects.includes('boygame_wall_torch'));
  await setCanvasVisibility(page, false);
  await page.locator('#object-palette-section').screenshot({
    path: path.join(outputDir, 'boygame-object-palette-panel.png'),
  });
  await setCanvasVisibility(page, true);

  await page.click('.palette-tab[data-mode="tiles"]');
  await page.selectOption('#tileset-select', 'boygame');

  // Choose local tile 10 (column 2, row 1) and stamp it into the synthetic room.
  await page.mouse.click(
    paletteBox.x + paletteBox.width * (2.5 / 8),
    paletteBox.y + paletteBox.height * (1.5 / 7),
  );
  const gameCanvas = await page.evaluate(() => Array.from(document.querySelectorAll('canvas'))
    .filter((canvas) => canvas.id !== 'palette-canvas' && canvas.id !== 'tile-preview-canvas')
    .map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => right.width * right.height - left.width * left.height)[0] ?? null);
  assert.ok(gameCanvas, 'Game canvas was not visible.');
  await page.mouse.click(
    gameCanvas.x + gameCanvas.width * 0.5,
    gameCanvas.y + gameCanvas.height * 0.36,
  );
  await waitForState(page, (state) => state?.activeScene?.roomDirty === true, 'Boygame tile placement');

  await page.click('.editor-feature-btn[data-editor-feature="lighting"]');
  await page.selectOption('#lighting-mode-select', 'playerAuraDark');
  await waitForState(
    page,
    (state) => state?.activeScene?.lighting?.rendererPath === 'webgl',
    'Boygame dark-room lighting preview',
  );

  await page.click('#btn-test-play');
  const runtimeState = await waitForState(
    page,
    (state) => state?.activeScene?.scene === 'overworld-play'
      && state?.activeScene?.mode === 'play'
      && boygameObjects(state).length === 16
      && state?.activeScene?.lighting?.rendererPath === 'webgl',
    'Boygame test play',
  );
  const runtimeObjects = boygameObjects(runtimeState);
  assert.equal(runtimeObjects.find((object) => object.id === 'boygame_coin')?.animationKey, 'boygame_coin_anim');
  assert.equal(runtimeObjects.find((object) => object.id === 'boygame_coin_small')?.animationKey, 'boygame_coin_small_anim');
  assert.equal(runtimeObjects.find((object) => object.id === 'boygame_heart')?.animationKey, 'boygame_heart_anim');
  assert.equal(runtimeObjects.find((object) => object.id === 'boygame_wall_torch')?.animationKey, 'boygame_wall_torch_anim');
  assert.equal(runtimeState.activeScene.lighting?.rendererPath, 'webgl');
  assert.ok(runtimeState.activeScene.lighting?.staticObjectEmitterCount >= 1);
  assert.ok(runtimeState.activeScene.lighting?.glowEmitterCount >= 1);
  summary.runtime = {
    scene: runtimeState.activeScene.scene,
    mode: runtimeState.activeScene.mode,
    roomId: runtimeState.activeScene.roomId,
    objectCount: runtimeObjects.length,
    animatedObjectIds: runtimeObjects
      .filter((object) => object.animationKey)
      .map((object) => object.id),
    lighting: runtimeState.activeScene.lighting,
  };
  await setEarlyWorldTilesVisibility(page, false);
  await page.screenshot({ path: path.join(outputDir, 'boygame-test-play.png') });
  await setEarlyWorldTilesVisibility(page, true);

  const heart = runtimeObjects.find((object) => object.id === 'boygame_heart');
  assert.ok(heart, 'Boygame heart was not present before collection.');
  const scoreBeforeHeart = runtimeState.activeScene.score;
  const moveResult = await page.evaluate(
    ({ x, y }) => window.run_preview_smoke_action?.('setPlayerPosition', { x, y }) ?? null,
    { x: heart.x, y: heart.y },
  );
  assert.equal(moveResult?.ok, true);
  const collectedState = await waitForState(
    page,
    (state) => !boygameObjects(state).some((object) => object.id === 'boygame_heart'),
    'Boygame heart collection',
  );
  assert.equal(collectedState.activeScene.score, scoreBeforeHeart + 1);
  summary.runtime.heartCollected = true;

  assert.deepEqual(summary.consoleErrors, []);
  assert.deepEqual(summary.pageErrors, []);
  summary.ok = true;
} catch (error) {
  summary.ok = false;
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
}

console.log(JSON.stringify(summary, null, 2));

async function readState(page) {
  return page.evaluate(() => {
    const raw = window.render_game_to_text?.() ?? '';
    return raw ? JSON.parse(raw) : null;
  });
}

async function setEarlyWorldTilesVisibility(page, visible) {
  await page.evaluate((nextVisible) => {
    const layer = document.querySelector('#wamp-early-world-tiles');
    if (layer instanceof HTMLElement) {
      layer.style.visibility = nextVisible ? '' : 'hidden';
    }
  }, visible);
}

async function setCanvasVisibility(page, visible) {
  await page.evaluate((nextVisible) => {
    for (const surface of document.querySelectorAll('canvas, #wamp-early-world-tiles')) {
      surface.style.visibility = nextVisible ? '' : 'hidden';
    }
  }, visible);
}

function boygameObjects(state) {
  return (state?.activeScene?.liveObjects ?? []).filter(
    (object) => typeof object.id === 'string' && object.id.startsWith('boygame_'),
  );
}

async function waitForState(page, predicate, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readState(page);
    if (lastState && predicate(lastState)) {
      return lastState;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastState?.activeScene ?? null)}`);
}
