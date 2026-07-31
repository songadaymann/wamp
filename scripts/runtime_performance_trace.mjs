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
    scenario: 'traversal',
    traceGc: false,
    out: 'output/runtime-performance-trace',
  };
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--trace-gc') {
      options.traceGc = true;
      continue;
    }
    if (argument === '--url' && value) options.url = value;
    else if (argument === '--duration-ms' && value) options.durationMs = Number(value);
    else if (argument === '--cpu-throttle' && value) options.cpuThrottle = Number(value);
    else if (argument === '--max-p95-ms' && value) options.maxP95Ms = Number(value);
    else if (argument === '--room' && value) options.roomId = value;
    else if (argument === '--scenario' && value) options.scenario = value;
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
  await page.waitForFunction(() => {
    try {
      const entries = JSON.parse(window.render_game_to_text?.() ?? '{}')
        ?.bootDiagnostics?.entries;
      if (!Array.isArray(entries)) return false;
      const lastRefreshStart = entries.findLastIndex((entry) => (
        entry?.phase === 'overworld-refresh:start'
      ));
      const lastRefreshReady = entries.findLastIndex((entry) => (
        entry?.phase === 'overworld-refresh:ready'
      ));
      return lastRefreshStart >= 0 && lastRefreshReady > lastRefreshStart;
    } catch {
      return false;
    }
  }, null, { timeout: 30_000 });
  const play = await page.evaluate(() => window.run_preview_smoke_action?.('playSelectedRoom'));
  if (!play?.ok) throw new Error(`Could not enter play mode: ${JSON.stringify(play)}`);
  const goalStartButton = page.locator(
    '#room-goal-intro-modal:not(.hidden) #btn-room-goal-intro-start',
  );
  if (await goalStartButton.waitFor({ state: 'visible', timeout: 5_000 }).then(
    () => true,
    () => false,
  )) {
    await goalStartButton.click();
  }
  await page.waitForFunction((requestedRoomId) => {
    try {
      const state = JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene;
      const currentRoomId = state?.currentRoom
        ? `${state.currentRoom.x},${state.currentRoom.y}`
        : null;
      return state?.mode === 'play'
        && currentRoomId === requestedRoomId
        && state?.player !== null
        && state?.player !== undefined;
    } catch {
      return false;
    }
  }, selection.roomId ?? roomId, { timeout: 30_000 });
}

function getRoomBenchmarkPosition(roomId) {
  const [roomX, roomY] = roomId.split(',').map(Number);
  if (!Number.isInteger(roomX) || !Number.isInteger(roomY)) {
    throw new Error(`Benchmark room must be an x,y coordinate: ${roomId}`);
  }
  return { x: roomX * 640 + 320, y: roomY * 352 + 160 };
}

function getRightNeighborTransition(roomId) {
  const [roomX, roomY] = roomId.split(',').map(Number);
  if (!Number.isInteger(roomX) || !Number.isInteger(roomY)) {
    throw new Error(`Transition room must be an x,y coordinate: ${roomId}`);
  }
  const seamX = (roomX + 1) * 640;
  return {
    sourceRoomId: `${roomX},${roomY}`,
    expectedRoomId: `${roomX + 1},${roomY}`,
    seamX,
    approachPosition: {
      x: seamX - 40,
      y: roomY * 352 + 291,
    },
  };
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

async function readTransitionRuntime(page) {
  return page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? '{}');
    const scene = state?.activeScene ?? null;
    const player = scene?.player ?? null;
    return {
      capturedAtMs: Number(performance.now().toFixed(1)),
      mode: scene?.mode ?? null,
      currentRoomId: scene?.currentRoom
        ? `${scene.currentRoom.x},${scene.currentRoom.y}`
        : null,
      selectedRoomId: scene?.selected
        ? `${scene.selected.x},${scene.selected.y}`
        : null,
      collectedKeysHeld: scene?.keysHeld ?? null,
      player: player
        ? {
            avatarId: player.avatarId ?? null,
            x: player.x ?? null,
            y: player.y ?? null,
            velocityX: player.velocityX ?? null,
            velocityY: player.velocityY ?? null,
            bodyWidth: player.bodyWidth ?? null,
            bodyHeight: player.bodyHeight ?? null,
          }
        : null,
    };
  });
}

async function runKeyboardRoomTransition(page, transition, durationMs) {
  await pinPlayerToBenchmarkRoom(page, transition.approachPosition);
  await page.waitForTimeout(50);
  const beforeSeam = await readTransitionRuntime(page);
  const keyDownAtMs = Date.now();
  const transitionTimeoutMs = Math.max(2_000, Math.min(15_000, durationMs));
  let crossingDetected = false;
  let transitionError = null;

  await page.keyboard.down('ArrowRight');
  try {
    try {
      await page.waitForFunction((expectedRoomId) => {
        try {
          const scene = JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene;
          const currentRoomId = scene?.currentRoom
            ? `${scene.currentRoom.x},${scene.currentRoom.y}`
            : null;
          return scene?.mode === 'play'
            && currentRoomId === expectedRoomId
            && Boolean(scene?.player);
        } catch {
          return false;
        }
      }, transition.expectedRoomId, { timeout: transitionTimeoutMs });
      crossingDetected = true;
    } catch (error) {
      transitionError = error instanceof Error ? error.message : String(error);
    }

    const atSeam = await readTransitionRuntime(page);
    await page.waitForTimeout(250);
    const afterSeam = await readTransitionRuntime(page);
    return {
      method: 'continuous-keyboard-input',
      heldKey: 'ArrowRight',
      sourceRoomId: transition.sourceRoomId,
      expectedRoomId: transition.expectedRoomId,
      seamX: transition.seamX,
      approachPosition: transition.approachPosition,
      teleportsAfterKeyDown: 0,
      transitionTimeoutMs,
      crossingDetected,
      transitionError,
      keyHoldMs: Date.now() - keyDownAtMs,
      beforeSeam,
      atSeam,
      afterSeam,
    };
  } finally {
    await page.keyboard.up('ArrowRight');
  }
}

async function startGcTrace(cdp) {
  await cdp.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'v8.execute',
      'disabled-by-default-v8.gc',
    ].join(','),
    transferMode: 'ReturnAsStream',
  });
}

async function stopGcTrace(cdp, tracePath) {
  const completed = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  const event = await completed;
  if (!event?.stream) {
    throw new Error('Chrome tracing completed without a readable stream.');
  }

  let traceJson = '';
  while (true) {
    const chunk = await cdp.send('IO.read', { handle: event.stream });
    traceJson += chunk.data ?? '';
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: event.stream });
  fs.writeFileSync(tracePath, traceJson);

  const trace = JSON.parse(traceJson);
  const gcEvents = (trace.traceEvents ?? []).filter((entry) => (
    typeof entry?.name === 'string'
    && /(?:^|\.)gc|garbage/i.test(entry.name)
    && typeof entry.dur === 'number'
  ));
  const durationsMs = gcEvents.map((entry) => entry.dur / 1000);
  return {
    eventCount: gcEvents.length,
    totalMs: durationsMs.reduce((total, value) => total + value, 0),
    maxMs: Math.max(0, ...durationsMs),
  };
}

async function run() {
  const options = parseArgs(process.argv);
  if (!['idle', 'traversal', 'room-transition'].includes(options.scenario)) {
    throw new Error(
      `Unsupported scenario "${options.scenario}". Use idle, traversal, or room-transition.`,
    );
  }
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
  if (options.traceGc) {
    await startGcTrace(cdp);
  }
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
  let transitionRun = null;
  if (options.scenario === 'idle') {
    await page.waitForTimeout(options.durationMs);
  } else if (options.scenario === 'room-transition') {
    const transition = getRightNeighborTransition(options.roomId);
    transitionRun = await runKeyboardRoomTransition(page, transition, options.durationMs);
    await page.waitForTimeout(Math.max(0, endedAt - Date.now()));
  } else {
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
  }

  const captured = await page.evaluate(() => {
    if (window.__wampFrameRequest) cancelAnimationFrame(window.__wampFrameRequest);
    return {
      frameTimes: window.__wampFrameTimes ?? [],
      profiler: window.wampMobilePerf?.get('runtime-mobile-trace') ?? null,
      state: JSON.parse(window.render_game_to_text?.() ?? '{}'),
    };
  });
  const tracePath = options.traceGc ? path.join(options.out, 'chrome-gc-trace.json') : null;
  const gc = tracePath ? await stopGcTrace(cdp, tracePath) : null;
  const warmFrameTimes = captured.frameTimes.slice(5);
  const frameTime = summarize(warmFrameTimes);
  const frameWorkP95Ms = captured.profiler?.updateMs?.p95 ?? Number.POSITIVE_INFINITY;
  const transition = options.scenario === 'room-transition'
    ? getRightNeighborTransition(options.roomId)
    : null;
  const transitionAssertion = transition
    ? {
        method: transitionRun?.method ?? null,
        heldKey: transitionRun?.heldKey ?? null,
        sourceRoomId: transition.sourceRoomId,
        expectedRoomId: transition.expectedRoomId,
        actualRoomId: captured.state?.activeScene?.currentRoom
          ? `${captured.state.activeScene.currentRoom.x},${captured.state.activeScene.currentRoom.y}`
          : null,
        mode: captured.state?.activeScene?.mode ?? null,
        seamX: transition.seamX,
        approachPosition: transition.approachPosition,
        crossingDetected: transitionRun?.crossingDetected ?? false,
        transitionError: transitionRun?.transitionError ?? null,
        transitionTimeoutMs: transitionRun?.transitionTimeoutMs ?? null,
        keyHoldMs: transitionRun?.keyHoldMs ?? null,
        teleportsAfterKeyDown: transitionRun?.teleportsAfterKeyDown ?? null,
        beforeSeam: transitionRun?.beforeSeam ?? null,
        atSeam: transitionRun?.atSeam ?? null,
        afterSeam: transitionRun?.afterSeam ?? null,
        playerPresentThroughout:
          Boolean(transitionRun?.beforeSeam?.player)
          && Boolean(transitionRun?.atSeam?.player)
          && Boolean(transitionRun?.afterSeam?.player)
          && Boolean(captured.state?.activeScene?.player),
        xMotionAcrossSeam:
          (transitionRun?.atSeam?.player?.x ?? Number.NEGATIVE_INFINITY)
          > (transitionRun?.beforeSeam?.player?.x ?? Number.POSITIVE_INFINITY),
        xMotionAfterSeam:
          (transitionRun?.afterSeam?.player?.x ?? Number.NEGATIVE_INFINITY)
          > (transitionRun?.atSeam?.player?.x ?? Number.POSITIVE_INFINITY),
        positiveVelocityAtSeam: (transitionRun?.atSeam?.player?.velocityX ?? 0) > 0,
        positiveVelocityAfterSeam: (transitionRun?.afterSeam?.player?.velocityX ?? 0) > 0,
        roomCoordinateChanged:
          transitionRun?.beforeSeam?.currentRoomId === transition.sourceRoomId
          && transitionRun?.atSeam?.currentRoomId === transition.expectedRoomId,
        remainedInDestinationColumn:
          transitionRun?.afterSeam?.currentRoomId?.split(',')[0]
          === transition.expectedRoomId.split(',')[0],
        finalPlayRuntimePresent:
          captured.state?.activeScene?.mode === 'play'
          && Boolean(captured.state?.activeScene?.player),
        passed:
          transitionRun?.method === 'continuous-keyboard-input'
          && transitionRun?.teleportsAfterKeyDown === 0
          && transitionRun?.crossingDetected === true
          && transitionRun?.beforeSeam?.mode === 'play'
          && transitionRun?.beforeSeam?.currentRoomId === transition.sourceRoomId
          && transitionRun?.atSeam?.mode === 'play'
          && transitionRun?.atSeam?.currentRoomId === transition.expectedRoomId
          && transitionRun?.afterSeam?.mode === 'play'
          && transitionRun?.afterSeam?.currentRoomId?.split(',')[0]
            === transition.expectedRoomId.split(',')[0]
          && Boolean(transitionRun?.beforeSeam?.player)
          && Boolean(transitionRun?.atSeam?.player)
          && Boolean(transitionRun?.afterSeam?.player)
          && Boolean(captured.state?.activeScene?.player)
          && (transitionRun?.atSeam?.player?.x ?? Number.NEGATIVE_INFINITY)
            > (transitionRun?.beforeSeam?.player?.x ?? Number.POSITIVE_INFINITY)
          && (transitionRun?.afterSeam?.player?.x ?? Number.NEGATIVE_INFINITY)
            > (transitionRun?.atSeam?.player?.x ?? Number.POSITIVE_INFINITY)
          && (transitionRun?.atSeam?.player?.velocityX ?? 0) > 0
          && (transitionRun?.afterSeam?.player?.velocityX ?? 0) > 0
          && captured.state?.activeScene?.mode === 'play'
          && Boolean(captured.state?.activeScene?.player),
      }
    : null;
  const screenshotPath = path.join(options.out, 'final.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const result = {
    generatedAt: new Date().toISOString(),
    options,
    frameTime,
    frameWorkP95Ms,
    frameWorkGate: 'Phaser update work measured on a 4x CPU-throttled mobile viewport; compositor pacing is reported separately.',
    transitionAssertion,
    profiler: captured.profiler,
    gc,
    tracePath,
    state: captured.state,
    errors,
    passed:
      frameWorkP95Ms < options.maxP95Ms
      && errors.length === 0
      && (transitionAssertion?.passed ?? true),
    screenshotPath,
  };
  const resultPath = path.join(options.out, 'result.json');
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    resultPath,
    scenario: options.scenario,
    frameTime,
    frameWorkP95Ms,
    gc,
    errors: errors.length,
    transitionAssertion,
    passed: result.passed,
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
