import { describe, expect, it } from 'vitest';
import type { RunFinishRequestBody } from './model';
import {
  compareLeaderboardEntries,
  computeRunScore,
  getLeaderboardRankingMode,
} from './scoring';

function finish(
  elapsedMs: number,
  result: RunFinishRequestBody['result'],
): RunFinishRequestBody {
  return {
    result,
    elapsedMs,
    deaths: 0,
    collectiblesCollected: 0,
    enemyCollectiblesCollected: 0,
    enemiesDefeated: 0,
    checkpointsReached: 0,
    finishedAt: '2026-07-23T00:00:00.000Z',
    verificationTrace: null,
  };
}

describe('NPC Quest scoring', () => {
  it('ranks Protect by longest duration score, including failed attempts', () => {
    const goal = {
      type: 'npc_quest',
      questType: 'protect',
      npcInstanceId: null,
      durationMs: 30_000,
      requiredCount: 1,
      destination: null,
      timeLimitMs: null,
    } as const;

    expect(getLeaderboardRankingMode(goal)).toBe('score');
    expect(computeRunScore(goal, finish(12_900, 'failed'))).toBe(120);
    expect(computeRunScore(goal, finish(30_000, 'completed'))).toBe(300);
    expect(computeRunScore(goal, finish(45_000, 'completed'))).toBe(300);
    expect(compareLeaderboardEntries(
      { elapsedMs: 12_900, deaths: 0, score: 120, finishedAt: '2026-07-23T00:00:00.000Z' },
      { elapsedMs: 12_100, deaths: 0, score: 120, finishedAt: '2026-07-23T00:00:01.000Z' },
      goal,
    )).toBeLessThan(0);
  });

  it('ranks Escort and Give by completion time', () => {
    const common = {
      type: 'npc_quest',
      npcInstanceId: null,
      durationMs: 30_000,
      requiredCount: 3,
      destination: { x: 100, y: 100 },
      timeLimitMs: null,
    } as const;

    expect(getLeaderboardRankingMode({ ...common, questType: 'escort' })).toBe('time');
    expect(getLeaderboardRankingMode({ ...common, questType: 'give' })).toBe('time');
  });
});
