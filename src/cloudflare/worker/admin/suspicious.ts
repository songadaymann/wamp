import type {
  SuspiciousPointEventRecord,
  SuspiciousRunCase,
  SuspiciousSeverity,
  SuspiciousSignal,
  SuspiciousSignalCode,
  SuspiciousSummaryResponse,
  SuspiciousUserIdentity,
  SuspiciousUserCase,
  SuspiciousUserDetailResponse,
  SuspiciousUsersResponse,
} from '../../../admin/model';
import type { CourseGoal } from '../../../courses/model';
import { normalizeCourseGoal } from '../../../courses/model';
import {
  compareCourseLeaderboardEntries,
  getCourseLeaderboardRankingMode,
} from '../../../courses/scoring';
import type { RoomGoal } from '../../../goals/roomGoals';
import type { UserStatsRecord } from '../../../runs/model';
import { normalizeRoomGoal } from '../../../goals/roomGoals';
import {
  compareLeaderboardEntries,
  getLeaderboardRankingMode,
} from '../../../runs/scoring';
import { isHeuristicPlayfunCharacterDisplayName } from '../../../playfun/identity';
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
import { mapUserStatsRow } from '../runs/points';
import { loadRecentInvalidations } from './suspiciousInvalidation';

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

const TOO_FAST_ABSOLUTE_MS = 1_000;
const RECORD_GAP_MIN_IMPROVEMENT_MS = 3_000;
const RECORD_GAP_MIN_IMPROVEMENT_RATIO = 0.3;
const RUN_BURST_5M_THRESHOLD = 10;
const RUN_BURST_5M_HIGH_THRESHOLD = 20;
const RUN_BURST_60M_THRESHOLD = 30;
const RUN_BURST_60M_HIGH_THRESHOLD = 60;
const REPEAT_IDENTICAL_THRESHOLD = 4;
const REPEAT_IDENTICAL_WINDOW_MS = 15 * 60 * 1_000;
const POINT_BURST_5M_THRESHOLD = 500;
const POINT_BURST_5M_HIGH_THRESHOLD = 1_000;
const NEW_ACCOUNT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const NEW_ACCOUNT_POINTS_THRESHOLD = 1_000;
const NEW_ACCOUNT_COMPLETED_RUNS_THRESHOLD = 20;

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

interface CombinedRunBase {
  kind: 'room' | 'course';
  attemptId: string;
  userId: string;
  userDisplayName: string;
  userCreatedAt: string;
  email: string | null;
  walletAddress: string | null;
  ogpId: string | null;
  playerId: string | null;
  sourceId: string;
  title: string | null;
  version: number;
  roomX: number | null;
  roomY: number | null;
  goalType: string;
  rankingMode: 'time' | 'score';
  goal: RoomGoal | CourseGoal;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  deaths: number;
  score: number;
  runFinalizedPoints: number | null;
  runFinalizedPointEventId: string | null;
  runFinalizedPointCreatedAt: string | null;
}

interface HistoricalComparableRun {
  attemptId: string;
  finishedAt: string;
  startedAt: string;
  elapsedMs: number;
  deaths: number;
  score: number;
}

interface UserAccumulator {
  userId: string;
  userDisplayName: string;
  userCreatedAt: string;
  email: string | null;
  walletAddress: string | null;
  ogpId: string | null;
  playerId: string | null;
  totalPoints: number;
  completedRuns: number;
  recentPoints: number;
  recentCompletedRuns: number;
  lastActivityAt: string | null;
  signals: Map<SuspiciousSignalCode, SuspiciousSignal>;
  roomRuns: Map<string, SuspiciousRunCase>;
  courseRuns: Map<string, SuspiciousRunCase>;
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

const SIGNAL_LABELS: Record<SuspiciousSignalCode, string> = {
  record_gap: 'Record Gap',
  too_fast_absolute: 'Too Fast',
  run_burst_5m: 'Run Burst · 5m',
  run_burst_60m: 'Run Burst · 60m',
  repeat_identical: 'Repeated Identical Clears',
  point_burst_5m: 'Point Burst · 5m',
  new_account_spike: 'New Account Spike',
};

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
  applyNewAccountSpikeSignals(accumulators);

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

function applyTooFastSignals(
  accumulators: Map<string, UserAccumulator>,
  roomRunLookup: Map<string, CombinedRunBase>,
  courseRunLookup: Map<string, CombinedRunBase>
): void {
  const counts = new Map<string, number>();
  for (const run of [...roomRunLookup.values(), ...courseRunLookup.values()]) {
    if (run.elapsedMs >= TOO_FAST_ABSOLUTE_MS) {
      continue;
    }
    incrementCount(counts, run.userId);
    markRun(accumulators, run, 'too_fast_absolute', 'high');
  }

  for (const [userId, count] of counts) {
    const accumulator = accumulators.get(userId);
    if (!accumulator) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code: 'too_fast_absolute',
      severity: 'high',
      label: SIGNAL_LABELS.too_fast_absolute,
      summary: `${count} completed run${count === 1 ? '' : 's'} under ${Math.round(TOO_FAST_ABSOLUTE_MS / 1000)}s.`,
      relatedAttemptIds: collectAttemptIdsForSignal(accumulator, 'too_fast_absolute'),
    });
  }
}

function applyRunBurstSignals(
  accumulators: Map<string, UserAccumulator>,
  runsByUser: Map<string, CombinedRunBase[]>,
  windowMs: number,
  threshold: number,
  highThreshold: number,
  code: 'run_burst_5m' | 'run_burst_60m'
): void {
  for (const [userId, runs] of runsByUser) {
    const sorted = [...runs].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));
    const best = findBestCountWindow(sorted.map((run) => ({ at: run.finishedAt, attemptId: run.attemptId })), windowMs);
    if (best.count < threshold) {
      continue;
    }

    const severity: SuspiciousSeverity = best.count >= highThreshold ? 'high' : 'medium';
    for (const attemptId of best.attemptIds) {
      const run = sorted.find((entry) => entry.attemptId === attemptId);
      if (run) {
        markRun(accumulators, run, code, severity);
      }
    }

    const accumulator = accumulators.get(userId);
    if (!accumulator) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code,
      severity,
      label: SIGNAL_LABELS[code],
      summary: `${best.count} completed runs inside ${Math.round(windowMs / 60_000)} minutes.`,
      relatedAttemptIds: best.attemptIds,
    });
  }
}

function applyRepeatSignals(
  accumulators: Map<string, UserAccumulator>,
  runsByUser: Map<string, CombinedRunBase[]>
): void {
  for (const [userId, runs] of runsByUser) {
    const groups = new Map<string, CombinedRunBase[]>();
    for (const run of runs) {
      const key = `${run.kind}:${run.sourceId}:${run.version}:${run.elapsedMs}`;
      const list = groups.get(key) ?? [];
      list.push(run);
      groups.set(key, list);
    }

    let clusterCount = 0;
    let maxRepeats = 0;
    const relatedAttemptIds = new Set<string>();

    for (const group of groups.values()) {
      const sorted = [...group].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));
      const best = findBestCountWindow(sorted.map((run) => ({ at: run.finishedAt, attemptId: run.attemptId })), REPEAT_IDENTICAL_WINDOW_MS);
      if (best.count < REPEAT_IDENTICAL_THRESHOLD) {
        continue;
      }

      clusterCount += 1;
      maxRepeats = Math.max(maxRepeats, best.count);
      for (const attemptId of best.attemptIds) {
        relatedAttemptIds.add(attemptId);
        const run = sorted.find((entry) => entry.attemptId === attemptId);
        if (run) {
          markRun(accumulators, run, 'repeat_identical', 'medium', { repeatGroupCount: best.count });
        }
      }
    }

    if (clusterCount === 0) {
      continue;
    }

    const accumulator = accumulators.get(userId);
    if (!accumulator) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code: 'repeat_identical',
      severity: 'medium',
      label: SIGNAL_LABELS.repeat_identical,
      summary: `${clusterCount} repeated identical finish cluster${clusterCount === 1 ? '' : 's'}; max ${maxRepeats} repeats in 15m.`,
      relatedAttemptIds: [...relatedAttemptIds],
    });
  }
}

function applyPointBurstSignals(
  accumulators: Map<string, UserAccumulator>,
  pointEvents: JoinedPointEventRow[]
): void {
  const grouped = new Map<string, Array<{ at: string; points: number }>>();
  for (const event of pointEvents) {
    const list = grouped.get(event.user_id) ?? [];
    list.push({ at: event.created_at, points: Math.max(0, Number(event.points ?? 0)) });
    grouped.set(event.user_id, list);
  }

  for (const [userId, events] of grouped) {
    const sorted = [...events].sort((left, right) => left.at.localeCompare(right.at));
    const best = findBestPointWindow(sorted, 5 * 60 * 1_000);
    if (best.totalPoints < POINT_BURST_5M_THRESHOLD) {
      continue;
    }

    const severity: SuspiciousSeverity =
      best.totalPoints >= POINT_BURST_5M_HIGH_THRESHOLD ? 'high' : 'medium';
    const accumulator = accumulators.get(userId);
    if (!accumulator) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code: 'point_burst_5m',
      severity,
      label: SIGNAL_LABELS.point_burst_5m,
      summary: `${best.totalPoints} points earned inside 5 minutes.`,
      relatedAttemptIds: [],
    });
  }
}

function applyNewAccountSpikeSignals(accumulators: Map<string, UserAccumulator>): void {
  const now = Date.now();
  for (const accumulator of accumulators.values()) {
    const createdAtMs = Date.parse(accumulator.userCreatedAt);
    if (!Number.isFinite(createdAtMs) || now - createdAtMs > NEW_ACCOUNT_MAX_AGE_MS) {
      continue;
    }

    const totalPoints = Math.max(accumulator.totalPoints, accumulator.recentPoints);
    const completedRuns = Math.max(accumulator.completedRuns, accumulator.recentCompletedRuns);
    if (totalPoints < NEW_ACCOUNT_POINTS_THRESHOLD && completedRuns < NEW_ACCOUNT_COMPLETED_RUNS_THRESHOLD) {
      continue;
    }

    addOrReplaceSignal(accumulator, {
      code: 'new_account_spike',
      severity: 'medium',
      label: SIGNAL_LABELS.new_account_spike,
      summary: `Account is under 24h old with ${totalPoints} total points and ${completedRuns} completed runs.`,
      relatedAttemptIds: [],
    });
  }
}

function markRecordGapRoomRuns(
  accumulators: Map<string, UserAccumulator>,
  recentRuns: CombinedRunBase[],
  historicalRuns: HistoricalComparableRun[],
  goal: RoomGoal
): void {
  const counts = new Map<string, number>();
  const bestSummaries = new Map<string, { improvementMs: number; ratio: number }>();
  const recentIds = new Set(recentRuns.map((run) => run.attemptId));
  const bestBeforeByAttemptId = buildBestBeforeMap(
    historicalRuns,
    recentIds,
    (left, right) =>
      compareLeaderboardEntries(
        {
          elapsedMs: left.elapsedMs,
          deaths: left.deaths,
          score: left.score,
          finishedAt: left.finishedAt,
        },
        {
          elapsedMs: right.elapsedMs,
          deaths: right.deaths,
          score: right.score,
          finishedAt: right.finishedAt,
        },
        goal
      )
  );

  for (const run of recentRuns) {
    const bestBefore = bestBeforeByAttemptId.get(run.attemptId);
    if (!bestBefore) {
      continue;
    }
    const improvementMs = bestBefore.elapsedMs - run.elapsedMs;
    const improvementRatio = improvementMs / bestBefore.elapsedMs;
    if (
      improvementMs < RECORD_GAP_MIN_IMPROVEMENT_MS ||
      improvementRatio < RECORD_GAP_MIN_IMPROVEMENT_RATIO
    ) {
      continue;
    }

    incrementCount(counts, run.userId);
    const best = bestSummaries.get(run.userId);
    if (!best || improvementMs > best.improvementMs) {
      bestSummaries.set(run.userId, { improvementMs, ratio: improvementRatio });
    }
    markRun(accumulators, run, 'record_gap', 'high', {
      previousBestElapsedMs: bestBefore.elapsedMs,
      improvementMs,
      improvementRatio,
    });
  }

  for (const [userId, count] of counts) {
    const accumulator = accumulators.get(userId);
    const best = bestSummaries.get(userId);
    if (!accumulator || !best) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code: 'record_gap',
      severity: 'high',
      label: SIGNAL_LABELS.record_gap,
      summary: `${count} run${count === 1 ? '' : 's'} beat the prior best by at least ${Math.round(RECORD_GAP_MIN_IMPROVEMENT_RATIO * 100)}%; biggest gap ${formatDuration(best.improvementMs)}.`,
      relatedAttemptIds: collectAttemptIdsForSignal(accumulator, 'record_gap'),
    });
  }
}

function markRecordGapCourseRuns(
  accumulators: Map<string, UserAccumulator>,
  recentRuns: CombinedRunBase[],
  historicalRuns: HistoricalComparableRun[],
  goal: CourseGoal
): void {
  const counts = new Map<string, number>();
  const bestSummaries = new Map<string, { improvementMs: number; ratio: number }>();
  const recentIds = new Set(recentRuns.map((run) => run.attemptId));
  const bestBeforeByAttemptId = buildBestBeforeMap(
    historicalRuns,
    recentIds,
    (left, right) =>
      compareCourseLeaderboardEntries(
        {
          elapsedMs: left.elapsedMs,
          deaths: left.deaths,
          score: left.score,
          finishedAt: left.finishedAt,
        },
        {
          elapsedMs: right.elapsedMs,
          deaths: right.deaths,
          score: right.score,
          finishedAt: right.finishedAt,
        },
        goal
      )
  );

  for (const run of recentRuns) {
    const bestBefore = bestBeforeByAttemptId.get(run.attemptId);
    if (!bestBefore) {
      continue;
    }
    const improvementMs = bestBefore.elapsedMs - run.elapsedMs;
    const improvementRatio = improvementMs / bestBefore.elapsedMs;
    if (
      improvementMs < RECORD_GAP_MIN_IMPROVEMENT_MS ||
      improvementRatio < RECORD_GAP_MIN_IMPROVEMENT_RATIO
    ) {
      continue;
    }

    incrementCount(counts, run.userId);
    const best = bestSummaries.get(run.userId);
    if (!best || improvementMs > best.improvementMs) {
      bestSummaries.set(run.userId, { improvementMs, ratio: improvementRatio });
    }
    markRun(accumulators, run, 'record_gap', 'high', {
      previousBestElapsedMs: bestBefore.elapsedMs,
      improvementMs,
      improvementRatio,
    });
  }

  for (const [userId, count] of counts) {
    const accumulator = accumulators.get(userId);
    const best = bestSummaries.get(userId);
    if (!accumulator || !best) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code: 'record_gap',
      severity: 'high',
      label: SIGNAL_LABELS.record_gap,
      summary: `${count} course run${count === 1 ? '' : 's'} beat the prior best by at least ${Math.round(RECORD_GAP_MIN_IMPROVEMENT_RATIO * 100)}%; biggest gap ${formatDuration(best.improvementMs)}.`,
      relatedAttemptIds: collectAttemptIdsForSignal(accumulator, 'record_gap'),
    });
  }
}

function buildBestBeforeMap(
  runs: HistoricalComparableRun[],
  recentIds: Set<string>,
  compare: (left: HistoricalComparableRun, right: HistoricalComparableRun) => number
): Map<string, HistoricalComparableRun> {
  const sorted = [...runs].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));
  const result = new Map<string, HistoricalComparableRun>();
  let bestBefore: HistoricalComparableRun | null = null;
  for (const run of sorted) {
    if (recentIds.has(run.attemptId) && bestBefore) {
      result.set(run.attemptId, bestBefore);
    }
    if (!bestBefore || compare(run, bestBefore) < 0) {
      bestBefore = run;
    }
  }
  return result;
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
      LEFT JOIN playfun_user_links l
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
          LEFT JOIN playfun_user_links l
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
          LEFT JOIN playfun_user_links l
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
      LEFT JOIN playfun_user_links l
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
      LEFT JOIN playfun_user_links l
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
      LEFT JOIN playfun_user_links l
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
      LEFT JOIN playfun_user_links l
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

function getOrCreateAccumulator(
  accumulators: Map<string, UserAccumulator>,
  userId: string,
  input: {
    userDisplayName: string;
    userCreatedAt: string;
    email: string | null;
    walletAddress: string | null;
    ogpId: string | null;
    playerId: string | null;
    stats: UserStatsRecord | null;
  }
): UserAccumulator {
  const existing = accumulators.get(userId);
  if (existing) {
    existing.userDisplayName = input.userDisplayName || existing.userDisplayName;
    existing.userCreatedAt = input.userCreatedAt || existing.userCreatedAt;
    existing.email = input.email ?? existing.email;
    existing.walletAddress = input.walletAddress ?? existing.walletAddress;
    existing.ogpId = input.ogpId ?? existing.ogpId;
    existing.playerId = input.playerId ?? existing.playerId;
    if (input.stats) {
      existing.totalPoints = input.stats.totalPoints;
      existing.completedRuns = input.stats.completedRuns;
    }
    return existing;
  }

  const created: UserAccumulator = {
    userId,
    userDisplayName: input.userDisplayName,
    userCreatedAt: input.userCreatedAt,
    email: input.email,
    walletAddress: input.walletAddress,
    ogpId: input.ogpId,
    playerId: input.playerId,
    totalPoints: input.stats?.totalPoints ?? 0,
    completedRuns: input.stats?.completedRuns ?? 0,
    recentPoints: 0,
    recentCompletedRuns: 0,
    lastActivityAt: null,
    signals: new Map(),
    roomRuns: new Map(),
    courseRuns: new Map(),
  };
  accumulators.set(userId, created);
  return created;
}

function buildSuspiciousUserCaseFromAccumulator(accumulator: UserAccumulator): SuspiciousUserCase {
  const signals = [...accumulator.signals.values()].sort(compareSignals);
  const strongestSeverity = signals.reduce<SuspiciousSeverity>(
    (current, signal) => (severityRank(signal.severity) > severityRank(current) ? signal.severity : current),
    'low'
  );

  return {
    userId: accumulator.userId,
    userDisplayName: accumulator.userDisplayName,
    userCreatedAt: accumulator.userCreatedAt,
    ogpId: accumulator.ogpId,
    playerId: accumulator.playerId,
    totalPoints: Math.max(accumulator.totalPoints, accumulator.recentPoints),
    completedRuns: Math.max(accumulator.completedRuns, accumulator.recentCompletedRuns),
    recentPoints: accumulator.recentPoints,
    recentCompletedRuns: accumulator.recentCompletedRuns,
    strongestSeverity,
    signalCodes: signals.map((signal) => signal.code),
    signals,
    identity: classifySuspiciousUserIdentity(accumulator),
    lastActivityAt: accumulator.lastActivityAt,
  };
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

function classifySuspiciousUserIdentity(accumulator: UserAccumulator): SuspiciousUserIdentity {
  const hasPlayfunLink = Boolean(accumulator.ogpId || accumulator.playerId);
  const hasIdentityBacking = Boolean(accumulator.email || accumulator.walletAddress);
  const hasHeuristicName = isHeuristicPlayfunCharacterDisplayName(accumulator.userDisplayName);

  if (hasPlayfunLink && !hasIdentityBacking) {
    return {
      bucket: 'playfun_signals',
      kind: 'playfun_only',
      label: 'Known Play.fun-only',
      summary: 'Linked in Play.fun and still missing both email and wallet identity.',
    };
  }

  if (hasPlayfunLink) {
    return {
      bucket: 'playfun_signals',
      kind: 'playfun_linked',
      label: 'Play.fun-linked',
      summary: 'Linked in Play.fun, but also backed by email or wallet identity.',
    };
  }

  if (hasHeuristicName) {
    return {
      bucket: 'playfun_signals',
      kind: 'playfun_name_heuristic',
      label: 'Play.fun name heuristic',
      summary: 'Display name matches the current Play.fun burner-name heuristic.',
    };
  }

  return {
    bucket: 'real_players',
    kind: 'no_playfun_signal',
    label: 'Real player, as far as we know',
    summary: 'No Play.fun link or current burner-name heuristic on this account.',
  };
}

function addOrReplaceSignal(accumulator: UserAccumulator, signal: SuspiciousSignal): void {
  accumulator.signals.set(signal.code, signal);
}

function markRun(
  accumulators: Map<string, UserAccumulator>,
  run: CombinedRunBase,
  code: SuspiciousSignalCode,
  severity: SuspiciousSeverity,
  extras?: {
    previousBestElapsedMs?: number | null;
    improvementMs?: number | null;
    improvementRatio?: number | null;
    repeatGroupCount?: number | null;
  }
): void {
  const accumulator = accumulators.get(run.userId);
  if (!accumulator) {
    return;
  }

  const store = run.kind === 'room' ? accumulator.roomRuns : accumulator.courseRuns;
  const existing = store.get(run.attemptId);
  const next: SuspiciousRunCase = existing ?? {
    kind: run.kind,
    attemptId: run.attemptId,
    sourceId: run.sourceId,
    title: run.title,
    version: run.version,
    roomX: run.roomX,
    roomY: run.roomY,
    goalType: run.goalType,
    rankingMode: run.rankingMode,
    userId: run.userId,
    userDisplayName: run.userDisplayName,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    result: 'completed',
    elapsedMs: run.elapsedMs,
    deaths: run.deaths,
    score: run.score,
    runFinalizedPoints: run.runFinalizedPoints,
    runFinalizedPointEventId: run.runFinalizedPointEventId,
    runFinalizedPointCreatedAt: run.runFinalizedPointCreatedAt,
    severity,
    ruleCodes: [],
    previousBestElapsedMs: null,
    improvementMs: null,
    improvementRatio: null,
    repeatGroupCount: null,
  };

  if (!next.ruleCodes.includes(code)) {
    next.ruleCodes = [...next.ruleCodes, code].sort();
  }
  next.severity = severityRank(severity) > severityRank(next.severity) ? severity : next.severity;
  if (extras?.previousBestElapsedMs !== undefined) {
    next.previousBestElapsedMs = extras.previousBestElapsedMs;
  }
  if (extras?.improvementMs !== undefined) {
    next.improvementMs = extras.improvementMs;
  }
  if (extras?.improvementRatio !== undefined) {
    next.improvementRatio = extras.improvementRatio;
  }
  if (extras?.repeatGroupCount !== undefined) {
    next.repeatGroupCount = extras.repeatGroupCount;
  }
  store.set(run.attemptId, next);
}

function collectAttemptIdsForSignal(
  accumulator: UserAccumulator,
  code: SuspiciousSignalCode
): string[] {
  const roomAttemptIds = [...accumulator.roomRuns.values()]
    .filter((run) => run.ruleCodes.includes(code))
    .map((run) => run.attemptId);
  const courseAttemptIds = [...accumulator.courseRuns.values()]
    .filter((run) => run.ruleCodes.includes(code))
    .map((run) => run.attemptId);
  return [...roomAttemptIds, ...courseAttemptIds];
}

function findBestCountWindow(
  items: Array<{ at: string; attemptId: string }>,
  windowMs: number
): { count: number; attemptIds: string[] } {
  const sorted = [...items].sort((left, right) => left.at.localeCompare(right.at));
  let bestCount = 0;
  let bestAttemptIds: string[] = [];
  let startIndex = 0;

  for (let endIndex = 0; endIndex < sorted.length; endIndex += 1) {
    const endTime = Date.parse(sorted[endIndex].at);
    while (startIndex <= endIndex && endTime - Date.parse(sorted[startIndex].at) > windowMs) {
      startIndex += 1;
    }
    const count = endIndex - startIndex + 1;
    if (count > bestCount) {
      bestCount = count;
      bestAttemptIds = sorted.slice(startIndex, endIndex + 1).map((item) => item.attemptId);
    }
  }

  return { count: bestCount, attemptIds: bestAttemptIds };
}

function findBestPointWindow(
  items: Array<{ at: string; points: number }>,
  windowMs: number
): { totalPoints: number } {
  const sorted = [...items].sort((left, right) => left.at.localeCompare(right.at));
  let bestTotal = 0;
  let startIndex = 0;
  let currentTotal = 0;

  for (let endIndex = 0; endIndex < sorted.length; endIndex += 1) {
    currentTotal += sorted[endIndex].points;
    const endTime = Date.parse(sorted[endIndex].at);
    while (startIndex <= endIndex && endTime - Date.parse(sorted[startIndex].at) > windowMs) {
      currentTotal -= sorted[startIndex].points;
      startIndex += 1;
    }
    bestTotal = Math.max(bestTotal, currentTotal);
  }

  return { totalPoints: bestTotal };
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

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
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

function compareSignals(left: SuspiciousSignal, right: SuspiciousSignal): number {
  return severityRank(right.severity) - severityRank(left.severity) || left.label.localeCompare(right.label);
}

function compareRunCases(left: SuspiciousRunCase, right: SuspiciousRunCase): number {
  return (
    severityRank(right.severity) - severityRank(left.severity) ||
    (right.finishedAt ?? '').localeCompare(left.finishedAt ?? '') ||
    left.attemptId.localeCompare(right.attemptId)
  );
}

function compareRunHistory(left: SuspiciousRunCase, right: SuspiciousRunCase): number {
  return (
    (right.finishedAt ?? right.startedAt).localeCompare(left.finishedAt ?? left.startedAt) ||
    right.startedAt.localeCompare(left.startedAt) ||
    left.attemptId.localeCompare(right.attemptId)
  );
}

function compareUserCases(left: SuspiciousUserCase, right: SuspiciousUserCase): number {
  return (
    severityRank(right.strongestSeverity) - severityRank(left.strongestSeverity) ||
    (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '') ||
    left.userDisplayName.localeCompare(right.userDisplayName)
  );
}

function mergeFlaggedRunsIntoHistory(
  runs: SuspiciousRunCase[],
  flaggedRuns: SuspiciousRunCase[]
): SuspiciousRunCase[] {
  const flaggedByAttemptId = new Map(flaggedRuns.map((run) => [run.attemptId, run]));
  return runs
    .map((run) => {
      const flagged = flaggedByAttemptId.get(run.attemptId);
      if (!flagged) {
        return run;
      }
      return {
        ...run,
        severity: flagged.severity,
        ruleCodes: [...flagged.ruleCodes],
        previousBestElapsedMs: flagged.previousBestElapsedMs,
        improvementMs: flagged.improvementMs,
        improvementRatio: flagged.improvementRatio,
        repeatGroupCount: flagged.repeatGroupCount,
      };
    })
    .sort(compareRunHistory);
}

function maxIso(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  return `${(ms / 1_000).toFixed(2)}s`;
}
