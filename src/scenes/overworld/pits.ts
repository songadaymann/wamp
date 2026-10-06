import type { CourseSnapshot } from '../../courses/model';
import type { ExpandedRoomMembershipSummary } from '../../expandedRooms/model';
import { roomIdFromCoordinates, type RoomSnapshot } from '../../persistence/roomModel';

export function hasDeadlyBottomEdge(
  room: Pick<RoomSnapshot, 'coordinates' | 'pitsAreDeadly'> | null,
  course: CourseSnapshot | null,
  membership: ExpandedRoomMembershipSummary | null = null,
  belowMembership: ExpandedRoomMembershipSummary | null = null,
): boolean {
  if (!room) return false;
  const roomId = roomIdFromCoordinates(room.coordinates);
  const belowId = roomIdFromCoordinates({ x: room.coordinates.x, y: room.coordinates.y + 1 });
  if (course?.roomRefs.some(ref => ref.roomId === roomId)) {
    return course.pitsAreDeadly === true && !course.roomRefs.some(ref => ref.roomId === belowId);
  }
  if (membership && membership.source !== 'standalone_room') {
    return membership.pitsAreDeadly === true && membership.expandedRoomId !== belowMembership?.expandedRoomId;
  }
  return room.pitsAreDeadly === true;
}
