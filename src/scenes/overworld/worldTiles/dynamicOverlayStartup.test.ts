import { describe, expect, it, vi } from 'vitest';
import {
  loadStartupDynamicOverlaySnapshots,
  stopStartupDynamicOverlayGeneration,
} from './dynamicOverlayStartup';

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
  it('clears both current-generation suppression markers when sharp readiness stops', () => {
    expect(stopStartupDynamicOverlayGeneration({
      generation: 7,
      startupDynamicOverlayGeneration: 7,
      fullPreviewUpgradeGeneration: 7,
    })).toEqual({
      startupDynamicOverlayGeneration: -1,
      fullPreviewUpgradeGeneration: -1,
    });
    expect(stopStartupDynamicOverlayGeneration({
      generation: 7,
      startupDynamicOverlayGeneration: 8,
      fullPreviewUpgradeGeneration: 8,
    })).toEqual({
      startupDynamicOverlayGeneration: 8,
      fullPreviewUpgradeGeneration: 8,
    });
  });

  it('does not begin saved construction snapshots until target-LOD imagery is sharp', async () => {
    const sharp = deferred<boolean>();
    const load = deferred<void>();
    const loadSnapshots = vi.fn(() => load.promise);
    const mergeDeferredSnapshots = vi.fn();

    await expect(loadStartupDynamicOverlaySnapshots({
      awaitBeforeReady: false,
      waitForDeferredStart: () => sharp.promise,
      loadSnapshots,
      isCurrent: () => true,
      mergeDeferredSnapshots,
    })).resolves.toBe('deferred');
    expect(loadSnapshots).not.toHaveBeenCalled();
    expect(mergeDeferredSnapshots).not.toHaveBeenCalled();

    sharp.resolve(true);
    await sharp.promise;
    await Promise.resolve();
    expect(loadSnapshots).toHaveBeenCalledOnce();

    load.resolve();
    await load.promise;
    await Promise.resolve();
    expect(mergeDeferredSnapshots).toHaveBeenCalledOnce();
  });

  it('preserves legacy awaiting and lets failures reach the compact fallback', async () => {
    const load = deferred<void>();
    const failure = new Error('snapshot batch failed');
    const waitForDeferredStart = vi.fn(async () => false);
    const onDeferredStartStopped = vi.fn();
    const operation = loadStartupDynamicOverlaySnapshots({
      awaitBeforeReady: true,
      waitForDeferredStart,
      onDeferredStartStopped,
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
    expect(waitForDeferredStart).not.toHaveBeenCalled();
    expect(onDeferredStartStopped).not.toHaveBeenCalled();
  });

  it('does not start snapshots when target-LOD readiness stops for fallback', async () => {
    const loadSnapshots = vi.fn(async () => {});
    const mergeDeferredSnapshots = vi.fn();
    const onDeferredStartStopped = vi.fn();

    await expect(loadStartupDynamicOverlaySnapshots({
      awaitBeforeReady: false,
      waitForDeferredStart: async () => false,
      onDeferredStartStopped,
      loadSnapshots,
      isCurrent: () => true,
      mergeDeferredSnapshots,
    })).resolves.toBe('deferred');
    await Promise.resolve();
    await Promise.resolve();

    expect(loadSnapshots).not.toHaveBeenCalled();
    expect(mergeDeferredSnapshots).not.toHaveBeenCalled();
    expect(onDeferredStartStopped).toHaveBeenCalledOnce();
  });

  it('does not start snapshots when the streaming generation becomes obsolete while waiting', async () => {
    const sharp = deferred<boolean>();
    const loadSnapshots = vi.fn(async () => {});
    let current = true;

    await loadStartupDynamicOverlaySnapshots({
      awaitBeforeReady: false,
      waitForDeferredStart: () => sharp.promise,
      loadSnapshots,
      isCurrent: () => current,
      mergeDeferredSnapshots: vi.fn(),
    });
    current = false;
    sharp.resolve(true);
    await sharp.promise;
    await Promise.resolve();

    expect(loadSnapshots).not.toHaveBeenCalled();
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
