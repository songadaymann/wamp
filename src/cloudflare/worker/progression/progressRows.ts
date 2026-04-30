import { HttpError } from '../core/http';
import type { Env, UserProgressRow, UserRow } from '../core/types';
import { sanitizeOptionalOverride } from './capabilities';
import {
  LANE_BASE_XP,
  levelForXp,
  parseRowNumber,
  type ProgressSeedMetrics,
  trustTierFromScore,
} from './shared';

export async function loadUserIdentityRow(env: Env, userId: string): Promise<UserRow | null> {
  return env.DB.prepare(
    `
      SELECT
        id,
        email,
        wallet_address,
        display_name,
        avatar_url,
        bio,
        selected_avatar_id,
        created_at,
        updated_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<UserRow>();
}

export async function loadUserProgressRow(env: Env, userId: string): Promise<UserProgressRow | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        user_id,
        total_pxp,
        total_bxp,
        total_cxp,
        player_level,
        builder_level,
        curator_level,
        hidden_trust_score,
        trust_tier_internal,
        founder_number,
        builder_claim_limit_override,
        builder_publish_limit_override,
        builder_object_limit_override,
        builder_collectible_limit_override,
        builder_cap_override_reason,
        builder_cap_override_updated_at,
        builder_cap_override_updated_by,
        badge_count,
        trophy_count,
        first_identity_qualified_at,
        created_at,
        updated_at
      FROM user_progress
      WHERE user_id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<UserProgressRow>();

  if (!row) {
    return null;
  }

  return {
    ...row,
    total_pxp: parseRowNumber(row.total_pxp),
    total_bxp: parseRowNumber(row.total_bxp),
    total_cxp: parseRowNumber(row.total_cxp),
    player_level: parseRowNumber(row.player_level),
    builder_level: parseRowNumber(row.builder_level),
    curator_level: parseRowNumber(row.curator_level),
    hidden_trust_score: parseRowNumber(row.hidden_trust_score),
    founder_number: row.founder_number === null ? null : parseRowNumber(row.founder_number),
    builder_claim_limit_override: sanitizeOptionalOverride(row.builder_claim_limit_override),
    builder_publish_limit_override: sanitizeOptionalOverride(row.builder_publish_limit_override),
    builder_object_limit_override: sanitizeOptionalOverride(row.builder_object_limit_override),
    builder_collectible_limit_override: sanitizeOptionalOverride(row.builder_collectible_limit_override),
    badge_count: parseRowNumber(row.badge_count),
    trophy_count: parseRowNumber(row.trophy_count),
  };
}

export async function upsertUserProgressRow(env: Env, row: UserProgressRow): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO user_progress (
          user_id,
          total_pxp,
          total_bxp,
          total_cxp,
          player_level,
          builder_level,
          curator_level,
          hidden_trust_score,
          trust_tier_internal,
          founder_number,
          builder_claim_limit_override,
          builder_publish_limit_override,
          builder_object_limit_override,
          builder_collectible_limit_override,
          builder_cap_override_reason,
          builder_cap_override_updated_at,
          builder_cap_override_updated_by,
          badge_count,
          trophy_count,
          first_identity_qualified_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          total_pxp = excluded.total_pxp,
          total_bxp = excluded.total_bxp,
          total_cxp = excluded.total_cxp,
          player_level = excluded.player_level,
          builder_level = excluded.builder_level,
          curator_level = excluded.curator_level,
          hidden_trust_score = excluded.hidden_trust_score,
          trust_tier_internal = excluded.trust_tier_internal,
          founder_number = COALESCE(user_progress.founder_number, excluded.founder_number),
          builder_claim_limit_override = excluded.builder_claim_limit_override,
          builder_publish_limit_override = excluded.builder_publish_limit_override,
          builder_object_limit_override = excluded.builder_object_limit_override,
          builder_collectible_limit_override = excluded.builder_collectible_limit_override,
          builder_cap_override_reason = excluded.builder_cap_override_reason,
          builder_cap_override_updated_at = excluded.builder_cap_override_updated_at,
          builder_cap_override_updated_by = excluded.builder_cap_override_updated_by,
          badge_count = excluded.badge_count,
          trophy_count = excluded.trophy_count,
          first_identity_qualified_at = COALESCE(
            user_progress.first_identity_qualified_at,
            excluded.first_identity_qualified_at
          ),
          updated_at = excluded.updated_at
      `
    ).bind(
      row.user_id,
      row.total_pxp,
      row.total_bxp,
      row.total_cxp,
      row.player_level,
      row.builder_level,
      row.curator_level,
      row.hidden_trust_score,
      row.trust_tier_internal,
      row.founder_number,
      row.builder_claim_limit_override,
      row.builder_publish_limit_override,
      row.builder_object_limit_override,
      row.builder_collectible_limit_override,
      row.builder_cap_override_reason,
      row.builder_cap_override_updated_at,
      row.builder_cap_override_updated_by,
      row.badge_count,
      row.trophy_count,
      row.first_identity_qualified_at,
      row.created_at,
      row.updated_at,
    ),
  ]);
}

async function countDistinctRoomCompletions(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM (
        SELECT DISTINCT room_id, room_version
        FROM room_runs
        WHERE user_id = ?
          AND result = 'completed'
      )
    `
  )
    .bind(userId)
    .first<{ count: number | string | null }>();

  return parseRowNumber(row?.count);
}

async function countDistinctCourseCompletions(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM (
        SELECT DISTINCT course_id, course_version
        FROM course_runs
        WHERE user_id = ?
          AND result = 'completed'
      )
    `
  )
    .bind(userId)
    .first<{ count: number | string | null }>();

  return parseRowNumber(row?.count);
}

async function countDistinctRatingsByUser(env: Env, userId: string): Promise<number> {
  const [roomRow, courseRow] = await Promise.all([
    env.DB.prepare(
      `
        SELECT COUNT(*) AS count
        FROM room_ratings
        WHERE user_id = ?
      `
    )
      .bind(userId)
      .first<{ count: number | string | null }>(),
    env.DB.prepare(
      `
        SELECT COUNT(*) AS count
        FROM course_ratings
        WHERE user_id = ?
      `
    )
      .bind(userId)
      .first<{ count: number | string | null }>(),
  ]);

  return parseRowNumber(roomRow?.count) + parseRowNumber(courseRow?.count);
}

async function countMeaningfulRoomPublishes(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM room_versions
      WHERE published_by_user_id = ?
        AND json_extract(snapshot_json, '$.goal.type') IS NOT NULL
    `
  )
    .bind(userId)
    .first<{ count: number | string | null }>();

  return parseRowNumber(row?.count);
}

async function countMeaningfulCoursePublishes(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM course_versions
      WHERE published_by_user_id = ?
        AND json_extract(snapshot_json, '$.goal.type') IS NOT NULL
    `
  )
    .bind(userId)
    .first<{ count: number | string | null }>();

  return parseRowNumber(row?.count);
}

async function countHistoricalCreatorUniqueCompletions(env: Env, userId: string): Promise<number> {
  const [roomRow, courseRow] = await Promise.all([
    env.DB.prepare(
      `
        SELECT COUNT(*) AS count
        FROM (
          SELECT DISTINCT r.room_id, r.user_id
          FROM room_runs r
          INNER JOIN room_versions v
            ON v.room_id = r.room_id
           AND v.version = r.room_version
          WHERE v.published_by_user_id = ?
            AND r.result = 'completed'
            AND r.user_id != ?
        )
      `
    )
      .bind(userId, userId)
      .first<{ count: number | string | null }>(),
    env.DB.prepare(
      `
        SELECT COUNT(*) AS count
        FROM (
          SELECT DISTINCT r.course_id, r.user_id
          FROM course_runs r
          INNER JOIN course_versions v
            ON v.course_id = r.course_id
           AND v.version = r.course_version
          WHERE v.published_by_user_id = ?
            AND r.result = 'completed'
            AND r.user_id != ?
        )
      `
    )
      .bind(userId, userId)
      .first<{ count: number | string | null }>(),
  ]);

  return parseRowNumber(roomRow?.count) + parseRowNumber(courseRow?.count);
}

export async function loadBackfillSeedMetrics(env: Env, userId: string): Promise<ProgressSeedMetrics> {
  const [
    roomClearCount,
    courseClearCount,
    ratingCount,
    roomPublishCount,
    coursePublishCount,
    creatorUniqueCompletionCount,
  ] = await Promise.all([
    countDistinctRoomCompletions(env, userId),
    countDistinctCourseCompletions(env, userId),
    countDistinctRatingsByUser(env, userId),
    countMeaningfulRoomPublishes(env, userId),
    countMeaningfulCoursePublishes(env, userId),
    countHistoricalCreatorUniqueCompletions(env, userId),
  ]);

  return {
    roomClearCount,
    courseClearCount,
    ratingCount,
    roomPublishCount,
    coursePublishCount,
    creatorUniqueCompletionCount,
  };
}

async function createBackfilledUserProgressRow(
  env: Env,
  userId: string,
): Promise<UserProgressRow> {
  const identity = await loadUserIdentityRow(env, userId);
  if (!identity) {
    throw new HttpError(404, 'User progress target was not found.');
  }

  const metrics = await loadBackfillSeedMetrics(env, userId);
  const accountAgeDays = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(identity.created_at)) / 86400000),
  );
  const now = new Date().toISOString();

  const totalPxp =
    metrics.roomClearCount * LANE_BASE_XP.roomClear +
    metrics.courseClearCount * LANE_BASE_XP.courseClear +
    Math.min(metrics.ratingCount, 100) * LANE_BASE_XP.ratingPxp;
  const totalBxp =
    metrics.roomPublishCount * LANE_BASE_XP.roomPublish +
    metrics.coursePublishCount * LANE_BASE_XP.coursePublish +
    metrics.creatorUniqueCompletionCount * 4;
  const totalCxp =
    metrics.ratingCount * LANE_BASE_XP.roomRatingCxp;
  const trustScore =
    Math.min(40, Math.floor(accountAgeDays / 14)) +
    (identity.email ? 20 : 0) +
    (identity.wallet_address ? 20 : 0) +
    Math.min(50, metrics.roomClearCount + metrics.courseClearCount) +
    Math.min(60, metrics.roomPublishCount * 6 + metrics.coursePublishCount * 8) +
    Math.min(60, Math.floor(metrics.creatorUniqueCompletionCount * 0.8)) +
    Math.min(20, Math.floor(metrics.ratingCount / 4));
  const trustTier = trustTierFromScore(trustScore);

  return {
    user_id: userId,
    total_pxp: totalPxp,
    total_bxp: totalBxp,
    total_cxp: totalCxp,
    player_level: levelForXp(totalPxp),
    builder_level: levelForXp(totalBxp),
    curator_level: levelForXp(totalCxp),
    hidden_trust_score: trustScore,
    trust_tier_internal: trustTier,
    founder_number: null,
    builder_claim_limit_override: null,
    builder_publish_limit_override: null,
    builder_object_limit_override: null,
    builder_collectible_limit_override: null,
    builder_cap_override_reason: null,
    builder_cap_override_updated_at: null,
    builder_cap_override_updated_by: null,
    badge_count: 0,
    trophy_count: 0,
    first_identity_qualified_at: null,
    created_at: now,
    updated_at: now,
  };
}

export async function loadOrBackfillUserProgress(
  env: Env,
  userId: string,
): Promise<UserProgressRow> {
  const existing = await loadUserProgressRow(env, userId);
  if (existing) {
    return existing;
  }

  const created = await createBackfilledUserProgressRow(env, userId);
  await upsertUserProgressRow(env, created);
  return (await loadUserProgressRow(env, userId)) ?? created;
}
