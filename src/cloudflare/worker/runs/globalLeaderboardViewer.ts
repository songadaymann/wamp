import type { GlobalLeaderboardEntry, GlobalLeaderboardResponse } from '../../../runs/model';
import type { Env } from '../core/types';
import { sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix, sqlUserIdIsNotLegacyGeneratedOnly } from '../generatedUsers/leaderboardIsolation';
import { mapRankedGlobalLeaderboardEntry, type RankedGlobalLeaderboardRow } from './globalLeaderboards';

type ViewerResponse = Pick<GlobalLeaderboardResponse, 'viewerEntry' | 'viewerNext'>;
interface ViewerRow extends RankedGlobalLeaderboardRow {
  next_user_id: string | null;
  next_display_name: string | null;
  next_points: number | null;
}

function eligible(alias: string): string {
  return `${sqlUserIdIsNotLegacyGeneratedOnly(`${alias}.user_id`)}
    AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix(`${alias}.user_id`)}`;
}

/** The same lifetime order as rankedStatsSql, without sorting/materializing every rank. */
function ahead(alias: string): string {
  return `(${alias}.total_points > viewer.total_points
    OR (${alias}.total_points = viewer.total_points AND ${alias}.completed_runs > viewer.completed_runs)
    OR (${alias}.total_points = viewer.total_points AND ${alias}.completed_runs = viewer.completed_runs
      AND ${alias}.total_rooms_published > viewer.total_rooms_published)
    OR (${alias}.total_points = viewer.total_points AND ${alias}.completed_runs = viewer.completed_runs
      AND ${alias}.total_rooms_published = viewer.total_rooms_published AND ${alias}.user_display_name < viewer.user_display_name)
    OR (${alias}.total_points = viewer.total_points AND ${alias}.completed_runs = viewer.completed_runs
      AND ${alias}.total_rooms_published = viewer.total_rooms_published AND ${alias}.user_display_name = viewer.user_display_name
      AND ${alias}.user_id < viewer.user_id))`;
}

/** A primary-key viewer lookup plus indexed count/neighbor reads; no public top-list query. */
export async function loadGlobalLeaderboardViewer(env: Pick<Env, 'DB'>, userId: string): Promise<ViewerResponse> {
  const row = await env.DB.prepare(`
    WITH viewer AS (SELECT * FROM user_stats target WHERE target.user_id = ? AND ${eligible('target')})
    SELECT viewer.*, viewer.total_points AS points_in_window,
      (SELECT COUNT(*) FROM user_stats candidate WHERE candidate.total_points >= viewer.total_points AND ${ahead('candidate')} AND ${eligible('candidate')}) + 1 AS overall_rank,
      neighbor.user_id AS next_user_id, neighbor.user_display_name AS next_display_name, neighbor.total_points AS next_points
    FROM viewer LEFT JOIN user_stats neighbor ON neighbor.user_id = (
      SELECT candidate.user_id FROM user_stats candidate
      WHERE candidate.total_points >= viewer.total_points AND ${ahead('candidate')} AND ${eligible('candidate')}
      ORDER BY candidate.total_points ASC, candidate.completed_runs ASC, candidate.total_rooms_published ASC,
        candidate.user_display_name DESC, candidate.user_id DESC LIMIT 1
    )
  `).bind(userId).first<ViewerRow>();
  return {
    viewerEntry: row ? mapRankedGlobalLeaderboardEntry(row) : null,
    viewerNext: row?.next_user_id ? {
      userId: row.next_user_id, userDisplayName: row.next_display_name!,
      pointsToPass: Math.max(1, Number(row.next_points) - Number(row.total_points) + 1),
    } : null,
  };
}

function sameEntry(a: GlobalLeaderboardEntry, b: GlobalLeaderboardEntry): boolean {
  return (Object.keys(a) as (keyof GlobalLeaderboardEntry)[]).every(key => a[key] === b[key]);
}

/** Refresh the whole snapshot when a changed viewer/neighbor could contradict the cached list. */
export function canReuseGlobalLeaderboardBase(
  base: GlobalLeaderboardResponse, viewer: ViewerResponse, userId: string, limit: number,
): boolean {
  const listed = base.entries.find(row => row.userId === userId);
  if (!listed) return viewer.viewerEntry === null || viewer.viewerEntry.rank > limit + 1;
  if (!viewer.viewerEntry || !sameEntry(listed, viewer.viewerEntry)) return false;
  const next = base.entries.find(row => row.rank === listed.rank - 1);
  if (!next) return viewer.viewerNext === null;
  return viewer.viewerNext?.userId === next.userId
    && viewer.viewerNext.userDisplayName === next.userDisplayName
    && viewer.viewerNext.pointsToPass === Math.max(1, next.totalPoints - listed.totalPoints + 1);
}
