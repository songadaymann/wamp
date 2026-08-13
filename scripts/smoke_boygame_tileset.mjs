import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:4517/';
const outputDir = process.env.BOYGAME_SMOKE_OUTPUT_DIR || 'output/web-game/boygame-tileset';
const url = new URL(baseUrl);
url.searchParams.set('previewSmoke', '1');
url.searchParams.set('renderer', 'canvas');

mkdirSync(outputDir, { recursive: true });

const summary = {
  url: url.toString(),
  outputDir,
  consoleErrors: [],
  pageErrors: [],
  palette: null,
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
  assert.deepEqual(texture, { width: 128, height: 208 });

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

  // Choose local tile 10 (column 2, row 1) and stamp it into the synthetic room.
  await page.mouse.click(
    paletteBox.x + paletteBox.width * (2.5 / 8),
    paletteBox.y + paletteBox.height * (1.5 / 13),
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

  await page.click('#btn-test-play');
  const runtimeState = await waitForState(
    page,
    (state) => state?.activeScene?.scene === 'overworld-play' && state?.activeScene?.mode === 'play',
    'Boygame test play',
  );
  summary.runtime = {
    scene: runtimeState.activeScene.scene,
    mode: runtimeState.activeScene.mode,
    roomId: runtimeState.activeScene.roomId,
  };
  await setEarlyWorldTilesVisibility(page, false);
  await page.screenshot({ path: path.join(outputDir, 'boygame-test-play.png') });
  await setEarlyWorldTilesVisibility(page, true);

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
