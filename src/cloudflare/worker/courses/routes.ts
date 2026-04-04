import {
  cloneCourseGoal,
  cloneCourseSnapshot,
  normalizeCourseGoal,
  normalizeCourseSnapshot,
  type CourseGoal,
  type CourseRecord,
  type CourseSnapshot,
} from '../../../courses/model';
import {
  computeCourseRunScore,
  getCourseLeaderboardRankingMode,
  sortCompletedCourseRunsForLeaderboard,
} from '../../../courses/scoring';
import type {
  CourseLeaderboardEntry,
  CourseLeaderboardResponse,
  CourseRunFinishRequestBody,
  CourseRunRecord,
  CourseRunStartRequestBody,
  CourseRunStartResponse,
} from '../../../courses/runModel';
import type { RunResult } from '../../../runs/model';
import {
  HttpError,
  jsonResponse,
  noContentResponse,
  normalizeIsoTimestamp,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  parseJsonBody,
  parseOptionalPositiveIntegerQueryParam,
  parsePositiveIntegerQueryParam,
} from '../core/http';
import type { CourseRunRow, Env } from '../core/types';
import {
  loadOptionalRequestAuth,
  requireAuthenticatedRequestAuth,
  requireOptionalScope,
} from '../auth/request';
import {
  enqueuePlayfunPointSync,
  flushPlayfunPointSync,
  linkPlayfunUserFromRequest,
  loadPlayfunUserLink,
} from '../playfun/service';
import {
  assertWampLeaderboardWriteAllowed,
  sqlUserIdIsNotPlayfunOnly,
} from '../playfun/leaderboardIsolation';
import {
  awardCoursePublishPoints,
  awardCourseCreatorCompletionPoints,
  awardRunFinalizePoints,
  upsertUserStats,
} from '../runs/points';
import {
  createCourseDraft,
  loadLatestEditableDraftCourseForRoom,
  loadCourseRecord,
  loadPublishedCourse,
  publishCourse,
  saveCourseDraft,
  unpublishCourse,
} from './store';

export async function handleCourseCreate(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'create course drafts',
    'rooms:write'
  );
  const snapshot = await parseCourseSnapshotBody(request);
  const record = await createCourseDraft(env, snapshot, auth.user, auth.isAdmin);
  return jsonResponse(request, record);
}

export async function handleCourseGet(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'rooms:read', 'read courses');
  const record = await loadCourseRecord(
    env,
    courseId,
    auth?.user.id ?? null,
    auth?.isAdmin ?? false
  );

  if (!record) {
    throw new HttpError(404, 'Course not found.');
  }

  if (record.permissions.canSaveDraft || auth?.isAdmin) {
    return jsonResponse(request, record);
  }

  if (!record.published) {
    throw new HttpError(404, 'Published course not found.');
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
    'load editable course drafts',
    'rooms:write'
  );
  const record = await loadLatestEditableDraftCourseForRoom(
    env,
    roomId,
    auth.user.id,
    auth.isAdmin
  );

  if (!record) {
    throw new HttpError(404, 'Draft course not found for this room.');
  }

  return jsonResponse(request, record);
}

export async function handleCourseDraftSave(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'save course drafts',
    'rooms:write'
  );
  const snapshot = await parseCourseSnapshotBody(request, courseId);
  const record = await saveCourseDraft(env, snapshot, auth.user, auth.isAdmin);
  return jsonResponse(request, record);
}

export async function handleCoursePublish(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'publish courses',
    'rooms:write'
  );
  const existing = await loadCourseRecord(env, courseId, auth.user.id, auth.isAdmin);
  if (!existing) {
    throw new HttpError(404, 'Course draft not found.');
  }

  const record = await publishCourse(env, courseId, auth.user, auth.isAdmin);
  const pointEvent = await awardCoursePublishPoints(
    env,
    auth.user.id,
    record.draft.id,
    record.published?.version ?? record.draft.version,
    !existing.published
  );
  await maybeMirrorAuthenticatedPointEventToPlayfun(env, request, auth.user.id, pointEvent);
  await upsertUserStats(env, auth.user.id);
  return jsonResponse(request, record);
}

export async function handleCourseUnpublish(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'unpublish courses',
    'rooms:write'
  );
  const record = await unpublishCourse(env, courseId, auth.user, auth.isAdmin);
  return jsonResponse(request, record);
}

export async function handleCourseRunStart(
  request: Request,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit course runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseCourseRunStartBody(request, courseId);
  const snapshot = await resolvePublishedCourseVersion(env, body.courseId, body.courseVersion);
  if (!snapshot.goal) {
    throw new HttpError(400, 'This course version does not have an active goal.');
  }

  const canonicalGoal = cloneCourseGoal(snapshot.goal);
  if (JSON.stringify(canonicalGoal) !== JSON.stringify(body.goal)) {
    throw new HttpError(409, 'Run goal does not match the published course version.');
  }

  const attemptId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO course_runs (
          attempt_id,
          course_id,
          course_version,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', NULL, 0, 0, 0, 0, 0)
      `
    ).bind(
      attemptId,
      snapshot.id,
      snapshot.version,
      canonicalGoal!.type,
      JSON.stringify(canonicalGoal),
      auth.user.id,
      auth.user.displayName,
      startedAt
    ),
  ]);

  const responseBody: CourseRunStartResponse = {
    attemptId,
    courseId: snapshot.id,
    courseVersion: snapshot.version,
    goalType: canonicalGoal!.type,
    startedAt,
    userId: auth.user.id,
    userDisplayName: auth.user.displayName,
  };

  return jsonResponse(request, responseBody);
}

export async function handleCourseRunFinish(
  request: Request,
  env: Env,
  attemptId: string
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'submit course runs',
    'runs:write'
  );
  await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const body = await parseCourseRunFinishBody(request);
  const existing = await loadCourseRunByAttemptId(env, attemptId);
  if (!existing) {
    throw new HttpError(404, 'Course run attempt was not found.');
  }

  if (existing.userId !== auth.user.id) {
    throw new HttpError(403, 'You can only finish your own course run attempts.');
  }

  if (existing.result !== 'active') {
    throw new HttpError(409, 'This course run attempt has already been finalized.');
  }

  const snapshot = await resolvePublishedCourseVersion(env, existing.courseId, existing.courseVersion);
  if (!snapshot.goal) {
    throw new HttpError(409, 'This course version no longer has a leaderboard goal.');
  }

  const finishedAt = new Date().toISOString();
  const reportedElapsedMs = body.elapsedMs;
  const clampedBody: CourseRunFinishRequestBody = {
    ...normalizeFinalizedCourseRunBody(
      snapshot.goal,
      {
        ...body,
        elapsedMs: computeEffectiveElapsedMs(existing.startedAt, finishedAt, reportedElapsedMs),
      },
      reportedElapsedMs
    ),
    finishedAt,
  };
  const score =
    clampedBody.result === 'completed' ? computeCourseRunScore(snapshot.goal, clampedBody) : 0;

  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE course_runs
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

  const finalizedRun = await loadCourseRunByAttemptId(env, attemptId);
  if (!finalizedRun) {
    throw new HttpError(500, 'Failed to reload finalized course run.');
  }

  let isFirstCompletion = false;
  let isNewPersonalBest = false;
  if (finalizedRun.result === 'completed') {
    const previousBest = await loadBestCompletedCourseRunForUserAndVersion(
      env,
      auth.user.id,
      finalizedRun.courseId,
      finalizedRun.courseVersion,
      attemptId
    );
    isFirstCompletion = previousBest === null;
    isNewPersonalBest =
      previousBest === null ||
      sortCompletedCourseRunsForLeaderboard([finalizedRun, previousBest], snapshot.goal)[0]?.attemptId ===
        finalizedRun.attemptId;
  }

  const pointEvent = await awardRunFinalizePoints(env, finalizedRun, {
    isFirstCompletion,
    isNewPersonalBest,
  });
  await maybeMirrorAuthenticatedPointEventToPlayfun(env, request, auth.user.id, pointEvent);

  const creatorPointEvent =
    finalizedRun.result === 'completed'
      ? await awardCourseCreatorCompletionPoints(env, {
          creatorUserId: await resolvePublishedCourseOwnerUserId(env, finalizedRun.courseId),
          courseId: finalizedRun.courseId,
          courseVersion: finalizedRun.courseVersion,
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

export async function handleCourseLeaderboard(
  request: Request,
  url: URL,
  env: Env,
  courseId: string
): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'read course leaderboards');
  const version = parseOptionalPositiveIntegerQueryParam(url.searchParams, 'version');
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 10, 1, 50);
  const snapshot = await resolvePublishedCourseVersion(env, courseId, version ?? undefined);
  if (!snapshot.goal) {
    throw new HttpError(404, 'This course version does not have a leaderboard goal.');
  }

  const leaderboard = await buildCourseLeaderboardResponse(
    env,
    snapshot,
    limit,
    auth?.user.id ?? null
  );
  return jsonResponse(request, leaderboard);
}

function sanitizeCourseRecordForPublicRead(record: CourseRecord): CourseRecord {
  const published = record.published ? cloneCourseSnapshot(record.published) : null;
  if (!published) {
    throw new HttpError(404, 'Published course not found.');
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

async function parseCourseSnapshotBody(
  request: Request,
  fallbackCourseId: string = crypto.randomUUID()
): Promise<CourseSnapshot> {
  const body = await parseJsonBody<CourseSnapshot>(request);
  return normalizeCourseSnapshot(body, fallbackCourseId);
}

async function parseCourseRunStartBody(
  request: Request,
  fallbackCourseId: string
): Promise<CourseRunStartRequestBody> {
  const body = await parseJsonBody<CourseRunStartRequestBody>(request);
  const courseId = typeof body.courseId === 'string' && body.courseId.trim() ? body.courseId.trim() : fallbackCourseId;
  const courseVersion = normalizePositiveInteger(body.courseVersion, 'courseVersion');
  const goal = normalizeCourseGoal(body.goal);

  if (!courseId) {
    throw new HttpError(400, 'courseId is required.');
  }
  if (!goal) {
    throw new HttpError(400, 'goal must be a valid course goal.');
  }

  return {
    courseId,
    courseVersion,
    goal,
    startedAt: normalizeIsoTimestamp(body.startedAt),
  };
}

async function parseCourseRunFinishBody(
  request: Request
): Promise<CourseRunFinishRequestBody> {
  const body = await parseJsonBody<CourseRunFinishRequestBody>(request);

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

function normalizeFinalizedCourseRunBody(
  goal: CourseSnapshot['goal'],
  body: CourseRunFinishRequestBody,
  reportedElapsedMs: number
): CourseRunFinishRequestBody {
  if (!goal) {
    return body;
  }

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
    throw new HttpError(409, 'Completed course runs must finish within the published time limit.');
  }

  switch (goal.type) {
    case 'collect_target':
      if (body.collectiblesCollected < goal.requiredCount) {
        throw new HttpError(409, 'Completed collect-target course runs must meet the published goal.');
      }
      break;
    case 'checkpoint_sprint':
      if (body.checkpointsReached < goal.checkpoints.length) {
        throw new HttpError(409, 'Completed checkpoint course runs must hit every checkpoint.');
      }
      break;
    case 'survival':
      if (body.elapsedMs < goal.durationMs) {
        throw new HttpError(409, 'Completed survival course runs must last the full published duration.');
      }
      break;
    case 'defeat_all':
    case 'reach_exit':
      break;
  }

  return body;
}

async function resolvePublishedCourseVersion(
  env: Env,
  courseId: string,
  version?: number
): Promise<CourseSnapshot> {
  const course = await loadPublishedCourse(env, courseId);
  if (course && (version === undefined || version === null || course.version === version)) {
    return cloneCourseSnapshot(course);
  }

  const record = await loadCourseRecord(env, courseId);
  if (!record) {
    throw new HttpError(404, 'Course not found.');
  }
  if (version === undefined || version === null) {
    throw new HttpError(404, 'Published course not found.');
  }
  const historicalVersion =
    record?.versions.find((entry) => entry.version === version) ?? null;
  if (!historicalVersion) {
    throw new HttpError(404, `Course version ${version} was not found.`);
  }

  return cloneCourseSnapshot(historicalVersion.snapshot);
}

async function loadCourseRunByAttemptId(
  env: Env,
  attemptId: string
): Promise<CourseRunRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        course_id,
        course_version,
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
      FROM course_runs
      WHERE attempt_id = ?
      LIMIT 1
    `
  )
    .bind(attemptId)
    .first<CourseRunRow>();

  return row ? mapCourseRunRow(row) : null;
}

interface RankedCourseLeaderboardRow {
  attempt_id: string;
  course_version: number;
  user_id: string;
  user_display_name: string;
  elapsed_ms: number;
  deaths: number;
  score: number;
  finished_at: string;
  overall_rank: number | string | null;
}

function getCourseLeaderboardSqlOrderClause(goal: CourseGoal): string {
  return getCourseLeaderboardRankingMode(goal) === 'time'
    ? 'elapsed_ms ASC, deaths ASC, score DESC, finished_at ASC, attempt_id ASC'
    : 'score DESC, elapsed_ms ASC, deaths ASC, finished_at ASC, attempt_id ASC';
}

function buildRankedCourseLeaderboardCte(goal: CourseGoal): string {
  const orderClause = getCourseLeaderboardSqlOrderClause(goal);
  return `
    WITH candidate_runs AS (
      SELECT
        attempt_id,
        course_version,
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
      FROM course_runs
      WHERE course_id = ?
        AND course_version = ?
        AND result = 'completed'
        AND elapsed_ms IS NOT NULL
        AND finished_at IS NOT NULL
        AND ${sqlUserIdIsNotPlayfunOnly('course_runs.user_id')}
    ),
    best_runs AS (
      SELECT
        attempt_id,
        course_version,
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
        course_version,
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

async function loadRankedCourseLeaderboardRows(
  env: Env,
  courseId: string,
  courseVersion: number,
  goal: CourseGoal,
  limit: number
): Promise<RankedCourseLeaderboardRow[]> {
  if (limit <= 0) {
    return [];
  }

  const cte = buildRankedCourseLeaderboardCte(goal);
  const result = await env.DB.prepare(
    `
      ${cte}
      SELECT
        attempt_id,
        course_version,
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
    .bind(courseId, courseVersion, limit)
    .all<RankedCourseLeaderboardRow>();

  return result.results;
}

async function loadViewerRankedCourseLeaderboardRow(
  env: Env,
  courseId: string,
  courseVersion: number,
  goal: CourseGoal,
  viewerUserId: string
): Promise<RankedCourseLeaderboardRow | null> {
  const cte = buildRankedCourseLeaderboardCte(goal);
  const row = await env.DB.prepare(
    `
      ${cte}
      SELECT
        attempt_id,
        course_version,
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
    .bind(courseId, courseVersion, viewerUserId)
    .first<RankedCourseLeaderboardRow>();

  return row ?? null;
}

function mapRankedCourseLeaderboardEntry(
  row: RankedCourseLeaderboardRow,
  snapshot: CourseSnapshot
): CourseLeaderboardEntry {
  return {
    rank: Number(row.overall_rank),
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    attemptId: row.attempt_id,
    courseId: snapshot.id,
    courseVersion: row.course_version,
    goalType: snapshot.goal!.type,
    elapsedMs: row.elapsed_ms,
    deaths: row.deaths,
    score: row.score,
    finishedAt: row.finished_at,
  };
}

function mapCourseRunRow(row: CourseRunRow): CourseRunRecord {
  const goal = parseStoredCourseGoal(row.goal_json, 'course run goal');
  return {
    attemptId: row.attempt_id,
    courseId: row.course_id,
    courseVersion: row.course_version,
    goalType: goal.type,
    goal,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result as RunResult,
    elapsedMs: row.elapsed_ms,
    deaths: row.deaths,
    score: row.score,
    collectiblesCollected: row.collectibles_collected,
    enemiesDefeated: row.enemies_defeated,
    checkpointsReached: row.checkpoints_reached,
  };
}

function parseStoredCourseGoal(raw: string, label: string) {
  try {
    const parsed = normalizeCourseGoal(JSON.parse(raw));
    if (!parsed) {
      throw new Error('Invalid goal.');
    }
    return parsed;
  } catch {
    throw new HttpError(500, `Failed to parse ${label}.`);
  }
}

async function buildCourseLeaderboardResponse(
  env: Env,
  snapshot: CourseSnapshot,
  limit: number,
  viewerUserId: string | null = null
): Promise<CourseLeaderboardResponse> {
  if (!snapshot.goal) {
    throw new HttpError(404, 'This course version does not have a leaderboard goal.');
  }

  const entryRows = await loadRankedCourseLeaderboardRows(
    env,
    snapshot.id,
    snapshot.version,
    snapshot.goal,
    limit
  );
  const viewerBestRow =
    viewerUserId === null
      ? null
      : await loadViewerRankedCourseLeaderboardRow(
          env,
          snapshot.id,
          snapshot.version,
          snapshot.goal,
          viewerUserId
        );
  const entries = entryRows.map((row) => mapRankedCourseLeaderboardEntry(row, snapshot));
  const viewerBest =
    viewerBestRow === null ? null : mapRankedCourseLeaderboardEntry(viewerBestRow, snapshot);

  return {
    courseId: snapshot.id,
    courseTitle: snapshot.title,
    courseVersion: snapshot.version,
    goalType: snapshot.goal.type,
    rankingMode: getCourseLeaderboardRankingMode(snapshot.goal),
    entries,
    viewerBest,
    viewerRank: viewerBest?.rank ?? null,
  };
}

async function loadBestCompletedCourseRunForUserAndVersion(
  env: Env,
  userId: string,
  courseId: string,
  courseVersion: number,
  excludeAttemptId: string | null
): Promise<CourseRunRecord | null> {
  const result = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        course_id,
        course_version,
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
      FROM course_runs
      WHERE user_id = ?
        AND course_id = ?
        AND course_version = ?
        AND result = 'completed'
        AND (? IS NULL OR attempt_id != ?)
    `
  )
    .bind(userId, courseId, courseVersion, excludeAttemptId, excludeAttemptId)
    .all<CourseRunRow>();

  const runs = result.results
    .filter(
      (row): row is CourseRunRow & { elapsed_ms: number; finished_at: string } =>
        typeof row.elapsed_ms === 'number' && typeof row.finished_at === 'string'
    )
    .map(mapCourseRunRow);

  if (runs.length === 0) {
    return null;
  }

  const course = await resolvePublishedCourseVersion(env, courseId, courseVersion);
  if (!course.goal) {
    return null;
  }
  return sortCompletedCourseRunsForLeaderboard(runs, course.goal)[0] ?? null;
}

async function resolvePublishedCourseOwnerUserId(
  env: Env,
  courseId: string
): Promise<string | null> {
  const row = await env.DB.prepare(
    `
      SELECT owner_user_id
      FROM courses
      WHERE id = ?
        AND published_json IS NOT NULL
      LIMIT 1
    `
  )
    .bind(courseId)
    .first<{ owner_user_id: string | null }>();

  return row?.owner_user_id ?? null;
}

async function maybeMirrorAuthenticatedPointEventToPlayfun(
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
    console.warn('Failed to mirror course point event to Play.fun', { userId, pointEventId: pointEvent.id, error });
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
    console.warn('Failed to mirror linked course Play.fun point event', {
      userId,
      pointEventId: pointEvent.id,
      error,
    });
  }
}
