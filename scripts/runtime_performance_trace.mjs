import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const DEFAULT_URL = 'http://127.0.0.1:3000/?previewSmoke=1&perf=1&mobilePerfHud=0';
const DEFAULT_MAX_SEAM_HOLD_MS = 100;
const TRANSITION_SAMPLE_INTERVAL_MS = 16;
const NEAR_SEAM_LEADING_EDGE_PX = 3;
const STOPPED_DIRECTIONAL_VELOCITY_PX_PER_SECOND = 1;
const ROOM_WIDTH_PX = 640;
const ROOM_HEIGHT_PX = 352;
const TRANSITION_APPROACH_DISTANCE_PX = 40;
const TRANSITION_DIRECTIONS = Object.freeze({
  right: Object.freeze({
    roomDelta: Object.freeze({ x: 1, y: 0 }),
    axis: 'x',
    motionSign: 1,
    heldKey: 'ArrowRight',
  }),
  left: Object.freeze({
    roomDelta: Object.freeze({ x: -1, y: 0 }),
    axis: 'x',
    motionSign: -1,
    heldKey: 'ArrowLeft',
  }),
  down: Object.freeze({
    roomDelta: Object.freeze({ x: 0, y: 1 }),
    axis: 'y',
    motionSign: 1,
    heldKey: 'ArrowDown',
  }),
  up: Object.freeze({
    roomDelta: Object.freeze({ x: 0, y: -1 }),
    axis: 'y',
    motionSign: -1,
    heldKey: 'ArrowUp',
  }),
});

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    durationMs: 60_000,
    cpuThrottle: 4,
    maxP95Ms: 20,
    roomId: '0,0',
    scenario: 'traversal',
    transitionDirection: 'right',
    transitionIterations: 5,
    transitionMinColdRuns: 3,
    transitionMinWarmRuns: 1,
    transitionMinProfilerRuns: 3,
    maxSeamHoldMs: DEFAULT_MAX_SEAM_HOLD_MS,
    transitionApproachX: null,
    transitionApproachY: null,
    transitionVelocityX: null,
    transitionVelocityY: null,
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
    else if (argument === '--transition-direction' && value) options.transitionDirection = value;
    else if (argument === '--transition-iterations' && value) options.transitionIterations = Number(value);
    else if (argument === '--transition-min-cold-runs' && value) options.transitionMinColdRuns = Number(value);
    else if (argument === '--transition-min-warm-runs' && value) options.transitionMinWarmRuns = Number(value);
    else if (argument === '--transition-min-profiler-runs' && value) options.transitionMinProfilerRuns = Number(value);
    else if (argument === '--max-seam-hold-ms' && value) options.maxSeamHoldMs = Number(value);
    else if (argument === '--transition-approach-x' && value) options.transitionApproachX = Number(value);
    else if (argument === '--transition-approach-y' && value) options.transitionApproachY = Number(value);
    else if (argument === '--transition-velocity-x' && value) options.transitionVelocityX = Number(value);
    else if (argument === '--transition-velocity-y' && value) options.transitionVelocityY = Number(value);
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

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
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

function getRenderedScene(state) {
  return state?.activeScene ?? state ?? null;
}

function getRenderedRoomId(room) {
  return Number.isInteger(room?.x) && Number.isInteger(room?.y)
    ? `${room.x},${room.y}`
    : null;
}

function readFiniteCounter(value) {
  return Number.isFinite(value) ? value : null;
}

export function analyzeRuntimeCounterDelta(baselineState, finalState) {
  const readCounters = (state) => {
    const scene = getRenderedScene(state);
    return {
      roomSnapshotCloneCount: readFiniteCounter(scene?.lodMetrics?.roomSnapshotCloneCount),
      frameWork: {
        jobsOver50Ms: readFiniteCounter(scene?.lodMetrics?.frameWork?.jobsOver50Ms),
        failedJobs: readFiniteCounter(scene?.lodMetrics?.frameWork?.failedJobs),
      },
    };
  };
  const baseline = readCounters(baselineState);
  const final = readCounters(finalState);
  const delta = {
    roomSnapshotCloneCount:
      baseline.roomSnapshotCloneCount !== null && final.roomSnapshotCloneCount !== null
        ? final.roomSnapshotCloneCount - baseline.roomSnapshotCloneCount
        : null,
    frameWork: {
      jobsOver50Ms:
        baseline.frameWork.jobsOver50Ms !== null && final.frameWork.jobsOver50Ms !== null
          ? final.frameWork.jobsOver50Ms - baseline.frameWork.jobsOver50Ms
          : null,
      failedJobs:
        baseline.frameWork.failedJobs !== null && final.frameWork.failedJobs !== null
          ? final.frameWork.failedJobs - baseline.frameWork.failedJobs
          : null,
    },
  };
  const checks = {
    zeroSteadySnapshotClones: delta.roomSnapshotCloneCount === 0,
    zeroSchedulerLongJobs: final.frameWork.jobsOver50Ms === 0,
    zeroSchedulerFailedJobs: final.frameWork.failedJobs === 0,
  };
  return {
    baseline,
    final,
    delta,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

export function analyzePostCrossingInvariantMonitor(monitor, expectedRoomId) {
  const samples = Array.isArray(monitor?.samples) ? monitor.samples : [];
  const violations = [];
  for (const sample of samples) {
    const reasons = [];
    if (sample?.currentRoomId !== expectedRoomId) reasons.push('unexpected-current-room');
    if (sample?.destinationLoaded !== true) reasons.push('destination-not-loaded');
    if (sample?.currentFullRoomLoaded !== true) reasons.push('current-room-not-fully-loaded');
    if (sample?.currentCollisionReady !== true) reasons.push('destination-collision-not-ready');
    if (sample?.currentTerrainColliderActive !== true) reasons.push('destination-collider-inactive');
    if (reasons.length > 0) {
      violations.push({
        capturedAtMs: sample?.capturedAtMs ?? null,
        currentRoomId: sample?.currentRoomId ?? null,
        reasons,
      });
    }
  }
  const parseErrorCount = Number.isInteger(monitor?.parseErrorCount)
    ? monitor.parseErrorCount
    : 0;
  const crossingObserved = monitor?.crossingSeen === true && samples.length > 0;
  return {
    expectedRoomId,
    crossingObserved,
    framesBeforeCrossing: monitor?.framesBeforeCrossing ?? null,
    sampleCount: samples.length,
    parseErrorCount,
    violations,
    passed: crossingObserved && parseErrorCount === 0 && violations.length === 0,
  };
}

export function analyzeFinalTransitionState(state, expectedRoomId) {
  const scene = getRenderedScene(state);
  const actualRoomId = getRenderedRoomId(scene?.currentRoom);
  const destinationLoaded = Array.isArray(scene?.loadedFullRoomIds)
    && scene.loadedFullRoomIds.includes(expectedRoomId);
  return {
    expectedRoomId,
    actualRoomId,
    destinationLoaded,
    currentFullRoomLoaded: scene?.currentFullRoomLoaded ?? null,
    currentCollisionReady: scene?.currentCollisionReady ?? null,
    currentTerrainColliderActive: scene?.currentTerrainColliderActive ?? null,
    mode: scene?.mode ?? null,
    playerPresent: Boolean(scene?.player),
    passed:
      actualRoomId === expectedRoomId
      && destinationLoaded
      && scene?.currentFullRoomLoaded === true
      && scene?.currentCollisionReady === true
      && scene?.currentTerrainColliderActive === true
      && scene?.mode === 'play'
      && Boolean(scene?.player),
  };
}

export function analyzeProfilerGate({
  scenario,
  finalProfiler,
  transitionWindowProfiler,
  maxP95Ms,
}) {
  const usesTransitionWindow = scenario === 'room-transition';
  const profiler = usesTransitionWindow ? transitionWindowProfiler : finalProfiler;
  const p95Ms = profiler?.updateMs?.p95;
  return {
    captureSource: usesTransitionWindow ? 'transition-window-after-seam' : 'final',
    capturePresent: Boolean(profiler),
    p95Ms: Number.isFinite(p95Ms) ? p95Ms : Number.POSITIVE_INFINITY,
    maxP95Ms,
    passed: Number.isFinite(p95Ms) && p95Ms < maxP95Ms,
  };
}

export function analyzeTransitionProfilerAggregate(
  runs,
  maxP95Ms,
  minProfilerRuns = 3,
) {
  const updateP95Values = (Array.isArray(runs) ? runs : [])
    .map((run) => run?.transitionWindow?.profiler?.updateMs?.p95)
    .filter(Number.isFinite);
  const medianP95Ms = median(updateP95Values);
  return {
    captureSource: 'transition-window-median',
    capturePresent: updateP95Values.length >= minProfilerRuns,
    sampleCount: updateP95Values.length,
    minimumSampleCount: minProfilerRuns,
    individualP95Ms: updateP95Values,
    p95Ms: updateP95Values.length > 0 ? medianP95Ms : Number.POSITIVE_INFINITY,
    maxP95Ms,
    passed:
      updateP95Values.length >= minProfilerRuns
      && Number.isFinite(medianP95Ms)
      && medianP95Ms < maxP95Ms,
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

async function createBenchmarkBrowserContext(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => localStorage.setItem('wamp_welcome_modal_seen_v1', '1'));
  return context;
}

async function waitForTransitionDestinationPrepared(page, destinationRoomId) {
  try {
    await page.waitForFunction((expectedRoomId) => {
      const probe = window.get_wamp_runtime_transition_probe?.(expectedRoomId) ?? null;
      return probe?.destinationLoaded === true || probe?.destinationDormantReady === true;
    }, destinationRoomId, { timeout: 15_000 });
  } catch (error) {
    const diagnostic = await page.evaluate((expectedRoomId) => {
      const state = JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene ?? null;
      return {
        probe: window.get_wamp_runtime_transition_probe?.(expectedRoomId) ?? null,
        mode: state?.mode ?? null,
        currentRoom: state?.currentRoom ?? null,
        selected: state?.selected ?? null,
        loadedFullRoomIds: state?.loadedFullRoomIds ?? null,
        lodMetrics: state?.lodMetrics ?? null,
        player: state?.player ?? null,
      };
    }, destinationRoomId);
    throw new Error(
      `Timed out staging transition destination ${destinationRoomId}: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    );
  }
}

async function prepareTransitionDestination(page, destinationRoomId) {
  const result = await page.evaluate(
    (roomId) => window.run_preview_smoke_action?.(
      'prepareTransitionDestination',
      { roomId },
    ),
    destinationRoomId,
  );
  if (!result?.ok) {
    throw new Error(`Could not stage transition destination: ${JSON.stringify(result)}`);
  }
}

async function clearTransitionDestinationPreparation(page, destinationRoomId) {
  const result = await page.evaluate(
    (roomId) => window.run_preview_smoke_action?.(
      'clearTransitionDestinationPreparation',
      { roomId },
    ),
    destinationRoomId,
  );
  if (!result?.ok) {
    throw new Error(`Could not clear staged transition destination: ${JSON.stringify(result)}`);
  }
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
  await page.waitForFunction((requestedRoomId) => {
    try {
      const state = JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene;
      const currentRoomId = state?.currentRoom
        ? `${state.currentRoom.x},${state.currentRoom.y}`
        : null;
      return state?.mode === 'play'
        && currentRoomId === requestedRoomId
        && state?.player !== null
        && state?.player !== undefined
        && state?.currentFullRoomLoaded === true
        && state?.currentCollisionReady === true
        && state?.currentTerrainColliderActive === true;
    } catch {
      return false;
    }
  }, selection.roomId ?? roomId, { timeout: 30_000 });

  // Heavy rooms can enter Play before their exact runtime finishes preparing.
  // Their goal intro opens only after that commit, so dismiss it after collision
  // readiness instead of racing it during the initial mode switch.
  const goalStartButton = page.locator(
    '#room-goal-intro-modal:not(.hidden) #btn-room-goal-intro-start',
  );
  if (await goalStartButton.waitFor({ state: 'visible', timeout: 2_000 }).then(
    () => true,
    () => false,
  )) {
    await goalStartButton.click();
    await goalStartButton.waitFor({ state: 'hidden', timeout: 5_000 });
  }
}

function getRoomBenchmarkPosition(roomId) {
  const [roomX, roomY] = roomId.split(',').map(Number);
  if (!Number.isInteger(roomX) || !Number.isInteger(roomY)) {
    throw new Error(`Benchmark room must be an x,y coordinate: ${roomId}`);
  }
  return { x: roomX * ROOM_WIDTH_PX + 320, y: roomY * ROOM_HEIGHT_PX + 160 };
}

export function getNeighborTransition(roomId, direction, overrides = {}) {
  const [roomX, roomY] = roomId.split(',').map(Number);
  if (!Number.isInteger(roomX) || !Number.isInteger(roomY)) {
    throw new Error(`Transition room must be an x,y coordinate: ${roomId}`);
  }
  const descriptor = TRANSITION_DIRECTIONS[direction];
  if (!descriptor) {
    throw new Error(
      `Unsupported transition direction "${direction}". Use right, left, down, or up.`,
    );
  }
  const expectedRoomX = roomX + descriptor.roomDelta.x;
  const expectedRoomY = roomY + descriptor.roomDelta.y;
  const sourceAxisCoordinate = descriptor.axis === 'x' ? roomX : roomY;
  const axisSize = descriptor.axis === 'x' ? ROOM_WIDTH_PX : ROOM_HEIGHT_PX;
  const seamCoordinate = (
    sourceAxisCoordinate + (descriptor.motionSign > 0 ? 1 : 0)
  ) * axisSize;
  const approachAxisCoordinate =
    seamCoordinate - descriptor.motionSign * TRANSITION_APPROACH_DISTANCE_PX;
  const defaultApproachPosition = descriptor.axis === 'x'
    ? {
        x: approachAxisCoordinate,
        y: roomY * ROOM_HEIGHT_PX + 291,
      }
    : {
        x: roomX * ROOM_WIDTH_PX + ROOM_WIDTH_PX / 2,
        y: approachAxisCoordinate,
      };
  const approachPosition = {
    x: Number.isFinite(overrides.approachX)
      ? overrides.approachX
      : defaultApproachPosition.x,
    y: Number.isFinite(overrides.approachY)
      ? overrides.approachY
      : defaultApproachPosition.y,
  };
  const approachVelocity = {
    x: Number.isFinite(overrides.velocityX) ? overrides.velocityX : 0,
    y: Number.isFinite(overrides.velocityY) ? overrides.velocityY : 0,
  };
  return {
    direction,
    heldKey: descriptor.heldKey,
    axis: descriptor.axis,
    motionSign: descriptor.motionSign,
    sourceRoomId: `${roomX},${roomY}`,
    expectedRoomId: `${expectedRoomX},${expectedRoomY}`,
    seamCoordinate,
    approachPosition,
    approachVelocity,
  };
}

function getTransitionOverrides(options) {
  return {
    approachX: options.transitionApproachX,
    approachY: options.transitionApproachY,
    velocityX: options.transitionVelocityX,
    velocityY: options.transitionVelocityY,
  };
}

function hasDirectionalMotion(fromRuntime, toRuntime, transition) {
  const fromPosition = fromRuntime?.player?.[transition.axis];
  const toPosition = toRuntime?.player?.[transition.axis];
  return Number.isFinite(fromPosition)
    && Number.isFinite(toPosition)
    && (toPosition - fromPosition) * transition.motionSign > 0;
}

function hasDirectionalVelocity(runtime, transition) {
  const velocityProperty = transition.axis === 'x' ? 'velocityX' : 'velocityY';
  const velocity = runtime?.player?.[velocityProperty];
  return Number.isFinite(velocity) && velocity * transition.motionSign > 0;
}

function getTransitionSampleDetails(sample, transition) {
  const position = sample?.player?.[transition.axis];
  const bodySizeProperty = transition.axis === 'x' ? 'bodyWidth' : 'bodyHeight';
  const velocityProperty = transition.axis === 'x' ? 'velocityX' : 'velocityY';
  const bodySize = sample?.player?.[bodySizeProperty];
  const velocity = sample?.player?.[velocityProperty];
  if (!Number.isFinite(position) || !Number.isFinite(bodySize)) return null;
  const centerDistanceToSeamPx = (
    transition.seamCoordinate - position
  ) * transition.motionSign;
  return {
    position,
    directionalVelocity: Number.isFinite(velocity)
      ? velocity * transition.motionSign
      : null,
    leadingEdgeDistanceToSeamPx: centerDistanceToSeamPx - bodySize / 2,
  };
}

function isDestinationLoaded(sample, transition) {
  if (sample?.destinationRoomId === transition.expectedRoomId) {
    return sample.destinationLoaded === true;
  }
  return Array.isArray(sample?.loadedFullRoomIds)
    && sample.loadedFullRoomIds.includes(transition.expectedRoomId);
}

function isDestinationPrepared(sample, transition) {
  return isDestinationLoaded(sample, transition)
    || (
      sample?.destinationRoomId === transition.expectedRoomId
      && sample.destinationDormantReady === true
    );
}

/**
 * Separates ordinary approach time from time spent stopped against a protected
 * seam. A moving sample near the seam is only contact; it becomes a hold when
 * the directional velocity is stopped or two nearby samples make no progress.
 */
export function analyzeTransitionSamples(
  samples,
  transition,
  {
    destinationLoadedBeforeKey = false,
    destinationPreparedBeforeKey = destinationLoadedBeforeKey,
    maxSeamHoldMs = DEFAULT_MAX_SEAM_HOLD_MS,
  } = {},
) {
  const timeline = Array.isArray(samples) ? samples : [];
  const crossingSample = timeline.find((sample) => (
    sample?.currentRoomId === transition.expectedRoomId
  )) ?? null;
  const destinationReadySample = timeline.find((sample) => (
    isDestinationLoaded(sample, transition)
  )) ?? null;
  let firstNearSeamContact = null;
  let firstNearSeamStop = null;
  let previousSourceSample = null;

  for (const sample of timeline) {
    if (sample?.currentRoomId !== transition.sourceRoomId) continue;
    const details = getTransitionSampleDetails(sample, transition);
    if (!details) continue;
    const isNearSeam = details.leadingEdgeDistanceToSeamPx
      <= NEAR_SEAM_LEADING_EDGE_PX;
    if (isNearSeam && !firstNearSeamContact) {
      firstNearSeamContact = { sample, details };
    }
    if (isNearSeam && !firstNearSeamStop) {
      const previousDetails = getTransitionSampleDetails(previousSourceSample, transition);
      const sampleGapMs = (
        sample.elapsedSinceKeyDownMs - (previousSourceSample?.elapsedSinceKeyDownMs ?? 0)
      );
      const directionalProgressPx = previousDetails
        ? (details.position - previousDetails.position) * transition.motionSign
        : Number.POSITIVE_INFINITY;
      const maximumStagnantProgressPx = Math.max(
        0.75,
        sampleGapMs * 0.15 * 0.15,
      );
      const stoppedByVelocity = Number.isFinite(details.directionalVelocity)
        && details.directionalVelocity <= STOPPED_DIRECTIONAL_VELOCITY_PX_PER_SECOND;
      const stoppedByPosition = previousDetails
        && sampleGapMs >= 8
        && previousSourceSample?.currentRoomId === transition.sourceRoomId
        && previousDetails.leadingEdgeDistanceToSeamPx <= NEAR_SEAM_LEADING_EDGE_PX
        && directionalProgressPx <= maximumStagnantProgressPx;
      if (stoppedByVelocity || stoppedByPosition) {
        firstNearSeamStop = { sample, details, reason: stoppedByVelocity ? 'velocity' : 'position' };
      }
    }
    previousSourceSample = sample;
  }

  const crossingMs = crossingSample?.elapsedSinceKeyDownMs ?? null;
  const stopMs = firstNearSeamStop?.sample?.elapsedSinceKeyDownMs ?? null;
  const lastSampleMs = timeline.at(-1)?.elapsedSinceKeyDownMs ?? 0;
  const seamHoldDetected = stopMs !== null;
  const seamHoldCensored = seamHoldDetected && crossingMs === null;
  const seamHoldMs = seamHoldDetected
    ? Math.max(0, (crossingMs ?? lastSampleMs) - stopMs)
    : 0;
  // The probe read and the actual CDP key event cannot be one browser task.
  // Conservatively treat a destination ready on the first post-key rAF as
  // warm, so a completion in that tiny gap never receives the cold allowance.
  const destinationPreparedAtInput = destinationPreparedBeforeKey
    || isDestinationPrepared(timeline[0], transition);
  const preparationState = destinationPreparedAtInput ? 'warm' : 'cold';
  const allowedSeamHoldMs = preparationState === 'warm' ? 0 : maxSeamHoldMs;
  const seamHoldWithinLimit = preparationState === 'warm'
    ? !seamHoldDetected && seamHoldMs === 0
    : seamHoldMs <= allowedSeamHoldMs;
  const destinationReadyMs = destinationLoadedBeforeKey
    ? 0
    : destinationReadySample?.elapsedSinceKeyDownMs ?? null;
  const sampleIntervalsMs = timeline.slice(1).map((sample, index) => (
    sample.elapsedSinceKeyDownMs - timeline[index].elapsedSinceKeyDownMs
  )).filter((value) => Number.isFinite(value) && value >= 0);

  return {
    preparationState,
    destinationLoadedBeforeKey,
    destinationPreparedBeforeKey: destinationPreparedAtInput,
    destinationReadyMsAfterKeyDown: destinationReadyMs,
    destinationReadyLeadMs: crossingMs !== null && destinationReadyMs !== null
      ? crossingMs - destinationReadyMs
      : null,
    keyDownToCrossingMs: crossingMs,
    approachToNearSeamContactMs:
      firstNearSeamContact?.sample?.elapsedSinceKeyDownMs ?? null,
    approachToNearSeamStopMs: stopMs,
    nearSeamContactToCrossingMs:
      firstNearSeamContact && crossingMs !== null
        ? Math.max(0, crossingMs - firstNearSeamContact.sample.elapsedSinceKeyDownMs)
        : null,
    seamHoldDetected,
    seamHoldCensored,
    seamHoldReason: firstNearSeamStop?.reason ?? null,
    seamHoldMs,
    maxSeamHoldMs,
    allowedSeamHoldMs,
    seamHoldGatePassed:
      crossingMs !== null
      && !seamHoldCensored
      && seamHoldWithinLimit,
    firstNearSeamContact: firstNearSeamContact
      ? {
          elapsedSinceKeyDownMs: firstNearSeamContact.sample.elapsedSinceKeyDownMs,
          position: firstNearSeamContact.details.position,
          directionalVelocity: firstNearSeamContact.details.directionalVelocity,
          leadingEdgeDistanceToSeamPx:
            firstNearSeamContact.details.leadingEdgeDistanceToSeamPx,
        }
      : null,
    firstNearSeamStop: firstNearSeamStop
      ? {
          elapsedSinceKeyDownMs: firstNearSeamStop.sample.elapsedSinceKeyDownMs,
          position: firstNearSeamStop.details.position,
          directionalVelocity: firstNearSeamStop.details.directionalVelocity,
          leadingEdgeDistanceToSeamPx:
            firstNearSeamStop.details.leadingEdgeDistanceToSeamPx,
          reason: firstNearSeamStop.reason,
        }
      : null,
    sampling: {
      sampleCount: timeline.length,
      targetIntervalMs: TRANSITION_SAMPLE_INTERVAL_MS,
      averageIntervalMs: sampleIntervalsMs.length > 0
        ? sampleIntervalsMs.reduce((total, value) => total + value, 0) / sampleIntervalsMs.length
        : 0,
      p95IntervalMs: percentile(sampleIntervalsMs, 95),
      maxIntervalMs: Math.max(0, ...sampleIntervalsMs),
    },
  };
}

export function analyzeTransitionRunAggregate(
  runs,
  transition,
  maxSeamHoldMs = DEFAULT_MAX_SEAM_HOLD_MS,
  { minColdRuns = 3, minWarmRuns = 1 } = {},
) {
  const transitionRuns = Array.isArray(runs) ? runs : [];
  const timings = transitionRuns
    .map((run) => run?.seamTiming ?? null)
    .filter(Boolean);
  const coldHoldMs = timings
    .filter((timing) => timing.preparationState === 'cold')
    .map((timing) => timing.seamHoldMs);
  const warmHoldMs = timings
    .filter((timing) => timing.preparationState === 'warm')
    .map((timing) => timing.seamHoldMs);
  const coldSeamHoldP95Ms = percentile(coldHoldMs, 95);
  const checks = {
    allRunsSampled: transitionRuns.length > 0 && timings.length === transitionRuns.length,
    minimumColdRunsCaptured: coldHoldMs.length >= minColdRuns,
    minimumWarmRunsCaptured: warmHoldMs.length >= minWarmRuns,
    allCrossingsDetected: transitionRuns.length > 0 && transitionRuns.every((run) => (
      run?.crossingDetected === true
      && run?.beforeSeam?.currentRoomId === transition.sourceRoomId
      && run?.atSeam?.currentRoomId === transition.expectedRoomId
    )),
    allSeamObservationsComplete: timings.length > 0 && timings.every(
      (timing) => (
        timing.seamHoldCensored !== true
        && Number.isFinite(timing.keyDownToCrossingMs)
        && Number.isFinite(timing.seamHoldMs)
      ),
    ),
    warmTransitionsHadZeroHold: timings
      .filter((timing) => timing.preparationState === 'warm')
      .every((timing) => timing.seamHoldDetected === false && timing.seamHoldMs === 0),
    coldP95WithinLimit: coldHoldMs.length === 0 || coldSeamHoldP95Ms <= maxSeamHoldMs,
    collisionReadyForEveryCrossing: transitionRuns.length > 0 && transitionRuns.every((run) => (
      run?.atSeam?.currentFullRoomLoaded === true
      && run?.atSeam?.currentCollisionReady === true
      && run?.atSeam?.currentTerrainColliderActive === true
      && run?.afterSeam?.currentFullRoomLoaded === true
      && run?.afterSeam?.currentCollisionReady === true
      && run?.afterSeam?.currentTerrainColliderActive === true
    )),
    postCrossingInvariantPassed: transitionRuns.length > 0 && transitionRuns.every(
      (run) => run?.postCrossingInvariantAtTransitionWindow?.passed === true,
    ),
  };
  return {
    runCount: transitionRuns.length,
    coldRunCount: coldHoldMs.length,
    warmRunCount: warmHoldMs.length,
    coldSeamHoldMs: coldHoldMs,
    warmSeamHoldMs: warmHoldMs,
    coldSeamHoldP95Ms,
    maxColdSeamHoldMs: Math.max(0, ...coldHoldMs),
    maxWarmSeamHoldMs: Math.max(0, ...warmHoldMs),
    maxSeamHoldMs,
    minColdRuns,
    minWarmRuns,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

async function pinPlayerToBenchmarkRoom(page, position, velocity = {}) {
  const result = await page.evaluate(
    (target) => window.run_preview_smoke_action?.('setPlayerPosition', {
      ...target,
      velocityX: target.velocityX ?? 0,
      velocityY: target.velocityY ?? 0,
      bodyEnabled: true,
    }),
    {
      ...position,
      velocityX: velocity.x,
      velocityY: velocity.y,
    },
  );
  if (!result?.ok) throw new Error(`Could not pin benchmark player: ${JSON.stringify(result)}`);
}

async function readTransitionRuntime(page, destinationRoomId) {
  return page.evaluate((expectedRoomId) => {
    const probe = window.get_wamp_runtime_transition_probe?.(expectedRoomId) ?? null;
    if (!probe) {
      throw new Error('The lightweight overworld transition probe is unavailable.');
    }
    return {
      capturedAtMs: Number(performance.now().toFixed(1)),
      mode: probe.mode,
      currentRoomId: probe.currentRoomId,
      selectedRoomId: probe.selectedRoomId,
      destinationRoomId: probe.destinationRoomId,
      destinationLoaded: probe.destinationLoaded,
      destinationPreparationIdentity: probe.destinationPreparationIdentity,
      destinationPreparationPhase: probe.destinationPreparationPhase,
      destinationDormantReady: probe.destinationDormantReady,
      currentFullRoomLoaded: probe.currentFullRoomLoaded,
      currentCollisionReady: probe.currentCollisionReady,
      currentTerrainColliderActive: probe.currentTerrainColliderActive,
      player: probe.player,
    };
  }, destinationRoomId);
}

async function startPostCrossingInvariantMonitor(page, expectedRoomId) {
  await page.evaluate((destinationRoomId) => {
    const previousMonitor = window.__wampTransitionInvariantMonitor;
    if (previousMonitor?.requestId) cancelAnimationFrame(previousMonitor.requestId);
    if (previousMonitor?.keyDownHandler) {
      window.removeEventListener('keydown', previousMonitor.keyDownHandler);
    }
    const monitor = {
      expectedRoomId: destinationRoomId,
      crossingSeen: false,
      framesBeforeCrossing: 0,
      parseErrorCount: 0,
      samples: [],
      timeline: [],
      keyDownAtMs: null,
      destinationPreparedAtKeyDown: null,
      keyDownHandler: null,
      requestId: 0,
    };
    monitor.keyDownHandler = () => {
      const probe = window.get_wamp_runtime_transition_probe?.(destinationRoomId) ?? null;
      monitor.timeline = [];
      monitor.keyDownAtMs = performance.now();
      monitor.destinationPreparedAtKeyDown = Boolean(
        probe?.destinationLoaded === true || probe?.destinationDormantReady === true,
      );
    };
    window.addEventListener('keydown', monitor.keyDownHandler, { once: true });
    const sample = (capturedAtMs) => {
      try {
        const probe = window.get_wamp_runtime_transition_probe?.(destinationRoomId) ?? null;
        if (!probe) throw new Error('Lightweight transition probe unavailable.');
        const currentRoomId = probe.currentRoomId;
        if (monitor.keyDownAtMs !== null) {
          monitor.timeline.push({
            capturedAtMs: Number(capturedAtMs.toFixed(1)),
            elapsedSinceKeyDownMs: Math.max(0, capturedAtMs - monitor.keyDownAtMs),
            mode: probe.mode,
            currentRoomId,
            destinationRoomId: probe.destinationRoomId,
            destinationLoaded: probe.destinationLoaded === true,
            destinationPreparationIdentity: probe.destinationPreparationIdentity,
            destinationPreparationPhase: probe.destinationPreparationPhase,
            destinationDormantReady: probe.destinationDormantReady === true,
            currentFullRoomLoaded: probe.currentFullRoomLoaded,
            currentCollisionReady: probe.currentCollisionReady,
            currentTerrainColliderActive: probe.currentTerrainColliderActive,
            player: probe.player,
          });
        }
        if (currentRoomId === destinationRoomId) monitor.crossingSeen = true;
        if (monitor.crossingSeen) {
          monitor.samples.push({
            capturedAtMs: Number(capturedAtMs.toFixed(1)),
            currentRoomId,
            destinationLoaded: probe.destinationLoaded === true,
            currentFullRoomLoaded: probe.currentFullRoomLoaded,
            currentCollisionReady: probe.currentCollisionReady,
            currentTerrainColliderActive: probe.currentTerrainColliderActive,
          });
        } else {
          monitor.framesBeforeCrossing += 1;
        }
      } catch {
        monitor.parseErrorCount += 1;
      }
      monitor.requestId = requestAnimationFrame(sample);
    };
    monitor.requestId = requestAnimationFrame(sample);
    window.__wampTransitionInvariantMonitor = monitor;
  }, expectedRoomId);
}

async function captureTransitionWindow(page) {
  return page.evaluate(() => {
    const monitor = window.__wampTransitionInvariantMonitor ?? null;
    const state = window.get_wamp_runtime_transition_probe?.(
      monitor?.expectedRoomId ?? null,
    ) ?? null;
    return {
      capturedAtMs: Number(performance.now().toFixed(1)),
      profiler: window.wampMobilePerf?.get('runtime-mobile-transition-window') ?? null,
      state,
      monitor: monitor
        ? {
            expectedRoomId: monitor.expectedRoomId,
            crossingSeen: monitor.crossingSeen,
            framesBeforeCrossing: monitor.framesBeforeCrossing,
            parseErrorCount: monitor.parseErrorCount,
            samples: monitor.samples,
            timeline: monitor.timeline,
            destinationPreparedAtKeyDown: monitor.destinationPreparedAtKeyDown,
          }
        : null,
    };
  });
}

async function stopPostCrossingInvariantMonitor(page) {
  await page.evaluate(() => {
    const monitor = window.__wampTransitionInvariantMonitor;
    if (monitor?.requestId) cancelAnimationFrame(monitor.requestId);
    if (monitor?.keyDownHandler) {
      window.removeEventListener('keydown', monitor.keyDownHandler);
    }
    delete window.__wampTransitionInvariantMonitor;
  });
}

async function runKeyboardRoomTransition(
  page,
  transition,
  durationMs,
  maxSeamHoldMs,
  { approachSettleMs = 50 } = {},
) {
  await pinPlayerToBenchmarkRoom(
    page,
    transition.approachPosition,
    transition.approachVelocity,
  );
  if (approachSettleMs > 0) await page.waitForTimeout(approachSettleMs);
  const beforeSeam = await readTransitionRuntime(page, transition.expectedRoomId);
  const destinationLoadedBeforeKey = isDestinationLoaded(beforeSeam, transition);
  const destinationPreparedBeforeKey = isDestinationPrepared(beforeSeam, transition);
  const keyDownAtMs = Date.now();
  const transitionTimeoutMs = Math.max(2_000, Math.min(15_000, durationMs));
  let crossingDetected = false;
  let transitionError = null;
  const samples = [];
  let keyHeld = false;
  let monitorCaptured = false;

  await startPostCrossingInvariantMonitor(page, transition.expectedRoomId);
  try {
    await page.keyboard.down(transition.heldKey);
    keyHeld = true;
    while (Date.now() - keyDownAtMs <= transitionTimeoutMs) {
      const sample = await readTransitionRuntime(page, transition.expectedRoomId);
      sample.elapsedSinceKeyDownMs = Date.now() - keyDownAtMs;
      samples.push(sample);
      if (sample.mode === 'play'
        && sample.currentRoomId === transition.expectedRoomId
        && Boolean(sample.player)) {
        crossingDetected = true;
        break;
      }
      const remainingMs = transitionTimeoutMs - (Date.now() - keyDownAtMs);
      if (remainingMs <= 0) break;
      await page.waitForTimeout(Math.min(TRANSITION_SAMPLE_INTERVAL_MS, remainingMs));
    }
    if (!crossingDetected) {
      transitionError = `Timed out after ${transitionTimeoutMs} ms waiting to cross from ${transition.sourceRoomId} to ${transition.expectedRoomId}.`;
    }

    const atSeam = samples.at(-1)
      ?? await readTransitionRuntime(page, transition.expectedRoomId);
    await page.waitForTimeout(250);
    const afterSeam = await readTransitionRuntime(page, transition.expectedRoomId);
    const transitionWindow = await captureTransitionWindow(page);
    monitorCaptured = true;
    const frameTimeline = transitionWindow.monitor?.timeline;
    const preparedAtKeyDown = transitionWindow.monitor?.destinationPreparedAtKeyDown;
    const seamTiming = analyzeTransitionSamples(
      Array.isArray(frameTimeline) && frameTimeline.length > 0 ? frameTimeline : samples,
      transition,
      {
        destinationLoadedBeforeKey,
        destinationPreparedBeforeKey: typeof preparedAtKeyDown === 'boolean'
          ? preparedAtKeyDown
          : destinationPreparedBeforeKey,
        maxSeamHoldMs,
      },
    );
    const postCrossingInvariantAtTransitionWindow = analyzePostCrossingInvariantMonitor(
      transitionWindow.monitor,
      transition.expectedRoomId,
    );
    return {
      method: 'continuous-keyboard-input',
      direction: transition.direction,
      heldKey: transition.heldKey,
      sourceRoomId: transition.sourceRoomId,
      expectedRoomId: transition.expectedRoomId,
      seamAxis: transition.axis,
      seamCoordinate: transition.seamCoordinate,
      approachPosition: transition.approachPosition,
      teleportsAfterKeyDown: 0,
      transitionTimeoutMs,
      crossingDetected,
      transitionError,
      keyHoldMs: Date.now() - keyDownAtMs,
      seamTiming,
      samples,
      beforeSeam,
      atSeam,
      afterSeam,
      postCrossingInvariantAtTransitionWindow,
      transitionWindow,
    };
  } finally {
    if (keyHeld) await page.keyboard.up(transition.heldKey);
    if (!monitorCaptured) await stopPostCrossingInvariantMonitor(page);
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
  if (!Object.hasOwn(TRANSITION_DIRECTIONS, options.transitionDirection)) {
    throw new Error(
      `Unsupported transition direction "${options.transitionDirection}". Use right, left, down, or up.`,
    );
  }
  if (!Number.isFinite(options.maxSeamHoldMs) || options.maxSeamHoldMs < 0) {
    throw new Error('--max-seam-hold-ms must be a non-negative number.');
  }
  for (const [label, value] of [
    ['--transition-approach-x', options.transitionApproachX],
    ['--transition-approach-y', options.transitionApproachY],
    ['--transition-velocity-x', options.transitionVelocityX],
    ['--transition-velocity-y', options.transitionVelocityY],
  ]) {
    if (value !== null && !Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number.`);
    }
  }
  if (!Number.isInteger(options.transitionIterations) || options.transitionIterations < 1) {
    throw new Error('--transition-iterations must be a positive integer.');
  }
  for (const [label, value] of [
    ['--transition-min-cold-runs', options.transitionMinColdRuns],
    ['--transition-min-warm-runs', options.transitionMinWarmRuns],
    ['--transition-min-profiler-runs', options.transitionMinProfilerRuns],
  ]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer.`);
    }
    if (value > options.transitionIterations) {
      throw new Error(`${label} cannot exceed --transition-iterations.`);
    }
  }
  if (
    options.transitionMinColdRuns + options.transitionMinWarmRuns
    > options.transitionIterations
  ) {
    throw new Error('Required cold and warm transition runs exceed total iterations.');
  }
  fs.mkdirSync(options.out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await createBenchmarkBrowserContext(browser);
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
  const baselineState = await page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? '{}')
  ));
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
  const transitionRuns = [];
  if (options.scenario === 'idle') {
    await page.waitForTimeout(options.durationMs);
  } else if (options.scenario === 'room-transition') {
    const transition = getNeighborTransition(
      options.roomId,
      options.transitionDirection,
      getTransitionOverrides(options),
    );
    // The primary page is deliberately warmed and remains the visual/final
    // assertion target. Every additional trial uses a fresh browser context,
    // guaranteeing a new runtime and artifact cache for honest cold samples.
    let warmTransitionRun;
    try {
      await prepareTransitionDestination(page, transition.expectedRoomId);
      await waitForTransitionDestinationPrepared(page, transition.expectedRoomId);
      warmTransitionRun = await runKeyboardRoomTransition(
        page,
        transition,
        options.durationMs,
        options.maxSeamHoldMs,
      );
    } finally {
      await clearTransitionDestinationPreparation(page, transition.expectedRoomId);
    }
    transitionRuns.push(warmTransitionRun);
    transitionRun = warmTransitionRun;

    for (let iteration = 1; iteration < options.transitionIterations; iteration += 1) {
      const coldContext = await createBenchmarkBrowserContext(browser);
      try {
        const coldPage = await coldContext.newPage();
        coldPage.on('pageerror', (error) => errors.push(`cold-${iteration}: ${String(error)}`));
        coldPage.on('console', (message) => {
          if (message.type() === 'error') {
            errors.push(`cold-${iteration}: ${message.text()}`);
          }
        });
        const coldCdp = await coldContext.newCDPSession(coldPage);
        await coldCdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpuThrottle });
        await coldPage.goto(options.url, { waitUntil: 'domcontentloaded' });
        await waitForOverworld(coldPage);
        await enterPlayableRoom(coldPage, options.roomId);
        const coldBaselineState = await coldPage.evaluate(() => (
          JSON.parse(window.render_game_to_text?.() ?? '{}')
        ));
        await coldPage.evaluate(() => {
          window.wampMobilePerf?.reset();
        });
        const coldRun = await runKeyboardRoomTransition(
          coldPage,
          transition,
          options.durationMs,
          options.maxSeamHoldMs,
          { approachSettleMs: 0 },
        );
        const coldFinalState = await coldPage.evaluate(() => (
          JSON.parse(window.render_game_to_text?.() ?? '{}')
        ));
        coldRun.runtimeCounterGate = analyzeRuntimeCounterDelta(
          coldBaselineState,
          coldFinalState,
        );
        transitionRuns.push(coldRun);
      } finally {
        await coldContext.close();
      }
    }
    transitionRun = transitionRuns[0] ?? null;
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
    const transitionMonitor = window.__wampTransitionInvariantMonitor ?? null;
    if (transitionMonitor?.requestId) cancelAnimationFrame(transitionMonitor.requestId);
    if (transitionMonitor?.keyDownHandler) {
      window.removeEventListener('keydown', transitionMonitor.keyDownHandler);
    }
    delete window.__wampTransitionInvariantMonitor;
    return {
      frameTimes: window.__wampFrameTimes ?? [],
      profiler: window.wampMobilePerf?.get('runtime-mobile-trace') ?? null,
      state: JSON.parse(window.render_game_to_text?.() ?? '{}'),
      transitionMonitor: transitionMonitor
        ? {
            expectedRoomId: transitionMonitor.expectedRoomId,
            crossingSeen: transitionMonitor.crossingSeen,
            framesBeforeCrossing: transitionMonitor.framesBeforeCrossing,
            parseErrorCount: transitionMonitor.parseErrorCount,
            samples: transitionMonitor.samples,
          }
        : null,
    };
  });
  const tracePath = options.traceGc ? path.join(options.out, 'chrome-gc-trace.json') : null;
  const gc = tracePath ? await stopGcTrace(cdp, tracePath) : null;
  const warmFrameTimes = captured.frameTimes.slice(5);
  const frameTime = summarize(warmFrameTimes);
  const profilerGate = options.scenario === 'room-transition'
    ? analyzeTransitionProfilerAggregate(
        transitionRuns,
        options.maxP95Ms,
        options.transitionMinProfilerRuns,
      )
    : analyzeProfilerGate({
        scenario: options.scenario,
        finalProfiler: captured.profiler,
        transitionWindowProfiler: null,
        maxP95Ms: options.maxP95Ms,
      });
  const frameWorkP95Ms = profilerGate.p95Ms;
  const runtimeCounterGate = analyzeRuntimeCounterDelta(baselineState, captured.state);
  if (transitionRuns[0]) {
    transitionRuns[0].runtimeCounterGate = runtimeCounterGate;
  }
  const transitionRuntimeCounterAggregate = options.scenario === 'room-transition'
    ? {
        sampleCount: transitionRuns.length,
        gates: transitionRuns.map((run) => run.runtimeCounterGate ?? null),
        passed:
          transitionRuns.length === options.transitionIterations
          && transitionRuns.every((run) => run.runtimeCounterGate?.passed === true),
      }
    : null;
  const transition = options.scenario === 'room-transition'
    ? getNeighborTransition(
        options.roomId,
        options.transitionDirection,
        getTransitionOverrides(options),
      )
    : null;
  const finalTransitionState = transition
    ? analyzeFinalTransitionState(captured.state, transition.expectedRoomId)
    : null;
  const postCrossingInvariant = transition
    ? analyzePostCrossingInvariantMonitor(captured.transitionMonitor, transition.expectedRoomId)
    : null;
  const transitionAggregate = transition
    ? analyzeTransitionRunAggregate(
        transitionRuns,
        transition,
        options.maxSeamHoldMs,
        {
          minColdRuns: options.transitionMinColdRuns,
          minWarmRuns: options.transitionMinWarmRuns,
        },
      )
    : null;
  const motionAcrossSeam = transition
    ? hasDirectionalMotion(transitionRun?.beforeSeam, transitionRun?.atSeam, transition)
    : false;
  const motionAfterSeam = transition
    ? hasDirectionalMotion(transitionRun?.atSeam, transitionRun?.afterSeam, transition)
    : false;
  const velocityAtSeamInExpectedDirection = transition
    ? hasDirectionalVelocity(transitionRun?.atSeam, transition)
    : false;
  const velocityAfterSeamInExpectedDirection = transition
    ? hasDirectionalVelocity(transitionRun?.afterSeam, transition)
    : false;
  const transitionAssertion = transition
    ? {
        method: transitionRun?.method ?? null,
        direction: transition.direction,
        heldKey: transitionRun?.heldKey ?? null,
        sourceRoomId: transition.sourceRoomId,
        expectedRoomId: transition.expectedRoomId,
        actualRoomId: finalTransitionState?.actualRoomId ?? null,
        mode: captured.state?.activeScene?.mode ?? null,
        seamAxis: transition.axis,
        seamCoordinate: transition.seamCoordinate,
        approachPosition: transition.approachPosition,
        crossingDetected: transitionRun?.crossingDetected ?? false,
        transitionError: transitionRun?.transitionError ?? null,
        transitionTimeoutMs: transitionRun?.transitionTimeoutMs ?? null,
        keyHoldMs: transitionRun?.keyHoldMs ?? null,
        keyDownToCrossingMs: transitionRun?.seamTiming?.keyDownToCrossingMs ?? null,
        preparationState: transitionRun?.seamTiming?.preparationState ?? null,
        destinationLoadedBeforeKey:
          transitionRun?.seamTiming?.destinationLoadedBeforeKey ?? null,
        destinationPreparedBeforeKey:
          transitionRun?.seamTiming?.destinationPreparedBeforeKey ?? null,
        destinationReadyMsAfterKeyDown:
          transitionRun?.seamTiming?.destinationReadyMsAfterKeyDown ?? null,
        destinationReadyLeadMs:
          transitionRun?.seamTiming?.destinationReadyLeadMs ?? null,
        approachToNearSeamContactMs:
          transitionRun?.seamTiming?.approachToNearSeamContactMs ?? null,
        approachToNearSeamStopMs:
          transitionRun?.seamTiming?.approachToNearSeamStopMs ?? null,
        seamHoldDetected: transitionRun?.seamTiming?.seamHoldDetected ?? null,
        seamHoldCensored: transitionRun?.seamTiming?.seamHoldCensored ?? null,
        seamHoldMs: transitionRun?.seamTiming?.seamHoldMs ?? null,
        maxSeamHoldMs: transitionRun?.seamTiming?.maxSeamHoldMs ?? options.maxSeamHoldMs,
        seamHoldGatePassed:
          transitionRun?.seamTiming?.seamHoldGatePassed ?? false,
        seamTiming: transitionRun?.seamTiming ?? null,
        teleportsAfterKeyDown: transitionRun?.teleportsAfterKeyDown ?? null,
        beforeSeam: transitionRun?.beforeSeam ?? null,
        atSeam: transitionRun?.atSeam ?? null,
        afterSeam: transitionRun?.afterSeam ?? null,
        playerPresentThroughout:
          Boolean(transitionRun?.beforeSeam?.player)
          && Boolean(transitionRun?.atSeam?.player)
          && Boolean(transitionRun?.afterSeam?.player)
          && Boolean(captured.state?.activeScene?.player),
        motionAcrossSeam,
        motionAfterSeam,
        velocityAtSeamInExpectedDirection,
        velocityAfterSeamInExpectedDirection,
        roomCoordinateChanged:
          transitionRun?.beforeSeam?.currentRoomId === transition.sourceRoomId
          && transitionRun?.atSeam?.currentRoomId === transition.expectedRoomId,
        destinationColliderReadyAtSeam:
          transitionRun?.atSeam?.currentFullRoomLoaded === true
          && transitionRun?.atSeam?.currentCollisionReady === true
          && transitionRun?.atSeam?.currentTerrainColliderActive === true,
        destinationColliderReadyAfterSeam:
          transitionRun?.afterSeam?.currentFullRoomLoaded === true
          && transitionRun?.afterSeam?.currentCollisionReady === true
          && transitionRun?.afterSeam?.currentTerrainColliderActive === true,
        postCrossingInvariant,
        postCrossingInvariantAtTransitionWindow:
          transitionRun?.postCrossingInvariantAtTransitionWindow ?? null,
        transitionWindowCapturedAtMs:
          transitionRun?.transitionWindow?.capturedAtMs ?? null,
        finalTransitionState,
        remainedInDestinationRoom:
          transitionRun?.afterSeam?.currentRoomId === transition.expectedRoomId,
        finalPlayRuntimePresent:
          captured.state?.activeScene?.mode === 'play'
          && Boolean(captured.state?.activeScene?.player),
        passed:
          transitionRun?.method === 'continuous-keyboard-input'
          && transitionRun?.teleportsAfterKeyDown === 0
          && transitionRun?.crossingDetected === true
          && transitionRun?.seamTiming?.seamHoldGatePassed === true
          && transitionRun?.beforeSeam?.mode === 'play'
          && transitionRun?.beforeSeam?.currentRoomId === transition.sourceRoomId
          && transitionRun?.atSeam?.mode === 'play'
          && transitionRun?.atSeam?.currentRoomId === transition.expectedRoomId
          && transitionRun?.atSeam?.currentFullRoomLoaded === true
          && transitionRun?.atSeam?.currentCollisionReady === true
          && transitionRun?.atSeam?.currentTerrainColliderActive === true
          && transitionRun?.afterSeam?.mode === 'play'
          && transitionRun?.afterSeam?.currentFullRoomLoaded === true
          && transitionRun?.afterSeam?.currentCollisionReady === true
          && transitionRun?.afterSeam?.currentTerrainColliderActive === true
          && transitionRun?.afterSeam?.currentRoomId === transition.expectedRoomId
          && postCrossingInvariant?.passed === true
          && finalTransitionState?.passed === true
          && Boolean(transitionRun?.beforeSeam?.player)
          && Boolean(transitionRun?.atSeam?.player)
          && Boolean(transitionRun?.afterSeam?.player)
          && Boolean(captured.state?.activeScene?.player)
          && motionAcrossSeam
          && motionAfterSeam
          && velocityAtSeamInExpectedDirection
          && velocityAfterSeamInExpectedDirection
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
    frameWorkGate: 'Phaser update work measured on a 4x CPU-throttled mobile viewport; room-transition runs use the profiler captured immediately after the seam so stalls cannot age out.',
    profilerGate,
    runtimeCounterGate,
    transitionRuntimeCounterAggregate,
    transitionAssertion,
    transitionAggregate,
    transitionRuns: transitionRuns.length > 0 ? transitionRuns : null,
    transitionSamples: transitionRun?.samples ?? null,
    transitionWindowProfiler: transitionRun?.transitionWindow?.profiler ?? null,
    transitionWindowState: transitionRun?.transitionWindow?.state ?? null,
    profiler: captured.profiler,
    gc,
    tracePath,
    state: captured.state,
    errors,
    passed:
      profilerGate.passed
      && runtimeCounterGate.passed
      && (transitionRuntimeCounterAggregate?.passed ?? true)
      && errors.length === 0
      && (transitionAssertion?.passed ?? true)
      && (transitionAggregate?.passed ?? true),
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
    profilerGate,
    runtimeCounterGate,
    transitionRuntimeCounterAggregate,
    gc,
    errors: errors.length,
    transitionAssertion,
    transitionAggregate,
    passed: result.passed,
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

const isMain = process.argv[1]
  && fs.existsSync(process.argv[1])
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
