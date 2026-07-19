import { describe, expect, it } from 'vitest';
import { WorldTileDebugMetricsTracker } from './metrics';

describe('world tile debug metrics', () => {
  it('reports coverage, queues, stale imagery, and fallback reason', () => {
    const tracker = new WorldTileDebugMetricsTracker();
    expect(tracker.update({
      targetLevel: 2,
      visibleCount: 4,
      readyCount: 3,
      staleCount: 1,
      queueDepths: { fetch: 2, decode: 1 },
      fallbackReason: 'coverage-timeout',
    })).toEqual({
      targetLevel: 2,
      visibleCount: 4,
      readyCount: 3,
      staleCount: 1,
      coveragePercentage: 75,
      queueDepths: {
        manifest: 0,
        fetch: 2,
        decode: 1,
        gpuUpload: 0,
        replacementGroups: 0,
      },
      replacementGapFrames: 0,
      fallbackReason: 'coverage-timeout',
    });
  });

  it('counts replacement-gap frames only after first complete coverage', () => {
    const tracker = new WorldTileDebugMetricsTracker();
    tracker.update({ visibleCount: 4, readyCount: 2 });
    expect(tracker.recordFrame().replacementGapFrames).toBe(0);

    tracker.update({ visibleCount: 4, readyCount: 4 });
    expect(tracker.recordFrame().replacementGapFrames).toBe(0);

    tracker.update({ visibleCount: 4, readyCount: 3 });
    expect(tracker.recordFrame().replacementGapFrames).toBe(1);
    expect(tracker.recordFrame().replacementGapFrames).toBe(2);
  });
});
