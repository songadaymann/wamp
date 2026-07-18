import { describe, expect, it } from 'vitest';
import { compareGlobalLeaderboardEntries } from './points';

function entry(overrides: Partial<Parameters<typeof compareGlobalLeaderboardEntries>[0]> = {}) {
  return {
    userId: 'user-a',
    userDisplayName: 'Alice',
    totalPoints: 100,
    totalScore: 50,
    totalDeaths: 0,
    totalCollectibles: 0,
    totalEnemiesDefeated: 0,
    totalCheckpoints: 0,
    totalRoomsPublished: 2,
    completedRuns: 3,
    failedRuns: 0,
    abandonedRuns: 0,
    pvpWins: 0,
    pvpLosses: 0,
    pvpDraws: 0,
    bestScore: 50,
    fastestClearMs: null,
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('compareGlobalLeaderboardEntries', () => {
  it('orders by points, completions, published rooms, then name', () => {
    const rows = [
      entry({ userId: 'd', userDisplayName: 'Delta', totalPoints: 99 }),
      entry({ userId: 'b', userDisplayName: 'Bravo', completedRuns: 4 }),
      entry({ userId: 'a', userDisplayName: 'Alpha', totalRoomsPublished: 3 }),
      entry({ userId: 'c', userDisplayName: 'Charlie' }),
    ].sort(compareGlobalLeaderboardEntries);

    expect(rows.map((row) => row.userId)).toEqual(['b', 'a', 'c', 'd']);
  });
});
