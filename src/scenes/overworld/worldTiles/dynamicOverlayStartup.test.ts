import { describe, expect, it, vi } from 'vitest';
import { loadStartupDynamicOverlaySnapshots } from './dynamicOverlayStartup';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('tiled-world startup dynamic overlays', () => {
  it('opens tiled browse readiness without waiting for saved construction snapshots', async () => {
    const load = deferred<void>();
    const mergeDeferredSnapshots = vi.fn();

    await expect(loadStartupDynamicOverlaySnapshots({
      awaitBeforeReady: false,
      loadSnapshots: () => load.promise,
      isCurrent: () => true,
      mergeDeferredSnapshots,
    })).resolves.toBe('deferred');
    expect(mergeDeferredSnapshots).not.toHaveBeenCalled();

    load.resolve();
    await load.promise;
    await Promise.resolve();
    expect(mergeDeferredSnapshots).toHaveBeenCalledOnce();
  });

  it('preserves legacy awaiting and lets failures reach the compact fallback', async () => {
    const load = deferred<void>();
    const failure = new Error('snapshot batch failed');
    const operation = loadStartupDynamicOverlaySnapshots({
      awaitBeforeReady: true,
      loadSnapshots: () => load.promise,
      isCurrent: () => true,
      mergeDeferredSnapshots: vi.fn(),
    });

    let settled = false;
    void operation.finally(() => { settled = true; }).catch(() => {});
    await Promise.resolve();
    expect(settled).toBe(false);
    load.reject(failure);
    await expect(operation).rejects.toBe(failure);
  });

  it('drops a late overlay when its streaming generation is obsolete', async () => {
    const load = deferred<void>();
    const mergeDeferredSnapshots = vi.fn();
    let current = true;

    await loadStartupDynamicOverlaySnapshots({
      awaitBeforeReady: false,
      loadSnapshots: () => load.promise,
      isCurrent: () => current,
      mergeDeferredSnapshots,
    });
    current = false;
    load.resolve();
    await load.promise;
    await Promise.resolve();

    expect(mergeDeferredSnapshots).not.toHaveBeenCalled();
  });

  it('merges a late overlay while keeping the ready gate nonblocking', async () => {
    const load = deferred<void>();
    const merge = deferred<void>();
    const mergeDeferredSnapshots = vi.fn(() => merge.promise);
    const onDeferredError = vi.fn();

    await expect(loadStartupDynamicOverlaySnapshots({
      awaitBeforeReady: false,
      loadSnapshots: () => load.promise,
      isCurrent: () => true,
      mergeDeferredSnapshots,
      onDeferredError,
    })).resolves.toBe('deferred');

    load.resolve();
    await load.promise;
    await Promise.resolve();
    expect(mergeDeferredSnapshots).toHaveBeenCalledOnce();
    expect(onDeferredError).not.toHaveBeenCalled();

    merge.resolve();
    await merge.promise;
  });
});
