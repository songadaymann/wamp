import { describe, expect, it, vi } from 'vitest';
import {
  PERFORMANCE_ADVISOR_THRESHOLDS,
  RuntimePerformanceAdvisor,
  type PerformanceAdvisorFrameSample,
  type PerformanceAdvisorSuggestionEvent,
} from './performanceAdvisor';

const READY_AT_MS = PERFORMANCE_ADVISOR_THRESHOLDS.startupIgnoreMs;

type FrameValues = Omit<PerformanceAdvisorFrameSample, 'atMs'>;

const GOOD_FRAME: FrameValues = {
  frameDeltaMs: 16,
  criticalUpdateMs: 5,
  schedulerHeadroomMs: 8,
};

const BAD_FRAME: FrameValues = {
  frameDeltaMs: 40,
  criticalUpdateMs: 12,
  schedulerHeadroomMs: 8,
};

function addBucket(
  advisor: RuntimePerformanceAdvisor,
  startedAtMs: number,
  frameCount: number,
  values: FrameValues | ((index: number) => FrameValues),
): void {
  for (let index = 0; index < frameCount; index += 1) {
    const frame = typeof values === 'function' ? values(index) : values;
    advisor.recordFrame({
      atMs: startedAtMs + index * (900 / Math.max(1, frameCount)),
      ...frame,
    });
  }
  advisor.tick(startedAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.bucketMs);
}

function addBadOrGoodBuckets(
  advisor: RuntimePerformanceAdvisor,
  pattern: readonly boolean[],
  startedAtMs = READY_AT_MS,
): void {
  pattern.forEach((bad, index) => {
    addBucket(
      advisor,
      startedAtMs + index * PERFORMANCE_ADVISOR_THRESHOLDS.bucketMs,
      10,
      bad ? BAD_FRAME : GOOD_FRAME,
    );
  });
}

function recordUnpreparedTransition(
  advisor: RuntimePerformanceAdvisor,
  atMs: number,
  overrides: Partial<{
    progressRevision: number | null;
    urgentWorkQueued: boolean;
    schedulerStarved: boolean;
  }> = {},
): void {
  advisor.recordTransitionGate({
    atMs,
    fromRoomId: '0,0',
    toRoomId: '1,0',
    reason: 'unprepared',
    generation: 4,
    progressRevision: overrides.progressRevision ?? 1,
    urgentWorkQueued: overrides.urgentWorkQueued ?? true,
    schedulerStarved: overrides.schedulerStarved ?? true,
  });
}

describe('RuntimePerformanceAdvisor frame evidence', () => {
  it('ignores startup, then imposes a fresh five-second quiet window after reset', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });

    addBucket(advisor, 0, 10, BAD_FRAME);
    advisor.tick(READY_AT_MS - 1);
    expect(advisor.getDebugState().state).toBe('warming');
    expect(advisor.getDebugState().rollingBuckets).toHaveLength(0);

    advisor.tick(READY_AT_MS);
    expect(advisor.getDebugState().state).toBe('observing');
    addBucket(advisor, READY_AT_MS, 10, GOOD_FRAME);
    expect(advisor.getDebugState().rollingBuckets).toHaveLength(1);

    const resetAtMs = READY_AT_MS + 1_000;
    advisor.resetEvidence('resize', resetAtMs);
    expect(advisor.getDebugState().rollingBuckets).toHaveLength(0);
    expect(advisor.getDebugState().quietRemainingMs).toBe(5_000);

    addBucket(advisor, resetAtMs, 10, BAD_FRAME);
    advisor.tick(resetAtMs + 4_999);
    expect(advisor.getDebugState().rollingBuckets).toHaveLength(0);
    advisor.tick(resetAtMs + 5_000);
    expect(advisor.getDebugState().state).toBe('observing');
  });

  it.each([
    {
      label: '45 FPS',
      frameCount: 10,
      frame: () => ({ ...BAD_FRAME, frameDeltaMs: 1_000 / 45 }),
      assertion: (bucket: ReturnType<RuntimePerformanceAdvisor['getDebugState']>['rollingBuckets'][number]) => {
        expect(bucket.approximateFps).toBeCloseTo(45, 8);
      },
    },
    {
      label: '25 ms frame p95',
      frameCount: 20,
      frame: (index: number) => ({
        ...BAD_FRAME,
        frameDeltaMs: index >= 18 ? 25 : 18,
      }),
      assertion: (bucket: ReturnType<RuntimePerformanceAdvisor['getDebugState']>['rollingBuckets'][number]) => {
        expect(bucket.frameP95Ms).toBe(25);
      },
    },
    {
      label: '10 percent of frames over 33.4 ms',
      frameCount: 10,
      frame: (index: number) => ({
        ...BAD_FRAME,
        frameDeltaMs: index === 9 ? 34 : 16,
      }),
      assertion: (bucket: ReturnType<RuntimePerformanceAdvisor['getDebugState']>['rollingBuckets'][number]) => {
        expect(bucket.over33FrameRatio).toBe(0.1);
      },
    },
  ])('treats the inclusive frame-pressure boundary for $label as pressure', ({
    frameCount,
    frame,
    assertion,
  }) => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    addBucket(advisor, READY_AT_MS, frameCount, frame);
    const bucket = advisor.getDebugState().rollingBuckets[0];
    assertion(bucket);
    expect(bucket.framePressure).toBe(true);
    expect(bucket.bad).toBe(true);
  });

  it.each([
    {
      label: '12 ms update p95',
      frame: (_index: number): FrameValues => ({
        frameDeltaMs: 40,
        criticalUpdateMs: 12,
        schedulerHeadroomMs: 8,
      }),
    },
    {
      label: '30 percent low scheduler headroom',
      frame: (index: number): FrameValues => ({
        frameDeltaMs: 40,
        criticalUpdateMs: 5,
        schedulerHeadroomMs: index < 3 ? 1 : 8,
      }),
    },
    {
      label: 'a long task',
      frame: (index: number): FrameValues => ({
        frameDeltaMs: 40,
        criticalUpdateMs: 5,
        schedulerHeadroomMs: 8,
        longTaskCount: index === 0 ? 1 : 0,
      }),
    },
  ])('accepts $label as critical corroboration', ({ frame }) => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    addBucket(advisor, READY_AT_MS, 10, frame);
    const bucket = advisor.getDebugState().rollingBuckets[0];
    expect(bucket.framePressure).toBe(true);
    expect(bucket.criticalCorroboration).toBe(true);
    expect(bucket.bad).toBe(true);
  });

  it('requires both frame pressure and critical corroboration', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    addBucket(advisor, READY_AT_MS, 10, {
      frameDeltaMs: 40,
      criticalUpdateMs: 5,
      schedulerHeadroomMs: 8,
    });
    addBucket(advisor, READY_AT_MS + 1_000, 10, {
      frameDeltaMs: 16,
      criticalUpdateMs: 12,
      schedulerHeadroomMs: 8,
    });

    const [pressureOnly, corroborationOnly] = advisor.getDebugState().rollingBuckets;
    expect(pressureOnly).toMatchObject({
      framePressure: true,
      criticalCorroboration: false,
      bad: false,
    });
    expect(corroborationOnly).toMatchObject({
      framePressure: false,
      criticalCorroboration: true,
      bad: false,
    });
  });

  it('suggests only after 8 of 10 bad buckets including the latest three', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    addBadOrGoodBuckets(advisor, [true, true, true, true, true, false, false, true, true, true]);

    expect(advisor.getSuggestion()?.reason).toBe('sustained-frame-pressure');
    expect(advisor.getSuggestion()?.evidence).toMatchObject({
      type: 'rolling-buckets',
      badBucketCount: 8,
      bucketCount: 10,
      latestConsecutiveBadBuckets: 3,
    });
  });

  it('does not suggest for seven bad buckets or eight with a broken latest-three streak', () => {
    const sevenBad = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    sevenBad.tick(READY_AT_MS);
    addBadOrGoodBuckets(
      sevenBad,
      [true, true, true, true, false, false, false, true, true, true],
    );
    expect(sevenBad.getSuggestion()).toBeNull();

    const brokenStreak = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    brokenStreak.tick(READY_AT_MS);
    addBadOrGoodBuckets(
      brokenStreak,
      [true, true, true, true, true, true, true, true, false, false],
    );
    expect(brokenStreak.getSuggestion()).toBeNull();
  });

  it('uses the separate healthy-update render path after three qualifying buckets', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    const renderFrame = (index: number): FrameValues => ({
      frameDeltaMs: index < 2 ? 60 : 30,
      criticalUpdateMs: 5,
      schedulerHeadroomMs: 8,
    });

    addBucket(advisor, READY_AT_MS, 30, renderFrame);
    addBucket(advisor, READY_AT_MS + 1_000, 30, renderFrame);
    expect(advisor.getSuggestion()).toBeNull();
    addBucket(advisor, READY_AT_MS + 2_000, 30, renderFrame);

    expect(advisor.getSuggestion()?.reason).toBe('render-gpu-pressure');
    expect(advisor.getDebugState().rollingBadBucketCount).toBe(0);
  });

  it('does not use the render path when update p95 is unhealthy', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    const renderFrame = (index: number): FrameValues => ({
      frameDeltaMs: index < 2 ? 60 : 30,
      criticalUpdateMs: 12,
      schedulerHeadroomMs: 8,
    });
    for (let bucket = 0; bucket < 3; bucket += 1) {
      addBucket(advisor, READY_AT_MS + bucket * 1_000, 30, renderFrame);
    }
    expect(advisor.getSuggestion()).toBeNull();
    expect(advisor.getDebugState().renderConsecutiveBucketCount).toBe(0);
  });
});

describe('RuntimePerformanceAdvisor transition and network evidence', () => {
  it('requires a full 750 ms unprepared stall with urgent queued starvation', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    recordUnpreparedTransition(advisor, READY_AT_MS);

    advisor.tick(READY_AT_MS + 749);
    expect(advisor.getSuggestion()).toBeNull();
    advisor.tick(READY_AT_MS + 750);
    expect(advisor.getSuggestion()?.reason).toBe('transition-starvation');
  });

  it('restarts the transition timer on destination progress', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    recordUnpreparedTransition(advisor, READY_AT_MS);
    advisor.recordDestinationProgress('1,0', 4, 2, READY_AT_MS + 700);

    advisor.tick(READY_AT_MS + 750);
    expect(advisor.getSuggestion()).toBeNull();
    advisor.tick(READY_AT_MS + 1_449);
    expect(advisor.getSuggestion()).toBeNull();
    advisor.tick(READY_AT_MS + 1_450);
    expect(advisor.getSuggestion()?.reason).toBe('transition-starvation');
  });

  it.each([
    { interruptedCondition: 'urgent work', overrides: { urgentWorkQueued: false } },
    { interruptedCondition: 'scheduler starvation', overrides: { schedulerStarved: false } },
  ])(
    'requires a fresh 750 ms after $interruptedCondition is interrupted',
    ({ overrides }) => {
      const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
      advisor.tick(READY_AT_MS);
      recordUnpreparedTransition(advisor, READY_AT_MS);
      recordUnpreparedTransition(advisor, READY_AT_MS + 700, overrides);
      recordUnpreparedTransition(advisor, READY_AT_MS + 1_000);

      advisor.tick(READY_AT_MS + 1_749);
      expect(advisor.getSuggestion()).toBeNull();
      advisor.tick(READY_AT_MS + 1_750);
      expect(advisor.getSuggestion()?.reason).toBe('transition-starvation');
    },
  );

  it('clears an abandoned transition gate before it can become a stall', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    recordUnpreparedTransition(advisor, READY_AT_MS);

    advisor.tick(READY_AT_MS + 700);
    advisor.clearTransitionGate(READY_AT_MS + 700);
    advisor.tick(READY_AT_MS + 2_000);

    expect(advisor.getSuggestion()).toBeNull();
    expect(advisor.getDebugState().activeTransition).toBeNull();
  });

  it('never counts locked gates or unprepared gates without both scheduler conditions', () => {
    const locked = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    locked.tick(READY_AT_MS);
    locked.recordTransitionGate({
      atMs: READY_AT_MS,
      fromRoomId: '0,0',
      toRoomId: '1,0',
      reason: 'locked',
      generation: null,
      progressRevision: null,
      urgentWorkQueued: true,
      schedulerStarved: true,
    });
    locked.tick(READY_AT_MS + 2_000);
    expect(locked.getSuggestion()).toBeNull();

    for (const overrides of [
      { urgentWorkQueued: false },
      { schedulerStarved: false },
    ]) {
      const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
      advisor.tick(READY_AT_MS);
      recordUnpreparedTransition(advisor, READY_AT_MS, overrides);
      advisor.tick(READY_AT_MS + 2_000);
      expect(advisor.getSuggestion()).toBeNull();
    }
  });

  it('requires two competing 1.5 second exact-snapshot incidents within ten minutes', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    advisor.recordExactSnapshot({
      phase: 'started',
      atMs: READY_AT_MS,
      roomId: '1,0',
      generation: 1,
    });
    advisor.recordExactSnapshot({
      phase: 'optional-competition',
      atMs: READY_AT_MS + 100,
      roomId: '1,0',
      generation: 1,
    });
    advisor.recordExactSnapshot({
      phase: 'settled',
      outcome: 'success',
      atMs: READY_AT_MS + 1_500,
      roomId: '1,0',
      generation: 1,
    });
    expect(advisor.getSuggestion()).toBeNull();

    advisor.recordExactSnapshot({
      phase: 'started',
      atMs: READY_AT_MS + 2_000,
      roomId: '2,0',
      generation: 2,
      optionalCompetitionObserved: true,
    });
    advisor.recordExactSnapshot({
      phase: 'settled',
      outcome: 'success',
      atMs: READY_AT_MS + 3_500,
      roomId: '2,0',
      generation: 2,
    });

    expect(advisor.getSuggestion()?.reason).toBe('network-contention');
    expect(advisor.getSuggestion()?.evidence).toMatchObject({
      type: 'network-incidents',
      incidentCount: 2,
      delayedForMs: 1_500,
    });
  });

  it('suggests for one competing exact-snapshot delay at 3 seconds', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    advisor.recordExactSnapshot({
      phase: 'started',
      atMs: READY_AT_MS,
      roomId: '1,0',
      generation: 1,
      optionalCompetitionObserved: true,
    });
    advisor.tick(READY_AT_MS + 2_999);
    expect(advisor.getSuggestion()).toBeNull();
    advisor.tick(READY_AT_MS + 3_000);
    expect(advisor.getSuggestion()?.reason).toBe('network-contention');
    expect(advisor.getSuggestion()?.evidence).toMatchObject({
      type: 'network-incidents',
      incidentCount: 1,
      delayedForMs: 3_000,
    });
  });

  it.each([
    {
      label: 'startup window',
      prepare(_advisor: RuntimePerformanceAdvisor) {
        return {
          startedAtMs: READY_AT_MS - PERFORMANCE_ADVISOR_THRESHOLDS.networkLongDelayMs,
          eligibleAtMs: READY_AT_MS,
        };
      },
    },
    {
      label: 'reset quiet window',
      prepare(advisor: RuntimePerformanceAdvisor) {
        advisor.tick(READY_AT_MS);
        const resetAtMs = READY_AT_MS + 1_000;
        advisor.resetEvidence('resize', resetAtMs);
        return {
          startedAtMs: resetAtMs + 1_000,
          eligibleAtMs: resetAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.resetQuietMs,
        };
      },
    },
  ])('counts exact-snapshot delay only after the $label', ({ prepare }) => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    const { startedAtMs, eligibleAtMs } = prepare(advisor);
    advisor.recordExactSnapshot({
      phase: 'started',
      atMs: startedAtMs,
      roomId: '1,0',
      generation: 1,
      optionalCompetitionObserved: true,
    });

    advisor.tick(eligibleAtMs);
    expect(advisor.getSuggestion()).toBeNull();
    advisor.tick(eligibleAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.networkLongDelayMs - 1);
    expect(advisor.getSuggestion()).toBeNull();
    advisor.tick(eligibleAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.networkLongDelayMs);
    expect(advisor.getSuggestion()?.reason).toBe('network-contention');
    expect(advisor.getSuggestion()?.evidence).toMatchObject({
      type: 'network-incidents',
      delayedForMs: PERFORMANCE_ADVISOR_THRESHOLDS.networkLongDelayMs,
    });
  });

  it('does not count a delay without optional competition or a cancelled request', () => {
    const noCompetition = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    noCompetition.tick(READY_AT_MS);
    noCompetition.recordExactSnapshot({
      phase: 'started',
      atMs: READY_AT_MS,
      roomId: '1,0',
      generation: 1,
    });
    noCompetition.tick(READY_AT_MS + 4_000);
    expect(noCompetition.getSuggestion()).toBeNull();
    expect(noCompetition.getDebugState().lastNetworkIncidentAtMs).toBeNull();

    const cancelled = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    cancelled.tick(READY_AT_MS);
    cancelled.recordExactSnapshot({
      phase: 'started',
      atMs: READY_AT_MS,
      roomId: '1,0',
      generation: 1,
      optionalCompetitionObserved: true,
    });
    cancelled.recordExactSnapshot({
      phase: 'settled',
      outcome: 'cancelled',
      atMs: READY_AT_MS + 3_000,
      roomId: '1,0',
      generation: 1,
    });
    expect(cancelled.getSuggestion()).toBeNull();
    expect(cancelled.getDebugState().lastNetworkIncidentAtMs).toBeNull();
  });
});

describe('RuntimePerformanceAdvisor suggestion lifecycle', () => {
  it('expires a suggestion after two minutes and emits typed lifecycle events once', () => {
    const events: PerformanceAdvisorSuggestionEvent[] = [];
    const advisor = new RuntimePerformanceAdvisor({
      startedAtMs: 0,
      onSuggestionEvent: (event) => events.push(event),
    });
    advisor.tick(READY_AT_MS);
    recordUnpreparedTransition(advisor, READY_AT_MS);
    advisor.tick(READY_AT_MS + 750);
    const suggestion = advisor.getSuggestion();
    expect(suggestion).not.toBeNull();

    advisor.tick(suggestion!.expiresAtMs - 1);
    expect(advisor.getSuggestion()).not.toBeNull();
    advisor.tick(suggestion!.expiresAtMs);
    expect(advisor.getSuggestion()).toBeNull();
    expect(events.map((event) => event.type)).toEqual([
      'suggestion-created',
      'suggestion-expired',
    ]);

    recordUnpreparedTransition(advisor, suggestion!.expiresAtMs + 1);
    advisor.tick(suggestion!.expiresAtMs + 2_000);
    expect(advisor.getSuggestion()).toBeNull();
    expect(advisor.getDebugState().suggestionCreatedThisSession).toBe(true);
  });

  it('suppresses all evidence outside Auto and clears a queued Auto suggestion', () => {
    const onSuggestionEvent = vi.fn<(event: PerformanceAdvisorSuggestionEvent) => void>();
    const advisor = new RuntimePerformanceAdvisor({
      startedAtMs: 0,
      onSuggestionEvent,
    });
    advisor.tick(READY_AT_MS);
    recordUnpreparedTransition(advisor, READY_AT_MS);
    advisor.tick(READY_AT_MS + 750);
    expect(advisor.getSuggestion()).not.toBeNull();

    advisor.setMode('battery-saver', READY_AT_MS + 751);
    expect(advisor.getSuggestion()).toBeNull();
    expect(advisor.getDebugState().state).toBe('suppressed');
    expect(onSuggestionEvent.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'suggestion-cleared',
      clearReason: 'mode-selected',
    });

    recordUnpreparedTransition(advisor, READY_AT_MS + 1_000);
    advisor.tick(READY_AT_MS + 5_000);
    expect(advisor.getSuggestion()).toBeNull();
    expect(advisor.getDebugState().activeTransition).toBeNull();
  });

  it('discards ineligible evidence and waits five seconds after eligibility returns', () => {
    const advisor = new RuntimePerformanceAdvisor({ startedAtMs: 0 });
    advisor.tick(READY_AT_MS);
    advisor.setEligibility(false, READY_AT_MS);
    addBadOrGoodBuckets(advisor, new Array(10).fill(true), READY_AT_MS);
    expect(advisor.getSuggestion()).toBeNull();
    expect(advisor.getDebugState().state).toBe('inactive');

    const restoredAtMs = READY_AT_MS + 10_000;
    advisor.setEligibility(true, restoredAtMs);
    expect(advisor.getDebugState().quietRemainingMs).toBe(5_000);
    addBucket(advisor, restoredAtMs, 10, BAD_FRAME);
    expect(advisor.getDebugState().rollingBuckets).toHaveLength(0);
    advisor.tick(restoredAtMs + 5_000);
    expect(advisor.getDebugState().state).toBe('observing');
  });
});
