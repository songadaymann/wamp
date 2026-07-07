import type { CourseGoal, CourseRecord, CourseSnapshot } from '../../../courses/model';
import {
  getCourseLeaderboardRankingMode,
} from '../../../courses/scoring';
import type { ExpandedRoomLeaderboardEntry, ExpandedRoomLeaderboardResponse } from '../../../expandedRooms/runModel';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { sqlUserIdIsNotLegacyGeneratedOnly } from '../generatedUsers/leaderboardIsolation';
import { loadCourseAggregateRatingSummaryForVersion } from '../progression/store';
import { sqlIsVerificationAccepted } from '../runs/verificationSql';

export interface RankedExpandedRoomLeaderboardRow {
  attempt_id: string;
  expanded_room_version: number;
  user_id: string;
  user_display_name: string;
  elapsed_ms: number;
  deaths: number;
  score: number;
  finished_at: string;
  overall_rank: number | string | null;
}

function getExpandedRoomLeaderboardSqlOrderClause(goal: CourseGoal): string {
  return getCourseLeaderboardRankingMode(goal) === 'time'
    ? 'elapsed_ms ASC, deaths ASC, score DESC, finished_at ASC, attempt_id ASC'
    : 'score DESC, elapsed_ms ASC, deaths ASC, finished_at ASC, attempt_id ASC';
}

function buildRankedExpandedRoomLeaderboardCte(goal: CourseGoal): string {
  const orderClause = getExpandedRoomLeaderboardSqlOrderClause(goal);
  return `
    WITH candidate_runs AS (
      SELECT
        attempt_id,
        expanded_room_version,
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
      FROM expanded_room_runs
      WHERE expanded_room_id = ?
        AND expanded_room_version = ?
        AND result = 'completed'
        AND elapsed_ms IS NOT NULL
        AND finished_at IS NOT NULL
        AND ${sqlIsVerificationAccepted('expanded_room_runs')}
        AND ${sqlUserIdIsNotLegacyGeneratedOnly('expanded_room_runs.user_id')}
    ),
    best_runs AS (
      SELECT
        attempt_id,
        expanded_room_version,
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
        expanded_room_version,
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

export async function loadRankedExpandedRoomLeaderboardRows(
  env: Env,
  expandedRoomId: string,
  expandedRoomVersion: number,
  goal: CourseGoal,
  limit: number,
): Promise<RankedExpandedRoomLeaderboardRow[]> {
  if (limit <= 0) {
    return [];
  }

  const cte = buildRankedExpandedRoomLeaderboardCte(goal);
  const result = await env.DB.prepare(
    `
      ${cte}
      SELECT
        attempt_id,
        expanded_room_version,
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
    .bind(expandedRoomId, expandedRoomVersion, limit)
    .all<RankedExpandedRoomLeaderboardRow>();

  return result.results;
}

export async function loadViewerRankedExpandedRoomLeaderboardRow(
  env: Env,
  expandedRoomId: string,
  expandedRoomVersion: number,
  goal: CourseGoal,
  viewerUserId: string,
): Promise<RankedExpandedRoomLeaderboardRow | null> {
  const cte = buildRankedExpandedRoomLeaderboardCte(goal);
  const row = await env.DB.prepare(
    `
      ${cte}
      SELECT
        attempt_id,
        expanded_room_version,
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
    .bind(expandedRoomId, expandedRoomVersion, viewerUserId)
    .first<RankedExpandedRoomLeaderboardRow>();

  return row ?? null;
}

function mapRankedExpandedRoomLeaderboardEntry(
  row: RankedExpandedRoomLeaderboardRow,
  params: {
    expandedRoomId: string;
    legacyCourseId: string | null;
    snapshot: CourseSnapshot;
  },
): ExpandedRoomLeaderboardEntry {
  return {
    rank: Number(row.overall_rank),
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    attemptId: row.attempt_id,
    courseId: params.legacyCourseId ?? params.snapshot.id,
    courseVersion: row.expanded_room_version,
    goalType: params.snapshot.goal!.type,
    elapsedMs: row.elapsed_ms,
    deaths: row.deaths,
    score: row.score,
    finishedAt: row.finished_at,
    expandedRoomId: params.expandedRoomId,
    expandedRoomVersion: row.expanded_room_version,
    legacyCourseId: params.legacyCourseId,
  };
}

export async function buildExpandedRoomLeaderboardResponse(
  env: Env,
  params: {
    expandedRoomId: string;
    expandedRoomTitle: string | null;
    legacyCourseId: string | null;
    courseRecord: CourseRecord;
    snapshot: CourseSnapshot;
    limit: number;
    viewerUserId?: string | null;
  },
): Promise<ExpandedRoomLeaderboardResponse> {
  const { snapshot } = params;
  if (!snapshot.goal) {
    throw new HttpError(404, 'This expanded room version does not have a leaderboard goal.');
  }

  const entryRows = await loadRankedExpandedRoomLeaderboardRows(
    env,
    params.expandedRoomId,
    snapshot.version,
    snapshot.goal,
    params.limit,
  );
  const viewerBestRow =
    params.viewerUserId === null || params.viewerUserId === undefined
      ? null
      : await loadViewerRankedExpandedRoomLeaderboardRow(
          env,
          params.expandedRoomId,
          snapshot.version,
          snapshot.goal,
          params.viewerUserId,
        );
  const entries = entryRows.map((row) =>
    mapRankedExpandedRoomLeaderboardEntry(row, {
      expandedRoomId: params.expandedRoomId,
      legacyCourseId: params.legacyCourseId,
      snapshot,
    }),
  );
  const viewerBest =
    viewerBestRow === null
      ? null
      : mapRankedExpandedRoomLeaderboardEntry(viewerBestRow, {
          expandedRoomId: params.expandedRoomId,
          legacyCourseId: params.legacyCourseId,
          snapshot,
        });
  const ratings = await loadCourseAggregateRatingSummaryForVersion(
    env,
    params.courseRecord,
    snapshot.version,
    params.viewerUserId ?? null,
  );

  return {
    expandedRoomId: params.expandedRoomId,
    expandedRoomTitle: params.expandedRoomTitle ?? snapshot.title,
    expandedRoomVersion: snapshot.version,
    legacyCourseId: params.legacyCourseId,
    courseId: params.legacyCourseId ?? snapshot.id,
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
