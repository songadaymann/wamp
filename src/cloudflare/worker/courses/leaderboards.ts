import type { CourseGoal, CourseRecord, CourseSnapshot } from '../../../courses/model';
import { getCourseLeaderboardRankingMode } from '../../../courses/scoring';
import type {
  CourseLeaderboardEntry,
  CourseLeaderboardResponse,
} from '../../../courses/runModel';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { sqlUserIdIsNotPlayfunOnly } from '../playfun/leaderboardIsolation';
import { loadCourseAggregateRatingSummaryForVersion } from '../progression/store';
import { sqlIsVerificationAccepted } from '../runs/verificationSql';

export interface RankedCourseLeaderboardRow {
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
        AND ${sqlIsVerificationAccepted('course_runs')}
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

export async function loadRankedCourseLeaderboardRows(
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

export async function loadViewerRankedCourseLeaderboardRow(
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

export async function buildCourseLeaderboardResponse(
  env: Env,
  record: CourseRecord,
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
  const ratings = await loadCourseAggregateRatingSummaryForVersion(
    env,
    record,
    snapshot.version,
    viewerUserId,
  );

  return {
    courseId: snapshot.id,
    courseTitle: snapshot.title,
    courseVersion: snapshot.version,
    goalType: snapshot.goal.type,
    rankingMode: getCourseLeaderboardRankingMode(snapshot.goal),
    quality: ratings.quality,
    difficulty: ratings.difficulty,
    viewerRating: ratings.viewerRating,
    trophy: ratings.trophy,
    entries,
    viewerBest,
    viewerRank: viewerBest?.rank ?? null,
  };
}
