import { requireAdminRequest } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { upsertUserStats } from '../runs/points';

export async function handleAdminRequest(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const clearMatch = /^\/api\/admin\/rooms\/([^/]+)\/clear$/.exec(url.pathname);
  if (clearMatch && request.method === 'POST') {
    return handleAdminRoomClear(request, env, decodeURIComponent(clearMatch[1]));
  }

  throw new HttpError(404, 'Admin route not found.');
}

async function handleAdminRoomClear(
  request: Request,
  env: Env,
  roomId: string
): Promise<Response> {
  requireAdminRequest(env, request, `clear room ${roomId}`);

  const roomRow = await env.DB.prepare(
    `
      SELECT
        id,
        claimer_user_id
      FROM rooms
      WHERE id = ?
      LIMIT 1
    `
  )
    .bind(roomId)
    .first<{ id: string; claimer_user_id: string | null }>();

  if (!roomRow) {
    throw new HttpError(404, 'Room not found.');
  }

  const runsResult = await env.DB.prepare(
    `
      SELECT DISTINCT attempt_id, user_id
      FROM room_runs
      WHERE room_id = ?
    `
  )
    .bind(roomId)
    .all<{ attempt_id: string; user_id: string }>();

  const versionsResult = await env.DB.prepare(
    `
      SELECT DISTINCT published_by_user_id
      FROM room_versions
      WHERE room_id = ?
        AND published_by_user_id IS NOT NULL
    `
  )
    .bind(roomId)
    .all<{ published_by_user_id: string | null }>();

  const courseMembershipsResult = await env.DB.prepare(
    `
      SELECT DISTINCT course_id
      FROM course_room_refs
      WHERE room_id = ?
    `
  )
    .bind(roomId)
    .all<{ course_id: string }>();

  const courseIds = courseMembershipsResult.results.map((row) => row.course_id);
  const courseRunsResult =
    courseIds.length > 0
      ? await env.DB.prepare(
          `
            SELECT DISTINCT attempt_id, user_id
            FROM course_runs
            WHERE course_id IN (${courseIds.map(() => '?').join(', ')})
          `
        )
          .bind(...courseIds)
          .all<{ attempt_id: string; user_id: string }>()
      : { results: [] as Array<{ attempt_id: string; user_id: string }> };

  const courseOwnersResult =
    courseIds.length > 0
      ? await env.DB.prepare(
          `
            SELECT DISTINCT owner_user_id
            FROM courses
            WHERE id IN (${courseIds.map(() => '?').join(', ')})
          `
        )
          .bind(...courseIds)
          .all<{ owner_user_id: string | null }>()
      : { results: [] as Array<{ owner_user_id: string | null }> };

  const affectedUserIds = new Set<string>();
  if (roomRow.claimer_user_id) {
    affectedUserIds.add(roomRow.claimer_user_id);
  }
  for (const row of runsResult.results) {
    if (row.user_id) {
      affectedUserIds.add(row.user_id);
    }
  }
  for (const row of versionsResult.results) {
    if (row.published_by_user_id) {
      affectedUserIds.add(row.published_by_user_id);
    }
  }
  for (const row of courseRunsResult.results) {
    if (row.user_id) {
      affectedUserIds.add(row.user_id);
    }
  }
  for (const row of courseOwnersResult.results) {
    if (row.owner_user_id) {
      affectedUserIds.add(row.owner_user_id);
    }
  }

  const attemptIds = runsResult.results.map((row) => row.attempt_id);
  const courseAttemptIds = courseRunsResult.results.map((row) => row.attempt_id);

  const statements = [
    ...(courseIds.length > 0
      ? [
          env.DB.prepare(
            `
              DELETE FROM point_events
              WHERE event_type IN (
                'course_first_publish',
                'course_publish_update',
                'course_creator_completion'
              )
                AND (${courseIds.map(() => 'source_key LIKE ?').join(' OR ')})
            `
          ).bind(...courseIds.map((courseId) => `${courseId}:%`)),
        ]
      : []),
    ...(courseAttemptIds.length > 0
      ? [
          env.DB.prepare(
            `
              DELETE FROM point_events
              WHERE event_type = 'run_finalized'
                AND source_key IN (${courseAttemptIds.map(() => '?').join(', ')})
            `
          ).bind(...courseAttemptIds),
        ]
      : []),
    ...(courseIds.length > 0
      ? [
          env.DB.prepare(
            `
              DELETE FROM courses
              WHERE id IN (${courseIds.map(() => '?').join(', ')})
            `
          ).bind(...courseIds),
        ]
      : []),
    env.DB.prepare('DELETE FROM room_runs WHERE room_id = ?').bind(roomId),
    env.DB.prepare('DELETE FROM room_difficulty_votes WHERE room_id = ?').bind(roomId),
    env.DB.prepare('DELETE FROM room_versions WHERE room_id = ?').bind(roomId),
    env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(roomId),
    env.DB.prepare(
      `
        DELETE FROM point_events
        WHERE event_type IN ('room_first_publish', 'room_publish_update')
          AND source_key LIKE ?
      `
    ).bind(`${roomId}:%`),
    env.DB.prepare(
      `
        DELETE FROM point_events
        WHERE event_type = 'room_creator_completion'
          AND source_key LIKE ?
      `
    ).bind(`${roomId}:%`),
  ];

  if (attemptIds.length > 0) {
    const placeholders = attemptIds.map(() => '?').join(', ');
    statements.push(
      env.DB.prepare(
        `
          DELETE FROM point_events
          WHERE event_type = 'run_finalized'
            AND source_key IN (${placeholders})
        `
      ).bind(...attemptIds)
    );
  }

  await env.DB.batch(statements);

  for (const userId of affectedUserIds) {
    await upsertUserStats(env, userId);
  }

  return jsonResponse(request, {
    ok: true,
    roomId,
    deleted: {
      room: 1,
      versions: versionsResult.results.length,
      runs: attemptIds.length,
      publishPointEvents: true,
      creatorCompletionPointEvents: true,
      runPointEvents: attemptIds.length,
      courses: courseIds.length,
      coursePublishPointEvents: courseIds.length > 0,
      courseRuns: courseAttemptIds.length,
    },
    affectedUsers: [...affectedUserIds],
  });
}
