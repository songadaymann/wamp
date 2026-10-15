/** Pure score inputs shared by room and course policies; no run/storage dependencies. */
export interface GoalScoreMetrics {
  result: 'completed' | 'failed' | 'abandoned';
  elapsedMs: number;
  deaths: number;
  collectiblesCollected: number;
  enemiesDefeated: number;
  checkpointsReached: number;
}

export type GoalRankingMode = 'time' | 'score';
/** Protect ranks exact survival time, even when its displayed score is rounded. */
export type RoomGoalRankingPolicy = GoalRankingMode | 'protect';
export interface RoomGoalScoreContext extends GoalScoreMetrics {
  deathPenalty: number;
}

export function createRoomGoalScoreContext(finish: GoalScoreMetrics): RoomGoalScoreContext {
  const deaths = Math.max(0, finish.deaths);
  return {
    result: finish.result,
    elapsedMs: Math.max(0, finish.elapsedMs),
    deaths,
    collectiblesCollected: Math.max(0, finish.collectiblesCollected),
    enemiesDefeated: Math.max(0, finish.enemiesDefeated),
    checkpointsReached: Math.max(0, finish.checkpointsReached),
    deathPenalty: deaths * 20,
  };
}

export function computeRoomGoalTimeBonus(timeLimitMs: number | null, elapsedMs: number, pointsPerSecond: number): number {
  if (timeLimitMs === null) {
    return Math.max(0, Math.floor((90_000 - elapsedMs) / 1000)) * Math.max(1, pointsPerSecond - 2);
  }
  return Math.max(0, Math.floor((timeLimitMs - elapsedMs) / 1000)) * pointsPerSecond;
}

export function computeCourseGoalBaseScore(finish: GoalScoreMetrics): number {
  const collectiblePoints = Math.max(0, finish.collectiblesCollected) * 10;
  const enemyPoints = Math.max(0, finish.enemiesDefeated) * 25;
  const checkpointPoints = Math.max(0, finish.checkpointsReached) * 50;
  const clearBonus = finish.result === 'completed' ? 250 : 0;
  const zeroDeathBonus = finish.result === 'completed' && finish.deaths === 0 ? 100 : 0;
  return collectiblePoints + enemyPoints + checkpointPoints + clearBonus + zeroDeathBonus;
}
