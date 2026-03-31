import { cloneRoomGoal, normalizeRoomGoal, type RoomGoal } from '../../../goals/roomGoals';
import { cloneRoomSnapshot, roomIdFromCoordinates, type RoomRecord, type RoomSnapshot } from '../../../persistence/roomModel';
import { computeRunScore, getLeaderboardRankingMode, sortCompletedRunsForLeaderboard } from '../../../runs/scoring';
import type {
  GlobalLeaderboardEntry,
  GlobalLeaderboardResponse,
  RoomDifficultyVoteRequestBody,
  RoomLeaderboardEntry,
  RoomLeaderboardResponse,
  RoomRunRecord,
  RunFinishRequestBody,
  RunStartRequestBody,
  RunStartResponse,
} from '../../../runs/model';
import {
  HttpError,
  getCoordinatesFromRequest,
  jsonResponse,
  noContentResponse,
  normalizeIsoTimestamp,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  normalizeRoomCoordinates,
  parseJsonBody,
  parseOptionalPositiveIntegerQueryParam,
  parsePositiveIntegerQueryParam,
} from '../core/http';
import type { Env, RoomRunRow, UserStatsRow } from '../core/types';
import { requireAuthenticatedRequestAuth, loadOptionalRequestAuth, requireOptionalScope } from '../auth/request';
import { loadRoomRecord } from '../rooms/store';
import {
  enqueuePlayfunPointSync,
  flushPlayfunPointSync,
  linkPlayfunUserFromRequest,
  loadPlayfunUserLink,
} from '../playfun/service';
import {
  assertWampLeaderboardWriteAllowed,
  sqlDoesNotHavePlayfunDisplayNamePrefix,
} from '../playfun/leaderboardIsolation';
import {
  awardRoomCreatorCompletionPoints,
  awardRunFinalizePoints,
  clampRunMetricsToSnapshot,
  getRunMetricCapsForSnapshot,
  loadBestCompletedRunForUserAndRoomVersion,
  upsertUserStats,
} from './points';
import {
  buildRoomDifficultySummary,
  hasViewerRatedRoomVersion,
  loadRoomDiscoveryResponse,
  parseRoomDifficultyOrThrow,
  upsertRoomDifficultyVote,
} from './difficulty';
import {
  resolveAggregatedRoomLeaderboardSelection,
  type AggregatedRoomLeaderboardSelection,
} from './roomLeaderboardAggregation';

export async function handleRunStart(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit leaderboard runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseRunStartBody(request);
  const record = await loadRoomRecord(env, body.roomId, body.roomCoordinates, auth.user.id);
  const snapshot = resolveRoomSnapshotForVersion(record, body.roomVersion);

  if (!record.published || snapshot.status !== 'published') {
    throw new HttpError(409, 'Only published room versions can accept leaderboard submissions.');
  }

  if (!snapshot.goal) {
    throw new HttpError(400, 'This room version does not have an active goal.');
  }

  const canonicalGoal = cloneRoomGoal(snapshot.goal);
  if (JSON.stringify(canonicalGoal) !== JSON.stringify(body.goal)) {
    throw new HttpError(409, 'Run goal does not match the published room version.');
  }

  const attemptId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO room_runs (
          attempt_id,
          room_id,
          room_x,
          room_y,
          room_version,
          goal_type,
          goal_json,
          user_id,
          user_display_name,
          started_at,
          finished_at,
          result,
          elapsed_ms,
          deaths,
          score,
          collectibles_collected,
          enemies_defeated,
          checkpoints_reached
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', NULL, 0, 0, 0, 0, 0)
      `
    ).bind(
      attemptId,
      snapshot.id,
      snapshot.coordinates.x,
      snapshot.coordinates.y,
      snapshot.version,
      canonicalGoal!.type,
      JSON.stringify(canonicalGoal),
      auth.user.id,
      auth.user.displayName,
      startedAt
    ),
  ]);

  const responseBody: RunStartResponse = {
    attemptId,
    roomId: snapshot.id,
    roomVersion: snapshot.version,
    goalType: canonicalGoal!.type,
    startedAt,
    userId: auth.user.id,
    userDisplayName: auth.user.displayName,
  };

  return jsonResponse(request, responseBody);
}

export async function handleRunFinish(
  request: Request,
  env: Env,
  attemptId: string
): Promise<Response> {
  if (!attemptId) {
    throw new HttpError(400, 'Attempt id is required.');
  }

  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit leaderboard runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseRunFinishBody(request);
  const existing = await loadRoomRunByAttemptId(env, attemptId);

  if (!existing) {
    throw new HttpError(404, 'Run attempt was not found.');
  }

  if (existing.userId !== auth.user.id) {
    throw new HttpError(403, 'You can only finish your own run attempts.');
  }

  if (existing.result !== 'active') {
    throw new HttpError(409, 'This run attempt has already been finalized.');
  }

  const roomRecord = await loadRoomRecord(
    env,
    existing.roomId,
    existing.roomCoordinates,
    auth.user.id,
    auth.user.walletAddress ?? null
  );
  const snapshot = resolveRoomSnapshotForVersion(roomRecord, existing.roomVersion);
  if (!snapshot.goal) {
    throw new HttpError(409, 'This room version no longer has a leaderboard goal.');
  }

  const metricCaps = getRunMetricCapsForSnapshot(snapshot);
  const clampedMetrics = clampRunMetricsToSnapshot(snapshot, {
    collectiblesCollected: body.collectiblesCollected,
    enemiesDefeated: body.enemiesDefeated,
    checkpointsReached: body.checkpointsReached,
  });
  const finishedAt = new Date().toISOString();
  const reportedElapsedMs = body.elapsedMs;
  const clampedBody: RunFinishRequestBody = {
    ...normalizeFinalizedRunBody(
      snapshot.goal,
      {
        ...body,
        elapsedMs: computeEffectiveElapsedMs(existing.startedAt, finishedAt, reportedElapsedMs),
        collectiblesCollected: clampedMetrics.collectiblesCollected,
        enemiesDefeated: clampedMetrics.enemiesDefeated,
        checkpointsReached: clampedMetrics.checkpointsReached,
      },
      metricCaps,
      reportedElapsedMs
    ),
    finishedAt,
  };
  const score = clampedBody.result === 'completed' ? computeRunScore(snapshot.goal, clampedBody) : 0;

  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE room_runs
        SET
          finished_at = ?,
          result = ?,
          elapsed_ms = ?,
          deaths = ?,
          score = ?,
          collectibles_collected = ?,
          enemies_defeated = ?,
          checkpoints_reached = ?
        WHERE attempt_id = ?
      `
    ).bind(
      finishedAt,
      clampedBody.result,
      clampedBody.elapsedMs,
      clampedBody.deaths,
      score,
      clampedBody.collectiblesCollected,
      clampedBody.enemiesDefeated,
      clampedBody.checkpointsReached,
      attemptId
    ),
  ]);

  const finalizedRun = await loadRoomRunByAttemptId(env, attemptId);
  if (!finalizedRun) {
    throw new HttpError(500, 'Failed to reload finalized run.');
  }

  let isFirstCompletion = false;
  let isNewPersonalBest = false;
  if (finalizedRun.result === 'completed') {
    const previousBest = await loadBestCompletedRunForUserAndRoomVersion(
      env,
      auth.user.id,
      finalizedRun.roomId,
      finalizedRun.roomVersion,
      snapshot.goal,
      finalizedRun.attemptId
    );
    isFirstCompletion = previousBest === null;
    isNewPersonalBest =
      previousBest === null ||
      sortCompletedRunsForLeaderboard([finalizedRun, previousBest], snapshot.goal)[0]?.attemptId ===
        finalizedRun.attemptId;
  }

  const pointEvent = await awardRunFinalizePoints(env, finalizedRun, {
    isFirstCompletion,
    isNewPersonalBest,
  });
  await maybeMirrorRunPointEventToPlayfun(env, request, auth.user.id, pointEvent);
  const creatorPointEvent =
    finalizedRun.result === 'completed'
      ? await awardRoomCreatorCompletionPoints(env, {
          creatorUserId: resolveRoomVersionPublisherUserId(roomRecord, finalizedRun.roomVersion),
          roomId: finalizedRun.roomId,
          roomVersion: finalizedRun.roomVersion,
          finisherUserId: finalizedRun.userId,
          attemptId: finalizedRun.attemptId,
        })
      : null;
  if (creatorPointEvent) {
    await maybeMirrorPointEventToLinkedPlayfunUser(env, creatorPointEvent.user_id, creatorPointEvent);
    await upsertUserStats(env, creatorPointEvent.user_id);
  }
  await upsertUserStats(env, auth.user.id);
  return noContentResponse(request);
}

export async function handleRoomLeaderboard(
  request: Request,
  url: URL,
  env: Env,
  roomId: string
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'read room leaderboards');
  const coordinates = getCoordinatesFromRequest(roomId, url.searchParams);
  const version = parseOptionalPositiveIntegerQueryParam(url.searchParams, 'version');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 10, 1, 50);
  const record = await loadRoomRecord(
    env,
    roomId,
    coordinates,
    auth?.user.id ?? null,
    auth?.user.walletAddress ?? null
  );
  const selection = resolveAggregatedRoomLeaderboardSelection(record, version);
  const snapshot = selection.snapshot;

  if (!snapshot.goal) {
    throw new HttpError(404, 'This room version does not have a leaderboard goal.');
  }

  const leaderboard = await buildRoomLeaderboardResponse(
    env,
    selection,
    limit,
    auth?.user.id ?? null
  );
  return jsonResponse(request, leaderboard);
}

export async function handleRoomDifficultyVote(
  request: Request,
  env: Env,
  roomId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'rate room difficulty',
    'runs:write'
  );
  const body = await parseRoomDifficultyVoteBody(request);
  const record = await loadRoomRecord(
    env,
    roomId,
    body.roomCoordinates,
    auth.user.id,
    auth.user.walletAddress ?? null,
    auth.isAdmin
  );
  const selection = resolveAggregatedRoomLeaderboardSelection(record, body.roomVersion);

  if (!record.published || record.published.version !== selection.roomVersion) {
    throw new HttpError(409, 'Difficulty voting is only available on the current published version.');
  }

  const snapshot = selection.snapshot;
  if (!snapshot.goal) {
    throw new HttpError(409, 'Only published challenge rooms can receive difficulty votes.');
  }

  const hasPlayedVersion = await hasViewerRatedRoomVersion(
    env,
    snapshot.id,
    selection.leaderboardFamilyVersions,
    auth.user.id
  );
  if (!hasPlayedVersion) {
    throw new HttpError(409, 'Play this published version once before rating its difficulty.');
  }

  const now = new Date().toISOString();
  await upsertRoomDifficultyVote(
    env,
    snapshot.id,
    selection.roomVersion,
    auth.user.id,
    body.difficulty,
    now
  );

  return noContentResponse(request);
}

export async function handleRoomDiscovery(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'discover room challenges');
  const rawDifficulty = url.searchParams.get('difficulty');
  const difficultyFilter =
    rawDifficulty && rawDifficulty.trim() ? parseRoomDifficultyOrThrow(rawDifficulty) : null;
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 100, 1, 200);
  const response = await loadRoomDiscoveryResponse(env, difficultyFilter, limit);
  return jsonResponse(request, response);
}

async function maybeMirrorRunPointEventToPlayfun(
  env: Env,
  request: Request,
  userId: string,
  pointEvent: { id: string; user_id: string; points: number; created_at: string }
): Promise<void> {
  if (pointEvent.points <= 0) {
    return;
  }

  const playfunSession = await linkPlayfunUserFromRequest(env, request, userId);
  if (!playfunSession) {
    return;
  }

  try {
    await enqueuePlayfunPointSync(env, pointEvent, playfunSession.ogpId);
    await flushPlayfunPointSync(env, userId);
  } catch (error) {
    console.warn('Failed to mirror run point event to Play.fun', { userId, pointEventId: pointEvent.id, error });
  }
}

async function maybeMirrorPointEventToLinkedPlayfunUser(
  env: Env,
  userId: string,
  pointEvent: { id: string; user_id: string; points: number; created_at: string }
): Promise<void> {
  if (pointEvent.points <= 0) {
    return;
  }

  const link = await loadPlayfunUserLink(env, userId);
  if (!link?.ogp_id) {
    return;
  }

  try {
    await enqueuePlayfunPointSync(env, pointEvent, link.ogp_id);
    await flushPlayfunPointSync(env, userId);
  } catch (error) {
    console.warn('Failed to mirror linked Play.fun point event', { userId, pointEventId: pointEvent.id, error });
  }
}

function resolveRoomVersionPublisherUserId(
  roomRecord: { versions: Array<{ version: number; publishedByUserId: string | null }> },
  roomVersion: number
): string | null {
  return roomRecord.versions.find((entry) => entry.version === roomVersion)?.publishedByUserId ?? null;
}

export async function handleGlobalLeaderboard(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'read global leaderboards');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 10, 1, 50);
  const leaderboard = await buildGlobalLeaderboardResponse(env, limit, auth?.user.id ?? null);
  return jsonResponse(request, leaderboard);
}

export async function parseRunStartBody(request: Request): Promise<RunStartRequestBody> {
  const body = await parseJsonBody<RunStartRequestBody>(request);
  const roomCoordinates = normalizeRoomCoordinates(body.roomCoordinates);
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
  const roomVersion = normalizePositiveInteger(body.roomVersion, 'roomVersion');
  const goal = normalizeRoomGoal(body.goal);

  if (!roomId) {
    throw new HttpError(400, 'roomId is required.');
  }

  if (!goal) {
    throw new HttpError(400, 'goal must be a valid room goal.');
  }

  if (roomId !== roomIdFromCoordinates(roomCoordinates)) {
    throw new HttpError(400, 'roomId must match roomCoordinates.');
  }

  return {
    roomId,
    roomCoordinates,
    roomVersion,
    goal,
    startedAt: normalizeIsoTimestamp(body.startedAt),
  };
}

export async function parseRunFinishBody(request: Request): Promise<RunFinishRequestBody> {
  const body = await parseJsonBody<RunFinishRequestBody>(request);

  if (body.result !== 'completed' && body.result !== 'failed' && body.result !== 'abandoned') {
    throw new HttpError(400, 'result must be completed, failed, or abandoned.');
  }

  return {
    result: body.result,
    elapsedMs: normalizeNonNegativeInteger(body.elapsedMs, 'elapsedMs'),
    deaths: normalizeNonNegativeInteger(body.deaths, 'deaths'),
    collectiblesCollected: normalizeNonNegativeInteger(
      body.collectiblesCollected,
      'collectiblesCollected'
    ),
    enemiesDefeated: normalizeNonNegativeInteger(body.enemiesDefeated, 'enemiesDefeated'),
    checkpointsReached: normalizeNonNegativeInteger(
      body.checkpointsReached,
      'checkpointsReached'
    ),
    score: null,
    finishedAt: normalizeIsoTimestamp(body.finishedAt),
  };
}

export async function parseRoomDifficultyVoteBody(
  request: Request
): Promise<RoomDifficultyVoteRequestBody> {
  const body = await parseJsonBody<RoomDifficultyVoteRequestBody>(request);

  return {
    roomCoordinates: normalizeRoomCoordinates(body.roomCoordinates),
    roomVersion: normalizePositiveInteger(body.roomVersion, 'roomVersion'),
    difficulty: parseRoomDifficultyOrThrow(body.difficulty),
  };
}

export function resolveRoomSnapshotForVersion(
  record: RoomRecord,
  version: number
): RoomSnapshot {
  if (record.published?.version === version) {
    return cloneRoomSnapshot(record.published);
  }

  const historicalVersion =
    record.versions.find((candidate) => candidate.version === version) ?? null;
  if (!historicalVersion) {
    throw new HttpError(404, `Room version ${version} was not found.`);
  }

  return cloneRoomSnapshot(historicalVersion.snapshot);
}

export async function loadRoomRunByAttemptId(
  env: Env,
  attemptId: string
): Promise<RoomRunRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        room_id,
        room_x,
        room_y,
        room_version,
        goal_type,
        goal_json,
        user_id,
        user_display_name,
        started_at,
        finished_at,
        result,
        elapsed_ms,
        deaths,
        score,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached
      FROM room_runs
      WHERE attempt_id = ?
      LIMIT 1
    `
  )
    .bind(attemptId)
    .first<RoomRunRow>();

  return row ? mapRoomRunRow(row) : null;
}

export async function loadCompletedRoomRuns(
  env: Env,
  roomId: string,
  roomVersion: number
): Promise<RoomRunRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        room_id,
        room_x,
        room_y,
        room_version,
        goal_type,
        goal_json,
        user_id,
        user_display_name,
        started_at,
        finished_at,
        result,
        elapsed_ms,
        deaths,
        score,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached
      FROM room_runs
      WHERE room_id = ?
        AND room_version = ?
        AND result = 'completed'
        AND ${sqlDoesNotHavePlayfunDisplayNamePrefix('room_runs.user_display_name')}
    `
  )
    .bind(roomId, roomVersion)
    .all<RoomRunRow>();

  return result.results.map(mapRoomRunRow);
}

export async function loadCompletedRoomRunsForVersions(
  env: Env,
  roomId: string,
  roomVersions: number[]
): Promise<RoomRunRecord[]> {
  if (roomVersions.length === 0) {
    return [];
  }

  const result = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        room_id,
        room_x,
        room_y,
        room_version,
        goal_type,
        goal_json,
        user_id,
        user_display_name,
        started_at,
        finished_at,
        result,
        elapsed_ms,
        deaths,
        score,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached
      FROM room_runs
      WHERE room_id = ?
        AND room_version IN (${roomVersions.map(() => '?').join(', ')})
        AND result = 'completed'
        AND ${sqlDoesNotHavePlayfunDisplayNamePrefix('room_runs.user_display_name')}
    `
  )
    .bind(roomId, ...roomVersions)
    .all<RoomRunRow>();

  return result.results.map(mapRoomRunRow);
}

interface RankedRoomLeaderboardRow {
  attempt_id: string;
  room_version: number;
  user_id: string;
  user_display_name: string;
  elapsed_ms: number;
  deaths: number;
  score: number;
  finished_at: string;
  overall_rank: number | string | null;
}

interface RankedGlobalLeaderboardRow extends UserStatsRow {
  overall_rank: number | string | null;
}

function getRoomLeaderboardSqlOrderClause(goal: RoomGoal): string {
  return getLeaderboardRankingMode(goal) === 'time'
    ? 'elapsed_ms ASC, deaths ASC, score DESC, finished_at ASC, attempt_id ASC'
    : 'score DESC, deaths ASC, elapsed_ms ASC, finished_at ASC, attempt_id ASC';
}

function getGlobalLeaderboardSqlOrderClause(): string {
  return 'total_points DESC, completed_runs DESC, total_rooms_published DESC, user_display_name ASC, user_id ASC';
}

function buildRankedRoomLeaderboardCte(goal: RoomGoal, versionCount: number): string {
  const versionPlaceholders = Array.from({ length: versionCount }, () => '?').join(', ');
  const orderClause = getRoomLeaderboardSqlOrderClause(goal);
  return `
    WITH candidate_runs AS (
      SELECT
        attempt_id,
        room_version,
        user_id,
        user_display_name,
        elapsed_ms,
        deaths,
        score,
        finished_at,
        ROW_NUMBER() OVER (
          PARTITION BY user_id
          ORDER BY ${orderClause}
        ) AS user_row_num
      FROM room_runs
      WHERE room_id = ?
        AND room_version IN (${versionPlaceholders})
        AND result = 'completed'
        AND elapsed_ms IS NOT NULL
        AND finished_at IS NOT NULL
        AND ${sqlDoesNotHavePlayfunDisplayNamePrefix('room_runs.user_display_name')}
    ),
    best_runs AS (
      SELECT
        attempt_id,
        room_version,
        user_id,
        user_display_name,
        elapsed_ms,
        deaths,
        score,
        finished_at
      FROM candidate_runs
      WHERE user_row_num = 1
    ),
    ranked_runs AS (
      SELECT
        attempt_id,
        room_version,
        user_id,
        user_display_name,
        elapsed_ms,
        deaths,
        score,
        finished_at,
        ROW_NUMBER() OVER (
          ORDER BY ${orderClause}
        ) AS overall_rank
      FROM best_runs
    )
  `;
}

async function loadRankedRoomLeaderboardRows(
  env: Env,
  roomId: string,
  roomVersions: number[],
  goal: RoomGoal,
  limit: number
): Promise<RankedRoomLeaderboardRow[]> {
  if (roomVersions.length === 0 || limit <= 0) {
    return [];
  }

  const cte = buildRankedRoomLeaderboardCte(goal, roomVersions.length);
  const result = await env.DB.prepare(
    `
      ${cte}
      SELECT
        attempt_id,
        room_version,
        user_id,
        user_display_name,
        elapsed_ms,
        deaths,
        score,
        finished_at,
        overall_rank
      FROM ranked_runs
      ORDER BY overall_rank
      LIMIT ?
    `
  )
    .bind(roomId, ...roomVersions, limit)
    .all<RankedRoomLeaderboardRow>();

  return result.results;
}

async function loadViewerRankedRoomLeaderboardRow(
  env: Env,
  roomId: string,
  roomVersions: number[],
  goal: RoomGoal,
  viewerUserId: string
): Promise<RankedRoomLeaderboardRow | null> {
  if (roomVersions.length === 0) {
    return null;
  }

  const cte = buildRankedRoomLeaderboardCte(goal, roomVersions.length);
  const row = await env.DB.prepare(
    `
      ${cte}
      SELECT
        attempt_id,
        room_version,
        user_id,
        user_display_name,
        elapsed_ms,
        deaths,
        score,
        finished_at,
        overall_rank
      FROM ranked_runs
      WHERE user_id = ?
      LIMIT 1
    `
  )
    .bind(roomId, ...roomVersions, viewerUserId)
    .first<RankedRoomLeaderboardRow>();

  return row ?? null;
}

function mapRankedRoomLeaderboardEntry(
  row: RankedRoomLeaderboardRow,
  snapshot: RoomSnapshot
): RoomLeaderboardEntry {
  return {
    rank: Number(row.overall_rank),
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    attemptId: row.attempt_id,
    roomId: snapshot.id,
    roomVersion: row.room_version,
    goalType: snapshot.goal!.type,
    elapsedMs: row.elapsed_ms,
    deaths: row.deaths,
    score: row.score,
    finishedAt: row.finished_at,
  };
}

async function loadRankedGlobalLeaderboardRows(
  env: Env,
  limit: number
): Promise<RankedGlobalLeaderboardRow[]> {
  if (limit <= 0) {
    return [];
  }

  const orderClause = getGlobalLeaderboardSqlOrderClause();
  const result = await env.DB.prepare(
    `
      WITH ranked_stats AS (
        SELECT
          user_id,
          user_display_name,
          total_points,
          total_score,
          total_deaths,
          total_collectibles,
          total_enemies_defeated,
          total_checkpoints,
          total_rooms_published,
          completed_runs,
          failed_runs,
          abandoned_runs,
          best_score,
          fastest_clear_ms,
          updated_at,
          ROW_NUMBER() OVER (
            ORDER BY ${orderClause}
          ) AS overall_rank
        FROM user_stats
        WHERE ${sqlDoesNotHavePlayfunDisplayNamePrefix('user_stats.user_display_name')}
      )
      SELECT
        user_id,
        user_display_name,
        total_points,
        total_score,
        total_deaths,
        total_collectibles,
        total_enemies_defeated,
        total_checkpoints,
        total_rooms_published,
        completed_runs,
        failed_runs,
        abandoned_runs,
        best_score,
        fastest_clear_ms,
        updated_at,
        overall_rank
      FROM ranked_stats
      ORDER BY overall_rank
      LIMIT ?
    `
  )
    .bind(limit)
    .all<RankedGlobalLeaderboardRow>();

  return result.results;
}

async function loadViewerRankedGlobalLeaderboardRow(
  env: Env,
  viewerUserId: string
): Promise<RankedGlobalLeaderboardRow | null> {
  const orderClause = getGlobalLeaderboardSqlOrderClause();
  const row = await env.DB.prepare(
    `
      WITH ranked_stats AS (
        SELECT
          user_id,
          user_display_name,
          total_points,
          total_score,
          total_deaths,
          total_collectibles,
          total_enemies_defeated,
          total_checkpoints,
          total_rooms_published,
          completed_runs,
          failed_runs,
          abandoned_runs,
          best_score,
          fastest_clear_ms,
          updated_at,
          ROW_NUMBER() OVER (
            ORDER BY ${orderClause}
          ) AS overall_rank
        FROM user_stats
        WHERE ${sqlDoesNotHavePlayfunDisplayNamePrefix('user_stats.user_display_name')}
      )
      SELECT
        user_id,
        user_display_name,
        total_points,
        total_score,
        total_deaths,
        total_collectibles,
        total_enemies_defeated,
        total_checkpoints,
        total_rooms_published,
        completed_runs,
        failed_runs,
        abandoned_runs,
        best_score,
        fastest_clear_ms,
        updated_at,
        overall_rank
      FROM ranked_stats
      WHERE user_id = ?
      LIMIT 1
    `
  )
    .bind(viewerUserId)
    .first<RankedGlobalLeaderboardRow>();

  return row ?? null;
}

function mapRankedGlobalLeaderboardEntry(row: RankedGlobalLeaderboardRow): GlobalLeaderboardEntry {
  return {
    rank: Number(row.overall_rank),
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    totalPoints: row.total_points,
    totalScore: row.total_score,
    totalRoomsPublished: row.total_rooms_published,
    completedRuns: row.completed_runs,
    failedRuns: row.failed_runs,
    abandonedRuns: row.abandoned_runs,
    bestScore: row.best_score,
    fastestClearMs: row.fastest_clear_ms,
    updatedAt: row.updated_at,
  };
}

export function mapRoomRunRow(row: RoomRunRow): RoomRunRecord {
  return {
    attemptId: row.attempt_id,
    roomId: row.room_id,
    roomCoordinates: {
      x: row.room_x,
      y: row.room_y,
    },
    roomVersion: row.room_version,
    goalType: parseStoredGoal(row.goal_json, 'room run goal').type,
    goal: parseStoredGoal(row.goal_json, 'room run goal'),
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result,
    elapsedMs: row.elapsed_ms,
    deaths: row.deaths,
    score: row.score,
    collectiblesCollected: row.collectibles_collected,
    enemiesDefeated: row.enemies_defeated,
    checkpointsReached: row.checkpoints_reached,
  };
}

export function parseStoredGoal(raw: string, label: string): RoomGoal {
  try {
    const parsed = normalizeRoomGoal(JSON.parse(raw));
    if (!parsed) {
      throw new Error('Invalid goal.');
    }
    return parsed;
  } catch {
    throw new HttpError(500, `Failed to parse ${label}.`);
  }
}

function computeEffectiveElapsedMs(
  startedAt: string,
  finishedAt: string,
  reportedElapsedMs: number
): number {
  const observedStart = Date.parse(startedAt);
  const observedFinish = Date.parse(finishedAt);
  const observedElapsedMs =
    Number.isFinite(observedStart) && Number.isFinite(observedFinish)
      ? Math.max(0, observedFinish - observedStart)
      : 0;
  return Math.max(Math.round(reportedElapsedMs), observedElapsedMs);
}

function normalizeFinalizedRunBody(
  goal: RoomGoal,
  body: RunFinishRequestBody,
  metricCaps: {
    maxCollectibles: number;
    maxEnemies: number;
    maxCheckpoints: number;
  },
  reportedElapsedMs: number
): RunFinishRequestBody {
  if (body.result !== 'completed') {
    return {
      ...body,
      collectiblesCollected: 0,
      enemiesDefeated: 0,
      checkpointsReached: 0,
    };
  }

  if (
    'timeLimitMs' in goal &&
    goal.timeLimitMs !== null &&
    reportedElapsedMs > goal.timeLimitMs
  ) {
    throw new HttpError(409, 'Completed runs must finish within the published time limit.');
  }

  switch (goal.type) {
    case 'collect_target':
      if (body.collectiblesCollected < goal.requiredCount) {
        throw new HttpError(409, 'Completed collect-target runs must meet the published goal.');
      }
      break;
    case 'defeat_all':
      if (body.enemiesDefeated < metricCaps.maxEnemies) {
        throw new HttpError(409, 'Completed defeat-all runs must clear every published enemy.');
      }
      break;
    case 'checkpoint_sprint':
      if (body.checkpointsReached < metricCaps.maxCheckpoints) {
        throw new HttpError(409, 'Completed checkpoint-sprint runs must hit every checkpoint.');
      }
      break;
    case 'survival':
      if (body.elapsedMs < goal.durationMs) {
        throw new HttpError(409, 'Completed survival runs must last the full published duration.');
      }
      break;
    case 'reach_exit':
      break;
  }

  return body;
}

export async function buildRoomLeaderboardResponse(
  env: Env,
  selection: AggregatedRoomLeaderboardSelection,
  limit: number,
  viewerUserId: string | null = null
): Promise<RoomLeaderboardResponse> {
  const snapshot = selection.snapshot;
  if (!snapshot.goal) {
    throw new HttpError(404, 'This room version does not have a leaderboard goal.');
  }

  const entriesRows = await loadRankedRoomLeaderboardRows(
    env,
    snapshot.id,
    selection.leaderboardFamilyVersions,
    snapshot.goal,
    limit
  );
  const viewerBestRow =
    viewerUserId === null
      ? null
      : await loadViewerRankedRoomLeaderboardRow(
          env,
          snapshot.id,
          selection.leaderboardFamilyVersions,
          snapshot.goal,
          viewerUserId
        );
  const difficulty = await buildRoomDifficultySummary(
    env,
    snapshot,
    viewerUserId,
    selection.currentPublishedVersion,
    selection.roomVersion,
    selection.leaderboardFamilyVersions
  );
  const entries = entriesRows.map((row) => mapRankedRoomLeaderboardEntry(row, snapshot));
  const viewerBest =
    viewerBestRow === null ? null : mapRankedRoomLeaderboardEntry(viewerBestRow, snapshot);

  return {
    roomId: snapshot.id,
    roomCoordinates: { ...snapshot.coordinates },
    roomTitle: snapshot.title,
    roomVersion: selection.roomVersion,
    displayRoomVersion: selection.displayRoomVersion,
    equivalentRoomVersions: [...selection.equivalentRoomVersions],
    leaderboardFamilyVersions: [...selection.leaderboardFamilyVersions],
    leaderboardSourceVersion: selection.leaderboardSourceVersion,
    canonicalRoomVersion: selection.canonicalRoomVersion,
    goalType: snapshot.goal.type,
    rankingMode: getLeaderboardRankingMode(snapshot.goal),
    difficulty,
    entries,
    viewerBest,
    viewerRank: viewerBest?.rank ?? null,
  };
}

export async function buildGlobalLeaderboardResponse(
  env: Env,
  limit: number,
  viewerUserId: string | null = null
): Promise<GlobalLeaderboardResponse> {
  const entries = (await loadRankedGlobalLeaderboardRows(env, limit)).map(
    mapRankedGlobalLeaderboardEntry
  );
  let viewerEntry: GlobalLeaderboardEntry | null = null;
  if (viewerUserId !== null) {
    viewerEntry = entries.find((entry) => entry.userId === viewerUserId) ?? null;
    if (viewerEntry === null) {
      const viewerRow = await loadViewerRankedGlobalLeaderboardRow(env, viewerUserId);
      viewerEntry = viewerRow ? mapRankedGlobalLeaderboardEntry(viewerRow) : null;
    }
  }

  return {
    entries,
    viewerEntry,
  };
}
