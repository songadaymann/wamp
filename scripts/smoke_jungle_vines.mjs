import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:4517/';
const outputDir = process.env.JUNGLE_VINES_SMOKE_OUTPUT_DIR || 'output/web-game/jungle-vines';
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
  if (message.type() === 'error') summary.consoleErrors.push(message.text());
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
    () => window.run_preview_smoke_action?.('openSyntheticJungleEditor') ?? null,
  );
  assert.equal(fixture?.ok, true, `Jungle editor fixture failed: ${JSON.stringify(fixture)}`);
  await waitForState(page, (state) => state?.activeScene?.scene === 'editor', 'editor');

  await page.selectOption('#background-select', 'jungle_vines');
  await page.selectOption('#tileset-select', 'jungle-vines');
  await page.waitForFunction(() => {
    const select = document.querySelector('#tileset-select');
    const canvas = document.querySelector('#palette-canvas');
    return select?.value === 'jungle-vines'
      && canvas instanceof HTMLCanvasElement
      && canvas.width > 0
      && canvas.height > 0;
  });

  const textures = await page.evaluate(() => {
    const game = window.__EVERYBODYS_PLATFORMER_GAME__;
    const describe = (key) => {
      const source = game?.textures.get(key)?.getSourceImage();
      return source ? { width: source.width, height: source.height } : null;
    };
    return {
      tileset: describe('jungle-vines'),
      backgroundLayers: Array.from({ length: 6 }, (_, index) => describe(`jungle_vines_${index}`)),
    };
  });
  assert.deepEqual(textures.tileset, { width: 144, height: 128 });
  assert.deepEqual(textures.backgroundLayers, Array(6).fill({ width: 384, height: 176 }));

  const paletteCanvas = page.locator('#palette-canvas');
  const paletteBox = await paletteCanvas.boundingBox();
  assert.ok(paletteBox, 'Jungle Vines palette canvas was not visible.');
  summary.palette = {
    selectedKey: await page.inputValue('#tileset-select'),
    selectedLabel: await page.locator('#tileset-select option:checked').textContent(),
    backgroundKey: await page.inputValue('#background-select'),
    textures,
  };
  assert.equal(summary.palette.selectedLabel, 'Jungle Vines');

  await setEarlyWorldTilesVisibility(page, false);
  await page.screenshot({ path: path.join(outputDir, 'jungle-editor.png') });
  await page.locator('#tile-palette-section').screenshot({
    path: path.join(outputDir, 'jungle-tile-palette-panel.png'),
  });

  await page.click('.palette-tab[data-mode="objects"]');
  await page.click('.obj-cat-tab[data-category="decoration"]');
  const decorationGroupCounts = {};
  for (const group of ['vines', 'trees', 'plants', 'rocks', 'props', 'sky']) {
    await page.click(`[data-decoration-group="${group}"]`);
    await page.waitForFunction(
      (activeGroup) => document.querySelector(`[data-decoration-group="${activeGroup}"]`)?.classList.contains('active'),
      group,
    );
    decorationGroupCounts[group] = await page.locator('#object-grid .object-item').count();
  }
  assert.deepEqual(decorationGroupCounts, {
    vines: 9,
    trees: 226,
    plants: 3,
    rocks: 5,
    props: 9,
    sky: 2,
  });

  await page.click('[data-decoration-group="trees"]');
  const treeSubcategoryCounts = {};
  for (const subgroup of ['woodland', 'tropical', 'blossom', 'bonsai', 'winter', 'classic']) {
    await page.click(`[data-tree-category="${subgroup}"]`);
    treeSubcategoryCounts[subgroup] = await page.locator('#object-grid .object-item').count();
  }
  assert.deepEqual(treeSubcategoryCounts, {
    woodland: 80,
    tropical: 60,
    blossom: 20,
    bonsai: 41,
    winter: 20,
    classic: 5,
  });

  await page.click('[data-tree-category="woodland"]');
  const woodlandFamilyCounts = {};
  for (const family of ['basic', 'birch', 'oak', 'weeping-willow']) {
    await page.click(`[data-tree-family="${family}"]`);
    woodlandFamilyCounts[family] = await page.locator('#object-grid .object-item').count();
  }
  assert.deepEqual(woodlandFamilyCounts, {
    basic: 20,
    birch: 20,
    oak: 20,
    'weeping-willow': 20,
  });

  await page.click('[data-tree-category="tropical"]');
  const tropicalFamilyCounts = {};
  for (const family of ['bamboo', 'coconut', 'palm']) {
    await page.click(`[data-tree-family="${family}"]`);
    tropicalFamilyCounts[family] = await page.locator('#object-grid .object-item').count();
  }
  assert.deepEqual(tropicalFamilyCounts, { bamboo: 20, coconut: 20, palm: 20 });

  await page.click('[data-tree-category="bonsai"]');
  const bonsaiFamilyCounts = {};
  for (const family of ['bonsai', 'bonsai-sakura']) {
    await page.click(`[data-tree-family="${family}"]`);
    bonsaiFamilyCounts[family] = await page.locator('#object-grid .object-item').count();
  }
  assert.deepEqual(bonsaiFamilyCounts, { bonsai: 21, 'bonsai-sakura': 20 });

  summary.trees = {
    total: decorationGroupCounts.trees,
    subgroups: treeSubcategoryCounts,
    families: {
      woodland: woodlandFamilyCounts,
      tropical: tropicalFamilyCounts,
      bonsai: bonsaiFamilyCounts,
    },
  };
  await page.click('[data-tree-category="woodland"]');
  await page.click('[data-tree-family="oak"]');
  await page.waitForFunction(
    () => document.querySelectorAll('.object-item[data-object-id^="tree_pack_oak_"]').length === 20,
  );
  await setCanvasVisibility(page, false);
  await page.locator('#object-palette-section').screenshot({
    path: path.join(outputDir, 'tree-object-palette-panel.png'),
  });
  await setCanvasVisibility(page, true);

  await page.click('.layer-btn[data-layer="background"]');
  await page.click('.object-item[data-object-id="tree_pack_oak_01"]');
  const gameCanvas = await page.evaluate(() => Array.from(document.querySelectorAll('#game-container canvas'))
    .map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => right.width * right.height - left.width * left.height)[0] ?? null);
  assert.ok(gameCanvas, 'Game canvas was not visible for tree placement.');
  await page.mouse.click(
    gameCanvas.x + gameCanvas.width * 0.54,
    gameCanvas.y + gameCanvas.height * 0.645,
  );
  await waitForState(page, (state) => state?.activeScene?.placedObjects === 16, 'tree decoration placement');
  await setEarlyWorldTilesVisibility(page, false);
  await page.screenshot({ path: path.join(outputDir, 'tree-pack-deco-placed.png') });

  await page.click('[data-decoration-group="vines"]');
  await page.click('[data-vine-category="sprigs"]');
  await page.waitForFunction(
    () => document.querySelectorAll('.object-item[data-object-id^="jungle_vine_sprig_"]').length === 7,
  );
  summary.objects = await page.locator('.object-item[data-object-id^="jungle_vine_sprig_"]').evaluateAll(
    (items) => items.map((item) => item.getAttribute('data-object-id')),
  );
  assert.equal(summary.objects.length, 7);
  assert.ok(summary.objects.includes('jungle_vine_sprig_1'));
  assert.ok(summary.objects.includes('jungle_vine_sprig_7'));
  summary.decorationGroupCounts = decorationGroupCounts;
  await setCanvasVisibility(page, false);
  await page.locator('#object-palette-section').screenshot({
    path: path.join(outputDir, 'jungle-object-palette-panel.png'),
  });
  await setCanvasVisibility(page, true);

  await page.click('#btn-test-play');
  const runtimeState = await waitForState(
    page,
    (state) => state?.activeScene?.scene === 'overworld-play'
      && state?.activeScene?.mode === 'play'
      && jungleObjects(state).length === 15
      && treePackObjects(state).length === 1
      && state?.activeScene?.currentRoomBackground?.background === 'jungle_vines'
      && state?.activeScene?.currentRoomBackground?.layerCount === 6,
    'Jungle test play',
  );
  const runtimeObjects = jungleObjects(runtimeState);
  assert.equal(treePackObjects(runtimeState)[0]?.id, 'tree_pack_oak_01');
  const climbingVine = runtimeObjects.find((object) => object.id === 'jungle_climbing_vine_1');
  assert.ok(climbingVine, 'Climbing vine was missing from test play.');
  await setEarlyWorldTilesVisibility(page, false);
  await page.screenshot({ path: path.join(outputDir, 'jungle-test-play.png') });
  await setEarlyWorldTilesVisibility(page, true);

  const moveResult = await page.evaluate(
    ({ x, y }) => window.run_preview_smoke_action?.('setPlayerPosition', { x, y }) ?? null,
    { x: climbingVine.x, y: climbingVine.y },
  );
  assert.equal(moveResult?.ok, true);
  await page.keyboard.down('ArrowUp');
  const climbingState = await waitForState(
    page,
    (state) => state?.activeScene?.player?.climbing === true,
    'vine climbing',
  );
  await page.keyboard.up('ArrowUp');
  assert.match(climbingState.activeScene.player.ladderKey, /jungle_climbing_vine_1/);

  summary.runtime = {
    scene: runtimeState.activeScene.scene,
    mode: runtimeState.activeScene.mode,
    objectCount: runtimeObjects.length,
    treePackObjectCount: treePackObjects(runtimeState).length,
    background: runtimeState.activeScene.currentRoomBackground,
    climbingVineKey: climbingState.activeScene.player.ladderKey,
  };
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

function jungleObjects(state) {
  return (state?.activeScene?.liveObjects ?? []).filter(
    (object) => typeof object.id === 'string' && object.id.startsWith('jungle_'),
  );
}

function treePackObjects(state) {
  return (state?.activeScene?.liveObjects ?? []).filter(
    (object) => typeof object.id === 'string' && object.id.startsWith('tree_pack_'),
  );
}

async function readState(targetPage) {
  return targetPage.evaluate(() => {
    const raw = window.render_game_to_text?.() ?? '';
    return raw ? JSON.parse(raw) : null;
  });
}

async function waitForState(targetPage, predicate, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readState(targetPage);
    if (lastState && predicate(lastState)) return lastState;
    await targetPage.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastState?.activeScene ?? null)}`);
}

async function setEarlyWorldTilesVisibility(targetPage, visible) {
  await targetPage.evaluate((nextVisible) => {
    const layer = document.querySelector('#wamp-early-world-tiles');
    if (layer instanceof HTMLElement) layer.style.visibility = nextVisible ? '' : 'hidden';
  }, visible);
}

async function setCanvasVisibility(targetPage, visible) {
  await targetPage.evaluate((nextVisible) => {
    for (const surface of document.querySelectorAll('canvas, #wamp-early-world-tiles')) {
      surface.style.visibility = nextVisible ? '' : 'hidden';
    }
  }, visible);
}
