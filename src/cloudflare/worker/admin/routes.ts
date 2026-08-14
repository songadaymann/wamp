import type {
  AdminProgressionCapsUpdateRequest,
  AdminProgressionCapsUpdateResponse,
  AdminProgressionUserCapsResponse,
  AdminProgressionUserLookupResponse,
} from '../../../admin/model';
import { createRoomSummaryFromRecord, type RoomRevertRequestBody } from '../../../persistence/roomModel';
import { requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { requireChatModeratorSession } from '../chat/moderation';
import {
  getCoordinatesFromRequest,
  HttpError,
  jsonResponse,
  normalizePositiveInteger,
  parseJsonBody,
} from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import {
  refreshPlayableContentIndexForRoom,
  schedulePlayableContentIndexRefresh,
} from '../playableContentIndex/store';
import { loadAdminProgressionUser, searchAdminProgressionUsers, updateAdminBuilderCapOverride } from '../progression/store';
import { syncUserBadges } from '../progression/badgesTrophies';
import { revertRoom } from '../rooms/store';
import { upsertUserStats } from '../runs/points';
import { loadLaunchStats } from './launchStats';
import { loadAdminGameJams } from './gameJams';
import { handleAdminExpandedRoomsMigrationReport } from '../expandedRooms/migrationReport';
import {
  handleAdminSuspiciousInvalidate,
  handleAdminSuspiciousInvalidatePreview,
  handleAdminSuspiciousSummary,
  handleAdminSuspiciousUserDetail,
  handleAdminSuspiciousUsers,
} from './suspicious';
import { handleAdminSnapshotImport, handleAdminSnapshotReset } from './snapshot';
import { handleAdminBackgroundImageRequest } from '../backgroundImages/routes';
import { handleAdminRoomCommentRequest } from '../roomComments/routes';
import { handleAdminSchoolRequest } from '../school/routes';
import { handleAdminWorldTileRequest } from '../worldTiles/routes';
import { handleAdminCustomSpriteRequest } from '../customSprites/adminRoutes';

export async function handleAdminRequest(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  if (url.pathname.startsWith('/api/admin/world-tiles')) {
    return handleAdminWorldTileRequest(request, url, env, context);
  }

  if (url.pathname.startsWith('/api/admin/custom-sprites')) {
    return handleAdminCustomSpriteRequest(request, url, env);
  }

  if (url.pathname.startsWith('/api/admin/background-images')) {
    return handleAdminBackgroundImageRequest(request, url, env);
  }

  if (url.pathname.startsWith('/api/admin/room-comments')) {
    return handleAdminRoomCommentRequest(request, url, env);
  }

  if (url.pathname.startsWith('/api/admin/school')) {
    return handleAdminSchoolRequest(request, url, env);
  }

  if (url.pathname === '/api/admin/launch-stats' && request.method === 'GET') {
    return handleAdminLaunchStats(request, env);
  }

  if (url.pathname === '/api/admin/game-jams' && request.method === 'GET') {
    return handleAdminGameJams(request, env);
  }

  if (url.pathname === '/api/admin/expanded-rooms/migration-report' && request.method === 'GET') {
    return handleAdminExpandedRoomsMigrationReport(request, env);
  }

  if (url.pathname === '/api/admin/suspicious/summary' && request.method === 'GET') {
    return handleAdminSuspiciousSummary(request, url, env);
  }

  if (url.pathname === '/api/admin/suspicious/users' && request.method === 'GET') {
    return handleAdminSuspiciousUsers(request, url, env);
  }

  if (url.pathname === '/api/admin/run-verification/audit' && request.method === 'GET') {
    return handleAdminRunVerificationAudit(request, url, env);
  }

  if (url.pathname === '/api/admin/progression/users' && request.method === 'GET') {
    return handleAdminProgressionUserSearch(request, url, env);
  }
  if (url.pathname === '/api/admin/progression/badges/backfill' && request.method === 'POST') {
    return handleAdminBadgeBackfill(request, env);
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

  const adminProgressionUserMatch = /^\/api\/admin\/progression\/users\/([^/]+)\/caps$/.exec(url.pathname);
  if (adminProgressionUserMatch && request.method === 'GET') {
    return handleAdminProgressionUserCaps(request, env, decodeURIComponent(adminProgressionUserMatch[1]));
  }
  if (adminProgressionUserMatch && request.method === 'POST') {
    return handleAdminProgressionUserCapsUpdate(request, env, decodeURIComponent(adminProgressionUserMatch[1]));
  }

  const clearMatch = /^\/api\/admin\/rooms\/([^/]+)\/clear$/.exec(url.pathname);
  if (clearMatch && request.method === 'POST') {
    return handleAdminRoomClear(request, env, decodeURIComponent(clearMatch[1]), context);
  }

  const restoreMatch = /^\/api\/admin\/rooms\/([^/]+)\/restore$/.exec(url.pathname);
  if (restoreMatch && request.method === 'POST') {
    return handleAdminRoomRestore(request, url, env, decodeURIComponent(restoreMatch[1]), context);
  }

  const featureMatch = /^\/api\/admin\/rooms\/([^/]+)\/feature$/.exec(url.pathname);
  if (featureMatch && request.method === 'POST') {
    return handleAdminRoomFeature(request, env, decodeURIComponent(featureMatch[1]), context);
  }

  throw new HttpError(404, 'Admin route not found.');
}

interface AdminBadgeBackfillRequestBody {
  cursor?: string | null;
  limit?: number;
}

async function handleAdminBadgeBackfill(request: Request, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'backfill progression badges');
  const body = await parseJsonBody<AdminBadgeBackfillRequestBody>(request);
  const cursor = typeof body.cursor === 'string' ? body.cursor.trim() : '';
  const limit = Math.max(
    1,
    Math.min(50, body.limit === undefined ? 20 : normalizePositiveInteger(body.limit, 'limit')),
  );
  const users = await env.DB.prepare(
    `
      SELECT id
      FROM users
      WHERE id > ?
      ORDER BY id ASC
      LIMIT ?
    `,
  ).bind(cursor, limit + 1).all<{ id: string }>();
  const batch = users.results.slice(0, limit);
  for (const user of batch) {
    await syncUserBadges(env, user.id);
  }
  const hasMore = users.results.length > limit;
  return jsonResponse(request, {
    processed: batch.length,
    done: !hasMore,
    ...(hasMore && batch.length > 0 ? { nextCursor: batch[batch.length - 1]?.id } : {}),
  });
}

interface AdminRoomFeatureRequestBody {
  roomVersion: number;
  featured: boolean;
}

async function handleAdminRoomRestore(
  request: Request,
  url: URL,
  env: Env,
  roomId: string,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  requireTrustedOriginForMutation(request);
  const { session } = await requireChatModeratorSession(env, request, `restore room ${roomId}`);
  const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
  const body = await parseJsonBody<RoomRevertRequestBody>(request);
  const record = await revertRoom(
    env,
    roomId,
    coordinates,
    body.targetVersion,
    {
      ownerUser: session.user,
      principalKind: 'user',
      principalAgentId: null,
      principalDisplayName: session.user.displayName ?? session.user.email ?? 'Moderator',
      requestAuthSource: 'session',
    },
    true
  );
  schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, roomId));

  return jsonResponse(request, url.searchParams.get('response') === 'compact'
    ? { summary: createRoomSummaryFromRecord(record), draft: record.draft, published: record.published }
    : record);
}

async function handleAdminRoomClear(
  request: Request,
  env: Env,
  roomId: string,
  context?: WorkerExecutionContextLike,
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
  schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, roomId));

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

async function handleAdminRoomFeature(
  request: Request,
  env: Env,
  roomId: string,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  requireAdminRequest(env, request, `feature room ${roomId}`);
  const body = await parseJsonBody<AdminRoomFeatureRequestBody>(request);
  const roomVersion = normalizePositiveInteger(body.roomVersion, 'roomVersion');
  if (typeof body.featured !== 'boolean') {
    throw new HttpError(400, 'featured must be true or false.');
  }

  const roomRow = await env.DB.prepare(
    `
      SELECT
        rooms.id,
        rooms.published_json,
        latest.version AS current_published_version
      FROM rooms
      INNER JOIN (
        SELECT room_id, MAX(version) AS version
        FROM room_versions
        GROUP BY room_id
      ) AS latest_index
        ON latest_index.room_id = rooms.id
      INNER JOIN room_versions AS latest
        ON latest.room_id = latest_index.room_id
       AND latest.version = latest_index.version
      WHERE rooms.id = ?
      LIMIT 1
    `
  )
    .bind(roomId)
    .first<{
      id: string;
      published_json: string | null;
      current_published_version: number;
    }>();

  if (!roomRow || !roomRow.published_json) {
    throw new HttpError(404, 'Published room not found.');
  }

  if (roomVersion !== roomRow.current_published_version) {
    throw new HttpError(409, 'Only the current published room version can be featured.');
  }

  const now = new Date().toISOString();
  if (body.featured) {
    await env.DB.prepare(
      `
        INSERT INTO featured_rooms (
          room_id,
          room_version,
          featured_at
        )
        VALUES (?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          room_version = excluded.room_version,
          featured_at = excluded.featured_at
      `
    )
      .bind(roomId, roomVersion, now)
      .all();
  } else {
    await env.DB.prepare(
      `
        DELETE FROM featured_rooms
        WHERE room_id = ?
      `
    )
      .bind(roomId)
      .all();
  }

  schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, roomId));

  return jsonResponse(request, {
    ok: true,
    roomId,
    roomVersion,
    featured: body.featured,
    featuredAt: body.featured ? now : null,
  });
}

async function handleAdminRunVerificationAudit(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  requireAdminRequest(env, request, 'read run verification audit');
  const limitParam = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(200, Math.trunc(limitParam)))
    : 50;

  const result = await env.DB.prepare(
    `
      SELECT
        id,
        attempt_id,
        run_kind,
        status,
        trigger_reason,
        verification_reason,
        summary_json,
        trace_json,
        created_at
      FROM run_verification_audit
      ORDER BY created_at DESC
      LIMIT ?
    `
  )
    .bind(limit)
    .all<{
      id: number;
      attempt_id: string;
      run_kind: 'room' | 'course';
      status: 'passed' | 'failed' | 'timeout' | 'skipped';
      trigger_reason: string;
      verification_reason: string | null;
      summary_json: string | null;
      trace_json: string | null;
      created_at: string;
    }>();

  return jsonResponse(request, {
    entries: result.results.map((row) => ({
      id: row.id,
      attemptId: row.attempt_id,
      runKind: row.run_kind,
      status: row.status,
      triggerReason: row.trigger_reason,
      verificationReason: row.verification_reason,
      summary: row.summary_json ? safeJsonParse(row.summary_json) : null,
      trace: row.trace_json ? safeJsonParse(row.trace_json) : null,
      createdAt: row.created_at,
    })),
  });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function handleAdminLaunchStats(request: Request, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'read launch stats');
  return jsonResponse(request, await loadLaunchStats(env));
}

async function handleAdminGameJams(request: Request, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'read game jam entrants');
  return jsonResponse(request, await loadAdminGameJams(env));
}

async function handleAdminProgressionUserSearch(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  requireAdminRequest(env, request, 'search progression users');
  const query = url.searchParams.get('query')?.trim() ?? '';
  const response: AdminProgressionUserLookupResponse = {
    query,
    items: await searchAdminProgressionUsers(env, query),
  };
  return jsonResponse(request, response);
}

async function handleAdminProgressionUserCaps(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  requireAdminRequest(env, request, `read progression caps for ${userId}`);
  const response: AdminProgressionUserCapsResponse = await loadAdminProgressionUser(env, userId);
  return jsonResponse(request, response);
}

async function handleAdminProgressionUserCapsUpdate(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  requireAdminRequest(env, request, `update progression caps for ${userId}`);
  const body = await parseJsonBody<AdminProgressionCapsUpdateRequest>(request);
  const response: AdminProgressionCapsUpdateResponse = {
    ok: true,
    ...(await updateAdminBuilderCapOverride(env, {
      userId,
      claimLimitPerDay: body.claimLimitPerDay,
      publishLimitPerDay: body.publishLimitPerDay,
      objectLimit: body.objectLimit,
      collectibleLimit: body.collectibleLimit,
      expandedRoomCellLimit: body.expandedRoomCellLimit,
      reason: body.reason,
      operatorLabel: body.operatorLabel,
    })),
  };
  return jsonResponse(request, response);
}
