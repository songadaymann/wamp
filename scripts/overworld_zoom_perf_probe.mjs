import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_URL = 'http://127.0.0.1:3000/?previewSmoke=1&perf=1&mobilePerfHud=0';

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    out: 'output/overworld-zoom-perf',
    steps: 18,
    deltaY: 90,
    settleMs: 500,
    headless: true,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--url' && next) {
      args.url = next;
      index += 1;
    } else if (arg === '--out' && next) {
      args.out = next;
      index += 1;
    } else if (arg === '--steps' && next) {
      args.steps = Number(next);
      index += 1;
    } else if (arg === '--delta-y' && next) {
      args.deltaY = Number(next);
      index += 1;
    } else if (arg === '--settle-ms' && next) {
      args.settleMs = Number(next);
      index += 1;
    } else if (arg === '--headless' && next) {
      args.headless = next !== '0' && next !== 'false';
      index += 1;
    }
  }

  return args;
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function readActiveScene(payload) {
  return payload && typeof payload === 'object' && payload.activeScene
    ? payload.activeScene
    : null;
}

async function readTextState(page) {
  const raw = await page.evaluate(() => window.render_game_to_text?.() ?? '{}');
  return JSON.parse(raw);
}

function summarizeScene(scene, label) {
  const lodMetrics = scene?.lodMetrics ?? {};
  const camera = scene?.camera ?? {};
  return {
    label,
    zoom: scene?.zoom ?? null,
    selected: scene?.selected ?? null,
    currentRoom: scene?.currentRoom ?? null,
    mode: scene?.mode ?? null,
    cameraMode: scene?.cameraMode ?? null,
    loadedPreviewRooms: lodMetrics.loadedPreviewRoomCount ?? scene?.loadedPreviewRooms ?? null,
    loadedPreviewChunks: lodMetrics.loadedPreviewChunkCount ?? null,
    previewRoomBudget: lodMetrics.previewRoomBudget ?? null,
    protectedVisiblePreviewRoomCount: lodMetrics.protectedVisiblePreviewRoomCount ?? null,
    previewTileSize: lodMetrics.previewTileSize ?? null,
    approximatePreviewTexturePixels: lodMetrics.approximatePreviewTexturePixels ?? null,
    loadedFullRooms: lodMetrics.loadedFullRoomCount ?? scene?.loadedFullRooms ?? null,
    activeChunkCount: lodMetrics.activeChunkCount ?? null,
    activeChunkRadius: lodMetrics.activeChunkRadius ?? null,
    worldView: camera.worldView ?? null,
  };
}

async function settle(page, ms) {
  await page.evaluate(async (durationMs) => {
    if (typeof window.advanceTime === 'function') {
      await window.advanceTime(durationMs);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
  }, ms);
}

async function waitForOverworld(page) {
  await page.waitForFunction(() => {
    try {
      const raw = window.render_game_to_text?.();
      if (!raw) return false;
      const payload = JSON.parse(raw);
      return payload?.activeScene?.scene === 'overworld-play' && payload?.appFeedback?.ready;
    } catch {
      return false;
    }
  }, null, { timeout: 15000 });
}

async function getCanvasBox(page) {
  const box = await page.evaluate(() => {
    let best = null;
    let bestArea = 0;
    for (const canvas of document.querySelectorAll('canvas')) {
      const rect = canvas.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (rect.width <= 0 || rect.height <= 0 || area <= bestArea) {
        continue;
      }
      bestArea = area;
      best = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }
    return best;
  });
  if (!box) {
    throw new Error('Canvas was not visible.');
  }
  return box;
}

async function dispatchWheelAtCanvasCenter(page, canvasBox, deltaY) {
  await page.evaluate(({ x, y, delta }) => {
    let canvas = null;
    let bestArea = 0;
    for (const candidate of document.querySelectorAll('canvas')) {
      const rect = candidate.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (rect.width <= 0 || rect.height <= 0 || area <= bestArea) {
        continue;
      }
      canvas = candidate;
      bestArea = area;
    }
    if (!canvas) {
      throw new Error('Canvas not found.');
    }
    canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: x,
      clientY: y,
      deltaY: delta,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      bubbles: true,
      cancelable: true,
    }));
  }, {
    x: Math.round(canvasBox.x + canvasBox.width * 0.5),
    y: Math.round(canvasBox.y + canvasBox.height * 0.5),
    delta: deltaY,
  });
}

async function runWheelBurst(page, label, steps, deltaY, settleMs) {
  const canvasBox = await getCanvasBox(page);
  const samples = [];

  await page.evaluate(() => window.wampMobilePerf?.reset());
  await settle(page, 100);

  samples.push(summarizeScene(readActiveScene(await readTextState(page)), `${label}:start`));
  for (let index = 0; index < steps; index += 1) {
    await dispatchWheelAtCanvasCenter(page, canvasBox, deltaY);
    await settle(page, 16);
    samples.push(summarizeScene(readActiveScene(await readTextState(page)), `${label}:step-${index + 1}`));
  }

  await settle(page, settleMs);
  const finalState = await readTextState(page);
  const profiler = await page.evaluate((reason) => window.wampMobilePerf?.get(reason) ?? null, label);

  return {
    label,
    steps,
    deltaY,
    samples,
    final: summarizeScene(readActiveScene(finalState), `${label}:final`),
    profiler,
  };
}

async function runProbe() {
  const args = parseArgs(process.argv);
  ensureDir(args.out);

  const browser = await chromium.launch({
    headless: args.headless,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const consoleMessages = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('WAMP_MOBILE_PERF')) {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
    }
  });
  page.on('pageerror', (error) => {
    consoleMessages.push({ type: 'pageerror', text: String(error) });
  });

  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  await waitForOverworld(page);
  await settle(page, 500);

  const zoomOut = await runWheelBurst(page, 'zoom-out-wheel', args.steps, args.deltaY, args.settleMs);
  const zoomIn = await runWheelBurst(page, 'zoom-in-wheel', args.steps, -args.deltaY, args.settleMs);
  const screenshotPath = path.join(args.out, 'final.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const result = {
    url: args.url,
    generatedAt: new Date().toISOString(),
    zoomOut,
    zoomIn,
    consoleMessages,
    screenshotPath,
  };
  const outputPath = path.join(args.out, 'result.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ${outputPath}`);
  await browser.close();
}

runProbe().catch((error) => {
  console.error(error);
  process.exit(1);
});
