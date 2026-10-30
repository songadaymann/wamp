import { ROOM_GOAL_DEFINITIONS } from '../../../goals/roomGoals';
import { roomGoalRankingPolicy } from '../../../goals/goalSchema';
import type { RoomGoal } from '../../../goals/roomGoals';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { RoomRecordView } from '../../../persistence/roomVersionLineage';
import { getLeaderboardRankingMode } from '../../../runs/scoring';
import type {
  RoomLeaderboardEntry,
  RoomLeaderboardResponse,
} from '../../../runs/model';
import { buildRoomLeaderboardVersionSelectionState } from '../../../runs/roomLeaderboardVersions';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import {
  sqlUserIdIsNotLegacyGeneratedOnly,
} from '../generatedUsers/leaderboardIsolation';
import { loadRoomAggregateRatingSummaryForVersion } from '../progression/store';
import type { AggregatedRoomLeaderboardSelection } from './roomLeaderboardAggregation';
import { sqlIsVerificationAccepted } from './verificationSql';
export { sqlIsVerificationAccepted } from './verificationSql';

export interface RankedRoomLeaderboardRow {
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

export function getRoomLeaderboardOrder(goal: RoomGoal): Array<[string, 'ASC' | 'DESC']> {
  if (roomGoalRankingPolicy(goal, ROOM_GOAL_DEFINITIONS) === 'protect') {
    return [['elapsed_ms', 'DESC'], ['deaths', 'ASC'], ['finished_at', 'ASC'], ['attempt_id', 'ASC']];
  }
  return getLeaderboardRankingMode(goal) === 'time'
    ? [['elapsed_ms', 'ASC'], ['deaths', 'ASC'], ['score', 'DESC'], ['finished_at', 'ASC'], ['attempt_id', 'ASC']]
    : [['score', 'DESC'], ['deaths', 'ASC'], ['elapsed_ms', 'ASC'], ['finished_at', 'ASC'], ['attempt_id', 'ASC']];
}

export function sqlRoomLeaderboardEligible(goal: RoomGoal, alias: string): string {
  const results = roomGoalRankingPolicy(goal, ROOM_GOAL_DEFINITIONS) === 'protect'
    ? "('completed', 'failed')" : "('completed')";
  return `${alias}.result IN ${results}
    AND ${alias}.elapsed_ms IS NOT NULL AND ${alias}.finished_at IS NOT NULL
    AND ${sqlIsVerificationAccepted(alias)}
    AND ${sqlUserIdIsNotLegacyGeneratedOnly(`${alias}.user_id`)}`;
}

function buildRankedRoomLeaderboardCte(goal: RoomGoal): string {
  const orderClause = getRoomLeaderboardOrder(goal).map(([column, direction]) => `${column} ${direction}`).join(', ');
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
        -- Leaderboard families are unbounded; keep them in one D1 bind instead
        -- of generating a placeholder per historical room version.
        AND room_version IN (
          SELECT CAST(value AS INTEGER)
          FROM json_each(?)
        )
        AND ${sqlRoomLeaderboardEligible(goal, 'room_runs')}
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

export async function loadRankedRoomLeaderboardRows(
  env: Env,
  roomId: string,
  roomVersions: number[],
  goal: RoomGoal,
  limit: number
): Promise<RankedRoomLeaderboardRow[]> {
  if (roomVersions.length === 0 || limit <= 0) {
    return [];
  }

  const cte = buildRankedRoomLeaderboardCte(goal);
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
    .bind(roomId, JSON.stringify(roomVersions), limit)
    .all<RankedRoomLeaderboardRow>();

  return result.results;
}

export async function loadViewerRankedRoomLeaderboardRow(
  env: Env,
  roomId: string,
  roomVersions: number[],
  goal: RoomGoal,
  viewerUserId: string
): Promise<RankedRoomLeaderboardRow | null> {
  if (roomVersions.length === 0) {
    return null;
  }

  const cte = buildRankedRoomLeaderboardCte(goal);
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
    .bind(roomId, JSON.stringify(roomVersions), viewerUserId)
    .first<RankedRoomLeaderboardRow>();

  return row ?? null;
}

export function mapRankedRoomLeaderboardEntry(
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

export interface RoomLeaderboardStandings {
  entries: RoomLeaderboardEntry[];
  viewerBest: RoomLeaderboardEntry | null;
}

export async function buildRoomLeaderboardResponse(
  env: Env,
  record: RoomRecordView,
  selection: AggregatedRoomLeaderboardSelection,
  limit: number,
  viewerUserId: string | null = null,
  standings?: RoomLeaderboardStandings | Promise<RoomLeaderboardStandings>,
): Promise<RoomLeaderboardResponse> {
  const snapshot = selection.snapshot;
  if (!snapshot.goal) {
    throw new HttpError(404, 'This room version does not have a leaderboard goal.');
  }

  const [entriesRows, ratings, shared] = await Promise.all([
    standings ? Promise.resolve([]) : loadRankedRoomLeaderboardRows(
      env,
      snapshot.id,
      selection.leaderboardFamilyVersions,
      snapshot.goal,
      limit,
    ),
    loadRoomAggregateRatingSummaryForVersion(
      env,
      record,
      selection.roomVersion,
      viewerUserId,
      selection.currentPublishedVersion,
    ),
    standings,
  ]);
  const listedViewerRow = viewerUserId === null
    ? null
    : entriesRows.find((row) => row.user_id === viewerUserId) ?? null;
  const viewerBestRow =
    shared || viewerUserId === null || listedViewerRow !== null
      ? listedViewerRow
      : await loadViewerRankedRoomLeaderboardRow(
          env,
          snapshot.id,
          selection.leaderboardFamilyVersions,
          snapshot.goal,
          viewerUserId,
        );
  const entries = shared?.entries ?? entriesRows.map((row) => mapRankedRoomLeaderboardEntry(row, snapshot));
  const viewerBest = shared ? shared.viewerBest
    : viewerBestRow === null ? null : mapRankedRoomLeaderboardEntry(viewerBestRow, snapshot);

  const versionSelection = buildRoomLeaderboardVersionSelectionState(record);
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
    currentPublishedVersion: selection.currentPublishedVersion,
    versionOptions: versionSelection.options,
    goalType: snapshot.goal.type,
    rankingMode: getLeaderboardRankingMode(snapshot.goal),
    difficulty: ratings.difficulty,
    quality: ratings.quality,
    viewerRating: ratings.viewerRating,
    trophy: ratings.trophy,
    entries,
    viewerBest,
    viewerRank: viewerBest?.rank ?? null,
  };
}

export { buildGlobalLeaderboardResponse, loadViewerRankedGlobalLeaderboardRow } from './globalLeaderboards';
