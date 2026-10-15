import type { LeaderboardRankingMode } from '../runs/model';
import { COURSE_GOAL_DEFINITIONS, type CourseGoal } from './model';
import { courseGoalRankingMode, scoreCourseGoal } from '../goals/goalSchema';
import type {
  CourseLeaderboardEntry,
  CourseRunFinishRequestBody,
  CourseRunRecord,
} from './runModel';

export function computeCourseRunScore(
  goal: CourseGoal,
  finish: CourseRunFinishRequestBody
): number {
  return scoreCourseGoal(goal, finish, COURSE_GOAL_DEFINITIONS);
}

export function getCourseLeaderboardRankingMode(goal: CourseGoal): LeaderboardRankingMode {
  return courseGoalRankingMode(goal, COURSE_GOAL_DEFINITIONS);
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
