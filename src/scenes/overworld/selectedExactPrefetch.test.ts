import { describe, expect, it } from 'vitest';
import { SelectedExactPrefetchLifecycle } from './selectedExactPrefetch';

describe('SelectedExactPrefetchLifecycle', () => {
  it('deduplicates in-flight work and marks readiness only after success', () => {
    const lifecycle = new SelectedExactPrefetchLifecycle('0,0');
    const request = lifecycle.begin({
      roomId: '0,0',
      targetLodReady: true,
      missingAtStart: true,
      nowMs: 0,
    });

    expect(request).not.toBeNull();
    expect(lifecycle.begin({
      roomId: '0,0',
      targetLodReady: true,
      missingAtStart: true,
      nowMs: 10,
    })).toBeNull();

    expect(lifecycle.complete({
      request: request!,
      snapshotAvailable: true,
      currentRoomId: '0,0',
      nowMs: 20,
    })).toEqual({ accepted: true, shouldRefreshSelectedState: true });
    expect(lifecycle.begin({
      roomId: '0,0',
      targetLodReady: true,
      missingAtStart: false,
      nowMs: 30,
    })).toBeNull();
  });

  it('retries failures with a capped delay and never overlaps requests', () => {
    const lifecycle = new SelectedExactPrefetchLifecycle('0,0', [50, 100]);
    let nowMs = 0;

    for (const expectedDelay of [50, 100, 100]) {
      const request = lifecycle.begin({
        roomId: '0,0',
        targetLodReady: true,
        missingAtStart: true,
        nowMs,
      });
      expect(request).not.toBeNull();
      lifecycle.complete({
        request: request!,
        snapshotAvailable: false,
        currentRoomId: '0,0',
        nowMs,
      });
      expect(lifecycle.begin({
        roomId: '0,0',
        targetLodReady: true,
        missingAtStart: true,
        nowMs: nowMs + expectedDelay - 1,
      })).toBeNull();
      nowMs += expectedDelay;
    }

    expect(lifecycle.begin({
      roomId: '0,0',
      targetLodReady: true,
      missingAtStart: true,
      nowMs,
    })).not.toBeNull();
  });

  it('ignores stale completion after selection changes and preserves explicit selection startup', () => {
    const lifecycle = new SelectedExactPrefetchLifecycle('0,0');
    const stale = lifecycle.begin({
      roomId: '0,0',
      targetLodReady: true,
      missingAtStart: true,
      nowMs: 0,
    });
    const current = lifecycle.begin({
      roomId: '4,-2',
      targetLodReady: false,
      missingAtStart: true,
      nowMs: 1,
    });

    expect(current).not.toBeNull();
    expect(lifecycle.complete({
      request: stale!,
      snapshotAvailable: true,
      currentRoomId: '4,-2',
      nowMs: 2,
    })).toEqual({ accepted: false, shouldRefreshSelectedState: false });
    expect(lifecycle.complete({
      request: current!,
      snapshotAvailable: true,
      currentRoomId: '4,-2',
      nowMs: 3,
    })).toEqual({ accepted: true, shouldRefreshSelectedState: true });
  });

  it('invalidates successful state so a changed room version can load again', () => {
    const lifecycle = new SelectedExactPrefetchLifecycle('0,0');
    const request = lifecycle.begin({
      roomId: '0,0',
      targetLodReady: true,
      missingAtStart: true,
      nowMs: 0,
    });
    lifecycle.complete({
      request: request!,
      snapshotAvailable: true,
      currentRoomId: '0,0',
      nowMs: 1,
    });

    lifecycle.invalidate('0,0');
    expect(lifecycle.begin({
      roomId: '0,0',
      targetLodReady: true,
      missingAtStart: true,
      nowMs: 2,
    })).not.toBeNull();
  });
});
