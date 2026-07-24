import type { RoomGoal } from '../../../goals/roomGoals';
import type { RoomRecord, RoomSnapshot } from '../../../persistence/roomModel';
import { getLeaderboardRankingMode } from '../../../runs/scoring';
import type {
  GlobalLeaderboardEntry,
  GlobalLeaderboardResponse,
  RoomLeaderboardEntry,
  RoomLeaderboardResponse,
} from '../../../runs/model';
import { buildRoomLeaderboardVersionSelectionState } from '../../../runs/roomLeaderboardVersions';
import { HttpError } from '../core/http';
import type { Env, UserStatsRow } from '../core/types';
import {
  sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix,
  sqlUserIdIsNotLegacyGeneratedOnly,
} from '../generatedUsers/leaderboardIsolation';
import { loadRoomAggregateRatingSummaryForVersion } from '../progression/store';
import type { AggregatedRoomLeaderboardSelection } from './roomLeaderboardAggregation';
import { sqlIsVerificationAccepted } from './verificationSql';
export { sqlIsVerificationAccepted } from './verificationSql';

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

export interface RankedGlobalLeaderboardRow extends UserStatsRow {
  overall_rank: number | string | null;
}

function getRoomLeaderboardSqlOrderClause(goal: RoomGoal): string {
  if (goal.type === 'npc_quest' && goal.questType === 'protect') {
    return 'elapsed_ms DESC, deaths ASC, finished_at ASC, attempt_id ASC';
  }
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
  const resultPredicate =
    goal.type === 'npc_quest' && goal.questType === 'protect'
      ? "result IN ('completed', 'failed')"
      : "result = 'completed'";
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
        AND ${resultPredicate}
        AND elapsed_ms IS NOT NULL
        AND finished_at IS NOT NULL
        AND ${sqlIsVerificationAccepted('room_runs')}
        AND ${sqlUserIdIsNotLegacyGeneratedOnly('room_runs.user_id')}
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
          pvp_wins,
          pvp_losses,
          pvp_draws,
          best_score,
          fastest_clear_ms,
          updated_at,
          ROW_NUMBER() OVER (
            ORDER BY ${orderClause}
          ) AS overall_rank
        FROM user_stats
        WHERE ${sqlUserIdIsNotLegacyGeneratedOnly('user_stats.user_id')}
          AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('user_stats.user_id')}
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
        pvp_wins,
        pvp_losses,
        pvp_draws,
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

export async function loadViewerRankedGlobalLeaderboardRow(
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
          pvp_wins,
          pvp_losses,
          pvp_draws,
          best_score,
          fastest_clear_ms,
          updated_at,
          ROW_NUMBER() OVER (
            ORDER BY ${orderClause}
          ) AS overall_rank
        FROM user_stats
        WHERE ${sqlUserIdIsNotLegacyGeneratedOnly('user_stats.user_id')}
          AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('user_stats.user_id')}
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
        pvp_wins,
        pvp_losses,
        pvp_draws,
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
    pvpWins: Number(row.pvp_wins ?? 0),
    pvpLosses: Number(row.pvp_losses ?? 0),
    pvpDraws: Number(row.pvp_draws ?? 0),
    bestScore: row.best_score,
    fastestClearMs: row.fastest_clear_ms,
    updatedAt: row.updated_at,
  };
}

export async function buildRoomLeaderboardResponse(
  env: Env,
  record: RoomRecord,
  selection: AggregatedRoomLeaderboardSelection,
  limit: number,
  viewerUserId: string | null = null
): Promise<RoomLeaderboardResponse> {
  const snapshot = selection.snapshot;
  if (!snapshot.goal) {
    throw new HttpError(404, 'This room version does not have a leaderboard goal.');
  }

  const [entriesRows, ratings] = await Promise.all([
    loadRankedRoomLeaderboardRows(
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
  ]);
  const listedViewerRow = viewerUserId === null
    ? null
    : entriesRows.find((row) => row.user_id === viewerUserId) ?? null;
  const viewerBestRow =
    viewerUserId === null || listedViewerRow !== null
      ? listedViewerRow
      : await loadViewerRankedRoomLeaderboardRow(
          env,
          snapshot.id,
          selection.leaderboardFamilyVersions,
          snapshot.goal,
          viewerUserId,
        );
  const entries = entriesRows.map((row) => mapRankedRoomLeaderboardEntry(row, snapshot));
  const viewerBest =
    viewerBestRow === null ? null : mapRankedRoomLeaderboardEntry(viewerBestRow, snapshot);

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
