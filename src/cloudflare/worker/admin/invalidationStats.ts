import type { SuspiciousRunCase } from '../../../admin/model';
import type { D1PreparedStatement, Env } from '../core/types';
import { isExpandedRoomSchemaMissingError } from '../expandedRooms/schemaErrors';

type RunSource = 'room' | 'course' | 'expanded_room';
const SOURCES: Record<RunSource, { table: string; id: string; version: string; targetPrefix: string }> = {
  room: { table: 'room_runs', id: 'room_id', version: 'room_version', targetPrefix: 'room:' },
  course: { table: 'course_runs', id: 'course_id', version: 'course_version', targetPrefix: 'expanded_room:course:' },
  expanded_room: { table: 'expanded_room_runs', id: 'expanded_room_id', version: 'expanded_room_version', targetPrefix: 'expanded_room:' },
};

interface DiscoveryPlayer { source: RunSource; contentId: string; version: number; userId: string }

/**
 * The copies of the invalidated runs kept for statistics: builder insights (room_insight_attempts)
 * and the one-row-per-player discovery sample behind Explore popularity, measured difficulty and
 * Room of the Day eligibility (discovery_run_players).
 */
export interface StatsRollback {
  insightAttemptKeys: string[];
  /** Every removed attempt, including Expanded Room copies of removed course runs. */
  removedAttemptIds: string[];
  players: DiscoveryPlayer[];
}

interface ExpandedRunRow { attempt_id: string; expanded_room_id: string; expanded_room_version: number; user_id: string }

/** Planned before the runs are deleted, since the Expanded Room copies are found through them. */
export async function planStatsRollback(env: Env, roomRuns: SuspiciousRunCase[], courseRuns: SuspiciousRunCase[]): Promise<StatsRollback> {
  const courseIds = JSON.stringify(courseRuns.map((run) => run.attemptId));
  let expanded: ExpandedRunRow[] = [];
  if (courseRuns.length > 0) {
    try {
      expanded = (await env.DB.prepare(`SELECT attempt_id, expanded_room_id, expanded_room_version, user_id FROM expanded_room_runs
        WHERE attempt_id IN (SELECT value FROM json_each(?)) OR legacy_course_attempt_id IN (SELECT value FROM json_each(?))`)
        .bind(courseIds, courseIds).all<ExpandedRunRow>()).results;
    } catch (error) {
      if (!isExpandedRoomSchemaMissingError(error)) throw error;
    }
  }
  const players = new Map<string, DiscoveryPlayer>();
  const addPlayer = (player: DiscoveryPlayer) => {
    players.set(JSON.stringify([player.source, player.contentId, player.version, player.userId]), player);
  };
  for (const run of roomRuns) addPlayer({ source: 'room', contentId: run.sourceId, version: run.version, userId: run.userId });
  for (const run of courseRuns) addPlayer({ source: 'course', contentId: run.sourceId, version: run.version, userId: run.userId });
  for (const row of expanded) {
    addPlayer({ source: 'expanded_room', contentId: row.expanded_room_id, version: Number(row.expanded_room_version), userId: row.user_id });
  }
  return {
    insightAttemptKeys: [...new Set([
      ...roomRuns.map((run) => `room:${run.attemptId}`),
      ...courseRuns.flatMap((run) => [`course:${run.attemptId}`, `expanded:${run.attemptId}`]),
      ...expanded.map((row) => `expanded:${row.attempt_id}`),
    ])],
    removedAttemptIds: [...new Set([...roomRuns, ...courseRuns].map((run) => run.attemptId).concat(expanded.map((row) => row.attempt_id)))],
    players: [...players.values()],
  };
}

/**
 * Rebuilds a player's discovery row from the accepted runs that remain, the same way the
 * historical backfill does (scripts/sql/backfill_discovery_run_players.sql), or drops it when none do.
 */
function recomputeDiscoveryPlayerSql(source: RunSource): string {
  const { table, id, version } = SOURCES[source];
  return `INSERT INTO discovery_run_players (target_key, version_key, user_id, difficulty_choice, sampled_at, last_played_at)
    WITH outcomes AS (
      SELECT attempt_id, result, finished_at, COALESCE(elapsed_ms, 0) AS elapsed_ms, COALESCE(deaths, 0) AS deaths,
        COALESCE(collectibles_collected, 0) AS collectibles, COALESCE(enemies_defeated, 0) AS enemies,
        COALESCE(checkpoints_reached, 0) AS checkpoints
      FROM ${table} WHERE user_id = ? AND ${id} = ? AND ${version} = ? AND result IN ('completed', 'failed')
        AND COALESCE(verification_status, 'not_required') IN ('not_required', 'passed') AND finished_at IS NOT NULL
      UNION ALL
      SELECT attempt_id, result, finished_at, COALESCE(json_extract(metrics_json, '$.elapsedMs'), 0),
        COALESCE(json_extract(metrics_json, '$.deaths'), 0), COALESCE(json_extract(metrics_json, '$.collectiblesCollected'), 0),
        COALESCE(json_extract(metrics_json, '$.enemiesDefeated'), 0), COALESCE(json_extract(metrics_json, '$.checkpointsReached'), 0)
      FROM guest_run_attempts WHERE claimed_user_id = ? AND content_type = ? AND content_id = ? AND content_version = ?
        AND result = 'completed' AND verification_status = 'passed' AND json_valid(metrics_json) AND finished_at IS NOT NULL
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY (result = 'completed') DESC, finished_at ASC, attempt_id ASC) AS sample_order,
        MAX(finished_at) OVER () AS last_played_at
      FROM outcomes WHERE attempt_id NOT IN (SELECT value FROM json_each(?))
    ), scored AS (
      SELECT *, MAX(0, elapsed_ms) / 60000.0 * 0.85 + MAX(0, deaths) * 1.35 + MIN(MAX(0, collectibles), 10) * 0.08
        + MIN(MAX(0, enemies), 8) * 0.1 + MIN(MAX(0, checkpoints), 5) * 0.14 AS difficulty_score
      FROM ranked WHERE sample_order = 1
    )
    SELECT ?, ?, ?,
      CASE WHEN result <> 'completed' THEN NULL WHEN difficulty_score < 0.9 THEN 'easy' WHEN difficulty_score < 2.6 THEN 'medium'
        WHEN difficulty_score < 5.4 THEN 'hard' ELSE 'extreme' END,
      CASE WHEN result = 'completed' THEN finished_at ELSE NULL END,
      last_played_at
    FROM scored`;
}

/** Runs in the same batch as the run deletes. */
export function prepareStatsRollbackStatements(env: Env, rollback: StatsRollback): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (rollback.insightAttemptKeys.length > 0) {
    statements.push(env.DB.prepare('DELETE FROM room_insight_attempts WHERE attempt_key IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(rollback.insightAttemptKeys)));
  }
  const removed = JSON.stringify(rollback.removedAttemptIds);
  for (const player of rollback.players) {
    const targetKey = SOURCES[player.source].targetPrefix + player.contentId;
    statements.push(env.DB.prepare('DELETE FROM discovery_run_players WHERE target_key = ? AND version_key = ? AND user_id = ?')
      .bind(targetKey, player.version, player.userId));
    statements.push(env.DB.prepare(recomputeDiscoveryPlayerSql(player.source)).bind(
      player.userId, player.contentId, player.version,
      player.userId, player.source, player.contentId, player.version,
      removed, targetKey, player.version, player.userId,
    ));
  }
  return statements;
}
