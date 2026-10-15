import { ROOM_GOAL_DEFINITIONS, type RoomGoal } from '../goals/roomGoals';
import { roomGoalRankingPolicy, scoreRoomGoal } from '../goals/goalSchema';
import type { LeaderboardRankingMode, RoomLeaderboardEntry, RoomRunRecord, RunFinishRequestBody } from './model';

export function computeRunScore(goal: RoomGoal, finish: RunFinishRequestBody): number {
  return scoreRoomGoal(goal, finish, ROOM_GOAL_DEFINITIONS);
}

export function getLeaderboardRankingMode(goal: RoomGoal): LeaderboardRankingMode {
  const policy = roomGoalRankingPolicy(goal, ROOM_GOAL_DEFINITIONS);
  return policy === 'protect' ? 'score' : policy;
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
  const includeFailed = roomGoalRankingPolicy(goal, ROOM_GOAL_DEFINITIONS) === 'protect';
  const rankedRuns = runs.filter(
    (run): run is RoomRunRecord & { elapsedMs: number; finishedAt: string } =>
      (
        run.result === 'completed' ||
        (includeFailed && run.result === 'failed')
      ) &&
      run.elapsedMs !== null &&
      run.finishedAt !== null
  );

  return sortRoomLeaderboardEntries(rankedRuns, goal);
}

export function compareLeaderboardEntries<
  T extends Pick<RoomLeaderboardEntry, 'elapsedMs' | 'deaths' | 'score' | 'finishedAt'>
>(
  left: T,
  right: T,
  goal: RoomGoal
): number {
  const rankingPolicy = roomGoalRankingPolicy(goal, ROOM_GOAL_DEFINITIONS);
  if (rankingPolicy === 'protect') {
    return (
      right.elapsedMs - left.elapsedMs ||
      left.deaths - right.deaths ||
      left.finishedAt.localeCompare(right.finishedAt)
    );
  }

  if (rankingPolicy === 'time') {
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
