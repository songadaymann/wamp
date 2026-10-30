import type { CourseRepository } from '../../courses/courseRepository';
import type { CourseLeaderboardResponse } from '../../courses/runModel';
import type { ExpandedRoomRepository } from '../../expandedRooms/repository';
import type { OverworldSelectedRoomContext } from './sceneBridge';

/** Standalone room aliases belong to the ordinary room board. Every other
 * Expanded Room identity ranks the whole footprint, regardless of selected cell. */
export function hasExpandedRoomLeaderboardTarget(context: OverworldSelectedRoomContext | null): boolean {
  return context?.state === 'published' && Boolean(context.courseId
    || (context.expandedRoomId && !context.expandedRoomId.startsWith('room:')));
}

export async function loadSelectedExpandedRoomLeaderboard(
  context: OverworldSelectedRoomContext,
  expandedRooms: Pick<ExpandedRoomRepository, 'loadExpandedRoomLeaderboard'>,
  courses: Pick<CourseRepository, 'loadCourseLeaderboard'>,
): Promise<CourseLeaderboardResponse | null> {
  if (!hasExpandedRoomLeaderboardTarget(context) || !context.courseGoalType) return null;
  // A playing run keeps its exact version even if the builder has republished.
  const version = context.expandedRoomVersion ?? null;
  if (context.expandedRoomId && !context.expandedRoomId.startsWith('room:')) {
    return expandedRooms.loadExpandedRoomLeaderboard(context.expandedRoomId, version, 25, true);
  }
  return courses.loadCourseLeaderboard(context.courseId!, version, 25, true);
}
