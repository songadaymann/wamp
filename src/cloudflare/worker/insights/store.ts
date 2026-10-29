import { ensureInsightRoomFacts, compareInsightFacts } from './lineage';
import { emptyInsightSummary, insightTargetForRoom, insightTargetKey, type DeathMapCell, type RoomInsightSummary, type RoomInsightTarget } from '../../../insights/model';
import type { Env } from '../core/types';
import { sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix, sqlUserIdIsNotLegacyGeneratedOnly } from '../generatedUsers/leaderboardIsolation';

interface SummaryRow { target_key: string; version_key: number; attempts: number; unique_players: number; completions: number;
  failures: number; abandonments: number; deaths: number; last_played: string; median_clear: number | null; mapped_attempts: number; mapped_deaths: number }
function selectionCte(targets: RoomInsightTarget[]): { sql: string; values: (string | number)[] } {
  return { sql: `requested(target_key,version_key) AS (VALUES ${targets.map(() => '(?,?)').join(',')}),
    selected_versions AS (
      SELECT target_key,version_key AS selected_version_key,version_key AS attempt_version_key FROM requested
      UNION SELECT requested.target_key,requested.version_key,sibling.version FROM requested
      JOIN room_version_facts selected ON requested.target_key LIKE 'room:%'
        AND selected.room_id=substr(requested.target_key,6) AND selected.version=requested.version_key
      JOIN room_version_facts sibling ON sibling.room_id=selected.room_id
      WHERE (${compareInsightFacts('selected','sibling')})=1
    ), owners AS (SELECT selected_versions.*, COALESCE(
      (SELECT published_by_user_id FROM room_versions WHERE room_id=substr(target_key,6) AND target_key LIKE 'room:%' AND version=attempt_version_key),
      (SELECT COALESCE(last_published_by_user_id,claimer_user_id) FROM rooms WHERE id=substr(target_key,6) AND target_key LIKE 'room:%'),
      (SELECT published_by_user_id FROM expanded_room_versions WHERE expanded_room_id=substr(target_key,15) AND target_key LIKE 'expanded_room:%' AND version=attempt_version_key),
      (SELECT owner_user_id FROM expanded_rooms WHERE id=substr(target_key,15) AND target_key LIKE 'expanded_room:%'),
      (SELECT published_by_user_id FROM course_versions WHERE course_id=substr(target_key,22) AND target_key LIKE 'expanded_room:course:%' AND version=attempt_version_key),
      (SELECT owner_user_id FROM courses WHERE id=substr(target_key,22) AND target_key LIKE 'expanded_room:course:%')
    ) AS builder_user_id FROM selected_versions),
    eligible AS (SELECT a.*,owners.selected_version_key FROM owners JOIN room_insight_attempts a
      ON a.target_key=owners.target_key AND a.version_key=owners.attempt_version_key
      WHERE (a.user_id IS NULL OR a.user_id<>COALESCE(owners.builder_user_id,''))
      AND ${sqlUserIdIsNotLegacyGeneratedOnly('a.user_id')}
      AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('a.user_id')})`,
    values: targets.flatMap(target => [insightTargetKey(target), target.version!]) };
}
export async function loadInsightSummaries(env: Env, targets: RoomInsightTarget[], options: { factsReady?: boolean } = {}): Promise<Map<string, RoomInsightSummary>> {
  const summaries = new Map<string, RoomInsightSummary>();
  if (!targets.length) return summaries;
  const uniqueTargets = [...new Map(targets.map(target => [`${insightTargetKey(target)}:${target.version}`,target])).values()];
  // Keep bind count below D1's limit for large profiles/discovery responses.
  for (let offset = 0; offset < uniqueTargets.length; offset += 40) {
    const batch = uniqueTargets.slice(offset, offset + 40);
    if (!options.factsReady) await ensureInsightRoomFacts(env,batch);
    const query = selectionCte(batch);
    const rows = await env.DB.prepare(`WITH ${query.sql}, clears AS (
      SELECT target_key,selected_version_key,elapsed_ms, ROW_NUMBER() OVER (PARTITION BY target_key,selected_version_key ORDER BY elapsed_ms) AS rn,
      COUNT(*) OVER (PARTITION BY target_key,selected_version_key) AS n FROM eligible WHERE result = 'completed'
    ), medians AS (SELECT target_key,selected_version_key,AVG(elapsed_ms) AS median_clear FROM clears
      WHERE rn IN ((n+1)/2,(n+2)/2) GROUP BY target_key,selected_version_key)
    SELECT a.target_key,a.selected_version_key AS version_key,COUNT(*) AS attempts,COUNT(DISTINCT player_key) AS unique_players,
      SUM(result = 'completed') AS completions,SUM(result = 'failed') AS failures,SUM(result = 'abandoned') AS abandonments,
      SUM(deaths) AS deaths,MAX(finished_at) AS last_played,MAX(median_clear) AS median_clear,
      SUM(death_positions_json IS NOT NULL) AS mapped_attempts,
      SUM(COALESCE(json_array_length(death_positions_json),0)) AS mapped_deaths
    FROM eligible a LEFT JOIN medians m ON m.target_key = a.target_key AND m.selected_version_key = a.selected_version_key
    GROUP BY a.target_key,a.selected_version_key`).bind(...query.values).all<SummaryRow>();
    for (const row of rows.results) summaries.set(`${row.target_key}:${row.version_key}`, {
      attempts: row.attempts, uniquePlayers: row.unique_players, completions: row.completions,
      failures: row.failures, abandonments: row.abandonments, clearRate: row.completions / row.attempts,
      medianClearMs: row.median_clear, averageDeaths: row.deaths / row.attempts, totalDeaths: row.deaths,
      lastPlayedAt: row.last_played, mappedAttempts: row.mapped_attempts, mappedDeaths: row.mapped_deaths,
    });
  }
  return summaries;
}
export async function loadInsightDeathMap(env: Env, target: RoomInsightTarget, options: { factsReady?: boolean } = {}): Promise<{ deathMap: DeathMapCell[]; deathMapTruncated: boolean }> {
  if (!options.factsReady) await ensureInsightRoomFacts(env,[target]);
  const query = selectionCte([target]);
  const rows = await env.DB.prepare(`WITH ${query.sql}
    SELECT json_extract(p.value,'$.roomX') AS roomX,json_extract(p.value,'$.roomY') AS roomY,
      json_extract(p.value,'$.tileX') AS tileX,json_extract(p.value,'$.tileY') AS tileY,COUNT(*) AS deaths
    FROM eligible, json_each(eligible.death_positions_json) p
    GROUP BY roomX,roomY,tileX,tileY ORDER BY deaths DESC,roomY,roomX,tileY,tileX LIMIT 4097`)
    .bind(...query.values).all<DeathMapCell>();
  return { deathMap: rows.results.slice(0,4096), deathMapTruncated: rows.results.length > 4096 };
}
/** One bounded batch per page; no browser request per room card. */
export async function attachRoomInsights<T extends { roomId: string; roomVersion: number; expandedRoom?: { expandedRoomId: string; expandedRoomVersion: number | null } | null }>(env: Env, rooms: T[]): Promise<(T & { insights: RoomInsightSummary })[]> {
  const targets = rooms.map(insightTargetForRoom);
  const summaries = await loadInsightSummaries(env, targets);
  return rooms.map((room,index) => ({ ...room, insights: summaries.get(`${insightTargetKey(targets[index])}:${targets[index].version}`) ?? emptyInsightSummary() }));
}
