import { describe, expect, it } from 'vitest';
import {
  CorruptWorldTileRetryTracker,
  getWorldTileRetryDelayMs,
  WorldTileFallbackController,
} from './retryFallback';

describe('world tile retry and compact fallback', () => {
  it('uses the bounded transient retry sequence', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(getWorldTileRetryDelayMs))
      .toEqual([500, 1_000, 2_000, 5_000, 10_000, 10_000, 10_000]);
  });

  it('activates session-sticky fallback after three critical incomplete-coverage failures', () => {
    const controller = new WorldTileFallbackController();
    controller.markCoverageIncomplete(0);
    expect(controller.recordCriticalFailure(100).active).toBe(false);
    expect(controller.recordCriticalFailure(200).active).toBe(false);
    expect(controller.recordCriticalFailure(300)).toMatchObject({
      active: true,
      reason: 'critical-failures',
      criticalFailures: 3,
    });

    expect(controller.markCoverageComplete()).toMatchObject({
      active: true,
      reason: 'critical-failures',
    });
  });

  it('activates fallback after ten seconds without complete coverage', () => {
    const controller = new WorldTileFallbackController();
    controller.markCoverageIncomplete(1_000);
    expect(controller.evaluate(10_999).active).toBe(false);
    expect(controller.evaluate(11_000)).toMatchObject({
      active: true,
      reason: 'coverage-timeout',
    });
  });

  it('immediately disables an incompatible manifest for the session', () => {
    const controller = new WorldTileFallbackController();
    expect(controller.recordPermanentManifestIncompatibility()).toMatchObject({
      active: true,
      reason: 'manifest-incompatible',
    });
  });

  it('allows exactly one eviction and refetch for a corrupt image', () => {
    const tracker = new CorruptWorldTileRetryTracker();
    expect(tracker.shouldEvictAndRetry('tile')).toBe(true);
    expect(tracker.shouldEvictAndRetry('tile')).toBe(false);
    tracker.markSuccessful('tile');
    expect(tracker.shouldEvictAndRetry('tile')).toBe(true);
  });
});
