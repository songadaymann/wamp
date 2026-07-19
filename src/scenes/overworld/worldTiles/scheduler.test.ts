import { describe, expect, it } from 'vitest';
import {
  getGpuWorldTileByteBudget,
  getPersistentWorldTileByteBudget,
  getWorldTileStreamingBudgets,
  ManifestRefreshSchedule,
  rankWorldTileRequests,
  type WorldTileRequestCandidate,
} from './scheduler';
import type { WorldTileAddress } from './types';

describe('world tile scheduling', () => {
  it('orders coverage, targets, siblings, proximity, prediction, then guard work', () => {
    const candidates: WorldTileRequestCandidate[] = [
      candidate(6, { guard: true }),
      candidate(5, { predictedMovement: true }),
      candidate(4, { centerDistance: 2 }),
      candidate(3, { siblingClosure: true }),
      candidate(2, { visibleTarget: true }),
      candidate(1, { uncoveredVisibleAncestor: true }),
    ];

    expect(rankWorldTileRequests(candidates).map((entry) => entry.address.x))
      .toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('deduplicates candidates while preserving their strongest reason', () => {
    const ranked = rankWorldTileRequests([
      candidate(1, { guard: true, centerDistance: 50 }),
      candidate(1, { visibleTarget: true, centerDistance: 10 }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({
      visibleTarget: true,
      guard: true,
      priorityTier: 1,
      proximityScore: 10,
    });
  });

  it('coalesces camera changes at 10 Hz and guarantees the latest trailing refresh', () => {
    const schedule = new ManifestRefreshSchedule();
    expect(schedule.schedule(0)).toEqual({ generation: 1, issueNow: true, dueAtMs: 0 });
    expect(schedule.schedule(20)).toEqual({ generation: 2, issueNow: false, dueAtMs: 100 });
    expect(schedule.schedule(60)).toEqual({ generation: 3, issueNow: false, dueAtMs: 100 });
    expect(schedule.hasTrailingRefresh()).toBe(true);
    expect(schedule.flush(99)).toBeNull();
    expect(schedule.flush(100)).toEqual({ generation: 3, issueNow: true, dueAtMs: 100 });
    expect(schedule.hasTrailingRefresh()).toBe(false);
  });

  it('exposes normal and reduced concurrency and upload budgets', () => {
    expect(getWorldTileStreamingBudgets('normal')).toMatchObject({
      fetchConcurrency: 6,
      decodeConcurrency: 2,
      gpuUploadsPerFrame: 2,
      gpuUploadBudgetMs: 4,
      persistentByteBudgetMb: 128,
      gpuTextureBudgetMb: 96,
    });
    expect(getWorldTileStreamingBudgets('reduced')).toMatchObject({
      fetchConcurrency: 3,
      decodeConcurrency: 1,
      gpuUploadsPerFrame: 1,
      gpuUploadBudgetMs: 2,
      persistentByteBudgetMb: 48,
      gpuTextureBudgetMb: 40,
    });
    expect(getPersistentWorldTileByteBudget('normal', 500 * 1_024 * 1_024))
      .toBe(50 * 1_024 * 1_024);
    expect(getPersistentWorldTileByteBudget('normal', 2_000 * 1_024 * 1_024))
      .toBe(128 * 1_024 * 1_024);
    expect(getPersistentWorldTileByteBudget('reduced', null)).toBe(48 * 1_024 * 1_024);
    expect(getGpuWorldTileByteBudget('reduced')).toBe(40 * 1_024 * 1_024);
  });
});

function candidate(
  x: number,
  properties: Omit<WorldTileRequestCandidate, 'address'>,
): WorldTileRequestCandidate {
  return { address: address(x), ...properties };
}

function address(x: number): WorldTileAddress {
  return { rendererVersion: 'renderer-v1', level: 4, x, y: 0 };
}
