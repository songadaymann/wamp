import {
  sortCourseRoomRefsForStorage,
  type CourseRoomRef,
} from '../../../courses/model';
import { HttpError } from '../core/http';

export type CourseRoomVersionPolicy = 'pinned' | 'latest_published';

export interface PublishedCourseRoomVersion {
  version: number;
  title: string | null;
  publishedByUserId: string | null;
}

export type PublishedCourseRoomVersionLoader = (
  roomId: string,
  requestedVersion: number | null,
) => Promise<PublishedCourseRoomVersion>;

export async function resolveCourseRoomRefsForActor(
  roomRefs: CourseRoomRef[],
  actorUserId: string,
  versionPolicy: CourseRoomVersionPolicy,
  loadPublishedVersion: PublishedCourseRoomVersionLoader,
): Promise<CourseRoomRef[]> {
  const resolvedRefs = await Promise.all(roomRefs.map(async (roomRef) => {
    const requestedVersion = versionPolicy === 'latest_published'
      ? null
      : roomRef.roomVersion;
    const roomVersion = await loadPublishedVersion(roomRef.roomId, requestedVersion);
    if (!roomVersion.publishedByUserId) {
      throw new HttpError(409, 'Only published rooms can be used in an expanded room.');
    }
    if (roomVersion.publishedByUserId !== actorUserId) {
      throw new HttpError(403, 'All expanded room cells must be published by the same creator.');
    }

    return {
      roomId: roomRef.roomId,
      coordinates: { ...roomRef.coordinates },
      roomVersion: roomVersion.version,
      roomTitle: roomVersion.title ?? roomRef.roomTitle ?? null,
    } satisfies CourseRoomRef;
  }));

  return sortCourseRoomRefsForStorage(resolvedRefs);
}
