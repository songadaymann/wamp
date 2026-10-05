import type { GlobalLeaderboardEntry, GlobalLeaderboardResponse, GlobalLeaderboardWindow } from '../../../runs/model';
import { globalLeaderboardWeek } from '../../../runs/globalLeaderboardWindow';
import { HttpError } from '../core/http';
import type { Env, UserStatsRow } from '../core/types';
import { sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix, sqlUserIdIsNotLegacyGeneratedOnly } from '../generatedUsers/leaderboardIsolation';

export interface RankedGlobalLeaderboardRow extends UserStatsRow {
  overall_rank: number | string | null;
  points_in_window: number;
}

export function parseGlobalLeaderboardWindow(value: string | null): GlobalLeaderboardWindow {
  if (value === null || value === 'all') return 'all';
  if (value === 'week') return 'week';
  throw new HttpError(400, 'Leaderboard window must be all or week.');
}

function rankedStatsSql(window: GlobalLeaderboardWindow): string {
  const weekly = window === 'week';
  return `WITH ${weekly ? `window_points AS (
    SELECT user_id, SUM(points) AS points_in_window
    FROM point_events
    WHERE created_at >= ? AND created_at < ? AND created_at <= ?
    GROUP BY user_id HAVING SUM(points) > 0
  ),` : ''} ranked_stats AS (
    SELECT user_stats.*, ${weekly ? 'window_points.points_in_window' : 'total_points AS points_in_window'},
      ROW_NUMBER() OVER (ORDER BY ${weekly
        ? 'points_in_window DESC, user_display_name ASC, user_stats.user_id ASC'
        : 'total_points DESC, completed_runs DESC, total_rooms_published DESC, user_display_name ASC, user_stats.user_id ASC'}) AS overall_rank
    FROM user_stats ${weekly ? 'JOIN window_points ON window_points.user_id = user_stats.user_id' : ''}
    WHERE ${sqlUserIdIsNotLegacyGeneratedOnly('user_stats.user_id')}
      AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('user_stats.user_id')}
  )`;
}

/** Profile ranks retain the existing lifetime points and tie-breakers. */
export async function loadViewerRankedGlobalLeaderboardRow(
  env: Pick<Env, 'DB'>, viewerUserId: string,
): Promise<RankedGlobalLeaderboardRow | null> {
  return env.DB.prepare(`${rankedStatsSql('all')} SELECT * FROM ranked_stats WHERE user_id = ? LIMIT 1`)
    .bind(viewerUserId).first<RankedGlobalLeaderboardRow>();
}

function entry(row: RankedGlobalLeaderboardRow): GlobalLeaderboardEntry {
  return {
    rank: Number(row.overall_rank), userId: row.user_id, userDisplayName: row.user_display_name,
    pointsInWindow: Number(row.points_in_window), totalPoints: row.total_points,
    totalScore: row.total_score, totalRoomsPublished: row.total_rooms_published,
    completedRuns: row.completed_runs, failedRuns: row.failed_runs, abandonedRuns: row.abandoned_runs,
    pvpWins: Number(row.pvp_wins ?? 0), pvpLosses: Number(row.pvp_losses ?? 0), pvpDraws: Number(row.pvp_draws ?? 0),
    bestScore: row.best_score, fastestClearMs: row.fastest_clear_ms, updatedAt: row.updated_at,
  };
}

export async function buildGlobalLeaderboardResponse(
  env: Pick<Env, 'DB'>, limit: number, viewerUserId: string | null = null,
  window: GlobalLeaderboardWindow = 'all', now: Date = new Date(),
): Promise<GlobalLeaderboardResponse> {
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const period = window === 'week' ? globalLeaderboardWeek(now) : null;
  const serverTime = now.toISOString();
  // One snapshot contains at most limit + 2 rows: the list, viewer and player immediately above.
  const rows = await env.DB.prepare(`${rankedStatsSql(window)} SELECT * FROM ranked_stats
    WHERE overall_rank <= ? OR user_id = ? OR overall_rank = (
      SELECT overall_rank - 1 FROM ranked_stats WHERE user_id = ?
    ) ORDER BY overall_rank`)
    .bind(...(period ? [period.startsAt, period.endsAt, serverTime] : []), boundedLimit, viewerUserId, viewerUserId)
    .all<RankedGlobalLeaderboardRow>();
  const entries = rows.results.filter(row => Number(row.overall_rank) <= boundedLimit).map(entry);
  const viewerRow = viewerUserId === null ? null : rows.results.find(row => row.user_id === viewerUserId) ?? null;
  const viewerEntry = viewerRow ? entry(viewerRow) : null;
  const next = viewerEntry ? rows.results.find(row => Number(row.overall_rank) === viewerEntry.rank - 1) : null;
  return {
    window, period, serverTime, entries, viewerEntry,
    viewerNext: next && viewerRow ? { userId: next.user_id, userDisplayName: next.user_display_name,
      pointsToPass: Math.max(1, Number(next.points_in_window) - Number(viewerRow.points_in_window) + 1) } : null,
  };
}
