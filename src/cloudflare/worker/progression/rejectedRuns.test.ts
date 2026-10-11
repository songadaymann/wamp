// A run the verifier rejected (or timed out on) is stored as 'completed' with a failed
// verification status. Leaderboards skip it; these progression reads must too (withheld F204).
import { describe, expect, it } from 'vitest';
import { fixture, run } from '../activity/testDatabase';
import { countHistoricalCreatorUniqueCompletions } from './progressRows';
import { hasCompletedRoomRatingWindow } from './ratings';

describe('rejected runs in progression (F204)', () => {
  it('only accepted clears open the room rating window', async () => {
    const f = fixture();
    run(f, 'rejected', 'p1', 300, 'failed');
    run(f, 'timed-out', 'p2', 300, 'timeout');
    run(f, 'verified', 'p3', 9000, 'passed');
    run(f, 'unchecked', 'generated', 9000, 'not_required');
    expect(await hasCompletedRoomRatingWindow(f.env, '0,0', [1], 'p1')).toBe(false);
    expect(await hasCompletedRoomRatingWindow(f.env, '0,0', [1], 'p2')).toBe(false);
    expect(await hasCompletedRoomRatingWindow(f.env, '0,0', [1], 'p3')).toBe(true);
    expect(await hasCompletedRoomRatingWindow(f.env, '0,0', [1], 'generated')).toBe(true);
  });

  it("a builder's unique clears count only accepted runs by other players", async () => {
    const f = fixture();
    run(f, 'rejected', 'p1', 300, 'failed');
    run(f, 'timed-out', 'p2', 300, 'timeout');
    run(f, 'verified', 'p3', 9000, 'passed');
    run(f, 'own', 'builder', 9000, 'passed');
    expect(await countHistoricalCreatorUniqueCompletions(f.env, 'builder')).toBe(1);
  });
});
