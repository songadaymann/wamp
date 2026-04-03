import { HttpError } from '../core/http';
import type { Env } from '../core/types';

const SUBMISSION_LOCKOUT_WINDOW_MS = 15 * 60 * 1_000;
const SUBMISSION_LOCKOUT_HELD_RUNS_THRESHOLD = 3;
const RUN_BURST_5M_THRESHOLD = 10;
const RUN_BURST_60M_THRESHOLD = 30;
const POINT_BURST_5M_THRESHOLD = 500;
const TOO_FAST_ABSOLUTE_MS = 1_000;
const HIGH_VALUE_CLEAR_POINTS_THRESHOLD = 1_000;
const HIGH_VALUE_CLEAR_MAX_ELAPSED_MS = 10_000;
const NEW_ACCOUNT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const NEW_ACCOUNT_POINTS_THRESHOLD = 1_000;
const NEW_ACCOUNT_COMPLETED_RUNS_THRESHOLD = 20;
const ROOM_VERSION_CHAIN_WINDOW_MS = 15 * 60 * 1_000;
const ROOM_VERSION_CHAIN_THRESHOLD = 4;

export interface RunHoldDecision {
  shouldHold: boolean;
  reasonCodes: string[];
  reasonJson: string | null;
}

interface BaseCompletedRunInput {
  userId: string;
  elapsedMs: number;
  finishedAt: string;
  projectedPoints: number;
}

export async function assertRunSubmissionAllowed(env: Env, userId: string): Promise<void> {
  const sinceIso = toRecentIso(SUBMISSION_LOCKOUT_WINDOW_MS);
  const row = await env.DB.prepare(
    `
      SELECT COALESCE(SUM(held_count), 0) AS held_runs
      FROM (
        SELECT COUNT(*) AS held_count
        FROM room_runs
        WHERE user_id = ?
          AND result = 'completed'
          AND is_held = 1
          AND finished_at IS NOT NULL
          AND finished_at >= ?
        UNION ALL
        SELECT COUNT(*) AS held_count
        FROM course_runs
        WHERE user_id = ?
          AND result = 'completed'
          AND is_held = 1
          AND finished_at IS NOT NULL
          AND finished_at >= ?
      )
    `
  )
    .bind(userId, sinceIso, userId, sinceIso)
    .first<{ held_runs: number | null }>();

  if (Number(row?.held_runs ?? 0) >= SUBMISSION_LOCKOUT_HELD_RUNS_THRESHOLD) {
    throw new HttpError(429, 'Run submissions are temporarily rate limited for this account.');
  }
}

export async function evaluateCompletedRoomRunHold(
  env: Env,
  input: BaseCompletedRunInput & {
    roomId: string;
  }
): Promise<RunHoldDecision> {
  const reasonCodes = await loadBaseHoldReasonCodes(env, input);
  const sinceIso = toIsoFromTimestamp(Date.parse(input.finishedAt) - ROOM_VERSION_CHAIN_WINDOW_MS);
  const versionRow = await env.DB.prepare(
    `
      SELECT COUNT(DISTINCT room_version) AS distinct_versions
      FROM room_runs
      WHERE user_id = ?
        AND room_id = ?
        AND result = 'completed'
        AND finished_at IS NOT NULL
        AND finished_at >= ?
    `
  )
    .bind(input.userId, input.roomId, sinceIso)
    .first<{ distinct_versions: number | null }>();

  if (Number(versionRow?.distinct_versions ?? 0) >= ROOM_VERSION_CHAIN_THRESHOLD) {
    reasonCodes.push('room_version_chain');
  }

  return finalizeHoldDecision(reasonCodes);
}

export async function evaluateCompletedCourseRunHold(
  env: Env,
  input: BaseCompletedRunInput
): Promise<RunHoldDecision> {
  return finalizeHoldDecision(await loadBaseHoldReasonCodes(env, input));
}

async function loadBaseHoldReasonCodes(
  env: Env,
  input: BaseCompletedRunInput
): Promise<string[]> {
  const [activity, user] = await Promise.all([
    loadRecentCompletedRunActivity(env, input.userId, input.finishedAt),
    loadUserCreatedAt(env, input.userId),
  ]);
  const projectedRecentPoints = activity.recentPoints5m + Math.max(0, input.projectedPoints);
  const reasonCodes: string[] = [];

  if (input.elapsedMs < TOO_FAST_ABSOLUTE_MS) {
    reasonCodes.push('too_fast_absolute');
  }
  if (activity.completedRuns5m >= RUN_BURST_5M_THRESHOLD) {
    reasonCodes.push('run_burst_5m');
  }
  if (activity.completedRuns60m >= RUN_BURST_60M_THRESHOLD) {
    reasonCodes.push('run_burst_60m');
  }
  if (projectedRecentPoints >= POINT_BURST_5M_THRESHOLD) {
    reasonCodes.push('point_burst_5m');
  }
  if (
    input.projectedPoints >= HIGH_VALUE_CLEAR_POINTS_THRESHOLD &&
    input.elapsedMs <= HIGH_VALUE_CLEAR_MAX_ELAPSED_MS
  ) {
    reasonCodes.push('high_value_clear_too_fast');
  }
  if (
    user !== null &&
    Date.parse(input.finishedAt) - user.createdAtMs <= NEW_ACCOUNT_MAX_AGE_MS &&
    (projectedRecentPoints >= NEW_ACCOUNT_POINTS_THRESHOLD ||
      activity.completedRuns60m >= NEW_ACCOUNT_COMPLETED_RUNS_THRESHOLD)
  ) {
    reasonCodes.push('new_account_spike');
  }

  return [...new Set(reasonCodes)];
}

async function loadRecentCompletedRunActivity(
  env: Env,
  userId: string,
  finishedAt: string
): Promise<{ completedRuns5m: number; completedRuns60m: number; recentPoints5m: number }> {
  const finishedAtMs = Date.parse(finishedAt);
  const since5mIso = toIsoFromTimestamp(finishedAtMs - 5 * 60 * 1_000);
  const since60mIso = toIsoFromTimestamp(finishedAtMs - 60 * 60 * 1_000);
  const [runRow, pointRow] = await Promise.all([
    env.DB.prepare(
      `
        SELECT
          COALESCE(SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END), 0) AS completed_runs_5m,
          COALESCE(SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END), 0) AS completed_runs_60m
        FROM (
          SELECT finished_at
          FROM room_runs
          WHERE user_id = ?
            AND result = 'completed'
            AND finished_at IS NOT NULL
          UNION ALL
          SELECT finished_at
          FROM course_runs
          WHERE user_id = ?
            AND result = 'completed'
            AND finished_at IS NOT NULL
        )
      `
    )
      .bind(since5mIso, since60mIso, userId, userId)
      .first<{ completed_runs_5m: number | null; completed_runs_60m: number | null }>(),
    env.DB.prepare(
      `
        SELECT COALESCE(SUM(points), 0) AS recent_points_5m
        FROM point_events
        WHERE user_id = ?
          AND created_at >= ?
      `
    )
      .bind(userId, since5mIso)
      .first<{ recent_points_5m: number | null }>(),
  ]);

  return {
    completedRuns5m: Number(runRow?.completed_runs_5m ?? 0),
    completedRuns60m: Number(runRow?.completed_runs_60m ?? 0),
    recentPoints5m: Number(pointRow?.recent_points_5m ?? 0),
  };
}

async function loadUserCreatedAt(
  env: Env,
  userId: string
): Promise<{ createdAtMs: number } | null> {
  const row = await env.DB.prepare(
    `
      SELECT created_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<{ created_at: string | null }>();
  const createdAtMs = Date.parse(row?.created_at ?? '');
  return Number.isFinite(createdAtMs) ? { createdAtMs } : null;
}

function finalizeHoldDecision(reasonCodes: string[]): RunHoldDecision {
  const uniqueCodes = [...new Set(reasonCodes)];
  return {
    shouldHold: uniqueCodes.length > 0,
    reasonCodes: uniqueCodes,
    reasonJson: uniqueCodes.length > 0 ? JSON.stringify(uniqueCodes) : null,
  };
}

function toRecentIso(windowMs: number): string {
  return toIsoFromTimestamp(Date.now() - windowMs);
}

function toIsoFromTimestamp(timestampMs: number): string {
  return new Date(Math.max(0, timestampMs)).toISOString();
}
