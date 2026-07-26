import { describe, expect, it, vi } from 'vitest';
import { installRenderLoopRecoveryMonitor } from './renderLoopRecovery';

describe('render loop recovery monitor', () => {
  it('does nothing while POST_RENDER remains current', () => {
    const harness = createHarness();
    harness.monitor.recordRender();
    harness.clock.advance(100);
    harness.monitor.notifyUserActivity();
    harness.clock.advance(600);
    harness.monitor.recordRender();
    harness.clock.advance(50);

    expect(harness.restartLoop).not.toHaveBeenCalled();
    expect(harness.monitor.getDebugState().restartCount).toBe(0);
  });

  it('restarts an orphaned RAF chain after input and a stale render heartbeat', () => {
    const harness = createHarness();
    harness.monitor.recordRender();
    harness.clock.advance(100);
    harness.monitor.notifyUserActivity();
    harness.clock.advance(650);

    expect(harness.restartLoop).toHaveBeenCalledOnce();
    expect(harness.monitor.getDebugState()).toMatchObject({
      restartCount: 1,
      consecutiveRestartAttempts: 1,
      lastRestartReason: 'user-activity',
    });

    harness.monitor.recordRender();
    harness.clock.advance(500);
    expect(harness.restartLoop).toHaveBeenCalledOnce();
    expect(harness.monitor.getDebugState().consecutiveRestartAttempts).toBe(0);
  });

  it('uses a runtime error as a stall signal without restarting a healthy loop', () => {
    const harness = createHarness();
    harness.monitor.recordRender();
    harness.clock.advance(20);
    harness.monitor.notifyRuntimeError({
      message: 'tile upload failed',
      source: 'main.js',
      line: 12,
      column: 4,
    });
    harness.clock.advance(200);
    harness.monitor.recordRender();
    harness.clock.advance(530);

    expect(harness.restartLoop).not.toHaveBeenCalled();
    expect(harness.monitor.getDebugState().lastRuntimeError).toEqual({
      message: 'tile upload failed',
      source: 'main.js',
      line: 12,
      column: 4,
    });
  });

  it('bounds unsuccessful restart attempts', () => {
    const harness = createHarness();
    harness.monitor.recordRender();
    harness.clock.advance(750);
    harness.monitor.notifyUserActivity();
    harness.clock.advance(0);
    harness.clock.advance(500);
    harness.clock.advance(500);

    expect(harness.restartLoop).toHaveBeenCalledTimes(2);
    expect(harness.monitor.getDebugState()).toMatchObject({
      restartCount: 2,
      consecutiveRestartAttempts: 2,
      exhaustedCount: 1,
    });
  });

  it('will not restart while recovery is ineligible', () => {
    const harness = createHarness({ eligible: false });
    harness.monitor.recordRender();
    harness.clock.advance(1_000);
    harness.monitor.notifyVisibilityResume();
    harness.clock.advance(0);

    expect(harness.restartLoop).not.toHaveBeenCalled();
  });
});

function createHarness(options: { eligible?: boolean } = {}) {
  const clock = new FakeClock(1_000);
  const restartLoop = vi.fn();
  const monitor = installRenderLoopRecoveryMonitor({
    now: () => clock.nowMs,
    scheduler: clock,
    restartLoop,
    isEligible: () => options.eligible ?? true,
    stallThresholdMs: 750,
    verificationDelayMs: 500,
  });
  return { clock, restartLoop, monitor };
}

class FakeClock {
  readonly timers = new Map<number, { dueAtMs: number; callback: () => void }>();
  nowMs: number;
  private nextTimerId = 1;

  constructor(nowMs: number) {
    this.nowMs = nowMs;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const timerId = this.nextTimerId++;
    this.timers.set(timerId, {
      dueAtMs: this.nowMs + Math.max(0, delayMs),
      callback,
    });
    return timerId;
  }

  clearTimeout(timer: unknown): void {
    this.timers.delete(Number(timer));
  }

  advance(elapsedMs: number): void {
    const targetMs = this.nowMs + elapsedMs;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAtMs <= targetMs)
        .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
      if (!next) break;
      const [timerId, timer] = next;
      this.timers.delete(timerId);
      this.nowMs = timer.dueAtMs;
      timer.callback();
    }
    this.nowMs = targetMs;
  }
}
