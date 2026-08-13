import type {
  SuspiciousPointEventRecord,
  SuspiciousRunCase,
  SuspiciousSeverity,
  SuspiciousSignalCode,
  SuspiciousSummaryResponse,
  SuspiciousUserCase,
  SuspiciousUserDetailResponse,
  SuspiciousUsersResponse,
} from '../../../admin/model';
import { normalizeCourseGoal, type CourseGoal } from '../../../courses/model';
import { getCourseLeaderboardRankingMode } from '../../../courses/scoring';
import { normalizeRoomGoal, type RoomGoal } from '../../../goals/roomGoals';
import type { UserStatsRecord } from '../../../runs/model';
import { getLeaderboardRankingMode } from '../../../runs/scoring';
import { requireAdminRequest } from '../auth/request';
import { HttpError, jsonResponse, parsePositiveIntegerQueryParam } from '../core/http';
import type {
  CourseRunRow,
  Env,
  PointEventRow,
  RoomRunRow,
  UserRow,
  UserStatsRow,
} from '../core/types';
import { isExpandedRoomSchemaMissingError } from '../expandedRooms/schemaErrors';
import { LEGACY_GENERATED_USER_LINKS_TABLE } from '../generatedUsers/legacySource';
import { mapUserStatsRow } from '../runs/points';
import { loadRecentInvalidations } from './suspiciousInvalidation';
import {
  SIGNAL_LABELS,
  applyNewAccountSpikeSignals,
  applyPointBurstSignals,
  applyRepeatSignals,
  applyRunBurstSignals,
  applyTooFastSignals,
  buildSuspiciousUserCaseFromAccumulator,
  classifySuspiciousUserIdentity,
  compareRunCases,
  compareSignals,
  compareUserCases,
  getOrCreateAccumulator,
  markRecordGapCourseRuns,
  markRecordGapRoomRuns,
  maxIso,
  mergeFlaggedRunsIntoHistory,
  type CombinedRunBase,
  type HistoricalComparableRun,
  type UserAccumulator,
} from './suspiciousModel';

export {
  handleAdminSuspiciousInvalidate,
  handleAdminSuspiciousInvalidatePreview,
} from './suspiciousInvalidation';

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 7;
const DEFAULT_USER_LIMIT = 50;
const MAX_USER_LIMIT = 200;
const MAX_RECENT_RUNS = 5_000;
const MAX_RECENT_POINT_EVENTS = 5_000;
const MAX_PLAYER_HISTORY_POINT_EVENTS = 100;
const RUN_BURST_5M_THRESHOLD = 10;
const RUN_BURST_5M_HIGH_THRESHOLD = 20;
const RUN_BURST_60M_THRESHOLD = 30;
const RUN_BURST_60M_HIGH_THRESHOLD = 60;

interface JoinedRoomRunRow extends RoomRunRow {
  title: string | null;
  user_created_at: string;
  email: string | null;
  wallet_address: string | null;
  ogp_id: string | null;
  player_id: string | null;
  run_finalized_point_event_id: string | null;
  run_finalized_points: number | string | null;
  run_finalized_point_created_at: string | null;
}

interface JoinedCourseRunRow extends CourseRunRow {
  title: string | null;
  user_created_at: string;
  email: string | null;
  wallet_address: string | null;
  ogp_id: string | null;
  player_id: string | null;
  run_finalized_point_event_id: string | null;
  run_finalized_points: number | string | null;
  run_finalized_point_created_at: string | null;
}

interface JoinedPointEventRow extends PointEventRow {
  user_display_name: string;
  user_created_at: string;
  email: string | null;
  wallet_address: string | null;
  ogp_id: string | null;
  player_id: string | null;
}

interface SuspiciousUserSearchRow extends Pick<UserRow, 'id' | 'email' | 'wallet_address' | 'display_name' | 'created_at'> {
  ogp_id: string | null;
  player_id: string | null;
  total_points: number | string | null;
  completed_runs: number | string | null;
  last_activity_at: string | null;
}

interface SuspiciousAnalysis {
  generatedAt: string;
  windowHours: number;
  items: SuspiciousUserCase[];
  byUserId: Map<string, SuspiciousUserCase>;
  roomRunsByUserId: Map<string, SuspiciousRunCase[]>;
  courseRunsByUserId: Map<string, SuspiciousRunCase[]>;
  recentPointEventsByUserId: Map<string, SuspiciousPointEventRecord[]>;
}

export async function handleAdminSuspiciousSummary(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  requireAdminRequest(env, request, 'read suspicious activity summary');
  const windowHours = parseWindowHours(url);
  const analysis = await loadSuspiciousAnalysis(env, windowHours);
  const recentInvalidations = await loadRecentInvalidations(env);
  const counts = { openCases: analysis.items.length, high: 0, medium: 0, low: 0 };

  for (const item of analysis.items) {
    counts[item.strongestSeverity] += 1;
  }

  const response: SuspiciousSummaryResponse = {
    generatedAt: analysis.generatedAt,
    windowHours,
    counts,
    recentInvalidations,
  };
  return jsonResponse(request, response);
}

export async function handleAdminSuspiciousUsers(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  requireAdminRequest(env, request, 'read suspicious activity users');
  const windowHours = parseWindowHours(url);
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', DEFAULT_USER_LIMIT, 1, MAX_USER_LIMIT);
  const severity = parseSeverityFilter(url.searchParams.get('severity'));
  const signal = parseSignalFilter(url.searchParams.get('signal'));
  const search = normalizeSearch(url.searchParams.get('q'));
  const analysis = await loadSuspiciousAnalysis(env, windowHours);

  if (search) {
    const items = await searchSuspiciousUsers(env, analysis, search, limit);
    const response: SuspiciousUsersResponse = {
      generatedAt: analysis.generatedAt,
      windowHours,
      scope: 'player_history_search',
      total: items.length,
      items,
    };
    return jsonResponse(request, response);
  }

  const filtered = analysis.items.filter((item) => {
    if (severity && item.strongestSeverity !== severity) {
      return false;
    }
    if (signal && !item.signalCodes.includes(signal)) {
      return false;
    }
    return true;
  });

  const response: SuspiciousUsersResponse = {
    generatedAt: analysis.generatedAt,
    windowHours,
    scope: 'review_window',
    total: filtered.length,
    items: filtered.slice(0, limit),
  };
  return jsonResponse(request, response);
}

export async function handleAdminSuspiciousUserDetail(
  request: Request,
  url: URL,
  env: Env,
  userId: string
): Promise<Response> {
  requireAdminRequest(env, request, `read suspicious activity for ${userId}`);
  const windowHours = parseWindowHours(url);
  const detailScope = parseDetailScope(url);
  const analysis = await loadSuspiciousAnalysis(env, windowHours);

  if (detailScope === 'player_history') {
    const user = await loadPlayerHistoryUser(env, analysis, userId);
    const [roomRuns, courseRuns, recentPointEvents, recentInvalidations] = await Promise.all([
      loadPlayerHistoryRoomRuns(env, userId, analysis.roomRunsByUserId.get(userId) ?? []),
      loadPlayerHistoryCourseRuns(env, userId, analysis.courseRunsByUserId.get(userId) ?? []),
      loadRecentPointEventsForUser(env, userId),
      loadRecentInvalidations(env, userId),
    ]);

    const response: SuspiciousUserDetailResponse = {
      generatedAt: analysis.generatedAt,
      windowHours,
      scope: 'player_history',
      user,
      roomRuns,
      courseRuns,
      recentPointEvents,
      recentInvalidations,
    };
    return jsonResponse(request, response);
  }

  const user = analysis.byUserId.get(userId);
  if (!user) {
    throw new HttpError(404, 'Suspicious user not found in the selected review window.');
  }

  const response: SuspiciousUserDetailResponse = {
    generatedAt: analysis.generatedAt,
    windowHours,
    scope: 'review_window',
    user,
    roomRuns: analysis.roomRunsByUserId.get(userId) ?? [],
    courseRuns: analysis.courseRunsByUserId.get(userId) ?? [],
    recentPointEvents: analysis.recentPointEventsByUserId.get(userId) ?? [],
    recentInvalidations: await loadRecentInvalidations(env, userId),
  };
  return jsonResponse(request, response);
}

async function loadSuspiciousAnalysis(
  env: Env,
  windowHours: number
): Promise<SuspiciousAnalysis> {
  const generatedAt = new Date().toISOString();
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1_000).toISOString();
  const [roomRuns, courseRuns, pointEvents] = await Promise.all([
    loadRecentCompletedRoomRuns(env, sinceIso),
    loadRecentCompletedCourseRuns(env, sinceIso),
    loadRecentPositivePointEvents(env, sinceIso),
  ]);

  const userIds = new Set<string>();
  for (const run of roomRuns) {
    userIds.add(run.user_id);
  }
  for (const run of courseRuns) {
    userIds.add(run.user_id);
  }
  for (const event of pointEvents) {
    userIds.add(event.user_id);
  }

  const userStatsById = await loadUserStatsByUserIds(env, [...userIds]);
  const recentPointEventsByUserId = new Map<string, SuspiciousPointEventRecord[]>();
  const accumulators = new Map<string, UserAccumulator>();
  const combinedRunsByUser = new Map<string, CombinedRunBase[]>();
  const roomRunLookup = new Map<string, CombinedRunBase>();
  const courseRunLookup = new Map<string, CombinedRunBase>();

  for (const row of pointEvents) {
    const accumulator = getOrCreateAccumulator(accumulators, row.user_id, {
      userDisplayName: row.user_display_name,
      userCreatedAt: row.user_created_at,
      email: row.email,
      walletAddress: row.wallet_address,
      ogpId: row.ogp_id,
      playerId: row.player_id,
      stats: userStatsById.get(row.user_id) ?? null,
    });
    accumulator.recentPoints += Math.max(0, Number(row.points ?? 0));
    accumulator.lastActivityAt = maxIso(accumulator.lastActivityAt, row.created_at);

    const list = recentPointEventsByUserId.get(row.user_id) ?? [];
    if (list.length < 25) {
      list.push({
        id: row.id,
        eventType: row.event_type,
        sourceKey: row.source_key,
        points: Math.max(0, Number(row.points ?? 0)),
        createdAt: row.created_at,
      });
      recentPointEventsByUserId.set(row.user_id, list);
    }
  }

  for (const row of roomRuns) {
    const goal = normalizeRoomGoal(parseJsonSafely(row.goal_json));
    if (!goal || typeof row.finished_at !== 'string' || typeof row.elapsed_ms !== 'number') {
      continue;
    }

    const run: CombinedRunBase = {
      kind: 'room',
      attemptId: row.attempt_id,
      userId: row.user_id,
      userDisplayName: row.user_display_name,
      userCreatedAt: row.user_created_at,
      email: row.email,
      walletAddress: row.wallet_address,
      ogpId: row.ogp_id,
      playerId: row.player_id,
      sourceId: row.room_id,
      title: row.title,
      version: row.room_version,
      roomX: row.room_x,
      roomY: row.room_y,
      goalType: row.goal_type,
      rankingMode: getLeaderboardRankingMode(goal),
      goal,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      elapsedMs: row.elapsed_ms,
      deaths: row.deaths,
      score: row.score,
      runFinalizedPoints: parseNullableNumber(row.run_finalized_points),
      runFinalizedPointEventId: row.run_finalized_point_event_id,
      runFinalizedPointCreatedAt: row.run_finalized_point_created_at,
    };
    roomRunLookup.set(run.attemptId, run);
    const accumulator = getOrCreateAccumulator(accumulators, run.userId, {
      userDisplayName: run.userDisplayName,
      userCreatedAt: run.userCreatedAt,
      email: run.email,
      walletAddress: run.walletAddress,
      ogpId: run.ogpId,
      playerId: run.playerId,
      stats: userStatsById.get(run.userId) ?? null,
    });
    accumulator.recentCompletedRuns += 1;
    accumulator.lastActivityAt = maxIso(accumulator.lastActivityAt, run.finishedAt);
    const list = combinedRunsByUser.get(run.userId) ?? [];
    list.push(run);
    combinedRunsByUser.set(run.userId, list);
  }

  for (const row of courseRuns) {
    const goal = normalizeCourseGoal(parseJsonSafely(row.goal_json));
    if (!goal || typeof row.finished_at !== 'string' || typeof row.elapsed_ms !== 'number') {
      continue;
    }

    const run: CombinedRunBase = {
      kind: 'course',
      attemptId: row.attempt_id,
      userId: row.user_id,
      userDisplayName: row.user_display_name,
      userCreatedAt: row.user_created_at,
      email: row.email,
      walletAddress: row.wallet_address,
      ogpId: row.ogp_id,
      playerId: row.player_id,
      sourceId: row.course_id,
      title: row.title,
      version: row.course_version,
      roomX: null,
      roomY: null,
      goalType: row.goal_type,
      rankingMode: getCourseLeaderboardRankingMode(goal),
      goal,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      elapsedMs: row.elapsed_ms,
      deaths: row.deaths,
      score: row.score,
      runFinalizedPoints: parseNullableNumber(row.run_finalized_points),
      runFinalizedPointEventId: row.run_finalized_point_event_id,
      runFinalizedPointCreatedAt: row.run_finalized_point_created_at,
    };
    courseRunLookup.set(run.attemptId, run);
    const accumulator = getOrCreateAccumulator(accumulators, run.userId, {
      userDisplayName: run.userDisplayName,
      userCreatedAt: run.userCreatedAt,
      email: run.email,
      walletAddress: run.walletAddress,
      ogpId: run.ogpId,
      playerId: run.playerId,
      stats: userStatsById.get(run.userId) ?? null,
    });
    accumulator.recentCompletedRuns += 1;
    accumulator.lastActivityAt = maxIso(accumulator.lastActivityAt, run.finishedAt);
    const list = combinedRunsByUser.get(run.userId) ?? [];
    list.push(run);
    combinedRunsByUser.set(run.userId, list);
  }

  applyTooFastSignals(accumulators, roomRunLookup, courseRunLookup);
  await applyRecordGapSignals(env, accumulators, roomRunLookup, courseRunLookup);
  applyRunBurstSignals(accumulators, combinedRunsByUser, 5 * 60 * 1_000, RUN_BURST_5M_THRESHOLD, RUN_BURST_5M_HIGH_THRESHOLD, 'run_burst_5m');
  applyRunBurstSignals(accumulators, combinedRunsByUser, 60 * 60 * 1_000, RUN_BURST_60M_THRESHOLD, RUN_BURST_60M_HIGH_THRESHOLD, 'run_burst_60m');
  applyRepeatSignals(accumulators, combinedRunsByUser);
  applyPointBurstSignals(accumulators, pointEvents);
  applyNewAccountSpikeSignals(accumulators, Date.now());

  const items: SuspiciousUserCase[] = [];
  const byUserId = new Map<string, SuspiciousUserCase>();
  const roomRunsByUserId = new Map<string, SuspiciousRunCase[]>();
  const courseRunsByUserId = new Map<string, SuspiciousRunCase[]>();

  for (const accumulator of accumulators.values()) {
    const signals = [...accumulator.signals.values()].sort(compareSignals);
    if (signals.length === 0) {
      continue;
    }
    const userCase = buildSuspiciousUserCaseFromAccumulator(accumulator);

    const suspiciousRoomRuns = [...accumulator.roomRuns.values()].sort(compareRunCases);
    const suspiciousCourseRuns = [...accumulator.courseRuns.values()].sort(compareRunCases);

    items.push(userCase);
    byUserId.set(userCase.userId, userCase);
    roomRunsByUserId.set(userCase.userId, suspiciousRoomRuns);
    courseRunsByUserId.set(userCase.userId, suspiciousCourseRuns);
  }

  items.sort(compareUserCases);

  return {
    generatedAt,
    windowHours,
    items,
    byUserId,
    roomRunsByUserId,
    courseRunsByUserId,
    recentPointEventsByUserId,
  };
}

async function searchSuspiciousUsers(
  env: Env,
  analysis: SuspiciousAnalysis,
  search: string,
  limit: number
): Promise<SuspiciousUserCase[]> {
  const rows = await loadSuspiciousUserSearchRows(env, search, limit);
  return rows.map((row) => analysis.byUserId.get(row.id) ?? buildUnsuspiciousUserCase(row));
}

async function loadPlayerHistoryUser(
  env: Env,
  analysis: SuspiciousAnalysis,
  userId: string
): Promise<SuspiciousUserCase> {
  const windowUser = analysis.byUserId.get(userId);
  if (windowUser) {
    return windowUser;
  }

  const row = await loadSuspiciousUserSearchRowById(env, userId);
  if (!row) {
    throw new HttpError(404, 'User not found.');
  }
  return buildUnsuspiciousUserCase(row);
}

async function applyRecordGapSignals(
  env: Env,
  accumulators: Map<string, UserAccumulator>,
  roomRunLookup: Map<string, CombinedRunBase>,
  courseRunLookup: Map<string, CombinedRunBase>
): Promise<void> {
  const roomGroups = new Map<string, CombinedRunBase[]>();
  for (const run of roomRunLookup.values()) {
    if (run.rankingMode !== 'time') {
      continue;
    }
    const key = `${run.sourceId}:${run.version}`;
    const list = roomGroups.get(key) ?? [];
    list.push(run);
    roomGroups.set(key, list);
  }

  for (const runs of roomGroups.values()) {
    const sample = runs[0];
    const historical = await loadHistoricalRoomRunsForVersion(env, sample.sourceId, sample.version);
    markRecordGapRoomRuns(accumulators, runs, historical, sample.goal as RoomGoal);
  }

  const courseGroups = new Map<string, CombinedRunBase[]>();
  for (const run of courseRunLookup.values()) {
    if (run.rankingMode !== 'time') {
      continue;
    }
    const key = `${run.sourceId}:${run.version}`;
    const list = courseGroups.get(key) ?? [];
    list.push(run);
    courseGroups.set(key, list);
  }

  for (const runs of courseGroups.values()) {
    const sample = runs[0];
    const historical = await loadHistoricalCourseRunsForVersion(env, sample.sourceId, sample.version);
    markRecordGapCourseRuns(accumulators, runs, historical, sample.goal as CourseGoal);
  }
}

async function loadRecentCompletedRoomRuns(
  env: Env,
  sinceIso: string
): Promise<JoinedRoomRunRow[]> {
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
        r.collectibles_collected,
        r.enemies_defeated,
        r.checkpoints_reached,
        v.title AS title,
        u.created_at AS user_created_at,
        u.email,
        u.wallet_address,
        l.ogp_id,
        l.player_id,
        p.id AS run_finalized_point_event_id,
        p.points AS run_finalized_points,
        p.created_at AS run_finalized_point_created_at
      FROM room_runs r
      INNER JOIN users u
        ON u.id = r.user_id
      LEFT JOIN room_versions v
        ON v.room_id = r.room_id
       AND v.version = r.room_version
      LEFT JOIN ${LEGACY_GENERATED_USER_LINKS_TABLE} l
        ON l.user_id = r.user_id
      LEFT JOIN point_events p
        ON p.user_id = r.user_id
       AND p.event_type = 'run_finalized'
       AND p.source_key = r.attempt_id
      WHERE r.result = 'completed'
        AND r.finished_at IS NOT NULL
        AND r.finished_at >= ?
      ORDER BY r.finished_at DESC
      LIMIT ?
    `
  )
    .bind(sinceIso, MAX_RECENT_RUNS)
    .all<JoinedRoomRunRow>();

  return result.results;
}

async function loadRecentCompletedCourseRuns(
  env: Env,
  sinceIso: string
): Promise<JoinedCourseRunRow[]> {
  try {
    const result = await env.DB.prepare(
      `
        SELECT *
        FROM (
          SELECT
            r.attempt_id,
            r.expanded_room_id AS course_id,
            r.expanded_room_version AS course_version,
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
            r.collectibles_collected,
            r.enemies_defeated,
            r.checkpoints_reached,
            v.title AS title,
            u.created_at AS user_created_at,
            u.email,
            u.wallet_address,
            l.ogp_id,
            l.player_id,
            p.id AS run_finalized_point_event_id,
            p.points AS run_finalized_points,
            p.created_at AS run_finalized_point_created_at
          FROM expanded_room_runs r
          INNER JOIN users u
            ON u.id = r.user_id
          LEFT JOIN expanded_room_versions v
            ON v.expanded_room_id = r.expanded_room_id
           AND v.version = r.expanded_room_version
          LEFT JOIN ${LEGACY_GENERATED_USER_LINKS_TABLE} l
            ON l.user_id = r.user_id
          LEFT JOIN point_events p
            ON p.user_id = r.user_id
           AND p.event_type = 'run_finalized'
           AND p.source_key = r.attempt_id
          WHERE r.result = 'completed'
            AND r.finished_at IS NOT NULL
            AND r.finished_at >= ?

          UNION ALL

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
            r.collectibles_collected,
            r.enemies_defeated,
            r.checkpoints_reached,
            v.title AS title,
            u.created_at AS user_created_at,
            u.email,
            u.wallet_address,
            l.ogp_id,
            l.player_id,
            p.id AS run_finalized_point_event_id,
            p.points AS run_finalized_points,
            p.created_at AS run_finalized_point_created_at
          FROM course_runs r
          INNER JOIN users u
            ON u.id = r.user_id
          LEFT JOIN course_versions v
            ON v.course_id = r.course_id
           AND v.version = r.course_version
          LEFT JOIN ${LEGACY_GENERATED_USER_LINKS_TABLE} l
            ON l.user_id = r.user_id
          LEFT JOIN point_events p
            ON p.user_id = r.user_id
           AND p.event_type = 'run_finalized'
           AND p.source_key = r.attempt_id
          WHERE r.result = 'completed'
            AND r.finished_at IS NOT NULL
            AND r.finished_at >= ?
            AND NOT EXISTS (
              SELECT 1
              FROM expanded_room_runs expanded
              WHERE expanded.legacy_course_attempt_id = r.attempt_id
                 OR expanded.attempt_id = r.attempt_id
            )
        )
        ORDER BY finished_at DESC
        LIMIT ?
      `
    )
      .bind(sinceIso, sinceIso, MAX_RECENT_RUNS)
      .all<JoinedCourseRunRow>();

    return result.results;
  } catch (error) {
    if (!isExpandedRoomSchemaMissingError(error)) {
      throw error;
    }
    return loadRecentCompletedLegacyCourseRuns(env, sinceIso);
  }
}

async function loadRecentCompletedLegacyCourseRuns(
  env: Env,
  sinceIso: string
): Promise<JoinedCourseRunRow[]> {
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
        r.collectibles_collected,
        r.enemies_defeated,
        r.checkpoints_reached,
        v.title AS title,
        u.created_at AS user_created_at,
        u.email,
        u.wallet_address,
        l.ogp_id,
        l.player_id,
        p.id AS run_finalized_point_event_id,
        p.points AS run_finalized_points,
        p.created_at AS run_finalized_point_created_at
      FROM course_runs r
      INNER JOIN users u
        ON u.id = r.user_id
      LEFT JOIN course_versions v
        ON v.course_id = r.course_id
       AND v.version = r.course_version
      LEFT JOIN ${LEGACY_GENERATED_USER_LINKS_TABLE} l
        ON l.user_id = r.user_id
      LEFT JOIN point_events p
        ON p.user_id = r.user_id
       AND p.event_type = 'run_finalized'
       AND p.source_key = r.attempt_id
      WHERE r.result = 'completed'
        AND r.finished_at IS NOT NULL
        AND r.finished_at >= ?
      ORDER BY r.finished_at DESC
      LIMIT ?
    `
  )
    .bind(sinceIso, MAX_RECENT_RUNS)
    .all<JoinedCourseRunRow>();

  return result.results;
}

async function loadRecentPositivePointEvents(
  env: Env,
  sinceIso: string
): Promise<JoinedPointEventRow[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        e.id,
        e.user_id,
        e.event_type,
        e.source_key,
        e.points,
        e.breakdown_json,
        e.created_at,
        u.display_name AS user_display_name,
        u.created_at AS user_created_at,
        u.email,
        u.wallet_address,
        l.ogp_id,
        l.player_id
      FROM point_events e
      INNER JOIN users u
        ON u.id = e.user_id
      LEFT JOIN ${LEGACY_GENERATED_USER_LINKS_TABLE} l
        ON l.user_id = e.user_id
      WHERE e.points > 0
        AND e.created_at >= ?
      ORDER BY e.created_at DESC
      LIMIT ?
    `
  )
    .bind(sinceIso, MAX_RECENT_POINT_EVENTS)
    .all<JoinedPointEventRow>();

  return result.results;
}

async function loadRecentPointEventsForUser(
  env: Env,
  userId: string
): Promise<SuspiciousPointEventRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        id,
        user_id,
        event_type,
        source_key,
        points,
        breakdown_json,
        created_at,
        '' AS user_display_name,
        '' AS user_created_at,
        NULL AS email,
        NULL AS wallet_address,
        NULL AS ogp_id,
        NULL AS player_id
      FROM point_events
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `
  )
    .bind(userId, MAX_PLAYER_HISTORY_POINT_EVENTS)
    .all<JoinedPointEventRow>();

  return result.results.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    sourceKey: row.source_key,
    points: Number(row.points ?? 0),
    createdAt: row.created_at,
  }));
}

async function loadSuspiciousUserSearchRows(
  env: Env,
  search: string,
  limit: number
): Promise<SuspiciousUserSearchRow[]> {
  const like = `%${search}%`;
  const rows = await env.DB.prepare(
    `
      SELECT
        u.id,
        u.email,
        u.wallet_address,
        u.display_name,
        u.created_at,
        l.ogp_id,
        l.player_id,
        s.total_points,
        s.completed_runs,
        (
          SELECT MAX(at)
          FROM (
            SELECT MAX(COALESCE(room_runs.finished_at, room_runs.started_at)) AS at
            FROM room_runs
            WHERE room_runs.user_id = u.id
            UNION ALL
            SELECT MAX(COALESCE(course_runs.finished_at, course_runs.started_at)) AS at
            FROM course_runs
            WHERE course_runs.user_id = u.id
            UNION ALL
            SELECT MAX(point_events.created_at) AS at
            FROM point_events
            WHERE point_events.user_id = u.id
          )
        ) AS last_activity_at
      FROM users u
      LEFT JOIN ${LEGACY_GENERATED_USER_LINKS_TABLE} l
        ON l.user_id = u.id
      LEFT JOIN user_stats s
        ON s.user_id = u.id
      WHERE lower(u.id) = ?
         OR lower(u.display_name) = ?
         OR lower(COALESCE(u.email, '')) = ?
         OR lower(COALESCE(u.wallet_address, '')) = ?
         OR lower(COALESCE(l.ogp_id, '')) = ?
         OR lower(COALESCE(l.player_id, '')) = ?
         OR lower(u.id) LIKE ?
         OR lower(u.display_name) LIKE ?
         OR lower(COALESCE(u.email, '')) LIKE ?
         OR lower(COALESCE(u.wallet_address, '')) LIKE ?
         OR lower(COALESCE(l.ogp_id, '')) LIKE ?
         OR lower(COALESCE(l.player_id, '')) LIKE ?
      ORDER BY
        CASE
          WHEN lower(u.id) = ? THEN 0
          WHEN lower(u.display_name) = ? THEN 1
          WHEN lower(COALESCE(u.email, '')) = ? THEN 2
          WHEN lower(COALESCE(u.wallet_address, '')) = ? THEN 3
          WHEN lower(COALESCE(l.ogp_id, '')) = ? THEN 4
          WHEN lower(COALESCE(l.player_id, '')) = ? THEN 5
          ELSE 6
        END,
        last_activity_at DESC,
        u.created_at DESC
      LIMIT ?
    `
  )
    .bind(
      search,
      search,
      search,
      search,
      search,
      search,
      like,
      like,
      like,
      like,
      like,
      like,
      search,
      search,
      search,
      search,
      search,
      search,
      limit
    )
    .all<SuspiciousUserSearchRow>();

  return rows.results;
}

async function loadSuspiciousUserSearchRowById(
  env: Env,
  userId: string
): Promise<SuspiciousUserSearchRow | null> {
  const rows = await loadSuspiciousUserSearchRows(env, userId.trim().toLowerCase(), 1);
  const match = rows.find((row) => row.id === userId);
  if (match) {
    return match;
  }

  const result = await env.DB.prepare(
    `
      SELECT
        u.id,
        u.email,
        u.wallet_address,
        u.display_name,
        u.created_at,
        l.ogp_id,
        l.player_id,
        s.total_points,
        s.completed_runs,
        (
          SELECT MAX(at)
          FROM (
            SELECT MAX(COALESCE(room_runs.finished_at, room_runs.started_at)) AS at
            FROM room_runs
            WHERE room_runs.user_id = u.id
            UNION ALL
            SELECT MAX(COALESCE(course_runs.finished_at, course_runs.started_at)) AS at
            FROM course_runs
            WHERE course_runs.user_id = u.id
            UNION ALL
            SELECT MAX(point_events.created_at) AS at
            FROM point_events
            WHERE point_events.user_id = u.id
          )
        ) AS last_activity_at
      FROM users u
      LEFT JOIN ${LEGACY_GENERATED_USER_LINKS_TABLE} l
        ON l.user_id = u.id
      LEFT JOIN user_stats s
        ON s.user_id = u.id
      WHERE u.id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<SuspiciousUserSearchRow>();

  return result ?? null;
}

async function loadUserStatsByUserIds(
  env: Env,
  userIds: string[]
): Promise<Map<string, UserStatsRecord>> {
  const result = new Map<string, UserStatsRecord>();
  for (const chunk of chunkArray(userIds, 100)) {
    if (chunk.length === 0) {
      continue;
    }
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await env.DB.prepare(
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
        WHERE user_id IN (${placeholders})
      `
    )
      .bind(...chunk)
      .all<UserStatsRow>();
    for (const row of rows.results) {
      result.set(row.user_id, mapUserStatsRow(row));
    }
  }
  return result;
}

async function loadHistoricalRoomRunsForVersion(
  env: Env,
  roomId: string,
  roomVersion: number
): Promise<HistoricalComparableRun[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        started_at,
        finished_at,
        elapsed_ms,
        deaths,
        score
      FROM room_runs
      WHERE room_id = ?
        AND room_version = ?
        AND result = 'completed'
        AND finished_at IS NOT NULL
        AND elapsed_ms IS NOT NULL
      ORDER BY finished_at ASC
    `
  )
    .bind(roomId, roomVersion)
    .all<
      Pick<RoomRunRow, 'attempt_id' | 'started_at' | 'finished_at' | 'elapsed_ms' | 'deaths' | 'score'>
    >();

  return result.results
    .filter((row): row is typeof row & { finished_at: string; elapsed_ms: number } => typeof row.finished_at === 'string' && typeof row.elapsed_ms === 'number')
    .map((row) => ({
      attemptId: row.attempt_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      elapsedMs: row.elapsed_ms,
      deaths: row.deaths,
      score: row.score,
    }));
}

async function loadHistoricalCourseRunsForVersion(
  env: Env,
  courseId: string,
  courseVersion: number
): Promise<HistoricalComparableRun[]> {
  const legacyCourseId = getLegacyCourseIdFromCourseRunSource(courseId);
  let result;
  try {
    result = await env.DB.prepare(
      `
        SELECT *
        FROM (
          SELECT
            attempt_id,
            started_at,
            finished_at,
            elapsed_ms,
            deaths,
            score
          FROM expanded_room_runs
          WHERE expanded_room_id = ?
            AND expanded_room_version = ?
            AND result = 'completed'
            AND finished_at IS NOT NULL
            AND elapsed_ms IS NOT NULL

          UNION ALL

          SELECT
            attempt_id,
            started_at,
            finished_at,
            elapsed_ms,
            deaths,
            score
          FROM course_runs
          WHERE course_id = ?
            AND course_version = ?
            AND result = 'completed'
            AND finished_at IS NOT NULL
            AND elapsed_ms IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM expanded_room_runs expanded
              WHERE expanded.legacy_course_attempt_id = course_runs.attempt_id
                 OR expanded.attempt_id = course_runs.attempt_id
            )
        )
        ORDER BY finished_at ASC
      `
    )
      .bind(courseId, courseVersion, legacyCourseId, courseVersion)
      .all<
        Pick<CourseRunRow, 'attempt_id' | 'started_at' | 'finished_at' | 'elapsed_ms' | 'deaths' | 'score'>
      >();
  } catch (error) {
    if (!isExpandedRoomSchemaMissingError(error)) {
      throw error;
    }
    result = await env.DB.prepare(
      `
        SELECT
          attempt_id,
          started_at,
          finished_at,
          elapsed_ms,
          deaths,
          score
        FROM course_runs
        WHERE course_id = ?
          AND course_version = ?
          AND result = 'completed'
          AND finished_at IS NOT NULL
          AND elapsed_ms IS NOT NULL
        ORDER BY finished_at ASC
      `
    )
      .bind(legacyCourseId, courseVersion)
      .all<
        Pick<CourseRunRow, 'attempt_id' | 'started_at' | 'finished_at' | 'elapsed_ms' | 'deaths' | 'score'>
      >();
  }

  return result.results
    .filter((row): row is typeof row & { finished_at: string; elapsed_ms: number } => typeof row.finished_at === 'string' && typeof row.elapsed_ms === 'number')
    .map((row) => ({
      attemptId: row.attempt_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      elapsedMs: row.elapsed_ms,
      deaths: row.deaths,
      score: row.score,
    }));
}

function getLegacyCourseIdFromCourseRunSource(courseId: string): string {
  return courseId.startsWith('course:') ? courseId.slice('course:'.length) : courseId;
}

async function loadPlayerHistoryRoomRuns(
  env: Env,
  userId: string,
  flaggedRuns: SuspiciousRunCase[]
): Promise<SuspiciousRunCase[]> {
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
        v.title AS title,
        p.id AS run_finalized_point_event_id,
        p.points AS run_finalized_points,
        p.created_at AS run_finalized_point_created_at
      FROM room_runs r
      LEFT JOIN room_versions v
        ON v.room_id = r.room_id
       AND v.version = r.room_version
      LEFT JOIN point_events p
        ON p.user_id = r.user_id
       AND p.event_type = 'run_finalized'
       AND p.source_key = r.attempt_id
      WHERE r.user_id = ?
      ORDER BY COALESCE(r.finished_at, r.started_at) DESC, r.attempt_id DESC
    `
  )
    .bind(userId)
    .all<JoinedRoomRunRow>();

  const runs: SuspiciousRunCase[] = [];
  for (const row of result.results) {
    const goal = normalizeRoomGoal(parseJsonSafely(row.goal_json));
    if (!goal) {
      continue;
    }
    runs.push({
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
      runFinalizedPoints: parseNullableNumber(row.run_finalized_points),
      runFinalizedPointEventId: row.run_finalized_point_event_id,
      runFinalizedPointCreatedAt: row.run_finalized_point_created_at,
      severity: 'low',
      ruleCodes: [],
      previousBestElapsedMs: null,
      improvementMs: null,
      improvementRatio: null,
      repeatGroupCount: null,
    });
  }

  return mergeFlaggedRunsIntoHistory(runs, flaggedRuns);
}

async function loadPlayerHistoryCourseRuns(
  env: Env,
  userId: string,
  flaggedRuns: SuspiciousRunCase[]
): Promise<SuspiciousRunCase[]> {
  const result = await loadPlayerHistoryCourseRunRows(env, userId);

  const runs: SuspiciousRunCase[] = [];
  for (const row of result.results) {
    const goal = normalizeCourseGoal(parseJsonSafely(row.goal_json));
    if (!goal) {
      continue;
    }
    runs.push({
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
      runFinalizedPoints: parseNullableNumber(row.run_finalized_points),
      runFinalizedPointEventId: row.run_finalized_point_event_id,
      runFinalizedPointCreatedAt: row.run_finalized_point_created_at,
      severity: 'low',
      ruleCodes: [],
      previousBestElapsedMs: null,
      improvementMs: null,
      improvementRatio: null,
      repeatGroupCount: null,
    });
  }

  return mergeFlaggedRunsIntoHistory(runs, flaggedRuns);
}

async function loadPlayerHistoryCourseRunRows(
  env: Env,
  userId: string,
): Promise<{ results: JoinedCourseRunRow[] }> {
  try {
    const result = await env.DB.prepare(
      `
        SELECT *
        FROM (
          SELECT
            r.attempt_id,
            r.expanded_room_id AS course_id,
            r.expanded_room_version AS course_version,
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
            r.collectibles_collected,
            r.enemies_defeated,
            r.checkpoints_reached,
            v.title AS title,
            p.id AS run_finalized_point_event_id,
            p.points AS run_finalized_points,
            p.created_at AS run_finalized_point_created_at
          FROM expanded_room_runs r
          LEFT JOIN expanded_room_versions v
            ON v.expanded_room_id = r.expanded_room_id
           AND v.version = r.expanded_room_version
          LEFT JOIN point_events p
            ON p.user_id = r.user_id
           AND p.event_type = 'run_finalized'
           AND p.source_key = r.attempt_id
          WHERE r.user_id = ?

          UNION ALL

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
            r.collectibles_collected,
            r.enemies_defeated,
            r.checkpoints_reached,
            v.title AS title,
            p.id AS run_finalized_point_event_id,
            p.points AS run_finalized_points,
            p.created_at AS run_finalized_point_created_at
          FROM course_runs r
          LEFT JOIN course_versions v
            ON v.course_id = r.course_id
           AND v.version = r.course_version
          LEFT JOIN point_events p
            ON p.user_id = r.user_id
           AND p.event_type = 'run_finalized'
           AND p.source_key = r.attempt_id
          WHERE r.user_id = ?
            AND NOT EXISTS (
              SELECT 1
              FROM expanded_room_runs expanded
              WHERE expanded.legacy_course_attempt_id = r.attempt_id
                 OR expanded.attempt_id = r.attempt_id
            )
        )
        ORDER BY COALESCE(finished_at, started_at) DESC, attempt_id DESC
      `
    )
      .bind(userId, userId)
      .all<JoinedCourseRunRow>();
    return { results: result.results };
  } catch (error) {
    if (!isExpandedRoomSchemaMissingError(error)) {
      throw error;
    }
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
          r.collectibles_collected,
          r.enemies_defeated,
          r.checkpoints_reached,
          v.title AS title,
          p.id AS run_finalized_point_event_id,
          p.points AS run_finalized_points,
          p.created_at AS run_finalized_point_created_at
        FROM course_runs r
        LEFT JOIN course_versions v
          ON v.course_id = r.course_id
         AND v.version = r.course_version
        LEFT JOIN point_events p
          ON p.user_id = r.user_id
         AND p.event_type = 'run_finalized'
         AND p.source_key = r.attempt_id
        WHERE r.user_id = ?
        ORDER BY COALESCE(r.finished_at, r.started_at) DESC, r.attempt_id DESC
      `
    )
      .bind(userId)
      .all<JoinedCourseRunRow>();
    return { results: result.results };
  }
}

function buildUnsuspiciousUserCase(row: SuspiciousUserSearchRow): SuspiciousUserCase {
  const accumulator: UserAccumulator = {
    userId: row.id,
    userDisplayName: row.display_name,
    userCreatedAt: row.created_at,
    email: row.email,
    walletAddress: row.wallet_address,
    ogpId: row.ogp_id,
    playerId: row.player_id,
    totalPoints: parseNullableNumber(row.total_points) ?? 0,
    completedRuns: parseNullableNumber(row.completed_runs) ?? 0,
    recentPoints: 0,
    recentCompletedRuns: 0,
    lastActivityAt: row.last_activity_at,
    signals: new Map(),
    roomRuns: new Map(),
    courseRuns: new Map(),
  };

  return {
    userId: accumulator.userId,
    userDisplayName: accumulator.userDisplayName,
    userCreatedAt: accumulator.userCreatedAt,
    ogpId: accumulator.ogpId,
    playerId: accumulator.playerId,
    totalPoints: accumulator.totalPoints,
    completedRuns: accumulator.completedRuns,
    recentPoints: 0,
    recentCompletedRuns: 0,
    strongestSeverity: 'low',
    signalCodes: [],
    signals: [],
    identity: classifySuspiciousUserIdentity(accumulator),
    lastActivityAt: accumulator.lastActivityAt,
  };
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

function parseNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWindowHours(url: URL): number {
  return parsePositiveIntegerQueryParam(
    url.searchParams,
    'windowHours',
    DEFAULT_WINDOW_HOURS,
    1,
    MAX_WINDOW_HOURS
  );
}

function parseDetailScope(url: URL): 'review_window' | 'player_history' {
  const raw = (url.searchParams.get('history') ?? '').trim().toLowerCase();
  if (!raw) {
    return 'review_window';
  }
  if (raw === '1' || raw === 'true' || raw === 'all') {
    return 'player_history';
  }
  throw new HttpError(400, 'history must be one of: 1, true, all.');
}

function parseSeverityFilter(raw: string | null): SuspiciousSeverity | null {
  if (!raw || raw === 'all') {
    return null;
  }
  if (raw === 'high' || raw === 'medium' || raw === 'low') {
    return raw;
  }
  throw new HttpError(400, 'severity must be one of: all, high, medium, low.');
}

function parseSignalFilter(raw: string | null): SuspiciousSignalCode | null {
  if (!raw || raw === 'all') {
    return null;
  }
  if (raw in SIGNAL_LABELS) {
    return raw as SuspiciousSignalCode;
  }
  throw new HttpError(400, 'signal is invalid.');
}

function normalizeSearch(raw: string | null): string | null {
  const normalized = raw?.trim().toLowerCase() ?? '';
  return normalized ? normalized : null;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
