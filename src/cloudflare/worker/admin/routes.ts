import { requireAdminRequest } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { upsertUserStats } from '../runs/points';
import { loadLaunchStats } from './launchStats';
import {
  handleAdminSuspiciousInvalidate,
  handleAdminSuspiciousInvalidatePreview,
  handleAdminSuspiciousSummary,
  handleAdminSuspiciousUserDetail,
  handleAdminSuspiciousUsers,
} from './suspicious';
import { handleAdminSnapshotImport, handleAdminSnapshotReset } from './snapshot';

export async function handleAdminRequest(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  if (url.pathname === '/api/admin/launch-stats' && request.method === 'GET') {
    return handleAdminLaunchStats(request, env);
  }

  if (url.pathname === '/api/admin/suspicious/summary' && request.method === 'GET') {
    return handleAdminSuspiciousSummary(request, url, env);
  }

  if (url.pathname === '/api/admin/suspicious/users' && request.method === 'GET') {
    return handleAdminSuspiciousUsers(request, url, env);
  }

  if (url.pathname === '/api/admin/snapshot/reset' && request.method === 'POST') {
    return handleAdminSnapshotReset(request, env);
  }

  const snapshotImportMatch = /^\/api\/admin\/snapshot\/import\/([^/]+)$/.exec(url.pathname);
  if (snapshotImportMatch && request.method === 'POST') {
    return handleAdminSnapshotImport(request, env, decodeURIComponent(snapshotImportMatch[1]));
  }

  const suspiciousUserDetailMatch = /^\/api\/admin\/suspicious\/users\/([^/]+)$/.exec(url.pathname);
  if (suspiciousUserDetailMatch && request.method === 'GET') {
    return handleAdminSuspiciousUserDetail(
      request,
      url,
      env,
      decodeURIComponent(suspiciousUserDetailMatch[1])
    );
  }

  const suspiciousPreviewMatch = /^\/api\/admin\/suspicious\/users\/([^/]+)\/invalidate-preview$/.exec(
    url.pathname
  );
  if (suspiciousPreviewMatch && request.method === 'POST') {
    return handleAdminSuspiciousInvalidatePreview(
      request,
      env,
      decodeURIComponent(suspiciousPreviewMatch[1])
    );
  }

  const suspiciousInvalidateMatch = /^\/api\/admin\/suspicious\/users\/([^/]+)\/invalidate$/.exec(
    url.pathname
  );
  if (suspiciousInvalidateMatch && request.method === 'POST') {
    return handleAdminSuspiciousInvalidate(
      request,
      env,
      decodeURIComponent(suspiciousInvalidateMatch[1])
    );
  }

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

  const attemptIds = runsResult.results.map((row) => row.attempt_id);

  const statements = [
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
      difficultyVotes: true,
      publishPointEvents: true,
      creatorCompletionPointEvents: true,
      runPointEvents: attemptIds.length,
    },
    affectedUsers: [...affectedUserIds],
  });
}

async function handleAdminLaunchStats(request: Request, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'read launch stats');
  return jsonResponse(request, await loadLaunchStats(env));
}
