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
  awardRoomCreatorCompletionPoints,
  awardRunFinalizePoints,
  clampRunMetricsToSnapshot,
  loadBestCompletedRunForUserAndRoomVersion,
  mapUserStatsRow,
  compareGlobalLeaderboardEntries,
  upsertUserStats,
} from './points';
import {
  buildRoomDifficultySummary,
  hasViewerRatedRoomVersion,
  loadRoomDiscoveryResponse,
  parseRoomDifficultyOrThrow,
  upsertRoomDifficultyVote,
} from './difficulty';

export async function handleRunStart(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit leaderboard runs',
    'runs:write'
  );
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
  const startedAt = normalizeIsoTimestamp(body.startedAt) ?? new Date().toISOString();

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

  const clampedMetrics = clampRunMetricsToSnapshot(snapshot, {
    collectiblesCollected: body.collectiblesCollected,
    enemiesDefeated: body.enemiesDefeated,
    checkpointsReached: body.checkpointsReached,
  });
  const finishedAt = normalizeIsoTimestamp(body.finishedAt) ?? new Date().toISOString();
  const clampedBody: RunFinishRequestBody = {
    ...body,
    collectiblesCollected: clampedMetrics.collectiblesCollected,
    enemiesDefeated: clampedMetrics.enemiesDefeated,
    checkpointsReached: clampedMetrics.checkpointsReached,
    finishedAt,
  };
  const score = computeRunScore(snapshot.goal, clampedBody);

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
      body.result,
      body.elapsedMs,
      body.deaths,
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

  const previousBest = await loadBestCompletedRunForUserAndRoomVersion(
    env,
    auth.user.id,
    finalizedRun.roomId,
    finalizedRun.roomVersion,
    snapshot.goal,
    finalizedRun.attemptId
  );
  const isNewPersonalBest =
    finalizedRun.result === 'completed' &&
    (previousBest === null ||
      sortCompletedRunsForLeaderboard([finalizedRun, previousBest], snapshot.goal)[0]?.attemptId ===
        finalizedRun.attemptId);

  const pointEvent = await awardRunFinalizePoints(env, finalizedRun, isNewPersonalBest);
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
  const snapshot =
    version === null
      ? record.published
      : resolveRoomSnapshotForVersion(record, version);

  if (!snapshot) {
    throw new HttpError(404, 'Published room version not found.');
  }

  if (!snapshot.goal) {
    throw new HttpError(404, 'This room version does not have a leaderboard goal.');
  }

  const leaderboard = await buildRoomLeaderboardResponse(
    env,
    snapshot,
    limit,
    auth?.user.id ?? null,
    record.published?.version ?? null
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

  if (!record.published || record.published.version !== body.roomVersion) {
    throw new HttpError(409, 'Difficulty voting is only available on the current published version.');
  }

  const snapshot = resolveRoomSnapshotForVersion(record, body.roomVersion);
  if (!snapshot.goal) {
    throw new HttpError(409, 'Only published challenge rooms can receive difficulty votes.');
  }

  const hasPlayedVersion = await hasViewerRatedRoomVersion(
    env,
    snapshot.id,
    snapshot.version,
    auth.user.id
  );
  if (!hasPlayedVersion) {
    throw new HttpError(409, 'Play this published version once before rating its difficulty.');
  }

  const now = new Date().toISOString();
  await upsertRoomDifficultyVote(
    env,
    snapshot.id,
    snapshot.version,
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
    `
  )
    .bind(roomId, roomVersion)
    .all<RoomRunRow>();

  return result.results.map(mapRoomRunRow);
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

export async function buildRoomLeaderboardResponse(
  env: Env,
  snapshot: RoomSnapshot,
  limit: number,
  viewerUserId: string | null = null,
  currentPublishedVersion: number | null = null
): Promise<RoomLeaderboardResponse> {
  if (!snapshot.goal) {
    throw new HttpError(404, 'This room version does not have a leaderboard goal.');
  }

  const runs = await loadCompletedRoomRuns(env, snapshot.id, snapshot.version);
  const sortedAll = sortCompletedRunsForLeaderboard(runs, snapshot.goal);
  const viewerBestRun =
    viewerUserId === null
      ? null
      : sortedAll.find((run) => run.userId === viewerUserId) ?? null;
  const viewerRank =
    viewerBestRun === null
      ? null
      : sortedAll.findIndex((run) => run.attemptId === viewerBestRun.attemptId) + 1;
  const sorted = sortedAll.slice(0, limit);
  const difficulty = await buildRoomDifficultySummary(
    env,
    snapshot,
    viewerUserId,
    currentPublishedVersion
  );
  const entries: RoomLeaderboardEntry[] = sorted.map((run, index) => ({
    rank: index + 1,
    userId: run.userId,
    userDisplayName: run.userDisplayName,
    attemptId: run.attemptId,
    roomId: run.roomId,
    roomVersion: run.roomVersion,
    goalType: run.goalType,
    elapsedMs: run.elapsedMs ?? 0,
    deaths: run.deaths,
    score: run.score,
    finishedAt: run.finishedAt ?? run.startedAt,
  }));

  return {
    roomId: snapshot.id,
    roomCoordinates: { ...snapshot.coordinates },
    roomTitle: snapshot.title,
    roomVersion: snapshot.version,
    goalType: snapshot.goal.type,
    rankingMode: getLeaderboardRankingMode(snapshot.goal),
    difficulty,
    entries,
    viewerBest:
      viewerBestRun === null
        ? null
        : {
            rank: viewerRank ?? 0,
            userId: viewerBestRun.userId,
            userDisplayName: viewerBestRun.userDisplayName,
            attemptId: viewerBestRun.attemptId,
            roomId: viewerBestRun.roomId,
            roomVersion: viewerBestRun.roomVersion,
            goalType: viewerBestRun.goalType,
            elapsedMs: viewerBestRun.elapsedMs ?? 0,
            deaths: viewerBestRun.deaths,
            score: viewerBestRun.score,
            finishedAt: viewerBestRun.finishedAt ?? viewerBestRun.startedAt,
          },
    viewerRank: viewerRank || null,
  };
}

export async function buildGlobalLeaderboardResponse(
  env: Env,
  limit: number,
  viewerUserId: string | null = null
): Promise<GlobalLeaderboardResponse> {
  const result = await env.DB.prepare(
    `
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
        updated_at
      FROM user_stats
    `
  ).all<UserStatsRow>();

  const entries = result.results
    .map(mapUserStatsRow)
    .sort(compareGlobalLeaderboardEntries)
    .map<GlobalLeaderboardEntry>((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      userDisplayName: entry.userDisplayName,
      totalPoints: entry.totalPoints,
      totalScore: entry.totalScore,
      totalRoomsPublished: entry.totalRoomsPublished,
      completedRuns: entry.completedRuns,
      failedRuns: entry.failedRuns,
      abandonedRuns: entry.abandonedRuns,
      bestScore: entry.bestScore,
      fastestClearMs: entry.fastestClearMs,
      updatedAt: entry.updatedAt,
    }));

  const viewerEntry =
    viewerUserId === null
      ? null
      : entries.find((entry) => entry.userId === viewerUserId) ?? null;

  return {
    entries: entries.slice(0, limit),
    viewerEntry,
  };
}
