import { describe, expect, it, vi } from 'vitest';
import { DynamicOverlayReadinessCoordinator } from './dynamicOverlayReadinessCoordinator';

describe('dynamic overlay readiness coordinator', () => {
  it('aborts the previous readiness generation and rejects obsolete waits', async () => {
    const coordinator = new DynamicOverlayReadinessCoordinator();
    coordinator.beginReadiness(7);
    const firstSignal = coordinator.getReadinessSignal();
    const waitForTargetLodReady = vi.fn(async () => true);

    coordinator.beginReadiness(8);

    expect(firstSignal?.aborted).toBe(true);
    expect(coordinator.getReadinessGeneration()).toBe(8);
    await expect(coordinator.waitForTargetLod({
      generation: 7,
      isGenerationCurrent: () => false,
      isBrowseCutoverActive: () => true,
      waitForTargetLodReady,
      onCurrentReadinessStopped: vi.fn(),
    })).resolves.toBe(false);
    expect(waitForTargetLodReady).not.toHaveBeenCalled();
  });

  it('passes the current abort signal and reports readiness that stops after waiting', async () => {
    const coordinator = new DynamicOverlayReadinessCoordinator();
    const pending = deferred<boolean>();
    let cutover = true;
    const onCurrentReadinessStopped = vi.fn();
    coordinator.beginReadiness(4);

    const result = coordinator.waitForTargetLod({
      generation: 4,
      isGenerationCurrent: () => true,
      isBrowseCutoverActive: () => cutover,
      waitForTargetLodReady: (signal) => {
        expect(signal).toBe(coordinator.getReadinessSignal());
        return pending.promise;
      },
      onCurrentReadinessStopped,
    });
    cutover = false;
    pending.resolve(true);

    await expect(result).resolves.toBe(false);
    expect(onCurrentReadinessStopped).toHaveBeenCalledOnce();
  });

  it('uses the exact capped retry sequence and suppresses overlapping timers', () => {
    const coordinator = new DynamicOverlayReadinessCoordinator();
    const delays: number[] = [];
    const callbacks: Array<() => void> = [];
    const remove = vi.fn();
    const retry = vi.fn();
    const options = {
      generation: 3,
      schedule: (delayMs: number, callback: () => void) => {
        delays.push(delayMs);
        callbacks.push(callback);
        return { remove };
      },
      isGenerationCurrent: () => true,
      isGenerationIdentityCurrent: () => true,
      isBrowseCutoverActive: () => true,
      onCurrentRetryStopped: vi.fn(),
      retry,
    };

    for (let attempt = 0; attempt < 7; attempt += 1) {
      expect(coordinator.scheduleRetry(options)).toBe(true);
      expect(coordinator.scheduleRetry(options)).toBe(false);
      callbacks.at(-1)?.();
    }

    expect(delays).toEqual([500, 1_000, 2_000, 5_000, 10_000, 10_000, 10_000]);
    expect(retry).toHaveBeenCalledTimes(7);
    expect(remove).not.toHaveBeenCalled();
  });

  it('drops obsolete retry callbacks and reset cancels pending readiness and timers', () => {
    const coordinator = new DynamicOverlayReadinessCoordinator();
    let callback = () => {};
    const remove = vi.fn();
    const onCurrentRetryStopped = vi.fn();
    coordinator.beginReadiness(9);
    const signal = coordinator.getReadinessSignal();
    coordinator.scheduleRetry({
      generation: 9,
      schedule: (_delay, next) => {
        callback = next;
        return { remove };
      },
      isGenerationCurrent: () => false,
      isGenerationIdentityCurrent: () => true,
      isBrowseCutoverActive: () => true,
      onCurrentRetryStopped,
      retry: vi.fn(),
    });

    callback();
    expect(onCurrentRetryStopped).toHaveBeenCalledOnce();

    coordinator.scheduleRetry({
      generation: 9,
      schedule: (_delay, next) => {
        callback = next;
        return { remove };
      },
      isGenerationCurrent: () => true,
      isGenerationIdentityCurrent: () => true,
      isBrowseCutoverActive: () => true,
      onCurrentRetryStopped,
      retry: vi.fn(),
    });
    coordinator.reset();

    expect(signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith(false);
    expect(coordinator.getReadinessGeneration()).toBe(-1);
    expect(coordinator.getReadinessSignal()).toBeNull();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
