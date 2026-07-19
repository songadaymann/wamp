import { describe, expect, it, vi } from 'vitest';
import { BrowseRealtimeStartupGate } from './browseRealtimeStartup';

describe('BrowseRealtimeStartupGate', () => {
  it('coalesces initial browse requests until target imagery is ready', async () => {
    let latestBounds = 'initial';
    const appliedBounds: string[] = [];
    const readiness = deferred<boolean>();
    const waitForBrowseReady = vi.fn((_signal: AbortSignal) => readiness.promise);
    const gate = new BrowseRealtimeStartupGate({
      getMode: () => 'browse',
      waitForBrowseReady,
      applySubscriptions: () => appliedBounds.push(latestBounds),
    });

    gate.request();
    latestBounds = 'latest';
    gate.request();

    expect(waitForBrowseReady).toHaveBeenCalledOnce();
    expect(appliedBounds).toEqual([]);

    readiness.resolve(true);
    await readiness.promise;
    await Promise.resolve();

    expect(appliedBounds).toEqual(['latest']);

    latestBounds = 'after-startup';
    gate.request();
    expect(appliedBounds).toEqual(['latest', 'after-startup']);
  });

  it('invalidates an old generation when scene runtime resets', async () => {
    const firstReadiness = deferred<boolean>();
    const secondReadiness = deferred<boolean>();
    const applySubscriptions = vi.fn();
    const waitForBrowseReady = vi
      .fn()
      .mockReturnValueOnce(firstReadiness.promise)
      .mockReturnValueOnce(secondReadiness.promise);
    const gate = new BrowseRealtimeStartupGate({
      getMode: () => 'browse',
      waitForBrowseReady,
      applySubscriptions,
    });

    gate.request();
    const firstSignal = waitForBrowseReady.mock.calls[0]?.[0] as AbortSignal;
    gate.reset();
    gate.request();

    expect(firstSignal.aborted).toBe(true);
    firstReadiness.resolve(true);
    await firstReadiness.promise;
    await Promise.resolve();
    expect(applySubscriptions).not.toHaveBeenCalled();

    secondReadiness.resolve(true);
    await secondReadiness.promise;
    await Promise.resolve();
    expect(applySubscriptions).toHaveBeenCalledOnce();
  });

  it('preserves immediate subscriptions in play and ignores the canceled browse waiter', async () => {
    let mode: 'browse' | 'play' = 'browse';
    const readiness = deferred<boolean>();
    const applySubscriptions = vi.fn();
    const waitForBrowseReady = vi.fn((_signal: AbortSignal) => readiness.promise);
    const gate = new BrowseRealtimeStartupGate({
      getMode: () => mode,
      waitForBrowseReady,
      applySubscriptions,
    });

    gate.request();
    const browseSignal = waitForBrowseReady.mock.calls[0]![0];
    mode = 'play';
    gate.request();

    expect(browseSignal.aborted).toBe(true);
    expect(applySubscriptions).toHaveBeenCalledOnce();

    readiness.resolve(true);
    await readiness.promise;
    await Promise.resolve();
    expect(applySubscriptions).toHaveBeenCalledOnce();

    gate.request();
    expect(applySubscriptions).toHaveBeenCalledTimes(2);
  });

  it('does not release browse subscriptions for a canceled or incomplete readiness wait', async () => {
    const readiness = deferred<boolean>();
    const applySubscriptions = vi.fn();
    const waitForBrowseReady = vi.fn((_signal: AbortSignal) => readiness.promise);
    const gate = new BrowseRealtimeStartupGate({
      getMode: () => 'browse',
      waitForBrowseReady,
      applySubscriptions,
    });

    gate.request();
    readiness.resolve(false);
    await readiness.promise;
    await Promise.resolve();

    expect(applySubscriptions).not.toHaveBeenCalled();
    gate.request();
    expect(waitForBrowseReady).toHaveBeenCalledTimes(2);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}
