import { suggestProgressionDifficulty, type ProgressionDifficultySuggestionInput } from '../../../progression/autoDifficulty';
import type { RunResult, RoomDifficulty } from '../../../runs/model';
import type { GuestRunContentType } from '../../../guestRooms/runModel';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { sqlUserIdIsNotLegacyGeneratedOnly, sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix } from '../generatedUsers/leaderboardIsolation';

const MEASURED_DIFFICULTY_MIN_PLAYERS = 3;
export const POPULAR_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

interface RunSample extends ProgressionDifficultySuggestionInput {
  result: RunResult;
  finishedAt?: string | null;
}
interface ClaimedRunRow extends ProgressionDifficultySuggestionInput {
  content_type: GuestRunContentType;
  content_id: string;
  content_version: number;
  finished_at: string;
}

function discoveryTargetKey(type: GuestRunContentType, id: string): string {
  return type === 'course' ? 'expanded_room:course:' + id : type + ':' + id;
}

export async function recordDiscoveryRunPlayer(
  env: Env, targetKey: string, version: number, userId: string, sample: RunSample,
): Promise<void> {
  if (!sample.finishedAt || (sample.result !== 'completed' && sample.result !== 'failed')) return;
  const choice = sample.result === 'completed' ? suggestProgressionDifficulty(sample) : null;
  await env.DB.batch([env.DB.prepare(`
    INSERT INTO discovery_run_players
      (target_key, version_key, user_id, difficulty_choice, sampled_at, last_played_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_key, version_key, user_id) DO UPDATE SET
      difficulty_choice = CASE
        WHEN excluded.sampled_at IS NOT NULL AND
          (discovery_run_players.sampled_at IS NULL OR excluded.sampled_at < discovery_run_players.sampled_at)
        THEN excluded.difficulty_choice ELSE discovery_run_players.difficulty_choice END,
      sampled_at = CASE
        WHEN excluded.sampled_at IS NOT NULL AND
          (discovery_run_players.sampled_at IS NULL OR excluded.sampled_at < discovery_run_players.sampled_at)
        THEN excluded.sampled_at ELSE discovery_run_players.sampled_at END,
      last_played_at = MAX(discovery_run_players.last_played_at, excluded.last_played_at)
  `).bind(targetKey, version, userId, choice, choice ? sample.finishedAt : null, sample.finishedAt)]);
}

export async function recordClaimedDiscoveryPlayers(env: Env, claimId: string, userId: string): Promise<void> {
  const rows = await env.DB.prepare(`
    SELECT content_type, content_id, content_version, finished_at,
      json_extract(metrics_json, '$.elapsedMs') AS elapsedMs,
      json_extract(metrics_json, '$.deaths') AS deaths,
      json_extract(metrics_json, '$.collectiblesCollected') AS collectiblesCollected,
      json_extract(metrics_json, '$.enemiesDefeated') AS enemiesDefeated,
      json_extract(metrics_json, '$.checkpointsReached') AS checkpointsReached
    FROM guest_run_attempts
    WHERE claim_id = ? AND claimed_user_id = ? AND result = 'completed' AND verification_status = 'passed'
    ORDER BY finished_at, attempt_id LIMIT 50
  `).bind(claimId, userId).all<ClaimedRunRow>();
  for (const row of rows.results) {
    await recordDiscoveryRunPlayer(env, discoveryTargetKey(row.content_type, row.content_id),
      row.content_version, userId, { ...row, result: 'completed', finishedAt: row.finished_at });
  }
}

export async function scheduleDiscoveryMetrics(
  context: WorkerExecutionContextLike | undefined, work: Promise<void>,
): Promise<void> {
  const guarded = work.catch((error: unknown) => console.error('Discovery run metrics refresh failed.', error));
  if (context) context.waitUntil(guarded);
  else await guarded;
}

/** Current versions only. Each row is one player, regardless of replay count. */
export const DISCOVERY_RUN_METRICS_CTE = `
  run_counts AS (
    SELECT players.target_key, players.version_key,
      SUM(players.last_played_at >= ?) AS recent_players,
      COUNT(players.difficulty_choice) AS measured_players,
      SUM(players.difficulty_choice = 'easy') AS easy_players,
      SUM(players.difficulty_choice = 'medium') AS medium_players,
      SUM(players.difficulty_choice = 'hard') AS hard_players
    FROM discovery_run_players players
    INNER JOIN playable_content_index current_target
      ON current_target.target_key = players.target_key AND current_target.version_key = players.version_key
    WHERE players.user_id <> COALESCE(current_target.builder_user_id, '')
      AND ${sqlUserIdIsNotLegacyGeneratedOnly('players.user_id')}
      AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('players.user_id')}
    GROUP BY players.target_key, players.version_key
  ),
  run_metrics AS (
    SELECT *, CASE
      WHEN measured_players < ${MEASURED_DIFFICULTY_MIN_PLAYERS} THEN NULL
      WHEN easy_players >= measured_players / 2 + 1 THEN 'easy'
      WHEN easy_players + medium_players >= measured_players / 2 + 1 THEN 'medium'
      WHEN easy_players + medium_players + hard_players >= measured_players / 2 + 1 THEN 'hard'
      ELSE 'extreme' END AS measured_difficulty
    FROM run_counts
  )
`;

export interface DiscoveryRunMetrics {
  target_key: string;
  version_key: number;
  measured_players: number;
  recent_players: number;
  measured_difficulty: RoomDifficulty | null;
}

export async function loadDiscoveryRunMetrics(env: Env): Promise<Map<string, DiscoveryRunMetrics>> {
  try {
    const rows = await env.DB.prepare(`WITH ${DISCOVERY_RUN_METRICS_CTE} SELECT * FROM run_metrics`)
      .bind(new Date(Date.now() - POPULAR_WINDOW_MS).toISOString()).all<DiscoveryRunMetrics>();
    return new Map(rows.results.map(row => [row.target_key, row]));
  } catch (error) {
    if (/no such table: (discovery_run_players|playable_content_index)/i.test(String(error))) return new Map();
    throw error;
  }
}

export function resolveDiscoveryDifficulty(
  voted: RoomDifficulty | null, votes: number, measured: DiscoveryRunMetrics | undefined,
): { consensusDifficulty: RoomDifficulty | null; difficultySource: 'votes' | 'measured' | null } {
  if (voted && votes >= 3) return { consensusDifficulty: voted, difficultySource: 'votes' };
  if (measured?.measured_difficulty) return { consensusDifficulty: measured.measured_difficulty, difficultySource: 'measured' };
  return { consensusDifficulty: voted, difficultySource: voted ? 'votes' : null };
}
