import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { OverworldPlayScene } from './OverworldPlayScene';

type PerformanceAdvisorLifecycleHarness = {
  performanceAdvisorSceneActive: boolean;
  resetPerformanceAdvisorEvidence: (reason: string, atMs: number) => void;
  syncPerformanceAdvisorEligibility: (atMs: number) => void;
  windowController: {
    handleWakeAsync: (data?: unknown) => Promise<void>;
  };
  handlePerformanceAdvisorSceneSleep: () => void;
  handleWake: (systems: unknown, data?: unknown) => void;
};

describe('OverworldPlayScene performance-advisor lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops editor sleep time and starts a clean observation window on wake', () => {
    const resetPerformanceAdvisorEvidence = vi.fn();
    const syncPerformanceAdvisorEligibility = vi.fn();
    const handleWakeAsync = vi.fn(async () => undefined);
    const harness = Object.assign(
      Object.create(OverworldPlayScene.prototype),
      {
        performanceAdvisorSceneActive: true,
        resetPerformanceAdvisorEvidence,
        syncPerformanceAdvisorEligibility,
        windowController: { handleWakeAsync },
      },
    ) as PerformanceAdvisorLifecycleHarness;
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(9_000);

    harness.handlePerformanceAdvisorSceneSleep();

    expect(harness.performanceAdvisorSceneActive).toBe(false);
    expect(resetPerformanceAdvisorEvidence).toHaveBeenNthCalledWith(
      1,
      'pause',
      1_000,
    );
    expect(syncPerformanceAdvisorEligibility).toHaveBeenNthCalledWith(1, 1_000);

    const wakeData = { mode: 'play' };
    harness.handleWake({} as never, wakeData);

    expect(harness.performanceAdvisorSceneActive).toBe(true);
    expect(resetPerformanceAdvisorEvidence).toHaveBeenNthCalledWith(
      2,
      'scene-wake',
      9_000,
    );
    expect(syncPerformanceAdvisorEligibility).toHaveBeenNthCalledWith(2, 9_000);
    expect(handleWakeAsync).toHaveBeenCalledWith(wakeData);
  });
});
