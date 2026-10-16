import { COURSE_SERVER_RULES } from './goalServerRules';
import type { CourseGoal } from './model';

export function getCourseEnemyGoalPublishValidationError(
  goal: CourseGoal | null,
  enemyCount: number,
): string | null {
  return goal ? COURSE_SERVER_RULES[goal.type].enemyError(enemyCount) : null;
}
