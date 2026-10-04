import { normalizeCourseSnapshot, type CourseSnapshot } from '../../../courses/model';
import type { GuestRunStartBody } from '../../../guestRooms/runModel';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { loadExpandedRoomTarget } from '../expandedRooms/store';
import { loadExactRoomVersion, loadRoomSnapshotsByReferences } from '../rooms/store';
import { computeCourseSnapshotVerificationHash, computeRoomSnapshotVerificationHash } from '../runs/verification';

export type GuestRunSnapshot = { kind: 'room'; room: RoomSnapshot }
  | { kind: 'course'; course: CourseSnapshot; rooms: RoomSnapshot[] };
export interface GuestRunSnapshotContext {
  snapshot: GuestRunSnapshot;
  snapshotHash: string;
  title: string | null;
  progressSourceType: 'room' | 'course';
  progressSourceId: string;
}
export async function loadGuestRunSnapshot(env: Env, body: GuestRunStartBody): Promise<GuestRunSnapshotContext> {
  let roomId = body.contentType === 'room' ? body.contentId : null;
  let courseId = body.contentId;
  let nativeExpanded = false;
  if (body.contentType === 'expanded_room') {
    const target = await loadExpandedRoomTarget(env, body.contentId);
    if (!target) throw new HttpError(404, 'Published expanded room not found.');
    if (target.source === 'standalone_room') roomId = target.anchorRoomId;
    else if (target.legacyCourseId) courseId = target.legacyCourseId;
    else { nativeExpanded = true; courseId = target.expandedRoomId; }
  }
  if (roomId !== null) {
    const version = await loadExactRoomVersion(env, roomId, body.version);
    const room = version?.snapshot;
    if (!room || room.status !== 'published' || !room.goal) throw new HttpError(404, 'Published room goal not found.');
    return { snapshot: { kind: 'room', room }, snapshotHash: await computeRoomSnapshotVerificationHash(room),
      title: room.title, progressSourceType: 'room', progressSourceId: room.id };
  }
  const row = await env.DB.prepare(nativeExpanded
    ? 'SELECT snapshot_json FROM expanded_room_versions WHERE expanded_room_id = ? AND version = ?'
    : 'SELECT snapshot_json FROM course_versions WHERE course_id = ? AND version = ?')
    .bind(courseId, body.version).first<{ snapshot_json: string }>();
  if (!row) throw new HttpError(404, 'Published course goal not found.');
  const course = normalizeCourseSnapshot(JSON.parse(row.snapshot_json), courseId);
  if (course.status !== 'published' || !course.goal || course.roomRefs.length === 0) throw new HttpError(404, 'Published course goal not found.');
  if (course.roomRefs.length > 128) throw new HttpError(409, 'This course is too large for guest progress.');
  const rooms = await loadRoomSnapshotsByReferences(env, course.roomRefs.map(ref => ref.roomVersion === null
    ? { kind: 'current_preview' as const, roomId: ref.roomId, state: 'published' as const, coordinates: ref.coordinates }
    : { kind: 'version' as const, roomId: ref.roomId, version: ref.roomVersion }));
  if (rooms.missing.length > 0) throw new HttpError(409, 'Some published course cells are unavailable.');
  return { snapshot: { kind: 'course', course, rooms: rooms.snapshots.map(entry => entry.snapshot) },
    snapshotHash: await computeCourseSnapshotVerificationHash(course), title: course.title,
    progressSourceType: 'course', progressSourceId: courseId };
}
