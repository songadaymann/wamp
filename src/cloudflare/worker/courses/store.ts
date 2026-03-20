import type { AuthUser } from '../../../auth/model';
import {
  cloneCourseRecord,
  cloneCourseSnapshot,
  courseRoomRefsFollowLinearPath,
  courseRoomRefsHaveUniqueRoomIds,
  createCourseVersionRecord,
  getCourseRoomOrder,
  normalizeCourseGoal,
  normalizeCourseSnapshot,
  type CourseGoalType,
  type CourseMarkerPoint,
  type CourseRecord,
  type CourseRoomRef,
  type CourseSnapshot,
  type CourseVersionRecord,
} from '../../../courses/model';
import { HttpError } from '../core/http';
import type {
  CourseRow,
  CourseVersionRow,
  Env,
  PersistCourseRecordInput,
  PersistCourseVersionInput,
  RoomVersionRow,
} from '../core/types';

export async function loadCourseRecord(
  env: Env,
  courseId: string,
  viewerUserId: string | null = null,
  viewerIsAdmin = false
): Promise<CourseRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        id,
        owner_user_id,
        owner_display_name,
        draft_json,
        published_json,
        draft_title,
        published_title,
        draft_version,
        published_version,
        created_at,
        updated_at,
        published_at
      FROM courses
      WHERE id = ?
      LIMIT 1
    `
  )
    .bind(courseId)
    .first<CourseRow>();

  if (!row) {
    return null;
  }

  const draft = parseStoredCourseSnapshot(row.draft_json, row.id);
  const published = row.published_json ? parseStoredCourseSnapshot(row.published_json, row.id) : null;
  const versions = await loadCourseVersions(env, row.id);

  const record: CourseRecord = {
    draft,
    published,
    versions,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    permissions: {
      canSaveDraft: viewerIsAdmin || (viewerUserId !== null && viewerUserId === row.owner_user_id),
      canPublish: viewerIsAdmin || (viewerUserId !== null && viewerUserId === row.owner_user_id),
      canUnpublish: viewerIsAdmin || (viewerUserId !== null && viewerUserId === row.owner_user_id),
    },
  };

  return cloneCourseRecord(record);
}

export async function loadPublishedCourse(
  env: Env,
  courseId: string
): Promise<CourseSnapshot | null> {
  const row = await env.DB.prepare(
    `
      SELECT published_json
      FROM courses
      WHERE id = ?
        AND published_json IS NOT NULL
      LIMIT 1
    `
  )
    .bind(courseId)
    .first<{ published_json: string | null }>();

  if (!row?.published_json) {
    return null;
  }

  return parseStoredCourseSnapshot(row.published_json, courseId);
}

export async function loadPublishedCourseMembershipsInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): Promise<
  Array<{
    roomId: string;
    courseId: string;
    courseTitle: string | null;
    goalType: CourseGoalType | null;
    roomIndex: number;
    roomCount: number;
  }>
> {
  const result = await env.DB.prepare(
    `
      SELECT
        refs.room_id,
        refs.room_order,
        course.id AS course_id,
        course.published_title,
        course.published_json,
        room_counts.room_count
      FROM course_room_refs refs
      INNER JOIN courses course
        ON course.id = refs.course_id
       AND course.published_version = refs.course_version
       AND course.published_json IS NOT NULL
      INNER JOIN (
        SELECT course_id, course_version, COUNT(*) AS room_count
        FROM course_room_refs
        GROUP BY course_id, course_version
      ) room_counts
        ON room_counts.course_id = refs.course_id
       AND room_counts.course_version = refs.course_version
      WHERE refs.room_x BETWEEN ? AND ?
        AND refs.room_y BETWEEN ? AND ?
      ORDER BY refs.course_id ASC, refs.room_order ASC
    `
  )
    .bind(minX, maxX, minY, maxY)
    .all<{
      room_id: string;
      room_order: number;
      course_id: string;
      published_title: string | null;
      published_json: string | null;
      room_count: number;
    }>();

  const goalTypeByCourseId = new Map<string, CourseGoalType | null>();
  return result.results.map((row) => ({
    goalType: (() => {
      if (goalTypeByCourseId.has(row.course_id)) {
        return goalTypeByCourseId.get(row.course_id) ?? null;
      }

      const goalType =
        row.published_json
          ? parseStoredCourseSnapshot(row.published_json, row.course_id).goal?.type ?? null
          : null;
      goalTypeByCourseId.set(row.course_id, goalType);
      return goalType;
    })(),
    roomId: row.room_id,
    courseId: row.course_id,
    courseTitle: row.published_title,
    roomIndex: row.room_order,
    roomCount: Number(row.room_count ?? 0),
  }));
}

export async function createCourseDraft(
  env: Env,
  snapshot: CourseSnapshot,
  actor: AuthUser,
  actorIsAdmin = false
): Promise<CourseRecord> {
  const normalized = normalizeCourseSnapshot(snapshot, snapshot.id);
  const now = new Date().toISOString();
  const draft = await resolveValidatedCourseDraft(env, normalized, actor, {
    allowSingleRoomDraft: true,
    requirePublishedGoal: false,
  });
  const createdAt = normalized.createdAt || now;
  const nextRecord: CourseRecord = {
    draft: {
      ...draft,
      status: 'draft',
      version: 1,
      createdAt,
      updatedAt: now,
      publishedAt: null,
    },
    published: null,
    versions: [],
    ownerUserId: actor.id,
    ownerDisplayName: actor.displayName,
    permissions: {
      canSaveDraft: true,
      canPublish: true,
      canUnpublish: true,
    },
  };

  await persistCourseRecord(env, {
    draft: nextRecord.draft,
    published: null,
    ownerUserId: actor.id,
    ownerDisplayName: actor.displayName,
    createdAt,
    updatedAt: now,
    publishedAt: null,
  });

  const stored = await loadCourseRecord(env, nextRecord.draft.id, actor.id, actorIsAdmin);
  if (!stored) {
    throw new HttpError(500, 'Failed to create course draft.');
  }

  return stored;
}

export async function saveCourseDraft(
  env: Env,
  snapshot: CourseSnapshot,
  actor: AuthUser,
  actorIsAdmin = false
): Promise<CourseRecord> {
  const existing = await loadCourseRecord(env, snapshot.id, actor.id, actorIsAdmin);
  if (!existing) {
    return createCourseDraft(env, snapshot, actor, actorIsAdmin);
  }

  if (!existing.permissions.canSaveDraft) {
    throw new HttpError(403, 'You do not have permission to edit this course.');
  }

  const now = new Date().toISOString();
  const nextVersion = existing.published?.version ?? existing.draft.version;
  const normalized = normalizeCourseSnapshot(snapshot, snapshot.id);
  const draft = await resolveValidatedCourseDraft(
    env,
    {
      ...normalized,
      version: nextVersion,
    },
    actor,
    {
      allowSingleRoomDraft: true,
      requirePublishedGoal: false,
    }
  );

  const nextDraft: CourseSnapshot = {
    ...draft,
    status: 'draft',
    version: nextVersion,
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: existing.published?.publishedAt ?? null,
  };

  await persistCourseRecord(env, {
    draft: nextDraft,
    published: existing.published,
    ownerUserId: existing.ownerUserId ?? actor.id,
    ownerDisplayName: existing.ownerDisplayName ?? actor.displayName,
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: existing.published?.publishedAt ?? null,
  });

  const stored = await loadCourseRecord(env, snapshot.id, actor.id, actorIsAdmin);
  if (!stored) {
    throw new HttpError(500, 'Failed to save course draft.');
  }

  return stored;
}

export async function publishCourse(
  env: Env,
  courseId: string,
  actor: AuthUser,
  actorIsAdmin = false
): Promise<CourseRecord> {
  const existing = await loadCourseRecord(env, courseId, actor.id, actorIsAdmin);
  if (!existing) {
    throw new HttpError(404, 'Course draft not found.');
  }

  if (!existing.permissions.canPublish) {
    throw new HttpError(403, 'You do not have permission to publish this course.');
  }

  const now = new Date().toISOString();
  const lastPublished = existing.versions[existing.versions.length - 1] ?? null;
  const nextVersion = lastPublished ? lastPublished.version + 1 : Math.max(1, existing.draft.version);
  const validatedDraft = await resolveValidatedCourseDraft(
    env,
    {
      ...existing.draft,
      version: nextVersion,
    },
    actor,
    {
      allowSingleRoomDraft: false,
      requirePublishedGoal: true,
    }
  );

  await ensureRoomsNotInOtherPublishedCourses(env, courseId, validatedDraft.roomRefs.map((roomRef) => roomRef.roomId));

  const published: CourseSnapshot = {
    ...validatedDraft,
    status: 'published',
    version: nextVersion,
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: now,
  };

  const draft: CourseSnapshot = {
    ...cloneCourseSnapshot(published),
    status: 'draft',
    updatedAt: now,
  };

  await persistCourseRecord(env, {
    draft,
    published,
    ownerUserId: existing.ownerUserId ?? actor.id,
    ownerDisplayName: existing.ownerDisplayName ?? actor.displayName,
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: now,
  });

  await persistCourseVersion(env, {
    snapshot: published,
    createdAt: now,
    publishedByUserId: actor.id,
    publishedByDisplayName: actor.displayName,
    onConflictUpdate: true,
  });

  const stored = await loadCourseRecord(env, courseId, actor.id, actorIsAdmin);
  if (!stored?.published) {
    throw new HttpError(500, 'Failed to publish course.');
  }

  return stored;
}

export async function unpublishCourse(
  env: Env,
  courseId: string,
  actor: AuthUser,
  actorIsAdmin = false
): Promise<CourseRecord> {
  const existing = await loadCourseRecord(env, courseId, actor.id, actorIsAdmin);
  if (!existing) {
    throw new HttpError(404, 'Course draft not found.');
  }

  if (!existing.permissions.canUnpublish) {
    throw new HttpError(403, 'You do not have permission to unpublish this course.');
  }

  if (!existing.published) {
    throw new HttpError(409, 'This course is not published.');
  }

  const now = new Date().toISOString();
  const draft: CourseSnapshot = {
    ...cloneCourseSnapshot(existing.draft),
    status: 'draft',
    updatedAt: now,
    publishedAt: null,
  };

  await persistCourseRecord(env, {
    draft,
    published: null,
    ownerUserId: existing.ownerUserId ?? actor.id,
    ownerDisplayName: existing.ownerDisplayName ?? actor.displayName,
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: null,
  });

  const stored = await loadCourseRecord(env, courseId, actor.id, actorIsAdmin);
  if (!stored || stored.published) {
    throw new HttpError(500, 'Failed to unpublish course.');
  }

  return stored;
}

async function loadCourseVersions(env: Env, courseId: string): Promise<CourseVersionRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        version,
        snapshot_json,
        title,
        created_at,
        published_by_user_id,
        published_by_display_name
      FROM course_versions
      WHERE course_id = ?
      ORDER BY version ASC
    `
  )
    .bind(courseId)
    .all<CourseVersionRow>();

  return result.results.map((row) => {
    const snapshot = parseStoredCourseSnapshot(row.snapshot_json, courseId);
    return createCourseVersionRecord(snapshot, {
      version: row.version,
      createdAt: row.created_at,
      publishedByUserId: row.published_by_user_id,
      publishedByDisplayName: row.published_by_display_name,
    });
  });
}

async function resolveValidatedCourseDraft(
  env: Env,
  draft: CourseSnapshot,
  actor: AuthUser,
  options: { allowSingleRoomDraft: boolean; requirePublishedGoal: boolean }
): Promise<CourseSnapshot> {
  const roomRefs = draft.roomRefs;
  if (roomRefs.length === 0) {
    throw new HttpError(400, 'A course needs at least one room in draft.');
  }

  if (!courseRoomRefsHaveUniqueRoomIds(roomRefs)) {
    throw new HttpError(400, 'Course rooms must be unique.');
  }

  if (roomRefs.length > 4) {
    throw new HttpError(400, 'Courses can span at most 4 rooms.');
  }

  if (!options.allowSingleRoomDraft && roomRefs.length < 2) {
    throw new HttpError(400, 'Published courses must span 2 to 4 rooms.');
  }

  if (!courseRoomRefsFollowLinearPath(roomRefs)) {
    throw new HttpError(400, 'Course rooms must follow one ordered linear path.');
  }

  const resolvedRefs = await Promise.all(
    roomRefs.map(async (roomRef) => {
      const roomVersion = await loadPublishedRoomVersionForCourse(env, roomRef.roomId, roomRef.roomVersion);
      if (!roomVersion.published_by_user_id) {
        throw new HttpError(409, 'Only published rooms can be used in a course.');
      }
      if (roomVersion.published_by_user_id !== actor.id) {
        throw new HttpError(403, 'All course rooms must be published by the same creator.');
      }
      return {
        roomId: roomRef.roomId,
        coordinates: { ...roomRef.coordinates },
        roomVersion: roomVersion.version,
        roomTitle: roomVersion.title ?? roomRef.roomTitle ?? null,
      } satisfies CourseRoomRef;
    })
  );

  const nextGoal = normalizeCourseGoal(draft.goal);
  validateCourseMarkerBelongsToCourse(draft.startPoint, resolvedRefs, 'Start point');
  validateCourseGoalMarkers(nextGoal, resolvedRefs);
  if (options.requirePublishedGoal) {
    validatePublishableCourseDraft(
      {
        ...draft,
        roomRefs: resolvedRefs,
        goal: nextGoal,
      },
      resolvedRefs
    );
  }

  return {
    ...cloneCourseSnapshot(draft),
    roomRefs: resolvedRefs,
    startPoint: draft.startPoint ? { ...draft.startPoint } : null,
    goal: nextGoal,
  };
}

async function loadPublishedRoomVersionForCourse(
  env: Env,
  roomId: string,
  requestedVersion: number
): Promise<RoomVersionRow> {
  const row = await env.DB.prepare(
    `
      SELECT
        version,
        snapshot_json,
        title,
        created_at,
        published_by_user_id,
        published_by_display_name,
        reverted_from_version
      FROM room_versions
      WHERE room_id = ?
        AND version = ?
      LIMIT 1
    `
  )
    .bind(roomId, requestedVersion)
    .first<RoomVersionRow & { reverted_from_version: number | null }>();

  if (!row) {
    throw new HttpError(404, `Room version ${roomId} v${requestedVersion} was not found.`);
  }

  return row;
}

function validateCourseMarkerBelongsToCourse(
  point: CourseMarkerPoint | null,
  roomRefs: CourseRoomRef[],
  label: string
): void {
  if (!point) {
    return;
  }

  const roomIds = new Set(roomRefs.map((roomRef) => roomRef.roomId));
  if (!roomIds.has(point.roomId)) {
    throw new HttpError(400, `${label} must belong to a room in the course.`);
  }
}

function validateCourseGoalMarkers(goal: CourseSnapshot['goal'], roomRefs: CourseRoomRef[]): void {
  if (!goal) {
    return;
  }

  switch (goal.type) {
    case 'reach_exit':
      validateCourseMarkerBelongsToCourse(goal.exit, roomRefs, 'Exit');
      return;
    case 'checkpoint_sprint':
      for (const checkpoint of goal.checkpoints) {
        validateCourseMarkerBelongsToCourse(checkpoint, roomRefs, 'Checkpoint');
      }
      validateCourseMarkerBelongsToCourse(goal.finish, roomRefs, 'Finish');
      return;
    default:
      return;
  }
}

function validatePublishableCourseDraft(
  draft: CourseSnapshot,
  roomRefs: CourseRoomRef[]
): void {
  if (!draft.title?.trim()) {
    throw new HttpError(400, 'Published courses need a title.');
  }

  if (!draft.goal) {
    throw new HttpError(400, 'Published courses need a goal.');
  }

  const firstRoomRef = roomRefs[0] ?? null;
  const lastRoomRef = roomRefs[roomRefs.length - 1] ?? null;
  if (!firstRoomRef || !lastRoomRef) {
    throw new HttpError(400, 'Published courses must span 2 to 4 rooms.');
  }

  if (!draft.startPoint) {
    throw new HttpError(400, 'Published courses need a start point.');
  }

  if (draft.startPoint.roomId !== firstRoomRef.roomId) {
    throw new HttpError(400, 'Start point must be placed in the first course room.');
  }

  switch (draft.goal.type) {
    case 'reach_exit':
      if (!draft.goal.exit) {
        throw new HttpError(400, 'Reach Exit courses need an exit.');
      }
      if (draft.goal.exit.roomId !== lastRoomRef.roomId) {
        throw new HttpError(400, 'Exit must be placed in the last course room.');
      }
      return;
    case 'checkpoint_sprint':
      if (draft.goal.checkpoints.length === 0) {
        throw new HttpError(400, 'Checkpoint Sprint courses need at least one checkpoint.');
      }
      if (!draft.goal.finish) {
        throw new HttpError(400, 'Checkpoint Sprint courses need a finish.');
      }
      if (draft.goal.finish.roomId !== lastRoomRef.roomId) {
        throw new HttpError(400, 'Finish must be placed in the last course room.');
      }
      let previousOrder = -1;
      for (const checkpoint of draft.goal.checkpoints) {
        const order = getCourseRoomOrder(roomRefs, checkpoint.roomId);
        if (order < 0) {
          throw new HttpError(400, 'Checkpoint must belong to a room in the course.');
        }
        if (order < previousOrder) {
          throw new HttpError(400, 'Checkpoints must follow the authored room order.');
        }
        previousOrder = order;
      }
      return;
    case 'collect_target':
    case 'defeat_all':
    case 'survival':
      return;
  }
}

async function ensureRoomsNotInOtherPublishedCourses(
  env: Env,
  courseId: string,
  roomIds: string[]
): Promise<void> {
  if (roomIds.length === 0) {
    return;
  }

  const placeholders = roomIds.map(() => '?').join(', ');
  const conflict = await env.DB.prepare(
    `
      SELECT refs.room_id, refs.course_id
      FROM course_room_refs refs
      INNER JOIN courses course
        ON course.id = refs.course_id
       AND course.published_version = refs.course_version
       AND course.published_json IS NOT NULL
      WHERE refs.room_id IN (${placeholders})
        AND refs.course_id != ?
      LIMIT 1
    `
  )
    .bind(...roomIds, courseId)
    .first<{ room_id: string; course_id: string }>();

  if (conflict) {
    throw new HttpError(409, 'A room can only belong to one active published course.');
  }
}

async function persistCourseRecord(env: Env, input: PersistCourseRecordInput): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO courses (
          id,
          owner_user_id,
          owner_display_name,
          draft_json,
          published_json,
          draft_title,
          published_title,
          draft_version,
          published_version,
          created_at,
          updated_at,
          published_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          owner_user_id = excluded.owner_user_id,
          owner_display_name = excluded.owner_display_name,
          draft_json = excluded.draft_json,
          published_json = excluded.published_json,
          draft_title = excluded.draft_title,
          published_title = excluded.published_title,
          draft_version = excluded.draft_version,
          published_version = excluded.published_version,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          published_at = excluded.published_at
      `
    ).bind(
      input.draft.id,
      input.ownerUserId,
      input.ownerDisplayName,
      JSON.stringify(input.draft),
      input.published ? JSON.stringify(input.published) : null,
      input.draft.title,
      input.published?.title ?? null,
      input.draft.version,
      input.published?.version ?? null,
      input.createdAt,
      input.updatedAt,
      input.publishedAt
    ),
  ]);
}

async function persistCourseVersion(env: Env, input: PersistCourseVersionInput): Promise<void> {
  const version = input.snapshot.version;
  const title = input.snapshot.title;

  const statements = [
    env.DB.prepare(
      `
        INSERT INTO course_versions (
          course_id,
          version,
          snapshot_json,
          title,
          created_at,
          published_by_user_id,
          published_by_display_name
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(course_id, version) DO UPDATE SET
          snapshot_json = excluded.snapshot_json,
          title = excluded.title,
          created_at = excluded.created_at,
          published_by_user_id = excluded.published_by_user_id,
          published_by_display_name = excluded.published_by_display_name
      `
    ).bind(
      input.snapshot.id,
      version,
      JSON.stringify(input.snapshot),
      title,
      input.createdAt,
      input.publishedByUserId,
      input.publishedByDisplayName
    ),
    env.DB.prepare(
      `
        DELETE FROM course_room_refs
        WHERE course_id = ?
          AND course_version = ?
      `
    ).bind(input.snapshot.id, version),
  ];

  for (let index = 0; index < input.snapshot.roomRefs.length; index += 1) {
    const roomRef = input.snapshot.roomRefs[index];
    statements.push(
      env.DB.prepare(
        `
          INSERT INTO course_room_refs (
            course_id,
            course_version,
            room_order,
            room_id,
            room_x,
            room_y,
            room_version,
            room_title
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).bind(
        input.snapshot.id,
        version,
        index,
        roomRef.roomId,
        roomRef.coordinates.x,
        roomRef.coordinates.y,
        roomRef.roomVersion,
        roomRef.roomTitle
      )
    );
  }

  await env.DB.batch(statements);
}

function parseStoredCourseSnapshot(raw: string, courseId: string): CourseSnapshot {
  try {
    return normalizeCourseSnapshot(JSON.parse(raw), courseId);
  } catch {
    throw new HttpError(500, 'Stored course data is invalid.');
  }
}
