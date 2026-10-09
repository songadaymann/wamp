import type { CourseGoal } from './model';

export function getCourseEnemyGoalPublishValidationError(
  goal: CourseGoal | null,
  enemyCount: number,
): string | null {
  return goal?.type === 'defeat_all' && enemyCount <= 0
    ? 'Defeat All needs at least one enemy in the expanded room. Publish its cell before publishing the expanded room.'
    : null;
}
