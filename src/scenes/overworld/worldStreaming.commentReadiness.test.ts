import { describe, expect, it, vi } from 'vitest';
import { OverworldWorldStreamingController } from './worldStreaming';

vi.mock('phaser', () => ({ default: {} }));

describe('browse comment world readiness', () => {
  it('awaits target LOD when tiled browse is active', async () => {
    const waitForTargetLodReady = vi.fn(async () => true);
    const harness = createHarness({
      debug: { enabled: true, shadow: false, fallbackReason: null },
      waitForTargetLodReady,
    });
    const signal = new AbortController().signal;

    await expect(callReadiness(harness, signal)).resolves.toBe(true);
    expect(waitForTargetLodReady).toHaveBeenCalledWith(harness.options.scene.cameras.main, signal);
  });

  it('starts immediately for legacy, shadow, or sticky compact fallback imagery', async () => {
    for (const debug of [
      { enabled: false, shadow: false, fallbackReason: null },
      { enabled: true, shadow: true, fallbackReason: null },
      { enabled: true, shadow: false, fallbackReason: 'coverage-timeout' },
    ]) {
      const waitForTargetLodReady = vi.fn(async () => false);
      const harness = createHarness({ debug, waitForTargetLodReady });
      await expect(callReadiness(harness)).resolves.toBe(true);
      expect(waitForTargetLodReady).not.toHaveBeenCalled();
    }
  });
});

interface Harness {
  options: { scene: { cameras: { main: object } } };
  worldTileController: {
    getDebugSnapshot(): { enabled: boolean; shadow: boolean; fallbackReason: string | null };
    waitForTargetLodReady: ReturnType<typeof vi.fn>;
  };
}

function createHarness(input: {
  debug: { enabled: boolean; shadow: boolean; fallbackReason: string | null };
  waitForTargetLodReady: ReturnType<typeof vi.fn>;
}): Harness {
  return {
    options: { scene: { cameras: { main: {} } } },
    worldTileController: {
      getDebugSnapshot: () => input.debug,
      waitForTargetLodReady: input.waitForTargetLodReady,
    },
  };
}

function callReadiness(harness: Harness, signal?: AbortSignal): Promise<boolean> {
  const method = OverworldWorldStreamingController.prototype.waitForBrowseCommentDiscoveryReady;
  return method.call(harness as never, signal);
}
