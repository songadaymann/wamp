import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_URL = 'http://127.0.0.1:3000/?previewSmoke=1&perf=1&mobilePerfHud=0&worldTiles=force';
const DEFAULT_ZOOMS = [0.08, 0.10, 0.17, 0.18, 0.20, 0.40, 0.80];

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
  };
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
  return samples;
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

function attachNetworkRecorder(page) {
  const requests = [];
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/api/world/tiles/') && !/\/world-tiles\/.*\.png(?:\?|$)/.test(url)) return;
    const headers = response.headers();
    requests.push({
      url,
      status: response.status(),
      resourceType: response.request().resourceType(),
      contentLength: Number(headers['content-length'] ?? 0),
      cacheStatus: headers['cf-cache-status'] ?? null,
      wampCache: headers['x-wamp-cache'] ?? null,
      serverTiming: headers['server-timing'] ?? null,
    });
  });
  return requests;
}

async function runPass(context, args, label) {
  const page = await context.newPage();
  const network = attachNetworkRecorder(page);
  const consoleMessages = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: String(error) }));

  const navigationStartedAt = performance.now();
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  await waitForOverworld(page, args.timeoutMs);
  await dismissWelcomeModal(page);
  const appReadyMs = Math.round((performance.now() - navigationStartedAt) * 10) / 10;
  const coarse = await waitForTileState(page, isCompleteCoverage, args.timeoutMs);
  const coarseReadyMs = Math.round((performance.now() - navigationStartedAt) * 10) / 10;
  const sharp = await waitForTileState(page, isSharpReady, args.timeoutMs);
  const sharpReadyMs = Math.round((performance.now() - navigationStartedAt) * 10) / 10;

  const zooms = [];
  for (const targetZoom of args.zooms) {
    const samples = await approachZoom(page, targetZoom);
    const coverage = await waitForTileState(page, isCompleteCoverage, args.timeoutMs);
    const targetReady = await waitForTileState(page, isSharpReady, args.timeoutMs);
    zooms.push({ targetZoom, samples, coverage, targetReady });
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
  const result = {
    label,
    appReadyMs,
    coarseReadyMs,
    sharpReadyMs,
    coarse,
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
    networkSummary: {
      requestCount: network.length,
      tileRequestCount: network.filter((entry) => /\/world-tiles\/.*\.png(?:\?|$)/.test(entry.url)).length,
      manifestRequestCount: network.filter((entry) => entry.url.includes('/api/world/tiles/manifest')).length,
      announcedBytes: network.reduce((sum, entry) => sum + entry.contentLength, 0),
      immutableCacheHits: network.filter((entry) => entry.cacheStatus === 'HIT').length,
    },
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
