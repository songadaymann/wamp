import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_URL = 'http://127.0.0.1:3000/?previewSmoke=1&perf=1&mobilePerfHud=0&worldTiles=force';
const DEFAULT_ZOOMS = [0.08, 0.10, 0.17, 0.18, 0.20, 0.40, 0.80];
const LOD_PROMOTION_THRESHOLDS = [0.108, 0.216, 0.432, 0.864];
const LOD_DEMOTION_THRESHOLDS = [Number.NEGATIVE_INFINITY, 0.092, 0.184, 0.368, 0.736];

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    out: 'output/overworld-tile-pyramid/probe',
    headless: true,
    timeoutMs: 20_000,
    zooms: DEFAULT_ZOOMS,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--url' && value) {
      args.url = value;
      index += 1;
    } else if (key === '--out' && value) {
      args.out = value;
      index += 1;
    } else if (key === '--timeout-ms' && value) {
      args.timeoutMs = Number(value);
      index += 1;
    } else if (key === '--zooms' && value) {
      args.zooms = value.split(',').map(Number).filter(Number.isFinite);
      index += 1;
    } else if (key === '--headless' && value) {
      args.headless = value !== '0' && value !== 'false';
      index += 1;
    }
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1_000) {
    throw new Error('--timeout-ms must be at least 1000.');
  }
  if (args.zooms.length === 0 || args.zooms.some((zoom) => zoom <= 0)) {
    throw new Error('--zooms must contain positive comma-separated numbers.');
  }
  return args;
}

async function readState(page) {
  const raw = await page.evaluate(() => window.render_game_to_text?.() ?? '{}');
  return JSON.parse(raw);
}

function tileMetricsFromState(state) {
  const scene = state?.activeScene ?? null;
  return scene?.lodMetrics?.worldTiles ?? scene?.worldTiles ?? null;
}

function summarizeState(state) {
  const scene = state?.activeScene ?? {};
  const metrics = tileMetricsFromState(state);
  const lod = scene.lodMetrics ?? {};
  const previewBuildSegment = scene.mobilePerformance?.topSegments?.find(
    (segment) => segment.label === 'stream.buildChunkPreviewTexture',
  ) ?? null;
  return {
    zoom: scene.zoom ?? null,
    camera: scene.camera?.worldView ?? null,
    mode: scene.mode ?? null,
    targetLevel: metrics?.targetLevel ?? null,
    committedLevel: metrics?.committedLevel ?? null,
    visibleCount: metrics?.visibleCount ?? null,
    readyCount: metrics?.readyCount ?? null,
    targetReadyCount: metrics?.targetReadyCount ?? null,
    staleCount: metrics?.staleCount ?? null,
    coveragePercentage: metrics?.coveragePercentage ?? null,
    targetCoveragePercentage: metrics?.targetCoveragePercentage ?? null,
    queueDepths: metrics?.queueDepths ?? null,
    replacementGapFrames: metrics?.replacementGapFrames ?? null,
    fallbackReason: metrics?.fallbackReason ?? null,
    rollout: metrics ? {
      enabled: metrics.enabled ?? false,
      cutoverActive: metrics.cutoverActive ?? false,
      shadow: metrics.shadow ?? false,
      forced: metrics.forced ?? false,
      rendererVersion: metrics.rendererVersion ?? null,
      cohortBucket: metrics.cohortBucket ?? null,
    } : null,
    byteCache: metrics ? {
      hits: metrics.byteCacheHits ?? 0,
      misses: metrics.byteCacheMisses ?? 0,
      evictions: metrics.byteCacheEvictions ?? 0,
    } : null,
    textureCache: metrics ? {
      attachedTileCount: metrics.attachedTileCount ?? 0,
      contextRestorePending: metrics.contextRestorePending ?? false,
    } : null,
    legacyPreviews: {
      loadedRoomCount: lod.loadedPreviewRoomCount ?? 0,
      loadedChunkCount: lod.loadedPreviewChunkCount ?? 0,
      pendingTextureBuildCount: lod.pendingPreviewTextureBuildCount ?? 0,
      buildSegment: previewBuildSegment,
    },
  };
}

function selectExpectedWorldTileLevel(zoom, currentLevel) {
  let nextLevel = currentLevel;
  while (nextLevel < 4 && zoom >= LOD_PROMOTION_THRESHOLDS[nextLevel]) {
    nextLevel += 1;
  }
  while (nextLevel > 0 && zoom <= LOD_DEMOTION_THRESHOLDS[nextLevel]) {
    nextLevel -= 1;
  }
  return nextLevel;
}

function isCompleteCoverage(metrics) {
  return metrics
    && metrics.visibleCount > 0
    && metrics.coveragePercentage === 100
    && metrics.fallbackReason === null;
}

function isSharpReady(metrics) {
  const targetReadyCount = metrics?.targetReadyCount ?? metrics?.readyCount ?? 0;
  const targetCoveragePercentage = metrics?.targetCoveragePercentage
    ?? (metrics?.visibleCount > 0 ? targetReadyCount / metrics.visibleCount * 100 : 0);
  return isCompleteCoverage(metrics)
    && targetReadyCount === metrics.visibleCount
    && targetCoveragePercentage === 100
    && metrics.staleCount === 0
    && metrics.committedLevel === metrics.targetLevel
    && Number(metrics.queueDepths?.replacementGroups ?? 0) === 0;
}

async function waitForOverworld(page, timeoutMs) {
  await page.waitForFunction(() => {
    try {
      const payload = JSON.parse(window.render_game_to_text?.() ?? '{}');
      return payload?.activeScene?.scene === 'overworld-play' && payload?.appFeedback?.ready === true;
    } catch {
      return false;
    }
  }, null, { timeout: timeoutMs });
}

async function dismissWelcomeModal(page) {
  const closeButton = page.locator('#btn-welcome-close');
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Welcome close control is not a button');
      }
      button.click();
    });
    await page.waitForTimeout(50);
  }
}

async function waitForTileState(page, predicate, timeoutMs) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const state = await readState(page);
    const metrics = tileMetricsFromState(state);
    if (predicate(metrics)) {
      return {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        state: summarizeState(state),
      };
    }
    await page.waitForTimeout(25);
  }
  const state = await readState(page);
  throw new Error(`Timed out waiting for tile coverage: ${JSON.stringify(summarizeState(state))}`);
}

async function getCanvasBox(page) {
  const box = await page.evaluate(() => {
    let best = null;
    let bestArea = 0;
    for (const canvas of document.querySelectorAll('canvas')) {
      const rect = canvas.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return best;
  });
  if (!box) throw new Error('No visible game canvas was found.');
  return box;
}

async function dispatchWheel(page, deltaY) {
  const box = await getCanvasBox(page);
  await page.evaluate(({ x, y, delta }) => {
    let canvas = null;
    let largest = 0;
    for (const candidate of document.querySelectorAll('canvas')) {
      const rect = candidate.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > largest) {
        largest = area;
        canvas = candidate;
      }
    }
    if (!canvas) throw new Error('Game canvas is unavailable.');
    canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: x,
      clientY: y,
      deltaY: delta,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      bubbles: true,
      cancelable: true,
    }));
  }, {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    delta: deltaY,
  });
}

async function approachZoom(page, targetZoom) {
  const startedAt = performance.now();
  const samples = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const before = summarizeState(await readState(page));
    const zoom = Number(before.zoom);
    samples.push(before);
    if (Number.isFinite(zoom) && Math.abs(zoom - targetZoom) <= 0.006) break;
    const deltaY = zoom > targetZoom ? 45 : -45;
    await dispatchWheel(page, deltaY);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(100);
  return {
    samples,
    gestureMs: Math.round((performance.now() - startedAt) * 10) / 10,
    finalState: summarizeState(await readState(page)),
  };
}

async function panViewport(page) {
  const box = await getCanvasBox(page);
  const startX = Math.round(box.x + box.width * 0.68);
  const startY = Math.round(box.y + box.height * 0.52);
  const endX = Math.round(box.x + box.width * 0.28);
  const endY = Math.round(box.y + box.height * 0.42);
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(endX, endY, { steps: 24 });
  await page.mouse.up({ button: 'middle' });
}

function cameraMoved(before, after) {
  const beforeView = before?.camera;
  const afterView = after?.camera;
  if (!beforeView || !afterView) return false;
  return beforeView.x !== afterView.x || beforeView.y !== afterView.y;
}

function isTrackedNetworkUrl(url) {
  return url.includes('/api/world/tiles/')
    || /\/world-tiles\/.*\.png(?:\?|$)/.test(url)
    || url.includes('/api/rooms/snapshots/query')
    || url.includes('/api/world/chunks');
}

function isWorldTileImageUrl(url) {
  return /\/world-tiles\/.*\.png(?:\?|$)/.test(url);
}

function getManifestLevel(url) {
  if (!url.includes('/api/world/tiles/manifest')) return null;
  try {
    const value = Number(new URL(url).searchParams.get('level'));
    return Number.isSafeInteger(value) && value >= 0 && value <= 4 ? value : 'invalid';
  } catch {
    return 'invalid';
  }
}

function parseSnapshotQuery(postData) {
  if (!postData) return null;
  try {
    const body = JSON.parse(postData);
    const references = Array.isArray(body?.references) ? body.references : [];
    const referenceKinds = references.map((reference) => (
      typeof reference?.kind === 'string' ? reference.kind : 'invalid'
    ));
    const referenceClasses = references.map((reference) => {
      const kind = typeof reference?.kind === 'string' ? reference.kind : 'invalid';
      if (kind !== 'current_preview') return kind;
      const state = typeof reference?.state === 'string' ? reference.state : 'unspecified';
      return `${kind}:${state}`;
    });
    return {
      detail: typeof body?.detail === 'string' ? body.detail : null,
      referenceCount: references.length,
      referenceKinds,
      referenceClasses,
    };
  } catch {
    return { detail: null, referenceCount: 0, referenceKinds: ['invalid-json'], referenceClasses: [] };
  }
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function summarizeTrackedNetwork(requests) {
  const tileRequests = requests.filter((entry) => isWorldTileImageUrl(entry.url));
  const manifestRequests = requests.filter((entry) => entry.manifestLevel !== null);
  const snapshotQueries = requests.filter((entry) => entry.snapshotQuery !== null);
  const snapshotReferenceKinds = snapshotQueries.flatMap(
    (entry) => entry.snapshotQuery.referenceKinds,
  );
  const snapshotReferenceClasses = snapshotQueries.flatMap(
    (entry) => entry.snapshotQuery.referenceClasses,
  );
  return {
    requestCount: requests.length,
    tileRequestCount: tileRequests.length,
    tileResponseCount: tileRequests.filter((entry) => entry.status !== null).length,
    tileRequestBytes: tileRequests.reduce((sum, entry) => sum + entry.contentLength, 0),
    manifestRequestCount: manifestRequests.length,
    manifestLevels: manifestRequests.map((entry) => entry.manifestLevel),
    manifestLevelCounts: countValues(manifestRequests.map((entry) => String(entry.manifestLevel))),
    snapshotQueryCount: snapshotQueries.length,
    snapshotReferenceKindCounts: countValues(snapshotReferenceKinds),
    snapshotReferenceClassCounts: countValues(snapshotReferenceClasses),
    snapshotReferenceCount: snapshotQueries.reduce(
      (sum, entry) => sum + entry.snapshotQuery.referenceCount,
      0,
    ),
    compactWorldSummaryRequestCount: requests.filter((entry) => (
      entry.url.includes('/api/world/chunks/summary')
    )).length,
    legacyWorldChunkRequestCount: requests.filter((entry) => (
      entry.url.includes('/api/world/chunks') && !entry.url.includes('/api/world/chunks/summary')
    )).length,
    announcedBytes: requests.reduce((sum, entry) => sum + entry.contentLength, 0),
    immutableCacheHits: requests.filter((entry) => entry.cacheStatus === 'HIT').length,
  };
}

function assertSerializedL0Bootstrap(requests) {
  const manifests = requests
    .filter((entry) => entry.manifestLevel !== null)
    .sort((left, right) => left.startedAtMs - right.startedAtMs);
  const l0Manifests = manifests.filter((entry) => entry.manifestLevel === 0);
  if (manifests[0]?.manifestLevel !== 0 || l0Manifests.length !== 1) {
    throw new Error(`Tile bootstrap must begin with exactly one L0 manifest: ${manifests.map((entry) => (
      `${entry.manifestLevel}@${entry.startedAtMs}ms`
    )).join(', ') || 'none'}`);
  }

  const firstRefinement = manifests.find((entry) => entry.manifestLevel !== 0) ?? null;
  if (!firstRefinement) return;
  const l0Manifest = l0Manifests[0];
  const l0TileRequests = requests.filter((entry) => (
    isWorldTileImageUrl(entry.url)
    && entry.startedAtMs >= l0Manifest.startedAtMs
    && entry.startedAtMs < firstRefinement.startedAtMs
  ));
  const unfinishedL0Network = l0Manifest.responseAtMs === null
    || l0Manifest.responseAtMs > firstRefinement.startedAtMs
    || l0TileRequests.some((entry) => (
      entry.responseAtMs === null || entry.responseAtMs > firstRefinement.startedAtMs
    ));
  if (unfinishedL0Network) {
    throw new Error(`Target-LOD refinement started before L0 network completion: ${JSON.stringify({
      l0ManifestResponseAtMs: l0Manifest.responseAtMs,
      l0TileResponsesAtMs: l0TileRequests.map((entry) => entry.responseAtMs),
      refinementLevel: firstRefinement.manifestLevel,
      refinementStartedAtMs: firstRefinement.startedAtMs,
    })}`);
  }
}

function attachNetworkRecorder(page, startedAt) {
  const requests = [];
  const requestEntries = new WeakMap();
  const elapsedMs = () => Math.round((performance.now() - startedAt) * 10) / 10;
  const recordRequest = (request) => {
    const url = request.url();
    if (!isTrackedNetworkUrl(url)) return null;
    const postData = url.includes('/api/rooms/snapshots/query') ? request.postData() : null;
    const entry = {
      url,
      method: request.method(),
      postData,
      snapshotQuery: parseSnapshotQuery(postData),
      manifestLevel: getManifestLevel(url),
      resourceType: request.resourceType(),
      startedAtMs: elapsedMs(),
      responseAtMs: null,
      failedAtMs: null,
      failure: null,
      status: null,
      contentLength: 0,
      cacheStatus: null,
      wampCache: null,
      serverTiming: null,
    };
    requestEntries.set(request, entry);
    requests.push(entry);
    return entry;
  };
  const findPendingRequestEntry = (request) => (
    requestEntries.get(request)
    ?? requests.find((entry) => (
      entry.url === request.url()
      && entry.method === request.method()
      && entry.responseAtMs === null
      && entry.failedAtMs === null
    ))
    ?? null
  );
  page.on('request', recordRequest);
  page.on('response', (response) => {
    const request = response.request();
    const entry = findPendingRequestEntry(request);
    if (!entry) return;
    const headers = response.headers();
    Object.assign(entry, {
      responseAtMs: elapsedMs(),
      status: response.status(),
      contentLength: Number(headers['content-length'] ?? 0) || 0,
      cacheStatus: headers['cf-cache-status'] ?? null,
      wampCache: headers['x-wamp-cache'] ?? null,
      serverTiming: headers['server-timing'] ?? null,
    });
  });
  page.on('requestfailed', (request) => {
    const entry = findPendingRequestEntry(request);
    if (!entry) return;
    entry.failedAtMs = elapsedMs();
    entry.failure = request.failure()?.errorText ?? 'unknown';
  });
  return {
    elapsedMs,
    snapshot: () => requests.map((entry) => ({
      ...entry,
      snapshotQuery: entry.snapshotQuery ? {
        ...entry.snapshotQuery,
        referenceKinds: [...entry.snapshotQuery.referenceKinds],
        referenceClasses: [...entry.snapshotQuery.referenceClasses],
      } : null,
    })),
  };
}

async function runPass(context, args, label) {
  const page = await context.newPage();
  const navigationStartedAt = performance.now();
  const networkRecorder = attachNetworkRecorder(page, navigationStartedAt);
  const consoleMessages = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: String(error) }));

  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  let coarseCoverageError = null;
  const coarseCoveragePromise = waitForTileState(page, isCompleteCoverage, args.timeoutMs)
    .then((state) => ({
      state,
      capturedAtMs: networkRecorder.elapsedMs(),
      network: networkRecorder.snapshot(),
    }))
    .catch((error) => {
      coarseCoverageError = error;
      return null;
    });
  await waitForOverworld(page, args.timeoutMs);
  await dismissWelcomeModal(page);
  const appReadyMs = Math.round((performance.now() - navigationStartedAt) * 10) / 10;
  const coarseCapture = await coarseCoveragePromise;
  if (!coarseCapture) throw coarseCoverageError;
  const coarse = coarseCapture.state;
  const coarseReadyMs = coarseCapture.capturedAtMs;
  assertSerializedL0Bootstrap(coarseCapture.network);
  const sharp = await waitForTileState(page, isSharpReady, args.timeoutMs);
  const sharpReadyMs = Math.round((performance.now() - navigationStartedAt) * 10) / 10;

  const zooms = [];
  let expectedLevel = Number(sharp.state.committedLevel);
  if (!Number.isInteger(expectedLevel) || expectedLevel < 0 || expectedLevel > 4) {
    throw new Error(`Initial sharp state has an invalid committed LOD: ${expectedLevel}`);
  }
  for (const targetZoom of args.zooms) {
    const approach = await approachZoom(page, targetZoom);
    expectedLevel = selectExpectedWorldTileLevel(Number(approach.finalState.zoom), expectedLevel);
    const coverage = await waitForTileState(page, isCompleteCoverage, args.timeoutMs);
    const targetReady = await waitForTileState(
      page,
      (metrics) => isSharpReady(metrics)
        && metrics.targetLevel === expectedLevel
        && metrics.committedLevel === expectedLevel,
      args.timeoutMs,
    );
    zooms.push({ targetZoom, expectedLevel, ...approach, coverage, targetReady });
  }

  const beforePan = summarizeState(await readState(page));
  const panStartedAt = performance.now();
  await panViewport(page);
  const panGestureMs = Math.round((performance.now() - panStartedAt) * 10) / 10;
  const panGestureCompletedAt = performance.now();
  const panCoverage = await waitForTileState(page, isCompleteCoverage, args.timeoutMs);
  const panCoverageMs = Math.round((performance.now() - panGestureCompletedAt) * 10) / 10;
  const panSharp = await waitForTileState(page, isSharpReady, args.timeoutMs);
  const panSharpMs = Math.round((performance.now() - panGestureCompletedAt) * 10) / 10;
  const afterPan = summarizeState(await readState(page));
  if (!cameraMoved(beforePan, afterPan)) {
    throw new Error('Overworld tile probe pan did not move the camera');
  }

  const screenshotPath = path.join(args.out, `${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const network = networkRecorder.snapshot();
  const result = {
    label,
    appReadyMs,
    coarseReadyMs,
    sharpReadyMs,
    coarse,
    coarseNetwork: {
      capturedAtMs: coarseCapture.capturedAtMs,
      requests: coarseCapture.network,
      summary: summarizeTrackedNetwork(coarseCapture.network),
    },
    sharp,
    zooms,
    pan: {
      before: beforePan,
      after: afterPan,
      coverage: panCoverage,
      sharp: panSharp,
      panGestureMs,
      panCoverageMs,
      panSharpMs,
    },
    network,
    networkSummary: summarizeTrackedNetwork(network),
    consoleMessages,
    screenshotPath,
  };
  await page.close();
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.out, { recursive: true });
  const browser = await chromium.launch({
    headless: args.headless,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const cold = await runPass(context, args, 'cold');
  const warm = await runPass(context, args, 'warm');
  const result = {
    generatedAt: new Date().toISOString(),
    url: args.url,
    zoomTargets: args.zooms,
    cold,
    warm,
  };
  const outputPath = path.join(args.out, 'result.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ${outputPath}`);
  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
