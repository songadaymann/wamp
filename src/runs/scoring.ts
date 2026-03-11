import type { RoomGoal } from '../goals/roomGoals';
import type { LeaderboardRankingMode, RoomLeaderboardEntry, RoomRunRecord, RunFinishRequestBody } from './model';

const REACH_EXIT_CLEAR_SCORE = 100;
const COLLECT_TARGET_ITEM_SCORE = 25;
const COLLECT_TARGET_CLEAR_SCORE = 60;
const DEFEAT_ALL_ENEMY_SCORE = 30;
const DEFEAT_ALL_CLEAR_SCORE = 80;
const CHECKPOINT_SPRINT_CLEAR_SCORE = 120;
const SURVIVAL_SCORE_PER_SECOND = 10;
const SURVIVAL_CLEAR_BONUS = 100;
const DEATH_PENALTY = 20;

export function computeRunScore(goal: RoomGoal, finish: RunFinishRequestBody): number {
  const elapsedMs = Math.max(0, finish.elapsedMs);
  const deaths = Math.max(0, finish.deaths);
  const collectiblesCollected = Math.max(0, finish.collectiblesCollected);
  const enemiesDefeated = Math.max(0, finish.enemiesDefeated);
  const checkpointsReached = Math.max(0, finish.checkpointsReached);
  const deathPenalty = deaths * DEATH_PENALTY;

  switch (goal.type) {
    case 'reach_exit':
      return Math.max(
        0,
        REACH_EXIT_CLEAR_SCORE + computeTimeBonus(goal.timeLimitMs, elapsedMs, 6) - deathPenalty
      );
    case 'collect_target':
      return Math.max(
        0,
        collectiblesCollected * COLLECT_TARGET_ITEM_SCORE +
          (finish.result === 'completed' ? COLLECT_TARGET_CLEAR_SCORE : 0) +
          computeTimeBonus(goal.timeLimitMs, elapsedMs, 5) -
          deathPenalty
      );
    case 'defeat_all':
      return Math.max(
        0,
        enemiesDefeated * DEFEAT_ALL_ENEMY_SCORE +
          (finish.result === 'completed' ? DEFEAT_ALL_CLEAR_SCORE : 0) +
          computeTimeBonus(goal.timeLimitMs, elapsedMs, 5) -
          deathPenalty
      );
    case 'checkpoint_sprint':
      return Math.max(
        0,
        CHECKPOINT_SPRINT_CLEAR_SCORE +
          checkpointsReached * 10 -
          deathPenalty
      );
    case 'survival':
      return Math.max(
        0,
        Math.floor(elapsedMs / 1000) * SURVIVAL_SCORE_PER_SECOND +
          (finish.result === 'completed' ? SURVIVAL_CLEAR_BONUS : 0) -
          deathPenalty
      );
  }
}

export function getLeaderboardRankingMode(goal: RoomGoal): LeaderboardRankingMode {
  switch (goal.type) {
    case 'survival':
      return 'score';
    case 'reach_exit':
    case 'collect_target':
    case 'defeat_all':
    case 'checkpoint_sprint':
      return 'time';
  }
}

export function sortRoomLeaderboardEntries<T extends Pick<RoomLeaderboardEntry, 'elapsedMs' | 'deaths' | 'score' | 'finishedAt'>>(
  entries: T[],
  goal: RoomGoal
): T[] {
  const sorted = [...entries];

  sorted.sort((left, right) => compareLeaderboardEntries(left, right, goal));

  return sorted;
}

export function sortCompletedRunsForLeaderboard(runs: RoomRunRecord[], goal: RoomGoal): RoomRunRecord[] {
  const completedRuns = runs.filter(
    (run): run is RoomRunRecord & { elapsedMs: number; finishedAt: string } =>
      run.result === 'completed' && run.elapsedMs !== null && run.finishedAt !== null
  );

  return sortRoomLeaderboardEntries(completedRuns, goal);
}

export function compareLeaderboardEntries<
  T extends Pick<RoomLeaderboardEntry, 'elapsedMs' | 'deaths' | 'score' | 'finishedAt'>
>(
  left: T,
  right: T,
  goal: RoomGoal
): number {
  const rankingMode = getLeaderboardRankingMode(goal);
  if (rankingMode === 'time') {
    return (
      left.elapsedMs - right.elapsedMs ||
      left.deaths - right.deaths ||
      right.score - left.score ||
      left.finishedAt.localeCompare(right.finishedAt)
    );
  }

  return (
    right.score - left.score ||
    left.deaths - right.deaths ||
    left.elapsedMs - right.elapsedMs ||
    left.finishedAt.localeCompare(right.finishedAt)
  );
}

function computeTimeBonus(timeLimitMs: number | null, elapsedMs: number, pointsPerSecond: number): number {
  if (timeLimitMs === null) {
    return Math.max(0, Math.floor((90_000 - elapsedMs) / 1000)) * Math.max(1, pointsPerSecond - 2);
  }

  return Math.max(0, Math.floor((timeLimitMs - elapsedMs) / 1000)) * pointsPerSecond;
}
