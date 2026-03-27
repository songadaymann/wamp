import type {
  SuspiciousInvalidationAuditSummary,
  SuspiciousInvalidationPreviewRequest,
  SuspiciousInvalidationPreviewResponse,
  SuspiciousInvalidationRequest,
  SuspiciousInvalidationResult,
  SuspiciousPointEventRecord,
  SuspiciousRunCase,
  SuspiciousSeverity,
} from '../../../admin/model';
import { normalizeCourseGoal } from '../../../courses/model';
import { getCourseLeaderboardRankingMode } from '../../../courses/scoring';
import { normalizeRoomGoal } from '../../../goals/roomGoals';
import { getLeaderboardRankingMode } from '../../../runs/scoring';
import { requireAdminRequest } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type {
  CourseRunRow,
  Env,
  PlayfunPointSyncRow,
  PointEventRow,
  RoomRunRow,
  SuspiciousInvalidationAuditRow,
} from '../core/types';
import { upsertUserStats } from '../runs/points';

const RECENT_INVALIDATION_LIMIT = 10;

interface InvalidationSelection {
  roomRuns: SuspiciousRunCase[];
  courseRuns: SuspiciousRunCase[];
  selectedPointEvents: PointEventRow[];
  runPointEvents: PointEventRow[];
  creatorPointEvents: PointEventRow[];
  playfunSync: PlayfunPointSyncRow[];
  affectedUsers: Array<{ userId: string; userDisplayName: string }>;
}

type SelectedRoomRunRow = Pick<
  RoomRunRow,
  | 'attempt_id'
  | 'room_id'
  | 'room_x'
  | 'room_y'
  | 'room_version'
  | 'goal_type'
  | 'goal_json'
  | 'user_id'
  | 'user_display_name'
  | 'started_at'
  | 'finished_at'
  | 'result'
  | 'elapsed_ms'
  | 'deaths'
  | 'score'
> & { title: string | null };

type SelectedCourseRunRow = Pick<
  CourseRunRow,
  | 'attempt_id'
  | 'course_id'
  | 'course_version'
  | 'goal_type'
  | 'goal_json'
  | 'user_id'
  | 'user_display_name'
  | 'started_at'
  | 'finished_at'
  | 'result'
  | 'elapsed_ms'
  | 'deaths'
  | 'score'
> & { title: string | null };

export async function handleAdminSuspiciousInvalidatePreview(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  requireAdminRequest(env, request, `preview suspicious invalidation for ${userId}`);
  const body = await parseSuspiciousInvalidationPreviewBody(request);
  const preview = await buildInvalidationPreview(env, userId, body);
  return jsonResponse(request, preview);
}

export async function handleAdminSuspiciousInvalidate(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  requireAdminRequest(env, request, `invalidate suspicious activity for ${userId}`);
  const body = await parseSuspiciousInvalidationBody(request);
  const preview = await buildInvalidationPreview(env, userId, body);
  const auditId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const snapshot = {
    roomRuns: preview.roomRuns,
    courseRuns: preview.courseRuns,
    selectedPointEvents: preview.selectedPointEvents,
    runPointEvents: preview.runPointEvents,
    creatorPointEvents: preview.creatorPointEvents,
    playfunSync: preview.playfunSync,
    affectedUsers: preview.affectedUsers,
  };

  const statements = [
    env.DB.prepare(
      `
        INSERT INTO admin_suspicious_invalidation_audit (
          id,
          target_user_id,
          target_user_display_name,
          operator_label,
          reason,
          room_run_attempt_ids_json,
          course_run_attempt_ids_json,
          affected_point_event_ids_json,
          affected_playfun_sync_json,
          affected_creator_user_ids_json,
          remote_follow_up_required,
          snapshot_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      auditId,
      preview.targetUserId,
      preview.targetUserDisplayName,
      body.operatorLabel,
      preview.reason,
      JSON.stringify(preview.roomRuns.map((run) => run.attemptId)),
      JSON.stringify(preview.courseRuns.map((run) => run.attemptId)),
      JSON.stringify([
        ...preview.selectedPointEvents.map((event) => event.id),
        ...preview.runPointEvents.map((event) => event.id),
        ...preview.creatorPointEvents.map((event) => event.id),
      ]),
      JSON.stringify(preview.playfunSync),
      JSON.stringify(preview.affectedUsers.map((user) => user.userId)),
      preview.remoteFollowUpRequired ? 1 : 0,
      JSON.stringify(snapshot),
      createdAt
    ),
  ];

  for (const run of preview.roomRuns) {
    statements.push(env.DB.prepare('DELETE FROM room_runs WHERE attempt_id = ?').bind(run.attemptId));
  }
  for (const run of preview.courseRuns) {
    statements.push(env.DB.prepare('DELETE FROM course_runs WHERE attempt_id = ?').bind(run.attemptId));
  }
  for (const event of [
    ...preview.selectedPointEvents,
    ...preview.runPointEvents,
    ...preview.creatorPointEvents,
  ]) {
    statements.push(env.DB.prepare('DELETE FROM point_events WHERE id = ?').bind(event.id));
  }

  await env.DB.batch(statements);

  for (const affectedUser of preview.affectedUsers) {
    await upsertUserStats(env, affectedUser.userId);
  }

  const response: SuspiciousInvalidationResult = {
    ok: true,
    auditId,
    operatorLabel: body.operatorLabel,
    ...preview,
  };
  return jsonResponse(request, response);
}

export async function loadRecentInvalidations(
  env: Env,
  targetUserId: string | null = null
): Promise<SuspiciousInvalidationAuditSummary[]> {
  const rows = targetUserId
    ? await env.DB.prepare(
        `
          SELECT
            id,
            target_user_id,
            target_user_display_name,
            operator_label,
            reason,
            room_run_attempt_ids_json,
            course_run_attempt_ids_json,
            affected_point_event_ids_json,
            affected_playfun_sync_json,
            affected_creator_user_ids_json,
            remote_follow_up_required,
            snapshot_json,
            created_at
          FROM admin_suspicious_invalidation_audit
          WHERE target_user_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
        .bind(targetUserId, RECENT_INVALIDATION_LIMIT)
        .all<SuspiciousInvalidationAuditRow>()
    : await env.DB.prepare(
        `
          SELECT
            id,
            target_user_id,
            target_user_display_name,
            operator_label,
            reason,
            room_run_attempt_ids_json,
            course_run_attempt_ids_json,
            affected_point_event_ids_json,
            affected_playfun_sync_json,
            affected_creator_user_ids_json,
            remote_follow_up_required,
            snapshot_json,
            created_at
          FROM admin_suspicious_invalidation_audit
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
        .bind(RECENT_INVALIDATION_LIMIT)
        .all<SuspiciousInvalidationAuditRow>();

  return rows.results.map(mapAuditSummary);
}

async function buildInvalidationPreview(
  env: Env,
  userId: string,
  input: SuspiciousInvalidationPreviewRequest
): Promise<SuspiciousInvalidationPreviewResponse> {
  const selection = await loadInvalidationSelection(
    env,
    userId,
    input.roomRunAttemptIds,
    input.courseRunAttemptIds,
    input.pointEventIds
  );
  const selectedPointEvents = selection.selectedPointEvents.map(mapPointEventRecord);
  const targetUser = selection.affectedUsers.find((entry) => entry.userId === userId);
  if (!targetUser) {
    throw new HttpError(404, 'Target user could not be resolved for invalidation.');
  }

  return {
    targetUserId: userId,
    targetUserDisplayName: targetUser.userDisplayName,
    reason: input.reason,
    roomRuns: selection.roomRuns,
    courseRuns: selection.courseRuns,
    selectedPointEvents,
    runPointEvents: selection.runPointEvents.map(mapPointEventRecord),
    creatorPointEvents: selection.creatorPointEvents.map(mapPointEventRecord),
    affectedUsers: selection.affectedUsers,
    playfunSync: selection.playfunSync.map((row) => ({
      pointEventId: row.point_event_id,
      ogpId: row.ogp_id,
      points: Math.max(0, Number(row.points ?? 0)),
      status: row.status,
      syncedAt: row.synced_at,
    })),
    remoteFollowUpRequired: selection.playfunSync.some((row) => row.status === 'sent'),
    summary: {
      roomRunsDeleted: selection.roomRuns.length,
      courseRunsDeleted: selection.courseRuns.length,
      selectedPointEventsDeleted: selectedPointEvents.length,
      runPointEventsDeleted: selection.runPointEvents.length,
      creatorPointEventsDeleted: selection.creatorPointEvents.length,
    },
  };
}

async function loadInvalidationSelection(
  env: Env,
  userId: string,
  roomRunAttemptIds: string[],
  courseRunAttemptIds: string[],
  pointEventIds: string[]
): Promise<InvalidationSelection> {
  if (roomRunAttemptIds.length === 0 && courseRunAttemptIds.length === 0 && pointEventIds.length === 0) {
    throw new HttpError(400, 'Select at least one suspicious run or point event.');
  }

  const roomRuns = await loadSelectedRoomRuns(env, userId, roomRunAttemptIds);
  const courseRuns = await loadSelectedCourseRuns(env, userId, courseRunAttemptIds);
  const allAttemptIds = [
    ...roomRuns.map((run) => run.attemptId),
    ...courseRuns.map((run) => run.attemptId),
  ];
  const [selectedPointEventsRaw, runPointEventsRaw, creatorPointEventsRaw] = await Promise.all([
    loadSelectedPointEvents(env, userId, pointEventIds),
    loadRunPointEventsByAttemptIds(env, allAttemptIds),
    loadCreatorPointEventsByAttemptIds(env, allAttemptIds),
  ]);
  const runPointEventIds = new Set(runPointEventsRaw.map((event) => event.id));
  const creatorPointEventIds = new Set(creatorPointEventsRaw.map((event) => event.id));
  const selectedPointEvents = selectedPointEventsRaw.filter(
    (event) => !runPointEventIds.has(event.id) && !creatorPointEventIds.has(event.id)
  );
  const runPointEvents = dedupePointEventsById(runPointEventsRaw);
  const creatorPointEvents = dedupePointEventsById(creatorPointEventsRaw);
  const allPointEventIds = [
    ...selectedPointEvents.map((event) => event.id),
    ...runPointEvents.map((event) => event.id),
    ...creatorPointEvents.map((event) => event.id),
  ];
  const playfunSync = await loadPlayfunSyncRowsByPointEventIds(env, allPointEventIds);

  const affectedUsers = new Map<string, { userId: string; userDisplayName: string }>();
  const targetUserRow = await env.DB.prepare(
    `
      SELECT id, display_name
      FROM users
      WHERE id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<{ id: string; display_name: string }>();
  if (targetUserRow) {
    affectedUsers.set(userId, {
      userId: targetUserRow.id,
      userDisplayName: targetUserRow.display_name,
    });
  }

  const creatorUserIds = [...new Set(creatorPointEvents.map((event) => event.user_id))];
  if (creatorUserIds.length > 0) {
    const creatorRows = await env.DB.prepare(
      `
        SELECT id, display_name
        FROM users
        WHERE id IN (${creatorUserIds.map(() => '?').join(', ')})
      `
    )
      .bind(...creatorUserIds)
      .all<{ id: string; display_name: string }>();
    for (const row of creatorRows.results) {
      affectedUsers.set(row.id, { userId: row.id, userDisplayName: row.display_name });
    }
  }

  return {
    roomRuns,
    courseRuns,
    selectedPointEvents,
    runPointEvents,
    creatorPointEvents,
    playfunSync,
    affectedUsers: [...affectedUsers.values()],
  };
}

async function loadSelectedRoomRuns(
  env: Env,
  userId: string,
  attemptIds: string[]
): Promise<SuspiciousRunCase[]> {
  if (attemptIds.length === 0) {
    return [];
  }

  const rows: SuspiciousRunCase[] = [];
  for (const chunk of chunkArray([...new Set(attemptIds)], 50)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await env.DB.prepare(
      `
        SELECT
          r.attempt_id,
          r.room_id,
          r.room_x,
          r.room_y,
          r.room_version,
          r.goal_type,
          r.goal_json,
          r.user_id,
          r.user_display_name,
          r.started_at,
          r.finished_at,
          r.result,
          r.elapsed_ms,
          r.deaths,
          r.score,
          v.title AS title
        FROM room_runs r
        LEFT JOIN room_versions v
          ON v.room_id = r.room_id
         AND v.version = r.room_version
        WHERE r.user_id = ?
          AND r.attempt_id IN (${placeholders})
      `
    )
      .bind(userId, ...chunk)
      .all<SelectedRoomRunRow>();

    for (const row of result.results) {
      const goal = normalizeRoomGoal(parseJsonSafely(row.goal_json));
      if (!goal) {
        continue;
      }
      rows.push({
        kind: 'room',
        attemptId: row.attempt_id,
        sourceId: row.room_id,
        title: row.title,
        version: row.room_version,
        roomX: row.room_x,
        roomY: row.room_y,
        goalType: row.goal_type,
        rankingMode: getLeaderboardRankingMode(goal),
        userId: row.user_id,
        userDisplayName: row.user_display_name,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        result: row.result,
        elapsedMs: row.elapsed_ms,
        deaths: row.deaths,
        score: row.score,
        severity: 'medium',
        ruleCodes: [],
        previousBestElapsedMs: null,
        improvementMs: null,
        improvementRatio: null,
        repeatGroupCount: null,
      });
    }
  }

  if (rows.length !== new Set(attemptIds).size) {
    throw new HttpError(404, 'One or more selected room runs were not found for that user.');
  }

  return rows.sort(compareRunCases);
}

async function loadSelectedPointEvents(
  env: Env,
  userId: string,
  pointEventIds: string[]
): Promise<PointEventRow[]> {
  if (pointEventIds.length === 0) {
    return [];
  }

  const rows: PointEventRow[] = [];
  for (const chunk of chunkArray([...new Set(pointEventIds)], 50)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await env.DB.prepare(
      `
        SELECT id, user_id, event_type, source_key, points, breakdown_json, created_at
        FROM point_events
        WHERE user_id = ?
          AND id IN (${placeholders})
      `
    )
      .bind(userId, ...chunk)
      .all<PointEventRow>();
    rows.push(...result.results);
  }

  if (rows.length !== [...new Set(pointEventIds)].length) {
    throw new HttpError(404, 'One or more selected point events could not be found for this user.');
  }

  return dedupePointEventsById(rows);
}

async function loadSelectedCourseRuns(
  env: Env,
  userId: string,
  attemptIds: string[]
): Promise<SuspiciousRunCase[]> {
  if (attemptIds.length === 0) {
    return [];
  }

  const rows: SuspiciousRunCase[] = [];
  for (const chunk of chunkArray([...new Set(attemptIds)], 50)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await env.DB.prepare(
      `
        SELECT
          r.attempt_id,
          r.course_id,
          r.course_version,
          r.goal_type,
          r.goal_json,
          r.user_id,
          r.user_display_name,
          r.started_at,
          r.finished_at,
          r.result,
          r.elapsed_ms,
          r.deaths,
          r.score,
          v.title AS title
        FROM course_runs r
        LEFT JOIN course_versions v
          ON v.course_id = r.course_id
         AND v.version = r.course_version
        WHERE r.user_id = ?
          AND r.attempt_id IN (${placeholders})
      `
    )
      .bind(userId, ...chunk)
      .all<SelectedCourseRunRow>();

    for (const row of result.results) {
      const goal = normalizeCourseGoal(parseJsonSafely(row.goal_json));
      if (!goal) {
        continue;
      }
      rows.push({
        kind: 'course',
        attemptId: row.attempt_id,
        sourceId: row.course_id,
        title: row.title,
        version: row.course_version,
        roomX: null,
        roomY: null,
        goalType: row.goal_type,
        rankingMode: getCourseLeaderboardRankingMode(goal),
        userId: row.user_id,
        userDisplayName: row.user_display_name,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        result: row.result,
        elapsedMs: row.elapsed_ms,
        deaths: row.deaths,
        score: row.score,
        severity: 'medium',
        ruleCodes: [],
        previousBestElapsedMs: null,
        improvementMs: null,
        improvementRatio: null,
        repeatGroupCount: null,
      });
    }
  }

  if (rows.length !== new Set(attemptIds).size) {
    throw new HttpError(404, 'One or more selected course runs were not found for that user.');
  }

  return rows.sort(compareRunCases);
}

async function loadRunPointEventsByAttemptIds(
  env: Env,
  attemptIds: string[]
): Promise<PointEventRow[]> {
  if (attemptIds.length === 0) {
    return [];
  }

  const rows: PointEventRow[] = [];
  for (const chunk of chunkArray([...new Set(attemptIds)], 50)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await env.DB.prepare(
      `
        SELECT
          id,
          user_id,
          event_type,
          source_key,
          points,
          breakdown_json,
          created_at
        FROM point_events
        WHERE event_type = 'run_finalized'
          AND source_key IN (${placeholders})
      `
    )
      .bind(...chunk)
      .all<PointEventRow>();
    rows.push(...result.results);
  }
  return rows;
}

async function loadCreatorPointEventsByAttemptIds(
  env: Env,
  attemptIds: string[]
): Promise<PointEventRow[]> {
  const uniqueAttemptIds = [...new Set(attemptIds)];
  if (uniqueAttemptIds.length === 0) {
    return [];
  }

  const rows = new Map<string, PointEventRow>();
  for (const attemptId of uniqueAttemptIds) {
    const candidates = await env.DB.prepare(
      `
        SELECT
          id,
          user_id,
          event_type,
          source_key,
          points,
          breakdown_json,
          created_at
        FROM point_events
        WHERE event_type IN ('room_creator_completion', 'course_creator_completion')
          AND breakdown_json LIKE ?
      `
    )
      .bind(`%${attemptId}%`)
      .all<PointEventRow>();

    for (const row of candidates.results) {
      const breakdown = parseJsonSafely(row.breakdown_json);
      if (breakdown && typeof breakdown === 'object' && (breakdown as { attemptId?: unknown }).attemptId === attemptId) {
        rows.set(row.id, row);
      }
    }
  }

  return [...rows.values()];
}

async function loadPlayfunSyncRowsByPointEventIds(
  env: Env,
  pointEventIds: string[]
): Promise<PlayfunPointSyncRow[]> {
  if (pointEventIds.length === 0) {
    return [];
  }

  const rows: PlayfunPointSyncRow[] = [];
  for (const chunk of chunkArray([...new Set(pointEventIds)], 50)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await env.DB.prepare(
      `
        SELECT
          point_event_id,
          user_id,
          ogp_id,
          points,
          status,
          attempt_count,
          created_at,
          last_attempted_at,
          synced_at,
          last_error
        FROM playfun_point_sync
        WHERE point_event_id IN (${placeholders})
      `
    )
      .bind(...chunk)
      .all<PlayfunPointSyncRow>();
    rows.push(...result.results);
  }
  return rows;
}

function mapAuditSummary(row: SuspiciousInvalidationAuditRow): SuspiciousInvalidationAuditSummary {
  return {
    id: row.id,
    targetUserId: row.target_user_id,
    targetUserDisplayName: row.target_user_display_name,
    operatorLabel: row.operator_label,
    reason: row.reason,
    roomRunCount: decodeJsonArray(row.room_run_attempt_ids_json).length,
    courseRunCount: decodeJsonArray(row.course_run_attempt_ids_json).length,
    pointEventCount: decodeJsonArray(row.affected_point_event_ids_json).length,
    remoteFollowUpRequired: row.remote_follow_up_required === 1,
    createdAt: row.created_at,
  };
}

function mapPointEventRecord(row: PointEventRow): SuspiciousPointEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    sourceKey: row.source_key,
    points: Math.max(0, Number(row.points ?? 0)),
    createdAt: row.created_at,
  };
}

function dedupePointEventsById(rows: PointEventRow[]): PointEventRow[] {
  const unique = new Map<string, PointEventRow>();
  for (const row of rows) {
    unique.set(row.id, row);
  }
  return [...unique.values()];
}

async function parseSuspiciousInvalidationPreviewBody(
  request: Request
): Promise<SuspiciousInvalidationPreviewRequest> {
  const body = await parseJsonBody<SuspiciousInvalidationPreviewRequest>(request);
  const reason = normalizeRequiredText(body.reason, 'reason');
  return {
    roomRunAttemptIds: normalizeStringArray(body.roomRunAttemptIds, 'roomRunAttemptIds'),
    courseRunAttemptIds: normalizeStringArray(body.courseRunAttemptIds, 'courseRunAttemptIds'),
    pointEventIds: normalizeStringArray(body.pointEventIds, 'pointEventIds'),
    reason,
  };
}

async function parseSuspiciousInvalidationBody(
  request: Request
): Promise<SuspiciousInvalidationRequest> {
  const body = await parseJsonBody<SuspiciousInvalidationRequest>(request);
  return {
    roomRunAttemptIds: normalizeStringArray(body.roomRunAttemptIds, 'roomRunAttemptIds'),
    courseRunAttemptIds: normalizeStringArray(body.courseRunAttemptIds, 'courseRunAttemptIds'),
    pointEventIds: normalizeStringArray(body.pointEventIds, 'pointEventIds'),
    reason: normalizeRequiredText(body.reason, 'reason'),
    operatorLabel: normalizeRequiredText(body.operatorLabel, 'operatorLabel'),
  };
}

function normalizeRequiredText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} is required.`);
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    throw new HttpError(400, `${label} is required.`);
  }
  if (normalized.length > 280) {
    throw new HttpError(400, `${label} must be 280 characters or fewer.`);
  }
  return normalized;
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${label} must be an array.`);
  }
  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  return [...new Set(normalized)];
}

function decodeJsonArray(raw: string | null): unknown[] {
  const parsed = parseJsonSafely(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonSafely(raw: string | null): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function severityRank(value: SuspiciousSeverity): number {
  switch (value) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
    default:
      return 1;
  }
}

function compareRunCases(left: SuspiciousRunCase, right: SuspiciousRunCase): number {
  return (
    severityRank(right.severity) - severityRank(left.severity) ||
    (right.finishedAt ?? '').localeCompare(left.finishedAt ?? '') ||
    left.attemptId.localeCompare(right.attemptId)
  );
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
