import { describe, expect, it } from 'vitest';
import {
  analyzeFinalTransitionState,
  analyzePostCrossingInvariantMonitor,
  analyzeProfilerGate,
  analyzeRuntimeCounterDelta,
  analyzeTransitionProfilerAggregate,
  analyzeTransitionRunAggregate,
  analyzeTransitionSamples,
  getNeighborTransition,
} from './runtime_performance_trace.mjs';

function transition(direction: 'right' | 'left' | 'down' | 'up') {
  const values = {
    right: { axis: 'x', motionSign: 1, seamCoordinate: 640, sourceRoomId: '0,0', expectedRoomId: '1,0' },
    left: { axis: 'x', motionSign: -1, seamCoordinate: 640, sourceRoomId: '1,0', expectedRoomId: '0,0' },
    down: { axis: 'y', motionSign: 1, seamCoordinate: 352, sourceRoomId: '0,0', expectedRoomId: '0,1' },
    up: { axis: 'y', motionSign: -1, seamCoordinate: 352, sourceRoomId: '0,1', expectedRoomId: '0,0' },
  } as const;
  return values[direction];
}

function sample({
  elapsed,
  room = '0,0',
  x = 600,
  y = 300,
  velocityX = 150,
  velocityY = 150,
  loaded = ['0,0'],
}: {
  elapsed: number;
  room?: string;
  x?: number;
  y?: number;
  velocityX?: number;
  velocityY?: number;
  loaded?: string[];
}) {
  return {
    elapsedSinceKeyDownMs: elapsed,
    currentRoomId: room,
    loadedFullRoomIds: loaded,
    player: {
      x,
      y,
      velocityX,
      velocityY,
      bodyWidth: 10,
      bodyHeight: 26,
    },
  };
}

describe('runtime room-transition seam timing', () => {
  it('retains an explicit authored opening and initial velocity for a transition route', () => {
    const route = getNeighborTransition('-1,1', 'up', {
      approachX: -496,
      approachY: 370,
      velocityX: 0,
      velocityY: -300,
    });

    expect(route.approachPosition).toEqual({ x: -496, y: 370 });
    expect(route.approachVelocity).toEqual({ x: 0, y: -300 });
    expect(route.expectedRoomId).toBe('-1,0');
  });

  it('reports zero seam hold when a warm rightward transition never stops', () => {
    const result = analyzeTransitionSamples([
      sample({ elapsed: 0, loaded: ['0,0', '1,0'] }),
      sample({ elapsed: 210, x: 633, loaded: ['0,0', '1,0'] }),
      sample({ elapsed: 240, room: '1,0', x: 643, loaded: ['0,0', '1,0'] }),
    ], transition('right'), {
      destinationLoadedBeforeKey: true,
      maxSeamHoldMs: 100,
    });

    expect(result.preparationState).toBe('warm');
    expect(result.keyDownToCrossingMs).toBe(240);
    expect(result.seamHoldDetected).toBe(false);
    expect(result.seamHoldMs).toBe(0);
    expect(result.seamHoldGatePassed).toBe(true);
  });

  it('separates cold approach time from an over-budget protected-seam stop', () => {
    const result = analyzeTransitionSamples([
      sample({ elapsed: 0 }),
      sample({ elapsed: 250, x: 634, velocityX: 0 }),
      sample({ elapsed: 360, x: 634, velocityX: 0, loaded: ['0,0', '1,0'] }),
      sample({ elapsed: 430, room: '1,0', x: 643, loaded: ['0,0', '1,0'] }),
    ], transition('right'), { maxSeamHoldMs: 100 });

    expect(result.preparationState).toBe('cold');
    expect(result.approachToNearSeamStopMs).toBe(250);
    expect(result.seamHoldMs).toBe(180);
    expect(result.destinationReadyMsAfterKeyDown).toBe(360);
    expect(result.destinationReadyLeadMs).toBe(70);
    expect(result.seamHoldGatePassed).toBe(false);
  });

  it('fails a warm transition as soon as a protected-seam hold is observed', () => {
    const result = analyzeTransitionSamples([
      sample({ elapsed: 0, loaded: ['0,0', '1,0'] }),
      sample({ elapsed: 250, x: 634, velocityX: 0, loaded: ['0,0', '1,0'] }),
      sample({ elapsed: 330, room: '1,0', x: 643, loaded: ['0,0', '1,0'] }),
    ], transition('right'), {
      destinationLoadedBeforeKey: true,
      maxSeamHoldMs: 100,
    });

    expect(result.preparationState).toBe('warm');
    expect(result.allowedSeamHoldMs).toBe(0);
    expect(result.seamHoldDetected).toBe(true);
    expect(result.seamHoldMs).toBe(80);
    expect(result.seamHoldGatePassed).toBe(false);
  });

  it('treats a fully prepared dormant destination as warm before activation', () => {
    const result = analyzeTransitionSamples([
      sample({ elapsed: 0 }),
      sample({ elapsed: 210, x: 633 }),
      sample({ elapsed: 240, room: '1,0', x: 643, loaded: ['0,0', '1,0'] }),
    ], transition('right'), {
      destinationLoadedBeforeKey: false,
      destinationPreparedBeforeKey: true,
      maxSeamHoldMs: 100,
    });

    expect(result.preparationState).toBe('warm');
    expect(result.destinationLoadedBeforeKey).toBe(false);
    expect(result.destinationPreparedBeforeKey).toBe(true);
    expect(result.allowedSeamHoldMs).toBe(0);
    expect(result.seamHoldGatePassed).toBe(true);
  });

  it('conservatively classifies first-rAF readiness as warm at the key boundary', () => {
    const first = {
      ...sample({ elapsed: 0 }),
      destinationRoomId: '1,0',
      destinationDormantReady: true,
    };
    const result = analyzeTransitionSamples([
      first,
      sample({ elapsed: 30, x: 634, velocityX: 0 }),
      sample({ elapsed: 60, room: '1,0', x: 643, loaded: ['0,0', '1,0'] }),
    ], transition('right'), {
      destinationPreparedBeforeKey: false,
      maxSeamHoldMs: 100,
    });

    expect(result.preparationState).toBe('warm');
    expect(result.destinationPreparedBeforeKey).toBe(true);
    expect(result.seamHoldGatePassed).toBe(false);
  });

  it.each([
    ['left', { room: '1,0', x: 646, y: 300, velocityX: 0, velocityY: 0 }],
    ['down', { room: '0,0', x: 320, y: 338, velocityX: 0, velocityY: 0 }],
    ['up', { room: '0,1', x: 320, y: 366, velocityX: 0, velocityY: 0 }],
  ] as const)('detects a direction-aware %s seam stop', (direction, stopped) => {
    const target = transition(direction);
    const result = analyzeTransitionSamples([
      sample({ elapsed: 60, ...stopped, loaded: [target.sourceRoomId] }),
      sample({ elapsed: 120, ...stopped, loaded: [target.sourceRoomId] }),
      sample({
        elapsed: 145,
        room: target.expectedRoomId,
        x: direction === 'left' ? 637 : 320,
        y: direction === 'up' ? 348 : direction === 'down' ? 356 : 300,
        velocityX: direction === 'left' ? -150 : 0,
        velocityY: direction === 'up' ? -150 : direction === 'down' ? 150 : 0,
        loaded: [target.sourceRoomId, target.expectedRoomId],
      }),
    ], target, { maxSeamHoldMs: 100 });

    expect(result.seamHoldDetected).toBe(true);
    expect(result.seamHoldMs).toBe(85);
    expect(result.seamHoldGatePassed).toBe(true);
  });

  it('marks an observed stop as censored when the transition never crosses', () => {
    const result = analyzeTransitionSamples([
      sample({ elapsed: 30, x: 634, velocityX: 0 }),
      sample({ elapsed: 230, x: 634, velocityX: 0 }),
    ], transition('right'), { maxSeamHoldMs: 100 });

    expect(result.seamHoldCensored).toBe(true);
    expect(result.seamHoldMs).toBe(200);
    expect(result.seamHoldGatePassed).toBe(false);
  });
});

describe('runtime room-transition aggregate gate', () => {
  it('computes cold p95 and requires zero hold for every warmed run', () => {
    const target = transition('right');
    const createRun = (preparationState: 'cold' | 'warm', seamHoldMs: number) => ({
      crossingDetected: true,
      beforeSeam: { currentRoomId: target.sourceRoomId },
      atSeam: {
        currentRoomId: target.expectedRoomId,
        currentFullRoomLoaded: true,
        currentCollisionReady: true,
        currentTerrainColliderActive: true,
      },
      afterSeam: {
        currentFullRoomLoaded: true,
        currentCollisionReady: true,
        currentTerrainColliderActive: true,
      },
      postCrossingInvariantAtTransitionWindow: { passed: true },
      seamTiming: {
        preparationState,
        keyDownToCrossingMs: 240,
        seamHoldCensored: false,
        seamHoldDetected: seamHoldMs > 0,
        seamHoldMs,
        seamHoldGatePassed: preparationState === 'cold' ? seamHoldMs <= 100 : seamHoldMs === 0,
      },
    });
    const result = analyzeTransitionRunAggregate([
      createRun('cold', 20),
      createRun('cold', 60),
      createRun('cold', 90),
      createRun('warm', 0),
      createRun('warm', 0),
    ], target, 100);

    expect(result).toMatchObject({
      runCount: 5,
      coldRunCount: 3,
      warmRunCount: 2,
      coldSeamHoldP95Ms: 90,
      maxWarmSeamHoldMs: 0,
      passed: true,
    });
  });

  it('fails when any warmed transition holds for even one sampled frame', () => {
    const target = transition('right');
    const result = analyzeTransitionRunAggregate([{
      crossingDetected: true,
      beforeSeam: { currentRoomId: target.sourceRoomId },
      atSeam: {
        currentRoomId: target.expectedRoomId,
        currentFullRoomLoaded: true,
        currentCollisionReady: true,
        currentTerrainColliderActive: true,
      },
      afterSeam: {
        currentFullRoomLoaded: true,
        currentCollisionReady: true,
        currentTerrainColliderActive: true,
      },
      postCrossingInvariantAtTransitionWindow: { passed: true },
      seamTiming: {
        preparationState: 'warm',
        keyDownToCrossingMs: 240,
        seamHoldCensored: false,
        seamHoldDetected: true,
        seamHoldMs: 16,
        seamHoldGatePassed: false,
      },
    }], target, 100);

    expect(result.checks.warmTransitionsHadZeroHold).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('cannot pass without the required cold and warm sample counts', () => {
    const target = transition('right');
    const warmOnly = analyzeTransitionRunAggregate([], target, 100);
    expect(warmOnly.checks.minimumColdRunsCaptured).toBe(false);
    expect(warmOnly.checks.minimumWarmRunsCaptured).toBe(false);
    expect(warmOnly.passed).toBe(false);
  });

  it('uses cold p95 rather than turning the cold gate into a max gate', () => {
    const target = transition('right');
    const makeRun = (seamHoldMs: number, preparationState: 'cold' | 'warm' = 'cold') => ({
      crossingDetected: true,
      beforeSeam: { currentRoomId: target.sourceRoomId },
      atSeam: {
        currentRoomId: target.expectedRoomId,
        currentFullRoomLoaded: true,
        currentCollisionReady: true,
        currentTerrainColliderActive: true,
      },
      afterSeam: {
        currentFullRoomLoaded: true,
        currentCollisionReady: true,
        currentTerrainColliderActive: true,
      },
      postCrossingInvariantAtTransitionWindow: { passed: true },
      seamTiming: {
        preparationState,
        keyDownToCrossingMs: 240,
        seamHoldCensored: false,
        seamHoldDetected: seamHoldMs > 0,
        seamHoldMs,
        seamHoldGatePassed: seamHoldMs <= 100,
      },
    });
    const result = analyzeTransitionRunAggregate([
      ...Array.from({ length: 19 }, () => makeRun(80)),
      makeRun(180),
      makeRun(0, 'warm'),
    ], target, 100);

    expect(result.coldSeamHoldP95Ms).toBe(80);
    expect(result.maxColdSeamHoldMs).toBe(180);
    expect(result.passed).toBe(true);
  });
});

describe('runtime transition profiler aggregate', () => {
  it('gates the median of at least three transition-window update p95 captures', () => {
    const runs = [18, 10, 14].map((p95) => ({
      transitionWindow: { profiler: { updateMs: { p95 } } },
    }));

    expect(analyzeTransitionProfilerAggregate(runs, 20, 3)).toMatchObject({
      sampleCount: 3,
      individualP95Ms: [18, 10, 14],
      p95Ms: 14,
      passed: true,
    });
    expect(analyzeTransitionProfilerAggregate(runs.slice(0, 2), 20, 3).passed).toBe(false);
  });

  it('averages the middle two captures when an even number remain', () => {
    const runs = [10, 19, 21, 30].map((p95) => ({
      transitionWindow: { profiler: { updateMs: { p95 } } },
    }));

    expect(analyzeTransitionProfilerAggregate(runs, 20, 3)).toMatchObject({
      sampleCount: 4,
      p95Ms: 20,
      passed: false,
    });
  });
});

function renderedState({
  roomId = '1,0',
  cloneCount = 3,
  jobsOver50Ms = 0,
  failedJobs = 0,
  loadedFullRoomIds = ['0,0', '1,0'],
  currentFullRoomLoaded = true,
  currentCollisionReady = true,
  currentTerrainColliderActive = true,
  mode = 'play',
  player = { x: 650, y: 300 },
} = {}) {
  const [x, y] = roomId.split(',').map(Number);
  return {
    activeScene: {
      currentRoom: { x, y },
      loadedFullRoomIds,
      currentFullRoomLoaded,
      currentCollisionReady,
      currentTerrainColliderActive,
      mode,
      player,
      lodMetrics: {
        roomSnapshotCloneCount: cloneCount,
        frameWork: { jobsOver50Ms, failedJobs },
      },
    },
  };
}

describe('runtime performance release gates', () => {
  it('requires zero steady snapshot clones and zero absolute scheduler failures', () => {
    const baseline = renderedState();
    expect(analyzeRuntimeCounterDelta(baseline, renderedState()).passed).toBe(true);

    const changed = analyzeRuntimeCounterDelta(baseline, renderedState({
      cloneCount: 4,
      jobsOver50Ms: 1,
      failedJobs: 1,
    }));
    expect(changed).toMatchObject({
      delta: {
        roomSnapshotCloneCount: 1,
        frameWork: { jobsOver50Ms: 1, failedJobs: 1 },
      },
      passed: false,
    });
  });

  it('does not hide a scheduler long job that happened before the measurement baseline', () => {
    const baseline = renderedState({ jobsOver50Ms: 1 });
    const unchangedFinal = renderedState({ jobsOver50Ms: 1 });
    expect(analyzeRuntimeCounterDelta(baseline, unchangedFinal)).toMatchObject({
      delta: { frameWork: { jobsOver50Ms: 0 } },
      checks: { zeroSchedulerLongJobs: false },
      passed: false,
    });
  });

  it('fails closed when a required runtime counter is absent', () => {
    const baseline = renderedState();
    const finalState = renderedState();
    delete (finalState.activeScene.lodMetrics.frameWork as { failedJobs?: number }).failedJobs;
    expect(analyzeRuntimeCounterDelta(baseline, finalState)).toMatchObject({
      delta: { frameWork: { failedJobs: null } },
      passed: false,
    });
  });

  it('fails the per-frame invariant when the player falls beyond the destination', () => {
    const result = analyzePostCrossingInvariantMonitor({
      crossingSeen: true,
      framesBeforeCrossing: 4,
      parseErrorCount: 0,
      samples: [
        {
          capturedAtMs: 100,
          currentRoomId: '1,0',
          destinationLoaded: true,
          currentFullRoomLoaded: true,
          currentCollisionReady: true,
          currentTerrainColliderActive: true,
        },
        {
          capturedAtMs: 116,
          currentRoomId: '2,0',
          destinationLoaded: true,
          currentFullRoomLoaded: true,
          currentCollisionReady: true,
          currentTerrainColliderActive: true,
        },
      ],
    }, '1,0');

    expect(result.sampleCount).toBe(2);
    expect(result.violations[0]).toMatchObject({
      currentRoomId: '2,0',
      reasons: ['unexpected-current-room'],
    });
    expect(result.passed).toBe(false);
  });

  it('fails the per-frame invariant when full collision infrastructure is not ready', () => {
    const result = analyzePostCrossingInvariantMonitor({
      crossingSeen: true,
      parseErrorCount: 0,
      samples: [{
        capturedAtMs: 100,
        currentRoomId: '1,0',
        destinationLoaded: true,
        currentFullRoomLoaded: true,
        currentCollisionReady: false,
        currentTerrainColliderActive: true,
      }],
    }, '1,0');

    expect(result.violations[0]?.reasons).toEqual(['destination-collision-not-ready']);
    expect(result.passed).toBe(false);
  });

  it('requires the final capture to remain in the collision-ready destination', () => {
    expect(analyzeFinalTransitionState(renderedState(), '1,0').passed).toBe(true);
    expect(analyzeFinalTransitionState(renderedState({ roomId: '2,0' }), '1,0')).toMatchObject({
      actualRoomId: '2,0',
      passed: false,
    });
    expect(analyzeFinalTransitionState(renderedState({
      currentCollisionReady: false,
    }), '1,0')).toMatchObject({
      actualRoomId: '1,0',
      currentCollisionReady: false,
      passed: false,
    });
  });

  it('uses the immediate transition-window profiler so a stall cannot age out', () => {
    const finalProfiler = { updateMs: { p95: 2 } };
    const transitionWindowProfiler = { updateMs: { p95: 27 } };
    expect(analyzeProfilerGate({
      scenario: 'room-transition',
      finalProfiler,
      transitionWindowProfiler,
      maxP95Ms: 20,
    })).toEqual({
      captureSource: 'transition-window-after-seam',
      capturePresent: true,
      p95Ms: 27,
      maxP95Ms: 20,
      passed: false,
    });
  });

  it('fails closed when the required transition-window profiler was not captured', () => {
    const gate = analyzeProfilerGate({
      scenario: 'room-transition',
      finalProfiler: { updateMs: { p95: 2 } },
      transitionWindowProfiler: null,
      maxP95Ms: 20,
    });
    expect(gate.capturePresent).toBe(false);
    expect(gate.passed).toBe(false);
  });
});
