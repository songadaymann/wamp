import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorldTileManifest } from './types';
import { WorldTileRoomManifestPrefetcher } from './roomPrefetcher';

describe('world tile room manifest prefetcher', () => {
  afterEach(() => vi.useRealTimers());

  it('deduplicates concurrent requests for the same room', async () => {
    let resolveLoad!: (manifest: WorldTileManifest | null) => void;
    const load = vi.fn(() => new Promise<WorldTileManifest | null>((resolve) => {
      resolveLoad = resolve;
    }));
    const onManifest = vi.fn();
    const prefetcher = new WorldTileRoomManifestPrefetcher({
      load,
      onManifest,
      onFailure: vi.fn(),
      shouldContinue: () => true,
      timeoutMs: 10_000,
    });

    const first = prefetcher.prefetch({ x: 4, y: -2 });
    const second = prefetcher.prefetch({ x: 4, y: -2 });
    expect(second).toBe(first);
    expect(load).toHaveBeenCalledOnce();
    resolveLoad(manifest('renderer-v1'));
    await first;
    expect(onManifest).toHaveBeenCalledOnce();
    expect(prefetcher.pendingCount).toBe(0);
  });

  it('aborts timed-out and cancelled requests without accepting stale manifests', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const load = vi.fn((_coordinates, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<WorldTileManifest | null>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const onManifest = vi.fn();
    const onFailure = vi.fn();
    const prefetcher = new WorldTileRoomManifestPrefetcher({
      load,
      onManifest,
      onFailure,
      shouldContinue: () => true,
      timeoutMs: 100,
    });

    const timedOut = prefetcher.prefetch({ x: 1, y: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
    expect(signals[0].aborted).toBe(true);
    expect(onFailure).toHaveBeenCalledOnce();

    const cancelled = prefetcher.prefetch({ x: 2, y: 2 });
    prefetcher.cancelAll();
    await cancelled;
    expect(signals[1].aborted).toBe(true);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onManifest).not.toHaveBeenCalled();
  });

  it('cancels obsolete selection requests while retaining shared mutation work', async () => {
    const pending = new Map<string, {
      resolve: (manifest: WorldTileManifest | null) => void;
      signal: AbortSignal;
    }>();
    const load = vi.fn((coordinates, signal: AbortSignal) => (
      new Promise<WorldTileManifest | null>((resolve, reject) => {
        pending.set(`${coordinates.x},${coordinates.y}`, { resolve, signal });
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })
    ));
    const onManifest = vi.fn();
    const prefetcher = new WorldTileRoomManifestPrefetcher({
      load,
      onManifest,
      onFailure: vi.fn(),
      shouldContinue: () => true,
      timeoutMs: 10_000,
    });

    const obsoleteSelection = prefetcher.prefetch({ x: 1, y: 1 }, 'selection');
    const shared = prefetcher.prefetch({ x: 2, y: 2 }, 'selection');
    expect(prefetcher.prefetch({ x: 2, y: 2 }, 'mutation')).toBe(shared);
    prefetcher.cancelOwner('selection', '3,3');

    expect(pending.get('1,1')?.signal.aborted).toBe(true);
    expect(pending.get('2,2')?.signal.aborted).toBe(false);
    pending.get('2,2')?.resolve(manifest('renderer-v1'));
    await Promise.all([obsoleteSelection, shared]);
    expect(onManifest).toHaveBeenCalledOnce();
  });
});

function manifest(rendererVersion: string): WorldTileManifest {
  return {
    schemaVersion: 1,
    rendererVersion,
    level: 4,
    targetBounds: { minTileX: 4, maxTileX: 4, minTileY: -2, maxTileY: -2 },
    entries: [],
    rooms: [],
  };
}
