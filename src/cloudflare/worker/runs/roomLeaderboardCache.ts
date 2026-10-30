import type { RoomLeaderboardEntry } from '../../../runs/model';
import { jsonResponse } from '../core/http';
import { loadAnonymousPublicCache } from '../core/publicCache';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import {
  getRoomLeaderboardOrder, sqlRoomLeaderboardEligible, loadRankedRoomLeaderboardRows,
  mapRankedRoomLeaderboardEntry, type RankedRoomLeaderboardRow, type RoomLeaderboardStandings,
} from './leaderboards';
import type { AggregatedRoomLeaderboardSelection } from './roomLeaderboardAggregation';

/** Rank is one plus the number of distinct players with any run ahead of this player's best. */
export async function loadRoomLeaderboardViewer(
  env: Env, selection: AggregatedRoomLeaderboardSelection, userId: string,
): Promise<RoomLeaderboardEntry | null> {
  const goal = selection.snapshot.goal!;
  const order = getRoomLeaderboardOrder(goal);
  const ahead = order.map(([column, direction], index) => {
    const ties = order.slice(0, index).map(([tie]) => `candidate.${tie} = viewer.${tie}`);
    return `(${[...ties, `candidate.${column} ${direction === 'ASC' ? '<' : '>'} viewer.${column}`].join(' AND ')})`;
  }).join(' OR ');
  const row = await env.DB.prepare(`
    WITH viewer AS (
      SELECT target.attempt_id, target.room_id, target.room_version, target.user_id, target.user_display_name,
        target.elapsed_ms, target.deaths, target.score, target.finished_at
      FROM room_runs target
      WHERE target.room_id = ? AND target.room_version IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        AND target.user_id = ? AND ${sqlRoomLeaderboardEligible(goal, 'target')}
      ORDER BY ${order.map(([column, direction]) => `target.${column} ${direction}`).join(', ')} LIMIT 1
    )
    SELECT viewer.*, (SELECT COUNT(DISTINCT candidate.user_id) FROM room_runs candidate
      WHERE candidate.room_id = viewer.room_id
        AND candidate.room_version IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        AND ${sqlRoomLeaderboardEligible(goal, 'candidate')} AND (${ahead})
    ) + 1 AS overall_rank FROM viewer
  `).bind(selection.snapshot.id, JSON.stringify(selection.leaderboardFamilyVersions), userId,
    JSON.stringify(selection.leaderboardFamilyVersions)).first<RankedRoomLeaderboardRow>();
  return row ? mapRankedRoomLeaderboardEntry(row, selection.snapshot) : null;
}

function canReuseEntries(entries: RoomLeaderboardEntry[], viewer: RoomLeaderboardEntry | null, userId: string, limit: number): boolean {
  const listed = entries.find(entry => entry.userId === userId);
  if (!listed) return viewer === null || viewer.rank > limit;
  return viewer !== null && (Object.keys(listed) as Array<keyof RoomLeaderboardEntry>).every(key => listed[key] === viewer[key]);
}

/** Only standings enter this cache: access, room metadata, ratings and eligibility are read separately. */
export async function loadCachedRoomStandings(
  request: Request, env: Env, selection: AggregatedRoomLeaderboardSelection, limit: number,
  userId: string | null, context: WorkerExecutionContextLike,
): Promise<{ standings: RoomLeaderboardStandings; status: string }> {
  const loadEntries = async () => (await loadRankedRoomLeaderboardRows(env, selection.snapshot.id,
    selection.leaderboardFamilyVersions, selection.snapshot.goal!, limit))
    .map(row => mapRankedRoomLeaderboardEntry(row, selection.snapshot));
  // A bounded key changes immediately when the selected family or ranking policy changes.
  // No credentials, viewer identity, draft or permission-dependent metadata go into the key or value.
  const signature = JSON.stringify([selection.snapshot.id, selection.leaderboardFamilyVersions,
    selection.snapshot.goal!.type, getRoomLeaderboardOrder(selection.snapshot.goal!), limit]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature)));
  const key = new URL(`/__wamp-cache/room-standings-v1/${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`, request.url);
  const response = await loadAnonymousPublicCache(new Request(key), context,
    async () => jsonResponse(request, await loadEntries(), { headers: { 'Cache-Control': 'public, max-age=20' } }));
  let entries = await response.json() as RoomLeaderboardEntry[];
  const viewerBest = userId === null ? null : await loadRoomLeaderboardViewer(env, selection, userId);
  let status = response.headers.get('X-WAMP-Cache') ?? 'bypass';
  if (userId !== null && !canReuseEntries(entries, viewerBest, userId, limit)) {
    entries = await loadEntries();
    status = 'bypass';
  }
  return { standings: { entries, viewerBest }, status };
}
