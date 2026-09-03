import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:3000/';
const outputDir = process.env.SMART_AUTOTILING_SMOKE_OUTPUT_DIR || 'output/web-game/smart-autotiling';
const FLIP_X = 1 << 20;
const FLIP_Y = 1 << 21;
const TILE_TRANSFORM_FLAGS = FLIP_X | FLIP_Y;
const url = new URL(baseUrl);
url.searchParams.set('previewSmoke', '1');
if (!url.searchParams.has('renderer')) url.searchParams.set('renderer', 'webgl');
const expectedRenderer = url.searchParams.get('renderer')?.toLowerCase();
assert.ok(
  expectedRenderer === 'canvas' || expectedRenderer === 'webgl',
  'Smart autotiling smoke requires renderer=canvas or renderer=webgl.',
);
mkdirSync(outputDir, { recursive: true });

function rectangleCells(x1, y1, x2, y2) {
  const cells = [];
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) cells.push({ x, y });
  }
  return cells;
}

function decodedBaseGid(value) {
  return value > 0 ? value & ~TILE_TRANSFORM_FLAGS : value;
}

function assertCyberLocalIndex(value, allowedLocalIndices, message) {
  const actualLocalIndex = decodedBaseGid(value) - 1633;
  assert.ok(
    allowedLocalIndices.includes(actualLocalIndex),
    `${message}: expected one of ${allowedLocalIndices.join(', ')}, received ${actualLocalIndex}`,
  );
}

function isCloudflareInsightsRumCorsNoise(message) {
  const text = message.text();
  const locationUrl = message.location().url ?? '';
  const combined = `${text} ${locationUrl}`;
  return combined.includes('cloudflareinsights.com/cdn-cgi/rum')
    && (
      combined.includes('CORS policy')
      || combined.includes('net::ERR_FAILED')
      || combined.includes('Failed to load resource')
    );
}

function captureBrowserErrors(page, summary) {
  page.on('console', (message) => {
    if (message.type() === 'error' && !isCloudflareInsightsRumCorsNoise(message)) {
      summary.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => summary.pageErrors.push(error.message));
}

function isGuardedSyntheticRoomMutation(request) {
  const method = request.method().toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const pathname = new URL(request.url()).pathname.toLowerCase();
  return pathname.includes('/api/rooms/99%2c99')
    || pathname.includes('/api/rooms/99,99')
    || pathname.includes('/api/guest-room-drafts');
}

async function guardSyntheticRoomMutations(page, summary) {
  page.on('request', (request) => {
    if (!isGuardedSyntheticRoomMutation(request)) return;
    summary.mutatingRoomRequests.push(`${request.method().toUpperCase()} ${request.url()}`);
  });
  await page.route(/\/api\/(?:rooms\/99(?:%2c|,)99|guest-room-drafts)/i, async (route) => {
    if (isGuardedSyntheticRoomMutation(route.request())) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  // This editor smoke does not exercise leaderboard data. Keep it hermetic so
  // an unavailable local API cannot turn renderer verification into a network
  // flake after every editor assertion has already passed.
  await page.route('**/api/leaderboards/rooms/*', async (route) => {
    if (route.request().method().toUpperCase() !== 'GET') {
      await route.continue();
      return;
    }
    const requestUrl = new URL(route.request().url());
    const roomId = decodeURIComponent(requestUrl.pathname.split('/').at(-1) ?? '99,99');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        roomId,
        roomCoordinates: { x: 99, y: 99 },
        roomTitle: 'Smart Autotiling Smoke',
        roomVersion: 1,
        displayRoomVersion: 1,
        equivalentRoomVersions: [1],
        leaderboardFamilyVersions: [1],
        leaderboardSourceVersion: 1,
        canonicalRoomVersion: 1,
        currentPublishedVersion: 1,
        goalType: 'reach_exit',
        rankingMode: 'time',
        difficulty: {
          consensus: null,
          counts: { easy: 0, medium: 0, hard: 0, extreme: 0 },
          totalVotes: 0,
          viewerVote: null,
          viewerSignedIn: false,
          viewerCanVote: false,
          viewerNeedsRun: false,
        },
        quality: {
          adjustedAverage: 0,
          rawAverage: 0,
          voteCount: 0,
          weightedVoteCount: 0,
          counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 },
        },
        viewerRating: null,
        trophy: null,
        entries: [],
        viewerBest: null,
        viewerRank: null,
      }),
    });
  });
}

async function runEditorCommands(page, editorCommands) {
  const result = await page.evaluate((commands) => (
    window.run_preview_smoke_action?.('runEditorCommands', { editorCommands: commands })
  ), editorCommands);
  assert.equal(
    result?.ok,
    true,
    `Editor preview-smoke command failed: ${JSON.stringify(result)}`,
  );
  return result.captures ?? {};
}

async function readEditorState(page) {
  return {
    theme: await page.locator('#smart-theme-select').inputValue(),
    brush: await page.locator('#smart-material-select').inputValue(),
    style: await page.locator('#smart-style-select').inputValue(),
    layer: await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'),
  };
}

async function assertEditorState(page, expected) {
  assert.deepEqual(await readEditorState(page), expected);
}

async function dismissKeepBuilding(page) {
  const button = page.locator('#btn-guest-builder-claim-continue');
  if (await button.isVisible()) await button.click();
}

const summary = {
  url: url.toString(),
  consoleErrors: [],
  pageErrors: [],
  mutatingRoomRequests: [],
  checks: {},
};
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addInitScript(() => {
  window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
  window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
  window.localStorage.setItem('wamp.settings.builderMode', 'beginner');
});
const page = await context.newPage();
const requestedUrls = [];
page.on('request', (request) => requestedUrls.push(request.url()));
captureBrowserErrors(page, summary);
await guardSyntheticRoomMutations(page, summary);

try {
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.run_preview_smoke_action === 'function');
  await page.waitForFunction(() => document.body.dataset.appReady === 'true');
  const clearedLocalBefore = await page.evaluate(() => (
    window.run_preview_smoke_action?.('clearSyntheticLocalRoom')
  ));
  assert.deepEqual(clearedLocalBefore, { ok: true, target: 'local' });
  const rendererProof = await page.evaluate(() => window.capture_debug_info?.().renderer);
  assert.equal(rendererProof?.requested, expectedRenderer);
  assert.equal(rendererProof?.active, expectedRenderer);
  summary.checks.renderer = { expected: expectedRenderer, active: rendererProof?.active };
  const opened = await page.evaluate(() => window.run_preview_smoke_action?.('openSyntheticEditor'));
  assert.equal(opened?.ok, true);
  await page.waitForFunction(() => document.body.dataset.appMode === 'editor');

  assert.equal(await page.locator('.palette-tab[data-mode="smart"]').getAttribute('class').then((value) => value?.includes('active')), true);
  assert.equal(await page.locator('.palette-tab[data-mode="tiles"]').isVisible(), false);
  assert.equal(await page.locator('[data-tool="copy"]').first().isVisible(), false);
  summary.checks.beginnerUi = true;

  const { painted } = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(8, 12, 10, 13) },
    { op: 'commitBatch' },
    { op: 'capture', name: 'painted' },
  ]);
  assert.equal(Object.keys(painted.smartTerrain.cells).length, 6);
  assert.ok(Object.keys(painted.smartTerrain.generatedDecorations).length > 0);
  assert.ok(painted.tileData.terrain[12][8] > 0);
  summary.checks.paintAndDetails = true;

  const localSave = await page.evaluate(() => (
    window.run_preview_smoke_action?.('saveSyntheticEditorToLocal')
  ));
  assert.deepEqual(localSave, { ok: true, target: 'local', roomId: '99,99' });
  // A hard reload can otherwise abort an in-flight three-second chat poll and
  // turn the navigation itself into a console error. Leave chat mode first and
  // wait for any current read-only poll to settle; no error is filtered here.
  await page.evaluate(() => {
    document.body.dataset.appMode = 'preview-smoke-reload';
  });
  await page.waitForFunction(() => window.get_chat_debug_state?.().loading !== true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.run_preview_smoke_action === 'function');
  await page.waitForFunction(() => document.body.dataset.appReady === 'true');
  assert.equal(
    await page.evaluate(() => window.capture_debug_info?.().renderer.active),
    expectedRenderer,
  );
  const reopenedLocal = await page.evaluate(() => (
    window.run_preview_smoke_action?.('openSyntheticEditorFromLocal')
  ));
  assert.equal(reopenedLocal?.ok, true);
  assert.equal(reopenedLocal?.target, 'local');
  assert.equal(reopenedLocal?.roomId, '99,99');
  await page.waitForFunction(() => document.body.dataset.appMode === 'editor');
  const { reopened } = await runEditorCommands(page, [{ op: 'capture', name: 'reopened' }]);
  assert.deepEqual(reopened.smartTerrain, painted.smartTerrain);
  assert.deepEqual(reopened.tileData, painted.tileData);
  const clearedLocalAfter = await page.evaluate(() => (
    window.run_preview_smoke_action?.('clearSyntheticLocalRoom')
  ));
  assert.deepEqual(clearedLocalAfter, { ok: true, target: 'local' });
  summary.checks.localPersistenceReload = true;

  const historyCaptures = await runEditorCommands(page, [
    { op: 'clearAllTiles' },
    { op: 'capture', name: 'historyBefore' },
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(8, 12, 10, 13) },
    { op: 'commitBatch' },
    { op: 'capture', name: 'historyPainted' },
    { op: 'undo' },
    { op: 'capture', name: 'undone' },
    { op: 'redo' },
    { op: 'capture', name: 'redone' },
  ]);
  await dismissKeepBuilding(page);
  assert.deepEqual(historyCaptures.undone.tileData, historyCaptures.historyBefore.tileData);
  assert.deepEqual(historyCaptures.undone.smartTerrain, historyCaptures.historyBefore.smartTerrain);
  assert.deepEqual(historyCaptures.redone.tileData, historyCaptures.historyPainted.tileData);
  assert.deepEqual(historyCaptures.redone.smartTerrain, historyCaptures.historyPainted.smartTerrain);
  summary.checks.undoRedo = true;

  const copiedCaptures = await runEditorCommands(page, [
    { op: 'copy', x1: 8, y1: 12, x2: 10, y2: 13 },
    { op: 'beginBatch' },
    { op: 'paste', x: 14, y: 12 },
    { op: 'commitBatch' },
    { op: 'capture', name: 'copied' },
  ]);
  const copied = Object.keys(copiedCaptures.copied.smartTerrain.cells).length;
  assert.equal(copied, 12);
  summary.checks.smartCopyPaste = true;

  await page.locator('#smart-theme-select').selectOption('cyber');
  await page.locator('#smart-material-select').selectOption('cyber.support');
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'background');
  assert.equal(await page.locator('.layer-btn[data-layer="foreground"]').isDisabled(), true);
  await page.locator('#smart-material-select').selectOption('cyber.concrete');
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'terrain');
  summary.checks.beginnerSmartLayerRouting = true;

  await page.locator('[data-builder-mode-choice="advanced"]').click();
  assert.equal(await page.locator('.palette-tab[data-mode="tiles"]').isVisible(), true);
  assert.equal(await page.locator('.palette-tab[data-mode="tiles"]').getAttribute('class').then((value) => value?.includes('active')), true);
  assert.equal(await page.locator('[data-tool="copy"]').first().isVisible(), true);
  await page.locator('.palette-tab[data-mode="smart"]').click();
  const smartBox = await page.locator('#smart-palette-section').boundingBox();
  summary.checks.smartPanelHeight = smartBox?.height ?? 0;
  assert.ok(smartBox && smartBox.height > 120);
  assert.equal(await page.locator('#smart-theme-select').isVisible(), true);
  assert.equal(await page.locator('#smart-material-select option[value="platform"]').count(), 0);
  summary.checks.advancedUi = true;

  await page.locator('#smart-theme-select').selectOption('cyber');
  assert.deepEqual(
    await page.locator('#smart-material-select option').all().then((options) =>
      Promise.all(options.map((option) => option.getAttribute('value')))
    ),
    [
      'cyber.concrete',
      'cyber.windows',
      'cyber.shell',
      'cyber.rubble',
      'cyber.support',
      'cyber.neon',
      'cyber.fence',
    ],
  );
  assert.equal(
    await page.locator('#smart-material-select option[value="cyber.concrete"]').textContent(),
    'Concrete',
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
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'terrain');
  await assertEditorState(page, {
    theme: 'cyber',
    brush: 'cyber.support',
    style: 'cyber-pink',
    layer: 'terrain',
  });
  for (const layer of ['background', 'terrain', 'foreground']) {
    assert.equal(await page.locator(`.layer-btn[data-layer="${layer}"]`).isEnabled(), true);
  }
  await page.locator('.layer-btn[data-layer="foreground"]').click();
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'foreground');
  const { advancedLayerSupport } = await runEditorCommands(page, [
    { op: 'clearAllTiles' },
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(16, 2, 16, 5) },
    { op: 'commitBatch' },
    { op: 'capture', name: 'advancedLayerSupport' },
  ]);
  assert.deepEqual(advancedLayerSupport.tileData.foreground.slice(2, 6).map((row) => row[16]), [
    1717 + 36, 1717 + 48, 1717 + 60, 1717 + 72,
  ]);
  assert.deepEqual(advancedLayerSupport.tileData.background.slice(2, 6).map((row) => row[16]), [
    -1, -1, -1, -1,
  ]);
  assert.deepEqual(
    Object.values(advancedLayerSupport.smartTerrain.recipes)[0]?.anchor,
    { layer: 'foreground', x: 16, y: 2 },
  );
  summary.checks.advancedSmartLayerOutput = true;
  assert.equal(await page.locator('[data-tool="rect"]').first().isEnabled(), true);
  assert.equal(await page.locator('[data-tool="ellipse"]').first().isEnabled(), true);
  assert.equal(await page.locator('[data-tool="fill"]').first().isEnabled(), true);
  assert.equal(await page.locator('[data-tool="line"]').first().isEnabled(), true);
  await page.locator('#btn-editor-top-tool-more').click();
  await page.screenshot({ path: path.join(outputDir, 'cyber-support-tools.png') });
  await page.locator('#btn-editor-top-tool-more').click();

  await page.locator('#smart-theme-select').selectOption('forest');
  await page.locator('#smart-material-select').selectOption('forest.ground');
  await page.locator('.layer-btn[data-layer="background"]').click();
  await assertEditorState(page, {
    theme: 'forest',
    brush: 'forest.ground',
    style: 'forest',
    layer: 'background',
  });
  assert.match(
    await page.locator('#smart-palette-hint').textContent() ?? '',
    /Exposed top edges are one-way landing surfaces/,
  );
  const backgroundGroundCells = rectangleCells(6, 4, 12, 7);
  const { backgroundGround } = await runEditorCommands(page, [
    { op: 'clearAllTiles' },
    { op: 'beginBatch' },
    { op: 'placeCells', cells: backgroundGroundCells },
    { op: 'commitBatch' },
    { op: 'capture', name: 'backgroundGround' },
    { op: 'fitToScreen' },
  ]);
  for (const { x, y } of backgroundGroundCells) {
    assert.ok(backgroundGround.tileData.background[y][x] > 0);
    assert.equal(backgroundGround.tileData.terrain[y][x], -1);
    assert.equal(
      backgroundGround.smartTerrain.semanticCells[`background:${x},${y}`]?.brushId,
      'forest.ground',
    );
  }
  await page.waitForTimeout(150);
  await dismissKeepBuilding(page);
  await page.screenshot({ path: path.join(outputDir, 'background-ground-top-surface.png') });
  summary.checks.advancedBackgroundGroundTopSurface = true;

  await page.locator('#smart-theme-select').selectOption('cyber');
  await page.locator('#smart-style-select').selectOption('cyber-pink');
  await page.locator('#smart-material-select').selectOption('cyber.support');
  await page.locator('.layer-btn[data-layer="foreground"]').click();

  await page.locator('#smart-material-select').selectOption('cyber.fence');
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'foreground');
  await assertEditorState(page, {
    theme: 'cyber',
    brush: 'cyber.fence',
    style: 'cyber-pink',
    layer: 'foreground',
  });
  await page.locator('#smart-material-select').selectOption('cyber.concrete');
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'foreground');
  await assertEditorState(page, {
    theme: 'cyber',
    brush: 'cyber.concrete',
    style: 'cyber-pink',
    layer: 'foreground',
  });
  assert.equal(await page.locator('[data-tool="ellipse"]').first().isEnabled(), true);
  assert.equal(await page.locator('[data-tool="fill"]').first().isEnabled(), true);
  assert.equal(await page.locator('.smart-details-row').isHidden(), true);
  await page.screenshot({ path: path.join(outputDir, 'cyber-smart-palette.png') });
  summary.checks.cyberRegistryUi = true;

  await page.locator('#smart-style-select').selectOption('cyber-yellow');
  await page.locator('.layer-btn[data-layer="terrain"]').click();
  const { cyberFill } = await runEditorCommands(page, [
    { op: 'clearAllTiles' },
    { op: 'beginBatch' },
    { op: 'floodFill', x: 0, y: 0 },
    { op: 'commitBatch' },
    { op: 'capture', name: 'cyberFill' },
    { op: 'clearAllTiles' },
  ]);
  assert.equal(Object.keys(cyberFill.smartTerrain.semanticCells).length, 40 * 22);
  assert.ok(cyberFill.tileData.terrain.every((row) => row.every((value) => value > 0)));
  summary.checks.cyberFill = true;
  await dismissKeepBuilding(page);

  const { cyberStructure } = await runEditorCommands(page, [
    { op: 'clearAllTiles' },
    { op: 'beginBatch' },
    { op: 'stampShape', kind: 'rect', x1: 32, y1: 2, x2: 39, y2: 17, outline: false, erase: false },
    { op: 'stampShape', kind: 'ellipse', x1: 4, y1: 10, x2: 10, y2: 16, outline: false, erase: false },
    { op: 'placeCells', cells: [
      { x: 20, y: 2 }, { x: 21, y: 2 },
      { x: 20, y: 3 }, { x: 21, y: 3 }, { x: 22, y: 3 },
      { x: 20, y: 4 }, { x: 21, y: 4 }, { x: 22, y: 4 }, { x: 23, y: 4 },
    ] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'cyberStructure' },
  ]);
  assert.equal(cyberStructure.smartTerrain.version, 2);
  assert.equal(cyberStructure.smartTerrain.semanticCells['terrain:32,2'].brushId, 'cyber.concrete');
  assert.equal(cyberStructure.tileData.terrain[2][32], 1633 + 14);
  assert.equal(cyberStructure.tileData.terrain[2][39], 1633 + 14 + FLIP_X);
  assertCyberLocalIndex(
    cyberStructure.tileData.terrain[4][35],
    [64, 82, 83],
    'Cyber rectangle interior uses coordinate-stable neutral Concrete',
  );
  assertCyberLocalIndex(
    cyberStructure.tileData.terrain[17][33],
    [15, 16, 62],
    'Cyber rectangle bottom uses neutral edge art',
  );
  assertCyberLocalIndex(
    cyberStructure.tileData.terrain[3][21],
    [11, 33, 35],
    'Cyber stair inner corner uses matched Concrete corner art',
  );
  assert.equal(cyberStructure.tileData.foreground[3][21], 1633 + 9 + FLIP_Y);
  assertCyberLocalIndex(
    cyberStructure.tileData.terrain[4][21],
    [15, 16, 62],
    'Cyber stair lower middle uses neutral bottom art',
  );
  assertCyberLocalIndex(
    cyberStructure.tileData.terrain[4][22],
    [15, 16, 62],
    'Cyber stair lower middle before end uses neutral bottom art',
  );
  assert.equal(cyberStructure.tileData.foreground[4][22], 1633 + 9 + FLIP_Y);
  assert.equal(cyberStructure.tileData.terrain[4][23], 1633 + 71);
  assert.ok(Object.keys(cyberStructure.smartTerrain.semanticCells).length > 128);
  assert.equal(Object.values(cyberStructure.smartTerrain.ownedOutputs)
    .filter(({ partId }) => partId === 'detail').length, 0);
  summary.checks.cyberStructureAndShapes = true;
  summary.checks.cyberDecorationDisabled = true;
  await dismissKeepBuilding(page);

  const cyberCopyHistoryCaptures = await runEditorCommands(page, [
    { op: 'copy', x1: 32, y1: 2, x2: 33, y2: 3 },
    { op: 'beginBatch' },
    { op: 'paste', x: 12, y: 2 },
    { op: 'commitBatch' },
    { op: 'capture', name: 'copied' },
    { op: 'undo' },
    { op: 'capture', name: 'undone' },
    { op: 'redo' },
    { op: 'capture', name: 'redone' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 35, y: 8 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'carved' },
  ]);
  const cyberCopyHistoryRepair = {
    copiedCount: Object.keys(cyberCopyHistoryCaptures.copied.smartTerrain.semanticCells).length,
    undoneCount: Object.keys(cyberCopyHistoryCaptures.undone.smartTerrain.semanticCells).length,
    redoneCount: Object.keys(cyberCopyHistoryCaptures.redone.smartTerrain.semanticCells).length,
    carved: cyberCopyHistoryCaptures.carved,
  };
  assert.equal(cyberCopyHistoryRepair.copiedCount, cyberCopyHistoryRepair.undoneCount + 4);
  assert.equal(cyberCopyHistoryRepair.redoneCount, cyberCopyHistoryRepair.copiedCount);
  assert.equal(cyberCopyHistoryRepair.carved.smartTerrain.semanticCells['terrain:35,8'], undefined);
  assert.equal(cyberCopyHistoryRepair.carved.tileData.terrain[8][35], -1);
  assert.deepEqual(cyberCopyHistoryRepair.carved.tileData.foreground[7].slice(34, 37), [
    -1, -1, -1,
  ]);
  assertCyberLocalIndex(
    cyberCopyHistoryRepair.carved.tileData.terrain[7][34],
    [11, 33, 35],
    'Cyber tunnel upper-left uses matched concave Concrete art',
  );
  assert.equal(
    cyberCopyHistoryRepair.carved.tileData.terrain[7][35],
    1633 + 34 + FLIP_Y,
    'Cyber interior-window ceiling uses C11Y',
  );
  assertCyberLocalIndex(
    cyberCopyHistoryRepair.carved.tileData.terrain[7][36],
    [11, 33, 35],
    'Cyber tunnel upper-right uses matched concave Concrete art',
  );
  assert.deepEqual(cyberCopyHistoryRepair.carved.tileData.terrain[8].slice(34, 37), [
    1633 + 21, -1, 1633 + 23,
  ]);
  assertCyberLocalIndex(
    cyberCopyHistoryRepair.carved.tileData.terrain[9][34],
    [11, 33, 35],
    'Cyber tunnel lower-left uses matched concave Concrete art',
  );
  assert.equal(
    cyberCopyHistoryRepair.carved.tileData.terrain[9][35],
    1633 + 34,
    'Cyber interior-window floor uses C11',
  );
  assertCyberLocalIndex(
    cyberCopyHistoryRepair.carved.tileData.terrain[9][36],
    [11, 33, 35],
    'Cyber tunnel lower-right uses matched concave Concrete art',
  );
  assert.deepEqual(cyberCopyHistoryRepair.carved.tileData.foreground[9].slice(34, 37), [
    -1, -1, -1,
  ]);
  summary.checks.cyberCopyUndoEraseRepair = true;
  await runEditorCommands(page, [{ op: 'setCamera', zoom: 1, centerTileX: 35, centerTileY: 8 }]);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outputDir, 'cyber-ground-tunnel.png') });
  await runEditorCommands(page, [{ op: 'setCamera', zoom: 2, centerTileX: 21.5, centerTileY: 3 }]);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outputDir, 'cyber-ground-ties.png') });
  await runEditorCommands(page, [{ op: 'fitToScreen' }]);

  await page.locator('#smart-material-select').selectOption('cyber.concrete');
  await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(12, 9, 19, 15) },
    { op: 'commitBatch' },
  ]);
  await page.locator('#smart-material-select').selectOption('cyber.windows');
  const { cyberWindowBand } = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(12, 10, 19, 13) },
    { op: 'commitBatch' },
    { op: 'capture', name: 'cyberWindowBand' },
  ]);
  for (const y of [10, 11, 12, 13]) {
    assertCyberLocalIndex(
      cyberWindowBand.tileData.terrain[y][12],
      [37],
      `Cyber Window left end at row ${y}`,
    );
    assertCyberLocalIndex(
      cyberWindowBand.tileData.terrain[y][15],
      [38],
      `Cyber Window stacked pane at row ${y}`,
    );
    assertCyberLocalIndex(
      cyberWindowBand.tileData.terrain[y][19],
      [37],
      `Cyber Window right end at row ${y}`,
    );
  }
  summary.checks.cyberWindowBand = true;
  await runEditorCommands(page, [{ op: 'setCamera', zoom: 1.5, centerTileX: 15.5, centerTileY: 12 }]);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outputDir, 'cyber-window-band.png') });
  await runEditorCommands(page, [{ op: 'fitToScreen' }]);

  await page.locator('#smart-style-select').selectOption('cyber-pink');
  await page.locator('#smart-material-select').selectOption('cyber.concrete');
  const cyberPlatform = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: [{ x: 20, y: 18 }] },
    { op: 'capture', name: 'belowMinimum' },
    { op: 'placeCells', cells: rectangleCells(21, 18, 24, 18) },
    { op: 'commitBatch' },
    { op: 'capture', name: 'complete' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 22, y: 18 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'repaired' },
    { op: 'beginBatch' },
    { op: 'placeCells', cells: [{ x: 22, y: 18 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'restored' },
  ]);
  assert.equal(cyberPlatform.belowMinimum.tileData.terrain[18][20], 1717 + 20);
  assert.equal(
    cyberPlatform.belowMinimum.smartTerrain.semanticCells['terrain:20,18']?.brushId,
    'cyber.concrete',
  );
  assert.deepEqual(cyberPlatform.complete.tileData.terrain[18].slice(20, 25), [
    1717 + 71 + FLIP_X, 1717 + 68, 1717 + 68, 1717 + 68, 1717 + 71,
  ]);
  assert.deepEqual(cyberPlatform.repaired.tileData.terrain[18].slice(20, 25), [
    1717 + 71 + FLIP_X, 1717 + 71, -1, 1717 + 71 + FLIP_X, 1717 + 71,
  ]);
  assert.deepEqual(cyberPlatform.restored.tileData.terrain[18].slice(20, 25), [
    1717 + 71 + FLIP_X, 1717 + 68, 1717 + 68, 1717 + 68, 1717 + 71,
  ]);

  await page.locator('#smart-style-select').selectOption('cyber-yellow');
  await page.locator('#smart-material-select').selectOption('cyber.support');
  await page.locator('.layer-btn[data-layer="background"]').click();
  const cyberSupport = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(18, 4, 18, 7) },
    { op: 'commitBatch' },
    { op: 'capture', name: 'complete' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 18, y: 5 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'repaired' },
    { op: 'beginBatch' },
    { op: 'placeCells', cells: [{ x: 18, y: 5 }] },
    { op: 'commitBatch' },
    { op: 'beginBatch' },
    { op: 'stampShape', kind: 'rect', x1: 32, y1: 18, x2: 35, y2: 20, outline: false, erase: false },
    { op: 'commitBatch' },
    { op: 'capture', name: 'bank' },
  ]);
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

  await page.locator('#smart-material-select').selectOption('cyber.neon');
  await page.locator('.layer-btn[data-layer="terrain"]').click();
  const cyberNeon = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(20, 8, 24, 8) },
    { op: 'commitBatch' },
    { op: 'capture', name: 'complete' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 22, y: 8 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'repaired' },
    { op: 'beginBatch' },
    { op: 'placeCells', cells: [{ x: 22, y: 8 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'restored' },
  ]);
  assert.deepEqual(cyberNeon.complete.tileData.terrain[8].slice(20, 25), [
    1633 + 49, 1633 + 50, 1633 + 73, 1633 + 74, 1633 + 51,
  ]);
  assert.deepEqual(cyberNeon.repaired.tileData.terrain[8].slice(20, 25), [-1, -1, -1, -1, -1]);
  assert.deepEqual(cyberNeon.restored.tileData.terrain[8].slice(20, 25), [
    1633 + 49, 1633 + 50, 1633 + 73, 1633 + 74, 1633 + 51,
  ]);

  await page.locator('#smart-material-select').selectOption('cyber.rubble');
  const cyberRubble = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'stampShape', kind: 'rect', x1: 20, y1: 10, x2: 22, y2: 11, outline: false, erase: false },
    { op: 'commitBatch' },
    { op: 'capture', name: 'complete' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 21, y: 10 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'repaired' },
  ]);
  assert.deepEqual(cyberRubble.complete.tileData.terrain.slice(10, 12).map((row) => row.slice(20, 23)), [
    [1645, 1645, 1645], [1645, 1645, 1645],
  ]);
  assert.deepEqual(cyberRubble.complete.tileData.foreground[9].slice(20, 23), [
    1633, 1633, 1633,
  ]);
  assert.deepEqual(cyberRubble.complete.tileData.foreground.slice(10, 12).map((row) => (
    [row[19], row[23]]
  )), [
    [1633 + 1, 1633 + 13], [1633 + 1, 1633 + 13],
  ]);
  assert.deepEqual(cyberRubble.complete.tileData.foreground[12].slice(20, 23), [
    1633 + 24, 1633 + 24, 1633 + 24,
  ]);
  assert.deepEqual(cyberRubble.repaired.tileData.terrain.slice(10, 12).map((row) => row.slice(20, 23)), [
    [1645, -1, 1645], [1645, 1645, 1645],
  ]);
  assert.equal(cyberRubble.repaired.tileData.foreground[10][21], 1633 + 10 + FLIP_X);
  assert.equal(cyberRubble.repaired.tileData.background[10][21], 1633 + 1);
  summary.checks.cyberPathMinimumsAndRepair = true;
  await runEditorCommands(page, [{ op: 'setCamera', zoom: 1, centerTileX: 22, centerTileY: 13 }]);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outputDir, 'cyber-platform-rubble.png') });
  await runEditorCommands(page, [{ op: 'fitToScreen' }]);

  await page.locator('#smart-style-select').selectOption('cyber-pink');
  await page.locator('#smart-material-select').selectOption('cyber.fence');
  await page.locator('.layer-btn[data-layer="foreground"]').click();
  const cyberPanelClipboard = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(26, 3, 30, 3) },
    { op: 'commitBatch' },
    { op: 'copy', x1: 26, y1: 3, x2: 30, y2: 4 },
    { op: 'beginBatch' },
    { op: 'paste', x: 26, y: 12 },
    { op: 'commitBatch' },
    { op: 'capture', name: 'complete' },
    { op: 'copy', x1: 26, y1: 3, x2: 30, y2: 3 },
    { op: 'beginBatch' },
    { op: 'paste', x: 33, y: 12 },
    { op: 'commitBatch' },
    { op: 'capture', name: 'partial' },
  ]);
  const countFramedPanelRecipes = (snapshot) => Object.values(snapshot.smartTerrain.recipes)
    .filter(({ brushId }) => brushId === 'cyber.fence').length;
  assert.equal(countFramedPanelRecipes(cyberPanelClipboard.complete), 2);
  assert.equal(countFramedPanelRecipes(cyberPanelClipboard.partial), 2);
  assert.deepEqual(cyberPanelClipboard.complete.tileData.foreground[3].slice(26, 31), [
    1717 + 44, 1717 + 45, 1717 + 45, 1717 + 45, 1717 + 46,
  ]);
  assert.deepEqual(cyberPanelClipboard.complete.tileData.foreground[4].slice(26, 31), [
    1717 + 56, 1717 + 57, 1717 + 57, 1717 + 57, 1717 + 58,
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
  const { suppressed } = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 27, y: 3 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'suppressed' },
  ]);
  await page.locator('.palette-tab[data-mode="smart"]').click();
  await page.locator('#smart-theme-select').selectOption('cyber');
  await page.locator('#smart-style-select').selectOption('cyber-pink');
  await page.locator('#smart-material-select').selectOption('cyber.fence');
  const smartErasureAndReload = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 28, y: 4 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'smartErased' },
    { op: 'applyCapture', name: 'smartErased' },
    { op: 'capture', name: 'reloaded' },
  ]);
  const cyberSuppressionAndReload = { suppressed, ...smartErasureAndReload };
  assert.ok(cyberSuppressionAndReload.suppressed.smartTerrain.suppressedOutputParts.some(
    (entry) => entry.endsWith(':row-0:column-1'),
  ));
  assert.equal(countFramedPanelRecipes(cyberSuppressionAndReload.smartErased), 1);
  assert.deepEqual(cyberSuppressionAndReload.reloaded.smartTerrain, cyberSuppressionAndReload.smartErased.smartTerrain);
  assert.deepEqual(cyberSuppressionAndReload.reloaded.tileData, cyberSuppressionAndReload.smartErased.tileData);
  assertCyberLocalIndex(
    cyberSuppressionAndReload.reloaded.tileData.terrain[4][35],
    [64, 82, 83],
    'Cyber neutral Concrete survives save/reload with transforms',
  );
  summary.checks.cyberSuppressionAndReload = true;
  summary.checks.cyberOwnedLayers = true;
  await dismissKeepBuilding(page);
  await runEditorCommands(page, [{ op: 'fitToScreen' }]);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, 'cyber-recipes.png') });

  await page.locator('#smart-theme-select').selectOption('forest');
  await page.locator('.layer-btn[data-layer="terrain"]').click();
  assert.equal(await page.locator('#smart-material-select').inputValue(), 'forest.ground');
  assert.equal(await page.locator('#smart-style-row').isVisible(), false);

  await page.locator('#btn-editor-top-tool-more').click();
  const ellipseButton = page.locator('#editor-top-more-tools-panel [data-tool="ellipse"]');
  await ellipseButton.click();
  assert.equal(await ellipseButton.getAttribute('class').then((value) => value?.includes('active')), true);
  const { smartEllipse } = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'stampShape', kind: 'ellipse', x1: 22, y1: 14, x2: 28, y2: 20, outline: false, erase: false },
    { op: 'commitBatch' },
    { op: 'capture', name: 'smartEllipse' },
  ]);
  assert.ok(smartEllipse.smartTerrain.cells['25,17']);
  assert.equal(smartEllipse.smartTerrain.cells['22,14'], undefined);
  assert.ok(smartEllipse.tileData.terrain[17][25] > 0);

  const shapeKeepBuilding = page.locator('#btn-guest-builder-claim-continue');
  if (await shapeKeepBuilding.isVisible()) await shapeKeepBuilding.click();
  await ellipseButton.click();
  assert.equal(
    await ellipseButton.locator('[data-part="filled"]').getAttribute('class')
      .then((value) => value?.includes('is-dim')),
    true,
  );
  assert.equal(
    await ellipseButton.locator('[data-part="outlined"]').getAttribute('class')
      .then((value) => value?.includes('is-dim')),
    false,
  );
  const { smartOutlines } = await runEditorCommands(page, [
    { op: 'clearCurrentLayer' },
    { op: 'beginBatch' },
    { op: 'stampShape', kind: 'rect', x1: 4, y1: 12, x2: 12, y2: 20, outline: true, erase: false },
    { op: 'stampShape', kind: 'ellipse', x1: 20, y1: 10, x2: 30, y2: 20, outline: true, erase: false },
    { op: 'commitBatch' },
    { op: 'capture', name: 'smartOutlines' },
  ]);
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
  await runEditorCommands(page, [{ op: 'fitToScreen' }]);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, 'smart-outlines.png') });

  await page.screenshot({ path: path.join(outputDir, 'smart-editor.png') });

  await runEditorCommands(page, [{ op: 'clearCurrentLayer' }]);
  await page.evaluate(() => {
    const theme = document.querySelector('#smart-theme-select');
    const material = document.querySelector('#smart-material-select');
    theme.value = 'forest';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    material.value = 'forest.ground';
    material.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.layer-btn[data-layer="terrain"]').click();
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
  const groundCells = [
    ...rectangleCells(4, 4, 4, 10),
    ...rectangleCells(1, 14, 38, 14),
    ...rectangleCells(10, 3, 18, 9),
    ...ordinarySteps.flatMap(([y, startX, endX]) => rectangleCells(startX, y, endX, y)),
  ];
  const { groundFixtures } = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: groundCells },
    { op: 'commitBatch' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 12, y: 5 }, { x: 16, y: 6 }, { x: 17, y: 6 }, { x: 17, y: 7 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'groundFixtures' },
  ]);
  const verticalThin = groundFixtures.tileData.terrain.slice(4, 11).map((row) => row[4]);
  const horizontalThinLocals = groundFixtures.tileData.terrain[14]
    .slice(2, 38)
    .map((gid) => gid - 1);
  assert.equal(verticalThin[0], 20);
  assert.ok(verticalThin.slice(1, -1).every((gid) => gid === 32 || gid === 44));
  assert.equal(verticalThin.at(-1), 56);
  assert.ok(horizontalThinLocals.length > 0);
  assert.ok(horizontalThinLocals.every((local) => [20, 44, 45, 46].includes(local)));
  assert.ok(!horizontalThinLocals.includes(47));
  assert.equal(groundFixtures.tileData.terrain[7][16], (1 << 21) + 55);
  assert.equal(groundFixtures.tileData.terrain[4][34], 30);
  assert.equal(groundFixtures.tileData.terrain[7][34], (1 << 21) + 34);
  summary.checks.verticalAndCaveTopology = true;
  summary.checks.correctedHorizontalTiles = true;
  summary.checks.ordinaryGroundTies = true;

  await page.evaluate(() => {
    const theme = document.querySelector('#smart-theme-select');
    theme.value = 'desert';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    const background = document.querySelector('#background-select');
    background.value = 'none';
    background.dispatchEvent(new Event('change', { bubbles: true }));
    const lighting = document.querySelector('#lighting-mode-select');
    lighting.value = 'off';
    lighting.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const { desertEdgeCaseFixture } = await runEditorCommands(page, [
    { op: 'clearCurrentLayer' },
    { op: 'beginBatch' },
    { op: 'placeCells', cells: [
      [3, 4], [4, 4], [5, 4],
      [3, 5], [4, 5], [5, 5],
      [3, 6], [4, 6], [5, 6],
      [6, 12], [7, 12], [8, 12],
      [6, 13], [7, 13], [8, 13],
      [6, 14], [7, 14], [8, 14],
    ].map(([x, y]) => ({ x, y })) },
    { op: 'commitBatch' },
    ...[6, 7, 8, 9, 10, 11, 12].flatMap((x) => [
      { op: 'beginBatch' },
      { op: 'placeCells', cells: [{ x, y: 5 }] },
      { op: 'commitBatch' },
    ]),
    ...[5, 4, 3, 2].flatMap((x) => [
      { op: 'beginBatch' },
      { op: 'placeCells', cells: [{ x, y: 13 }] },
      { op: 'commitBatch' },
    ]),
    { op: 'capture', name: 'desertEdgeCaseFixture' },
  ]);
  assert.equal(desertEdgeCaseFixture.tileData.terrain[5][6], 2101);
  assert.equal(desertEdgeCaseFixture.tileData.terrain[5][7], 117);
  for (let x = 8; x < 12; x += 1) {
    assert.equal(desertEdgeCaseFixture.tileData.terrain[5][x], 118);
  }
  assert.equal(desertEdgeCaseFixture.tileData.terrain[5][12], 119);
  assert.deepEqual(
    desertEdgeCaseFixture.tileData.foreground[5].slice(5, 13),
    [2076, -1, -1, -1, -1, -1, -1, -1],
  );
  assert.equal(desertEdgeCaseFixture.tileData.terrain[13][2], 117);
  assert.equal(desertEdgeCaseFixture.tileData.terrain[13][3], 118);
  assert.equal(desertEdgeCaseFixture.tileData.terrain[13][4], 119);
  assert.equal(desertEdgeCaseFixture.tileData.terrain[13][5], 2102);
  assert.deepEqual(
    desertEdgeCaseFixture.tileData.foreground[13].slice(2, 7),
    [-1, -1, -1, -1, 2075],
  );
  assert.equal(await page.locator(
    '#tileset-select option[value="autotile-edge-cases-desert"]',
  ).count(), 0);
  assert.equal(await page.locator(
    '#tileset-select option[value="autotile-artist-extras"]',
  ).count(), 0);
  const edgeCaseAtlasRuntime = await page.evaluate(() => {
    const textures = window.__EVERYBODYS_PLATFORMER_GAME__?.textures;
    const seamSource = textures?.get('autotile-edge-cases-desert')?.getSourceImage();
    const artistSource = textures?.get('autotile-artist-extras')?.getSourceImage();
    return {
      seam: [seamSource?.width, seamSource?.height],
      artist: [artistSource?.width, artistSource?.height],
    };
  });
  assert.deepEqual(edgeCaseAtlasRuntime.seam, [64, 16]);
  assert.deepEqual(edgeCaseAtlasRuntime.artist, [192, 96]);
  assert.match(
    requestedUrls.find((requestUrl) => requestUrl.includes('autotile-edge-cases-desert.png')),
    /autotile-edge-cases-desert\.png\?v=2026-08-25-authored-ledges-1$/,
  );
  assert.match(
    requestedUrls.find((requestUrl) => requestUrl.includes('rr_extras.png')),
    /rr_extras\.png\?v=2026-08-29-artist-ledges-v2$/,
  );
  summary.checks.desertCompositeEdgeCases = true;
  summary.checks.sequentialDesertCompositeEdges = true;
  summary.checks.artistDirectionalTransition = true;
  summary.checks.artistPlatformContinuation = true;
  summary.checks.hiddenEdgeCaseAtlas = true;
  summary.checks.versionedEdgeCaseAtlas = true;
  await page.evaluate(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene;
    scene.cameras.main.setZoom(4);
    scene.cameras.main.centerOn(7.5 * 16, 5 * 16);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, 'desert-edge-case-right.png') });
  await page.evaluate(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene;
    scene.cameras.main.centerOn(4.5 * 16, 13 * 16);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, 'desert-edge-case-left.png') });
  await runEditorCommands(page, [{ op: 'fitToScreen' }]);
  for (const fixture of [
    { theme: 'cave', transitionGid: 2077, startGid: 189, middleGid: 190, capGid: 191 },
    { theme: 'forest', transitionGid: 2089, startGid: 45, middleGid: 46, capGid: 47 },
  ]) {
    await page.evaluate((theme) => {
      const select = document.querySelector('#smart-theme-select');
      select.value = theme;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, fixture.theme);
    const { artistLedgeFixture } = await runEditorCommands(page, [
      { op: 'clearCurrentLayer' },
      { op: 'beginBatch' },
      { op: 'placeCells', cells: [
        [3, 4], [4, 4], [5, 4],
        [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5],
        [3, 6], [4, 6], [5, 6],
      ].map(([x, y]) => ({ x, y })) },
      { op: 'commitBatch' },
      { op: 'capture', name: 'artistLedgeFixture' },
      { op: 'setCamera', zoom: 4, centerTileX: 7, centerTileY: 5 },
    ]);
    assert.equal(artistLedgeFixture.tileData.terrain[5][6], fixture.transitionGid);
    assert.equal(artistLedgeFixture.tileData.terrain[5][7], fixture.startGid);
    assert.equal(artistLedgeFixture.tileData.terrain[5][8], fixture.middleGid);
    assert.equal(artistLedgeFixture.tileData.terrain[5][9], fixture.capGid);
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(outputDir, `${fixture.theme}-artist-ledge-right.png`),
    });
  }
  summary.checks.caveArtistLedge = true;
  summary.checks.forestArtistLedge = true;
  await runEditorCommands(page, [{ op: 'fitToScreen' }]);
  await page.evaluate(() => {
    const theme = document.querySelector('#smart-theme-select');
    theme.value = 'gothic';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const { gothicTunnelFloor } = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(5, 5, 9, 9) },
    { op: 'commitBatch' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 7, y: 7 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'gothicTunnelFloor' },
  ]);
  assert.equal(await page.locator('#smart-material-select').inputValue(), 'gothic.ground');
  assert.equal(gothicTunnelFloor.tileData.terrain[8][7], (1 << 21) + 783);
  summary.checks.gothicTunnelFloor = true;
  await runEditorCommands(page, [{ op: 'setCamera', zoom: 3, centerTileX: 7.5, centerTileY: 7.5 }]);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, 'gothic-tunnel-floor.png') });
  await runEditorCommands(page, [{ op: 'fitToScreen' }]);

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
  await page.locator('.layer-btn[data-layer="background"]').click();
  assert.equal(await page.locator('#smart-theme-select').inputValue(), 'water');
  assert.equal(await page.locator('#smart-theme-select').isDisabled(), true);
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'background');
  const { tunnelFixture } = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: rectangleCells(20, 3, 28, 11) },
    { op: 'commitBatch' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: rectangleCells(23, 6, 25, 8) },
    { op: 'commitBatch' },
    { op: 'capture', name: 'tunnelFixture' },
  ]);
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
  await page.locator('.layer-btn[data-layer="terrain"]').click();
  assert.equal(await page.locator('#smart-theme-select').inputValue(), 'forest');
  assert.equal(await page.locator('#smart-theme-select').isEnabled(), true);
  assert.equal(await page.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'terrain');
  const featureFixture = await runEditorCommands(page, [
    { op: 'beginBatch' },
    { op: 'placeCells', cells: [{ x: 25, y: 5 }, { x: 24, y: 6 }, { x: 25, y: 7 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'before' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 25, y: 6 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'erased' },
    { op: 'beginBatch' },
    { op: 'eraseCells', cells: [{ x: 25, y: 6 }] },
    { op: 'placeCells', cells: [{ x: 24, y: 6 }] },
    { op: 'commitBatch' },
    { op: 'capture', name: 'restored' },
    { op: 'beginBatch' },
    { op: 'placeCells', cells: [
      [11, 14], [12, 14], [13, 14], [14, 14], [15, 14],
      [11, 15], [15, 15],
      [11, 16], [12, 16], [13, 16], [14, 16], [15, 16],
      [30, 14], [31, 14], [32, 14],
      [30, 15], [32, 15],
      [30, 16], [31, 16], [32, 16],
    ].map(([x, y]) => ({ x, y })) },
    { op: 'commitBatch' },
    { op: 'capture', name: 'gaps' },
  ]);
  assert.ok(featureFixture.before.smartTerrain.generatedDecorations['25,6']);
  assert.ok(featureFixture.before.smartTerrain.generatedBackgroundDecorations['25,6']);
  assert.equal(featureFixture.erased.tileData.terrain[6][25], -1);
  assert.notEqual(featureFixture.erased.tileData.background[6][25], -1);
  assert.ok(featureFixture.restored.smartTerrain.generatedDecorations['25,6']);
  assert.ok(featureFixture.restored.smartTerrain.generatedBackgroundDecorations['25,6']);
  assert.deepEqual(featureFixture.gaps.tileData.terrain[15].slice(12, 15), [23, 1, 11]);
  assert.deepEqual(featureFixture.gaps.tileData.background[15].slice(12, 15), [1, 25, 25]);
  assert.equal(featureFixture.gaps.tileData.terrain[15][31], 11);
  assert.equal(featureFixture.gaps.tileData.background[15][31], 23);
  summary.checks.featureCornersAndErase = true;
  summary.checks.featureGapPairs = true;
  const keepBuilding = page.locator('#btn-guest-builder-claim-continue');
  if (await keepBuilding.isVisible()) await keepBuilding.click();
  await page.evaluate(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__?.scene.keys.EditorScene;
    scene.cameras.main.setZoom(2.5);
    scene.cameras.main.centerOn(21.5 * 16, 15 * 16);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, 'topology-fixtures.png') });

  const decorationPools = {
    forest: { firstGid: 1, expected: [2, 3, 4, 5, 56, 58, 59] },
    desert: { firstGid: 73, expected: [2, 3, 4, 5, 7, 8] },
    cave: { firstGid: 145, expected: [3, 4, 5, 6, 57, 61] },
    gothic: { firstGid: 733, expected: [2, 3, 4, 5] },
  };
  for (const [themeName, pool] of Object.entries(decorationPools)) {
    await page.locator('.layer-btn[data-layer="terrain"]').click();
    await runEditorCommands(page, [{ op: 'clearCurrentLayer' }]);
    await page.evaluate(({ theme }) => {
      const material = document.querySelector('#smart-material-select');
      const themeSelect = document.querySelector('#smart-theme-select');
      themeSelect.value = theme;
      themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      material.value = `${theme}.ground`;
      material.dispatchEvent(new Event('change', { bubbles: true }));
    }, { theme: themeName });
    const decorationCells = [2, 5, 8, 11, 14, 17, 20]
      .flatMap((y) => rectangleCells(0, y, 39, y));
    const { decorationFixture } = await runEditorCommands(page, [
      { op: 'beginBatch' },
      { op: 'placeCells', cells: decorationCells },
      { op: 'commitBatch' },
      { op: 'capture', name: 'decorationFixture' },
    ]);
    const variants = new Set(Object.values(decorationFixture.smartTerrain.generatedDecorations)
      .map(({ gid }) => gid - pool.firstGid));
    assert.deepEqual([...variants].sort((a, b) => a - b), pool.expected);
    if (themeName === 'desert') {
      const decorations = Object.fromEntries(Object.entries(
        decorationFixture.smartTerrain.generatedDecorations,
      ).map(([key, { gid }]) => [key, gid - pool.firstGid]));
      for (const [key, local] of Object.entries(decorations)) {
        const [x, y] = key.split(',').map(Number);
        if (local === 7) assert.equal(decorations[`${x + 1},${y}`], 8);
        if (local === 8) assert.equal(decorations[`${x - 1},${y}`], 7);
      }
      summary.checks.desertDecorationPairs = true;
    }
    if (themeName === 'forest') {
      const decorationEntry = Object.entries(
        decorationFixture.smartTerrain.generatedDecorations,
      )[0];
      assert.ok(decorationEntry);
      const [targetKey, decoration] = decorationEntry;
      assert.equal(decoration.layer, 'terrain');
      const [ownerX, ownerY] = decoration.ownerKey.split(',').map(Number);
      const [targetX, targetY] = targetKey.split(',').map(Number);
      const oldDecorationValue = decorationFixture.tileData.terrain[targetY][targetX];
      await page.locator('#smart-theme-select').selectOption('cyber');
      await page.locator('#smart-style-select').selectOption('cyber-yellow');
  await page.locator('#smart-material-select').selectOption('cyber.concrete');
  await page.locator('.layer-btn[data-layer="terrain"]').click();
      const decorationOverwriteCaptures = await runEditorCommands(page, [
        { op: 'beginBatch' },
        { op: 'placeCells', cells: [{ x: ownerX, y: ownerY }] },
        { op: 'commitBatch' },
        { op: 'capture', name: 'decorationOverwrite' },
        { op: 'undo' },
        { op: 'capture', name: 'decorationOverwriteUndone' },
        { op: 'redo' },
        { op: 'capture', name: 'decorationOverwriteRedone' },
      ]);
      const { decorationOverwrite, decorationOverwriteUndone, decorationOverwriteRedone } = (
        decorationOverwriteCaptures
      );
      assert.equal(decorationOverwrite.smartTerrain.cells[decoration.ownerKey], undefined);
      assert.equal(Object.values(decorationOverwrite.smartTerrain.generatedDecorations).some(
        (candidate) => candidate.ownerKey === decoration.ownerKey,
      ), false);
      assert.notEqual(decorationOverwrite.tileData.terrain[targetY][targetX], oldDecorationValue);
      assert.equal(Object.values(decorationOverwrite.smartTerrain.ownedOutputs).some(
        (output) => output.ownerId === `legacy-cell:${decoration.ownerKey}`,
      ), false);
      assert.equal(
        decorationOverwriteUndone.tileData.terrain[targetY][targetX],
        oldDecorationValue,
      );
      assert.equal(Object.values(decorationOverwriteUndone.smartTerrain.generatedDecorations).some(
        (candidate) => candidate.ownerKey === decoration.ownerKey,
      ), true);
      assert.deepEqual(decorationOverwriteRedone.tileData, decorationOverwrite.tileData);
      assert.deepEqual(decorationOverwriteRedone.smartTerrain, decorationOverwrite.smartTerrain);
      summary.checks.crossBrushDecorationCleanup = true;
      await dismissKeepBuilding(page);
      await runEditorCommands(page, [{
        op: 'setCamera', zoom: 3, centerTileX: ownerX, centerTileY: ownerY - 0.5,
      }]);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(outputDir, 'decoration-overwrite.png') });
    }
    const decorationKeepBuilding = page.locator('#btn-guest-builder-claim-continue');
    if (await decorationKeepBuilding.isVisible()) await decorationKeepBuilding.click();
    await runEditorCommands(page, [{ op: 'fitToScreen' }]);
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
  captureBrowserErrors(coursePage, summary);
  await guardSyntheticRoomMutations(coursePage, summary);
  await coursePage.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await coursePage.waitForFunction(() => typeof window.run_preview_smoke_action === 'function');
  await coursePage.waitForFunction(() => document.body.dataset.appReady === 'true');
  assert.equal(
    await coursePage.evaluate(() => window.capture_debug_info?.().renderer.active),
    expectedRenderer,
  );
  const courseOpened = await coursePage.evaluate(() => (
    window.run_preview_smoke_action?.('openSyntheticCourseEditor')
  ));
  assert.equal(courseOpened?.ok, true);
  await coursePage.waitForFunction(() => document.body.dataset.editorCourseMode === 'true');
  await coursePage.locator('#smart-theme-select').selectOption('cyber');
  await coursePage.locator('#smart-style-select').selectOption('cyber-pink');
  await coursePage.locator('#smart-material-select').selectOption('cyber.support');
  assert.equal(await coursePage.locator('#editor-layer-chip').getAttribute('data-layer-tone'), 'terrain');
  await assertEditorState(coursePage, {
    theme: 'cyber',
    brush: 'cyber.support',
    style: 'cyber-pink',
    layer: 'terrain',
  });
  assert.equal(await coursePage.locator('[data-tool="ellipse"]').first().isEnabled(), true);
  assert.equal(await coursePage.locator('[data-tool="fill"]').first().isEnabled(), true);
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
  captureBrowserErrors(welcomePage, summary);
  await guardSyntheticRoomMutations(welcomePage, summary);
  const welcomeUrl = new URL(url);
  welcomeUrl.searchParams.set('welcome', '1');
  await welcomePage.goto(welcomeUrl.toString(), { waitUntil: 'domcontentloaded' });
  await welcomePage.waitForFunction(() => document.body.dataset.appReady === 'true', undefined, { timeout: 60_000 });
  await welcomePage.locator('#welcome-modal:not(.hidden)').waitFor({ timeout: 10_000 });
  await welcomePage.locator('#btn-welcome-build').click();
  await welcomePage.locator('#welcome-builder-choice:not(.hidden)').waitFor();
  assert.equal(await welcomePage.locator('#welcome-builder-choice').isVisible(), true);
  await welcomePage.screenshot({ path: path.join(outputDir, 'builder-choice.png') });
  await welcomeContext.close();
  summary.checks.firstBuildChoice = true;

  assert.deepEqual(summary.mutatingRoomRequests, []);
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
