import type { Env, UserStatsRow } from '../core/types';
import { storedRoomProtectionSql } from '../rooms/protection';
import { sqlUserIdIsNotLegacyGeneratedOnly } from '../generatedUsers/leaderboardIsolation';

export async function loadPublicUserProfileCourseCount(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM courses
      WHERE owner_user_id = ?
        AND published_json IS NOT NULL
    `
  )
    .bind(userId)
    .first<{ count: number | string | null }>();

  return Number(row?.count ?? 0) || 0;
}

export async function loadUserStatsRow(env: Env, userId: string) {
  return env.DB.prepare(
    `
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
        updated_at
      FROM user_stats
      WHERE user_id = ?
        AND ${sqlUserIdIsNotLegacyGeneratedOnly('user_stats.user_id')}
      LIMIT 1
    `
  )
    .bind(userId)
    .first<UserStatsRow>();
}

export async function loadPublishedRoomsByCreator(env: Env, userId: string) {
  const result = await env.DB.prepare(
    `
      SELECT
        id,
        x,
        y,
        published_title,
        published_json,
        CASE WHEN ${storedRoomProtectionSql()} THEN 1 ELSE 0 END AS is_minted
      FROM rooms
      WHERE published_json IS NOT NULL
        AND claimer_user_id = ?
    `
  )
    .bind(userId)
    .all<{
      id: string;
      x: number;
      y: number;
      published_title: string | null;
      published_json: string;
      is_minted?: number;
    }>();

  return result.results;
}

