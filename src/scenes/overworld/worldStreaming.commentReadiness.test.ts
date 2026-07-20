import { describe, expect, it, vi } from 'vitest';
import { OverworldWorldStreamingController } from './worldStreaming';

vi.mock('phaser', () => ({ default: {} }));

describe('browse comment world readiness', () => {
  it('awaits target LOD when tiled browse is active', async () => {
    const waitForTargetLodReady = vi.fn(async () => true);
    const harness = createHarness({
      prepare: vi.fn(async () => true),
      debug: { enabled: true, shadow: false, fallbackReason: null },
      waitForTargetLodReady,
    });
    const signal = new AbortController().signal;

    await expect(callReadiness(harness, signal)).resolves.toBe(true);
    expect(waitForTargetLodReady).toHaveBeenCalledWith(harness.options.scene.cameras.main, signal);
  });

  it('waits for tile preparation before treating an initially disabled snapshot as legacy', async () => {
    let debug = { enabled: false, shadow: false, fallbackReason: null as string | null };
    const preparation = deferred<boolean>();
    const prepare = vi.fn(() => preparation.promise);
    const waitForTargetLodReady = vi.fn(async () => true);
    const harness = createHarness({
      prepare,
      getDebugSnapshot: () => debug,
      waitForTargetLodReady,
    });

    const readiness = callReadiness(harness);
    await Promise.resolve();
    expect(waitForTargetLodReady).not.toHaveBeenCalled();

    debug = { enabled: true, shadow: false, fallbackReason: null };
    preparation.resolve(true);

    await expect(readiness).resolves.toBe(true);
    expect(waitForTargetLodReady).toHaveBeenCalledOnce();
  });

  it('starts immediately for legacy, shadow, or sticky compact fallback imagery', async () => {
    for (const input of [
      {
        prepare: false,
        debug: { enabled: false, shadow: false, fallbackReason: null },
      },
      {
        prepare: true,
        debug: { enabled: true, shadow: true, fallbackReason: null },
      },
      {
        prepare: true,
        debug: { enabled: true, shadow: false, fallbackReason: 'coverage-timeout' },
      },
    ]) {
      const waitForTargetLodReady = vi.fn(async () => false);
      const harness = createHarness({
        prepare: vi.fn(async () => input.prepare),
        debug: input.debug,
        waitForTargetLodReady,
      });
      await expect(callReadiness(harness)).resolves.toBe(true);
      expect(waitForTargetLodReady).not.toHaveBeenCalled();
    }
  });

  it('does not start discovery when its caller aborts during tile preparation', async () => {
    const preparation = deferred<boolean>();
    const controller = new AbortController();
    const waitForTargetLodReady = vi.fn(async () => true);
    const harness = createHarness({
      prepare: vi.fn(() => preparation.promise),
      debug: { enabled: true, shadow: false, fallbackReason: null },
      waitForTargetLodReady,
    });

    const readiness = callReadiness(harness, controller.signal);
    controller.abort();
    preparation.resolve(true);

    await expect(readiness).resolves.toBe(false);
    expect(waitForTargetLodReady).not.toHaveBeenCalled();
  });
});

interface Harness {
  options: { scene: { cameras: { main: object } } };
  worldTileController: {
    prepare: ReturnType<typeof vi.fn>;
    getDebugSnapshot(): { enabled: boolean; shadow: boolean; fallbackReason: string | null };
    waitForTargetLodReady: ReturnType<typeof vi.fn>;
  };
}

function createHarness(input: {
  prepare: ReturnType<typeof vi.fn>;
  debug?: { enabled: boolean; shadow: boolean; fallbackReason: string | null };
  getDebugSnapshot?: () => { enabled: boolean; shadow: boolean; fallbackReason: string | null };
  waitForTargetLodReady: ReturnType<typeof vi.fn>;
}): Harness {
  return {
    options: { scene: { cameras: { main: {} } } },
    worldTileController: {
      prepare: input.prepare,
      getDebugSnapshot: input.getDebugSnapshot ?? (() => input.debug!),
      waitForTargetLodReady: input.waitForTargetLodReady,
    },
  };
}

function callReadiness(harness: Harness, signal?: AbortSignal): Promise<boolean> {
  const method = OverworldWorldStreamingController.prototype.waitForBrowseSecondaryStartupReady;
  return method.call(harness as never, signal);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
