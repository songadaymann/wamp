import { createCourseRepository } from '../courses/courseRepository';
import { createExpandedRoomRepository } from '../expandedRooms/repository';
import { createRoomRepository } from '../persistence/roomRepository';
import type { RoomCoordinates } from '../persistence/roomModel';
import type { GuestRunSavedClear } from './runModel';

type ReplayTarget = Pick<GuestRunSavedClear, 'contentType' | 'contentId'>;
export interface GuestRunReplayLink { href: string; label: string }
const coordinates = (value: string): RoomCoordinates | null => {
  if (!/^-?\d+,-?\d+$/.test(value)) return null;
  const [x, y] = value.split(',').map(Number);
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null;
};
const href = (value: RoomCoordinates) => `/r/${value.x}/${value.y}`;

/** Resolve current published content; never turn editable browser XP into an award. */
export async function resolveGuestRunReplayLink(target: ReplayTarget): Promise<GuestRunReplayLink | null> {
  try {
    if (target.contentType === 'room' || target.contentId.startsWith('room:')) {
      const id = target.contentId.replace(/^room:/, '');
      const point = coordinates(id);
      if (!point || !(await createRoomRepository().loadRoom(id, point)).published) return null;
      return { href: href(point), label: 'Replay' };
    }
    if (target.contentType === 'course' || target.contentId.startsWith('course:')) {
      const course = (await createCourseRepository().loadCourse(target.contentId.replace(/^course:/, ''))).published;
      const start = course?.roomRefs.find(room => room.roomId === course.startPoint?.roomId) ?? course?.roomRefs[0];
      return start ? { href: href(start.coordinates), label: 'Replay' } : null;
    }
    const expanded = await createExpandedRoomRepository().loadExpandedRoom(target.contentId);
    return expanded.publishedAt ? { href: href(expanded.anchorCoordinates), label: 'View room' } : null;
  } catch { return null; }
}
