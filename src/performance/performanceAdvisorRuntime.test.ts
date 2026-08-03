import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDevicePerformanceMode,
  setDevicePerformanceMode,
} from './devicePerformanceMode';
import {
  PERFORMANCE_ADVISOR_THRESHOLDS,
  type PerformanceAdvisorSuggestionEvent,
} from './performanceAdvisor';
import {
  PERFORMANCE_ADVISOR_SUGGESTION_EVENT,
  PerformanceAdvisorRuntime,
  subscribePerformanceAdvisorSuggestionEvents,
} from './performanceAdvisorRuntime';

interface RuntimeHarness {
  readonly runtime: PerformanceAdvisorRuntime;
  readonly target: EventTarget;
  readonly clock: {
    monotonicMs: number;
    wallMs: number;
  };
}

const runtimes: PerformanceAdvisorRuntime[] = [];

beforeEach(() => {
  setDevicePerformanceMode('auto');
});

afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.destroy();
  }
  setDevicePerformanceMode('auto');
  vi.restoreAllMocks();
});

function createHarness(options: {
  readonly coolingDown?: boolean;
  readonly wallMs?: number;
} = {}): RuntimeHarness {
  const clock = {
    monotonicMs: 0,
    wallMs: options.wallMs ?? 1_000,
  };
  const target = new EventTarget();
  const runtime = new PerformanceAdvisorRuntime({
    monotonicNow: () => clock.monotonicMs,
    wallNow: () => clock.wallMs,
    eventTarget: target,
    cooldownStore: {
      isCoolingDown: vi.fn(() => options.coolingDown ?? false),
    },
  });
  runtimes.push(runtime);
  return { runtime, target, clock };
}

function triggerTransitionSuggestion(harness: RuntimeHarness): void {
  const readyAtMs = PERFORMANCE_ADVISOR_THRESHOLDS.startupIgnoreMs;
  harness.runtime.advisor.setEligibility(true, 0);
  harness.clock.monotonicMs = readyAtMs;
  harness.runtime.advisor.tick(readyAtMs);
  harness.runtime.advisor.recordTransitionGate({
    atMs: readyAtMs,
    fromRoomId: '0,0',
    toRoomId: '1,0',
    reason: 'unprepared',
    generation: 7,
    progressRevision: 2,
    urgentWorkQueued: true,
    schedulerStarved: true,
  });
  harness.clock.monotonicMs = readyAtMs
    + PERFORMANCE_ADVISOR_THRESHOLDS.transitionStallMs;
  harness.runtime.advisor.tick(harness.clock.monotonicMs);
}

describe('PerformanceAdvisorRuntime', () => {
  it('suppresses the suggestion-created event while the device cooldown is active', () => {
    const harness = createHarness({ coolingDown: true, wallMs: 42_000 });
    const suggestionEvents: PerformanceAdvisorSuggestionEvent[] = [];
    harness.target.addEventListener(PERFORMANCE_ADVISOR_SUGGESTION_EVENT, (event) => {
      suggestionEvents.push((event as CustomEvent<PerformanceAdvisorSuggestionEvent>).detail);
    });

    triggerTransitionSuggestion(harness);

    expect(harness.runtime.getSuggestion()).toBeNull();
    expect(suggestionEvents.some((event) => event.type === 'suggestion-created')).toBe(false);
    expect(suggestionEvents).toEqual([
      expect.objectContaining({
        type: 'suggestion-cleared',
        clearReason: 'manual',
      }),
    ]);
  });

  it('clears a candidate and suppresses further evidence when device mode changes', () => {
    const harness = createHarness();
    const suggestionEvents: PerformanceAdvisorSuggestionEvent[] = [];
    const unsubscribe = subscribePerformanceAdvisorSuggestionEvents(
      (event) => suggestionEvents.push(event),
      harness.target,
    );
    triggerTransitionSuggestion(harness);
    expect(harness.runtime.getSuggestion()).not.toBeNull();

    harness.clock.monotonicMs += 1;
    setDevicePerformanceMode('battery-saver');

    expect(getDevicePerformanceMode()).toBe('battery-saver');
    expect(harness.runtime.getSuggestion()).toBeNull();
    expect(harness.runtime.advisor.getDebugState().state).toBe('suppressed');
    expect(suggestionEvents.at(-1)).toMatchObject({
      type: 'suggestion-cleared',
      clearReason: 'mode-selected',
    });

    harness.runtime.advisor.recordTransitionGate({
      atMs: harness.clock.monotonicMs,
      fromRoomId: '0,0',
      toRoomId: '1,0',
      reason: 'unprepared',
      generation: 8,
      progressRevision: 1,
      urgentWorkQueued: true,
      schedulerStarved: true,
    });
    harness.clock.monotonicMs += 2_000;
    harness.runtime.advisor.tick(harness.clock.monotonicMs);
    expect(harness.runtime.getSuggestion()).toBeNull();
    unsubscribe();
  });

  it('forwards created and expired lifecycle events to subscribers', () => {
    const harness = createHarness();
    const suggestionEvents: PerformanceAdvisorSuggestionEvent[] = [];
    const unsubscribe = subscribePerformanceAdvisorSuggestionEvents(
      (event) => suggestionEvents.push(event),
      harness.target,
    );

    triggerTransitionSuggestion(harness);
    const suggestion = harness.runtime.getSuggestion();
    expect(suggestion).not.toBeNull();
    harness.clock.monotonicMs = suggestion!.expiresAtMs;
    harness.runtime.advisor.tick(harness.clock.monotonicMs);

    expect(suggestionEvents).toEqual([
      expect.objectContaining({
        type: 'suggestion-created',
        suggestion: expect.objectContaining({ id: suggestion!.id }),
      }),
      expect.objectContaining({
        type: 'suggestion-expired',
        suggestionId: suggestion!.id,
      }),
    ]);
    unsubscribe();
  });

  it('requires the current suggestion id before dismissing', () => {
    const harness = createHarness();
    const suggestionEvents: PerformanceAdvisorSuggestionEvent[] = [];
    const unsubscribe = subscribePerformanceAdvisorSuggestionEvents(
      (event) => suggestionEvents.push(event),
      harness.target,
    );
    triggerTransitionSuggestion(harness);
    const suggestion = harness.runtime.getSuggestion();
    expect(suggestion).not.toBeNull();

    expect(harness.runtime.dismissSuggestion(suggestion!.id + 1)).toBe(false);
    expect(harness.runtime.getSuggestion()?.id).toBe(suggestion!.id);
    expect(harness.runtime.dismissSuggestion(suggestion!.id)).toBe(true);
    expect(harness.runtime.getSuggestion()).toBeNull();
    expect(suggestionEvents.at(-1)).toMatchObject({
      type: 'suggestion-cleared',
      suggestionId: suggestion!.id,
      clearReason: 'dismissed',
    });
    unsubscribe();
  });
});
