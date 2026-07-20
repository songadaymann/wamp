import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_URL = 'http://127.0.0.1:3000/?previewSmoke=1&perf=1&mobilePerfHud=0';

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    durationMs: 60_000,
    cpuThrottle: 4,
    maxP95Ms: 20,
    roomId: '0,0',
    out: 'output/runtime-performance-trace',
  };
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--url' && value) options.url = value;
    else if (argument === '--duration-ms' && value) options.durationMs = Number(value);
    else if (argument === '--cpu-throttle' && value) options.cpuThrottle = Number(value);
    else if (argument === '--max-p95-ms' && value) options.maxP95Ms = Number(value);
    else if (argument === '--room' && value) options.roomId = value;
    else if (argument === '--out' && value) options.out = value;
    else continue;
    index += 1;
  }
  return options;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue / 100) - 1));
  return sorted[index] ?? 0;
}

function summarize(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    samples: values.length,
    averageMs: values.length > 0 ? total / values.length : 0,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
    maxMs: Math.max(0, ...values),
    over20Ms: values.filter((value) => value > 20).length,
    over33Ms: values.filter((value) => value > 33.4).length,
  };
}

async function waitForOverworld(page) {
  await page.waitForFunction(() => {
    try {
      const state = JSON.parse(window.render_game_to_text?.() ?? '{}');
      return state?.activeScene?.scene === 'overworld-play' && state?.appFeedback?.ready;
    } catch {
      return false;
    }
  }, null, { timeout: 30_000 });
}

async function enterPlayableRoom(page, roomId) {
  await page.waitForFunction(() => typeof window.run_preview_smoke_action === 'function', null, { timeout: 30_000 });
  const selection = await page.evaluate(
    (requestedRoomId) => window.run_preview_smoke_action?.('selectEditableRoom', { roomId: requestedRoomId }),
    roomId,
  );
  if (!selection?.ok) throw new Error(`Could not select playable room: ${JSON.stringify(selection)}`);
  await page.waitForFunction((requestedRoomId) => {
    try {
      const state = JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene;
      const selectedRoomId = `${state?.selected?.x},${state?.selected?.y}`;
      return selectedRoomId === requestedRoomId
        && ['published', 'draft', 'claimed_unpublished'].includes(state?.selectedState);
    } catch {
      return false;
    }
  }, selection.roomId ?? roomId, { timeout: 15_000 });
  const play = await page.evaluate(() => window.run_preview_smoke_action?.('playSelectedRoom'));
  if (!play?.ok) throw new Error(`Could not enter play mode: ${JSON.stringify(play)}`);
  await page.waitForFunction(() => {
    try {
      return JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene?.mode === 'play';
    } catch {
      return false;
    }
  }, null, { timeout: 15_000 });
  const goalStartButton = page.locator(
    '#room-goal-intro-modal:not(.hidden) #btn-room-goal-intro-start',
  );
  if (await goalStartButton.waitFor({ state: 'visible', timeout: 5_000 }).then(
    () => true,
    () => false,
  )) {
    await goalStartButton.click();
  }
}

function getRoomBenchmarkPosition(roomId) {
  const [roomX, roomY] = roomId.split(',').map(Number);
  if (!Number.isInteger(roomX) || !Number.isInteger(roomY)) {
    throw new Error(`Benchmark room must be an x,y coordinate: ${roomId}`);
  }
  return { x: roomX * 640 + 320, y: roomY * 352 + 160 };
}

async function pinPlayerToBenchmarkRoom(page, position) {
  const result = await page.evaluate(
    (target) => window.run_preview_smoke_action?.('setPlayerPosition', {
      ...target,
      velocityX: 0,
      velocityY: 0,
      bodyEnabled: true,
    }),
    position,
  );
  if (!result?.ok) throw new Error(`Could not pin benchmark player: ${JSON.stringify(result)}`);
}

async function run() {
  const options = parseArgs(process.argv);
  fs.mkdirSync(options.out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => localStorage.setItem('wamp_welcome_modal_seen_v1', '1'));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpuThrottle });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(options.url, { waitUntil: 'domcontentloaded' });
  await waitForOverworld(page);
  await enterPlayableRoom(page, options.roomId);
  const benchmarkPosition = getRoomBenchmarkPosition(options.roomId);
  await pinPlayerToBenchmarkRoom(page, benchmarkPosition);
  await page.waitForTimeout(2_000);
  await page.evaluate(() => {
    window.wampMobilePerf?.reset();
    window.__wampFrameTimes = [];
    let previous = performance.now();
    const sample = (now) => {
      window.__wampFrameTimes.push(now - previous);
      previous = now;
      window.__wampFrameRequest = requestAnimationFrame(sample);
    };
    window.__wampFrameRequest = requestAnimationFrame(sample);
  });

  const endedAt = Date.now() + options.durationMs;
  let direction = 'ArrowRight';
  while (Date.now() < endedAt) {
    await page.keyboard.down(direction);
    await page.waitForTimeout(Math.min(500, Math.max(0, endedAt - Date.now())));
    await page.keyboard.up(direction);
    await page.keyboard.press('Space');
    direction = direction === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
    await page.waitForTimeout(Math.min(2_000, Math.max(0, endedAt - Date.now())));
    await pinPlayerToBenchmarkRoom(page, benchmarkPosition);
  }

  const captured = await page.evaluate(() => {
    if (window.__wampFrameRequest) cancelAnimationFrame(window.__wampFrameRequest);
    return {
      frameTimes: window.__wampFrameTimes ?? [],
      profiler: window.wampMobilePerf?.get('60-second-mobile-trace') ?? null,
      state: JSON.parse(window.render_game_to_text?.() ?? '{}'),
    };
  });
  const warmFrameTimes = captured.frameTimes.slice(5);
  const frameTime = summarize(warmFrameTimes);
  const frameWorkP95Ms = captured.profiler?.updateMs?.p95 ?? Number.POSITIVE_INFINITY;
  const screenshotPath = path.join(options.out, 'final.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const result = {
    generatedAt: new Date().toISOString(),
    options,
    frameTime,
    frameWorkP95Ms,
    frameWorkGate: 'Phaser update work measured on a 4x CPU-throttled mobile viewport; compositor pacing is reported separately.',
    profiler: captured.profiler,
    state: captured.state,
    errors,
    passed: frameWorkP95Ms < options.maxP95Ms && errors.length === 0,
    screenshotPath,
  };
  const resultPath = path.join(options.out, 'result.json');
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({ resultPath, frameTime, frameWorkP95Ms, errors: errors.length, passed: result.passed }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
