import type { CourseRoomRef, CourseSnapshot } from '../../courses/model';

export interface ResolveCourseStartRoomRefOptions {
  lockedStartRoomId?: string | null;
  selectedRoomId?: string | null;
  roomRefHasSpawnPoint?: (roomRef: CourseRoomRef) => boolean;
}

export function resolveCourseStartRoomRef(
  course: CourseSnapshot,
  options: ResolveCourseStartRoomRefOptions = {},
): CourseRoomRef | null {
  if (options.lockedStartRoomId) {
    const lockedRoomRef = course.roomRefs.find(
      (roomRef) => roomRef.roomId === options.lockedStartRoomId,
    );
    if (lockedRoomRef) {
      return lockedRoomRef;
    }
  }

  if (course.startPoint) {
    const startRoomRef = course.roomRefs.find(
      (roomRef) => roomRef.roomId === course.startPoint?.roomId,
    );
    if (startRoomRef) {
      return startRoomRef;
    }
  }

  const hasSpawnPoint = options.roomRefHasSpawnPoint ?? (() => false);
  if (options.selectedRoomId) {
    const selectedRoomRef = course.roomRefs.find(
      (roomRef) => roomRef.roomId === options.selectedRoomId,
    );
    if (selectedRoomRef && hasSpawnPoint(selectedRoomRef)) {
      return selectedRoomRef;
    }
  }

  return (
    course.roomRefs.find((roomRef) => hasSpawnPoint(roomRef)) ??
    course.roomRefs[0] ??
    null
  );
}
