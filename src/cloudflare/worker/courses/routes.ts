import { cloneCourseSnapshot, type CourseRecord } from '../../../courses/model';
import { expandedRoomIdFromLegacyCourseId } from '../../../expandedRooms/model';
import { HttpError, jsonResponse } from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { refreshPlayableContentIndexForExpandedRoom, schedulePlayableContentIndexRefresh } from '../playableContentIndex/store';
import { loadOptionalRequestAuth, requireAuthenticatedRequestAuth, requireOptionalScope } from '../auth/request';
import { awardCoursePublishPoints, upsertUserStats } from '../runs/points';
import { assertUserCanPublishContent, awardCoursePublishProgression, resolveRoomCapabilities } from '../progression/store';
import { createCourseDraft, loadLatestEditableDraftCourseForRoom, loadCourseRecord, publishCourse, saveCourseDraft, unpublishCourse } from './store';
import { parseCourseSnapshotBody } from './requestBodies';
import { assertPrimeOnlyAuthoringRooms } from '../worlds/access';
export { handleCourseRunStart, handleCourseRunFinish, handleCourseLeaderboard, handleCourseRatingSubmit } from './runAdapters';

interface CoursePublishRouteOptions {
  enforceDailyPublishLimit?: boolean;
  executionContext?: WorkerExecutionContextLike;
}

export async function handleCourseCreate(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'create expanded room drafts',
    'rooms:write'
  );
  const snapshot = await parseCourseSnapshotBody(request);
  await assertPrimeOnlyAuthoringRooms(env, snapshot.roomRefs.map((room) => room.roomId));
  const record = await createCourseDraft(env, snapshot, auth.user, auth.isAdmin, auth.source);
  return jsonResponse(request, record);
}

export async function handleCourseGet(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'rooms:read', 'read expanded rooms');
  const record = await loadCourseRecord(
    env,
    courseId,
    auth?.user.id ?? null,
    auth?.isAdmin ?? false
  );

  if (!record) {
    throw new HttpError(404, 'Expanded Room not found.');
  }

  if (record.permissions.canSaveDraft || auth?.isAdmin) {
    const editableRecord = auth
      ? await attachExpandedRoomCellLimitForUser(env, record, auth.user.id, auth.source)
      : record;
    return jsonResponse(request, editableRecord);
  }

  if (!record.published) {
    throw new HttpError(404, 'Published expanded room not found.');
  }

  return jsonResponse(request, sanitizeCourseRecordForPublicRead(record));
}

export async function handleCourseDraftByRoomLookup(
  request: Request,
  env: Env,
  roomId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'load editable expanded room drafts',
    'rooms:write'
  );
  const record = await loadLatestEditableDraftCourseForRoom(
    env,
    roomId,
    auth.user.id,
    auth.isAdmin
  );

  if (!record) {
    throw new HttpError(404, 'Draft expanded room not found for this room.');
  }

  return jsonResponse(
    request,
    await attachExpandedRoomCellLimitForUser(env, record, auth.user.id, auth.source)
  );
}

export async function handleCourseDraftSave(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'save expanded room drafts',
    'rooms:write'
  );
  const snapshot = await parseCourseSnapshotBody(request, courseId);
  await assertPrimeOnlyAuthoringRooms(env, snapshot.roomRefs.map((room) => room.roomId));
  const record = await saveCourseDraft(env, snapshot, auth.user, auth.isAdmin, auth.source);
  return jsonResponse(request, record);
}

export async function handleCoursePublish(
  request: Request,
  env: Env,
  courseId: string,
  options: CoursePublishRouteOptions = {}
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'publish expanded rooms',
    'rooms:write'
  );
  const existing = await loadCourseRecord(env, courseId, auth.user.id, auth.isAdmin);
  if (!existing) {
    throw new HttpError(404, 'Expanded Room draft not found.');
  }
  await assertPrimeOnlyAuthoringRooms(env, existing.draft.roomRefs.map((room) => room.roomId));

  if (options.enforceDailyPublishLimit !== false) {
    await assertUserCanPublishContent(env, auth.user.id, auth.source);
  }

  const record = await publishCourse(env, courseId, auth.user, auth.isAdmin, auth.source);
  await awardCoursePublishPoints(
    env,
    auth.user.id,
    record.draft.id,
    record.published?.version ?? record.draft.version,
    !existing.published
  );
  await awardCoursePublishProgression(env, {
    userId: auth.user.id,
    courseId: record.draft.id,
    courseVersion: record.published?.version ?? record.draft.version,
    publishedSnapshot: record.published ?? record.draft,
    previousPublishedSnapshot: existing.published,
    publishedAt: record.published?.publishedAt ?? new Date().toISOString(),
    isFirstPublish: !existing.published,
  });
  await upsertUserStats(env, auth.user.id);
  schedulePlayableContentIndexRefresh(
    options.executionContext,
    refreshPlayableContentIndexForExpandedRoom(env, expandedRoomIdFromLegacyCourseId(courseId)),
  );
  return jsonResponse(request, record);
}

export async function handleCourseUnpublish(
  request: Request,
  env: Env,
  courseId: string,
  executionContext?: WorkerExecutionContextLike,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'unpublish expanded rooms',
    'rooms:write'
  );
  const record = await unpublishCourse(env, courseId, auth.user, auth.isAdmin);
  schedulePlayableContentIndexRefresh(
    executionContext,
    refreshPlayableContentIndexForExpandedRoom(env, expandedRoomIdFromLegacyCourseId(courseId)),
  );
  return jsonResponse(
    request,
    await attachExpandedRoomCellLimitForUser(env, record, auth.user.id, auth.source)
  );
}

async function attachExpandedRoomCellLimitForUser(
  env: Env,
  record: CourseRecord,
  userId: string,
  requestAuthSource: Parameters<typeof resolveRoomCapabilities>[2]
): Promise<CourseRecord> {
  const capabilities = await resolveRoomCapabilities(env, userId, requestAuthSource);
  return {
    ...record,
    expandedRoomCellLimit: capabilities.expandedRoomCellLimit,
  };
}

function sanitizeCourseRecordForPublicRead(record: CourseRecord): CourseRecord {
  const published = record.published ? cloneCourseSnapshot(record.published) : null;
  if (!published) {
    throw new HttpError(404, 'Published expanded room not found.');
  }

  return {
    draft: cloneCourseSnapshot(published),
    published,
    versions: record.versions.map(cloneCourseRecordVersionForPublicRead),
    ownerUserId: record.ownerUserId,
    ownerDisplayName: record.ownerDisplayName,
    permissions: {
      canSaveDraft: false,
      canPublish: false,
      canUnpublish: false,
    },
  };
}

function cloneCourseRecordVersionForPublicRead(version: CourseRecord['versions'][number]) {
  return {
    ...version,
    snapshot: cloneCourseSnapshot(version.snapshot),
  };
}
