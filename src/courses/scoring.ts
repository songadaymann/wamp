import type { LeaderboardRankingMode } from '../runs/model';
import type { CourseGoal } from './model';
import type {
  CourseLeaderboardEntry,
  CourseRunFinishRequestBody,
  CourseRunRecord,
} from './runModel';

export function computeCourseRunScore(
  goal: CourseGoal,
  finish: CourseRunFinishRequestBody
): number {
  const collectiblePoints = Math.max(0, finish.collectiblesCollected) * 10;
  const enemyPoints = Math.max(0, finish.enemiesDefeated) * 25;
  const checkpointPoints = Math.max(0, finish.checkpointsReached) * 50;
  const clearBonus = finish.result === 'completed' ? 250 : 0;
  const zeroDeathBonus = finish.result === 'completed' && finish.deaths === 0 ? 100 : 0;
  const survivalBonus =
    goal.type === 'survival' && finish.result === 'completed'
      ? Math.max(0, Math.round(finish.elapsedMs / 1000)) * 5
      : 0;

  return (
    collectiblePoints +
    enemyPoints +
    checkpointPoints +
    clearBonus +
    zeroDeathBonus +
    survivalBonus
  );
}

export function getCourseLeaderboardRankingMode(goal: CourseGoal): LeaderboardRankingMode {
  switch (goal.type) {
    case 'reach_exit':
      return goal.timeLimitMs ? 'time' : 'score';
    case 'checkpoint_sprint':
      return 'time';
    case 'collect_target':
    case 'defeat_all':
    case 'survival':
    default:
      return 'score';
  }
}

export function compareCourseLeaderboardEntries(
  left: Pick<CourseRunRecord | CourseLeaderboardEntry, 'elapsedMs' | 'deaths' | 'score' | 'finishedAt'>,
  right: Pick<CourseRunRecord | CourseLeaderboardEntry, 'elapsedMs' | 'deaths' | 'score' | 'finishedAt'>,
  goal: CourseGoal
): number {
  const rankingMode = getCourseLeaderboardRankingMode(goal);

  if (rankingMode === 'time') {
    const leftElapsed = Math.max(0, left.elapsedMs ?? Number.MAX_SAFE_INTEGER);
    const rightElapsed = Math.max(0, right.elapsedMs ?? Number.MAX_SAFE_INTEGER);
    if (leftElapsed !== rightElapsed) {
      return leftElapsed - rightElapsed;
    }
    if (left.deaths !== right.deaths) {
      return left.deaths - right.deaths;
    }
    if (left.score !== right.score) {
      return right.score - left.score;
    }
  } else {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    const leftElapsed = Math.max(0, left.elapsedMs ?? Number.MAX_SAFE_INTEGER);
    const rightElapsed = Math.max(0, right.elapsedMs ?? Number.MAX_SAFE_INTEGER);
    if (leftElapsed !== rightElapsed) {
      return leftElapsed - rightElapsed;
    }
    if (left.deaths !== right.deaths) {
      return left.deaths - right.deaths;
    }
  }

  return (left.finishedAt ?? '').localeCompare(right.finishedAt ?? '');
}

export function sortCompletedCourseRunsForLeaderboard(
  runs: CourseRunRecord[],
  goal: CourseGoal
): CourseRunRecord[] {
  return [...runs].sort((left, right) => compareCourseLeaderboardEntries(left, right, goal));
}
