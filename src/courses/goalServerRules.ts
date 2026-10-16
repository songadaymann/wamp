import type { Goal } from '../goals/goalSchema';
import type { CourseGoalType, CourseMarkerPoint, CourseRoomRef } from './model';

interface CourseServerRule<K extends CourseGoalType> {
  countsEnemies: boolean;
  enemyError: (enemyCount: number) => string | null;
  publishError: (goal: Goal<CourseMarkerPoint, K>, rooms: readonly CourseRoomRef[], enemyCount: number) => string | null;
  removeRoom: (goal: Goal<CourseMarkerPoint, K>, roomId: string) => Goal<CourseMarkerPoint, K>;
}
export type CourseServerRegistry = { [K in CourseGoalType]: CourseServerRule<K> };
const unchanged = <K extends CourseGoalType>(goal: Goal<CourseMarkerPoint, K>): Goal<CourseMarkerPoint, K> => goal;
const noRequirements = { countsEnemies: false, enemyError: () => null, publishError: () => null, removeRoom: unchanged };
const enemyError = (count: number): string | null => count <= 0
  ? 'Defeat All needs at least one enemy in the expanded room. Publish its cell before publishing the expanded room.' : null;

/** Publish errors and removal retain their existing order, messages and clone behavior. */
export const COURSE_SERVER_RULES: CourseServerRegistry = {
  reach_exit: {
    ...noRequirements,
    publishError: goal => goal.exit ? null : 'Reach Exit expanded rooms need an exit.',
    removeRoom: (goal, roomId) => goal.exit?.roomId === roomId ? { ...goal, exit: null } : goal,
  },
  collect_target: { ...noRequirements },
  defeat_all: { ...noRequirements, countsEnemies: true, enemyError, publishError: (_goal, _rooms, count) => enemyError(count) },
  checkpoint_sprint: {
    ...noRequirements,
    publishError: (goal, rooms) => {
      if (goal.checkpoints.length === 0) return 'Checkpoint Sprint expanded rooms need at least one checkpoint.';
      if (!goal.finish) return 'Checkpoint Sprint expanded rooms need a finish.';
      for (const point of goal.checkpoints) {
        if (!rooms.some(room => room.roomId === point.roomId)) return 'Checkpoint must belong to a room in the expanded room.';
      }
      return null;
    },
    removeRoom: (goal, roomId) => ({ ...goal, checkpoints: goal.checkpoints.filter(point => point.roomId !== roomId), finish: goal.finish?.roomId === roomId ? null : goal.finish }),
  },
  survival: { ...noRequirements },
};
export function getCourseGoalPublishError<K extends CourseGoalType>(goal: Goal<CourseMarkerPoint, K>, rooms: readonly CourseRoomRef[], enemyCount: number): string | null {
  return COURSE_SERVER_RULES[goal.type].publishError(goal, rooms, enemyCount);
}
export function removeCourseGoalRoom<K extends CourseGoalType>(goal: Goal<CourseMarkerPoint, K>, roomId: string): Goal<CourseMarkerPoint, K> {
  return COURSE_SERVER_RULES[goal.type].removeRoom(goal, roomId);
}
