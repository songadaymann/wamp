import {
  type BadgeAwardSummary,
  type ProgressionSummary,
  type QualityRatingSummary,
  type TrophyAwardSummary,
  type TrophyContentType,
} from '../../../progression/model';
import type { BadgeAwardRow, ContentTrophyRow, Env } from '../core/types';
import {
  buildLaneSummary,
  parseRowNumber,
  TROPHY_MIN_WEIGHTED_VOTES,
  TROPHY_THRESHOLD,
} from './shared';
import {
  loadBackfillSeedMetrics,
  loadOrBackfillUserProgress,
  loadReadOnlyUserProgress,
  upsertUserProgressRow,
} from './progressRows';
import { loadBuilderCapabilitySummary } from './trustCaps';
import { isExpandedRoomSchemaMissingError } from '../expandedRooms/schemaErrors';

const BADGE_DEFINITIONS: Record<
  string,
  {
    category: BadgeAwardSummary['category'];
    label: string;
    description: string;
  }
> = {
  founder_first_99: {
    category: 'founder',
    label: 'First 99',
    description: 'Qualified as one of the first 99 WAMP identities.',
  },
  founder_first_999: {
    category: 'founder',
    label: 'First 999',
    description: 'Qualified as one of the first 999 WAMP identities.',
  },
  founder_first_9999: {
    category: 'founder',
    label: 'First 9999',
    description: 'Qualified as one of the first 9999 WAMP identities.',
  },
  player_first_clear: {
    category: 'player',
    label: 'First Clear',
    description: 'Completed a published room or course challenge.',
  },
  player_10_clears: {
    category: 'player',
    label: '10 Clears',
    description: 'Completed ten published room or course challenges.',
  },
  player_100_clears: {
    category: 'player',
    label: '100 Clears',
    description: 'Completed one hundred published room or course challenges.',
  },
  player_top10_entrant: {
    category: 'player',
    label: 'Top 10',
    description: 'Broke into a top-10 leaderboard.',
  },
  player_top1_finisher: {
    category: 'player',
    label: '#1',
    description: 'Took the top spot on a leaderboard.',
  },
  builder_first_published_challenge: {
    category: 'builder',
    label: 'First Room',
    description: 'Published a room challenge with a real goal.',
  },
  builder_first_published_course: {
    category: 'builder',
    label: 'First Expanded Room',
    description: 'Published an Expanded Room.',
  },
  builder_10_unique_players: {
    category: 'builder',
    label: '10 Players',
    description: 'Ten unique players completed your published work.',
  },
  builder_100_unique_players: {
    category: 'builder',
    label: '100 Players',
    description: 'One hundred unique players completed your published work.',
  },
  builder_first_trophy_room: {
    category: 'builder',
    label: 'First Trophy',
    description: 'One of your room or course versions earned a trophy.',
  },
  curator_first_rating: {
    category: 'curator',
    label: 'First Rating',
    description: 'Submitted your first post-run rating.',
  },
  curator_50_ratings: {
    category: 'curator',
    label: '50 Ratings',
    description: 'Submitted fifty post-run ratings.',
  },
  curator_200_ratings: {
    category: 'curator',
    label: '200 Ratings',
    description: 'Submitted two hundred post-run ratings.',
  },
};

export async function loadTrophyForContentVersion(
  env: Env,
  contentType: TrophyContentType,
  contentId: string,
  versionKey: number,
): Promise<TrophyAwardSummary | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        content_type,
        content_id,
        version_key,
        trophy_type,
        metric_value,
        weighted_vote_count,
        awarded_at
      FROM content_trophies
      WHERE content_type = ?
        AND content_id = ?
        AND version_key = ?
      ORDER BY awarded_at DESC
      LIMIT 1
    `
  )
    .bind(contentType, contentId, versionKey)
    .first<ContentTrophyRow>();

  if (!row) {
    return null;
  }

  return {
    contentType,
    contentId,
    versionKey: parseRowNumber(row.version_key),
    trophyType: row.trophy_type,
    awardedAt: row.awarded_at,
  };
}

async function loadOwnedRoomTrophyRows(env: Env, userId: string): Promise<TrophyAwardSummary[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        t.content_type,
        t.content_id,
        t.version_key,
        t.trophy_type,
        t.metric_value,
        t.weighted_vote_count,
        t.awarded_at
      FROM content_trophies t
      INNER JOIN room_versions v
        ON t.content_type = 'room'
       AND t.content_id = v.room_id
       AND t.version_key = v.version
      WHERE v.published_by_user_id = ?
      ORDER BY t.awarded_at DESC
      LIMIT 12
    `
  )
    .bind(userId)
    .all<ContentTrophyRow>();

  return result.results.map((row) => ({
    contentType: 'room',
    contentId: row.content_id,
    versionKey: parseRowNumber(row.version_key),
    trophyType: row.trophy_type,
    awardedAt: row.awarded_at,
  }));
}

async function loadOwnedCourseTrophyRows(env: Env, userId: string): Promise<TrophyAwardSummary[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        t.content_type,
        t.content_id,
        t.version_key,
        t.trophy_type,
        t.metric_value,
        t.weighted_vote_count,
        t.awarded_at
      FROM content_trophies t
      INNER JOIN course_versions v
        ON t.content_type = 'course'
       AND t.content_id = v.course_id
       AND t.version_key = v.version
      WHERE v.published_by_user_id = ?
      ORDER BY t.awarded_at DESC
      LIMIT 12
    `
  )
    .bind(userId)
    .all<ContentTrophyRow>();

  return result.results.map((row) => ({
    contentType: 'course',
    contentId: row.content_id,
    versionKey: parseRowNumber(row.version_key),
    trophyType: row.trophy_type,
    awardedAt: row.awarded_at,
  }));
}

async function loadOwnedExpandedRoomTrophyRows(env: Env, userId: string): Promise<TrophyAwardSummary[]> {
  let result;
  try {
    result = await env.DB.prepare(
      `
        SELECT
          t.content_type,
          t.content_id,
          t.version_key,
          t.trophy_type,
          t.metric_value,
          t.weighted_vote_count,
          t.awarded_at
        FROM content_trophies t
        INNER JOIN expanded_room_versions v
          ON t.content_type = 'expanded_room'
         AND t.content_id = v.expanded_room_id
         AND t.version_key = v.version
        WHERE v.published_by_user_id = ?
        ORDER BY t.awarded_at DESC
        LIMIT 12
      `
    )
      .bind(userId)
      .all<ContentTrophyRow>();
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }

  return result.results.map((row) => ({
    contentType: 'expanded_room',
    contentId: row.content_id,
    versionKey: parseRowNumber(row.version_key),
    trophyType: row.trophy_type,
    awardedAt: row.awarded_at,
  }));
}

async function countOwnedTrophies(env: Env, userId: string): Promise<number> {
  const [roomRows, courseRows, expandedRoomRows] = await Promise.all([
    loadOwnedRoomTrophyRows(env, userId),
    loadOwnedCourseTrophyRows(env, userId),
    loadOwnedExpandedRoomTrophyRows(env, userId),
  ]);
  return dedupePlayableTrophies([...roomRows, ...courseRows, ...expandedRoomRows]).length;
}

async function upsertBadgeAward(
  env: Env,
  userId: string,
  badgeId: string,
  sourceType: string,
  sourceId: string,
  awardedAt: string,
): Promise<boolean> {
  const existing = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM badge_awards
      WHERE user_id = ?
        AND badge_id = ?
      LIMIT 1
    `
  )
    .bind(userId, badgeId)
    .first<{ found: number | string | null }>();

  if (parseRowNumber(existing?.found) === 1) {
    return false;
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO badge_awards (
          user_id,
          badge_id,
          source_type,
          source_id,
          metadata_json,
          awarded_at
        )
        VALUES (?, ?, ?, ?, NULL, ?)
      `
    ).bind(userId, badgeId, sourceType, sourceId, awardedAt),
  ]);
  return true;
}

async function loadBadgeAwardRows(env: Env, userId: string): Promise<BadgeAwardRow[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        user_id,
        badge_id,
        source_type,
        source_id,
        metadata_json,
        awarded_at
      FROM badge_awards
      WHERE user_id = ?
      ORDER BY awarded_at DESC, badge_id ASC
    `
  )
    .bind(userId)
    .all<BadgeAwardRow>();

  return result.results;
}

async function syncBadgeAndTrophyCounts(env: Env, userId: string): Promise<void> {
  const progress = await loadOrBackfillUserProgress(env, userId);
  const badgeRows = await loadBadgeAwardRows(env, userId);
  const trophyCount = await countOwnedTrophies(env, userId);
  await upsertUserProgressRow(env, {
    ...progress,
    badge_count: badgeRows.length,
    trophy_count: trophyCount,
    updated_at: new Date().toISOString(),
  });
}

export async function syncUserBadges(env: Env, userId: string): Promise<void> {
  const progress = await loadOrBackfillUserProgress(env, userId);
  const now = new Date().toISOString();
  const metrics = await loadBackfillSeedMetrics(env, userId);
  const top10Event = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM pxp_events
      WHERE user_id = ?
        AND event_type = 'top10_entry'
      LIMIT 1
    `
  )
    .bind(userId)
    .first<{ found: number | string | null }>();
  const top1Event = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM pxp_events
      WHERE user_id = ?
        AND event_type = 'top1_take'
      LIMIT 1
    `
  )
    .bind(userId)
    .first<{ found: number | string | null }>();

  const totalClears = metrics.roomClearCount + metrics.courseClearCount;
  if (progress.founder_number !== null && progress.founder_number <= 99) {
    await upsertBadgeAward(env, userId, 'founder_first_99', 'founder_number', String(progress.founder_number), now);
  }
  if (progress.founder_number !== null && progress.founder_number <= 999) {
    await upsertBadgeAward(env, userId, 'founder_first_999', 'founder_number', String(progress.founder_number), now);
  }
  if (progress.founder_number !== null && progress.founder_number <= 9999) {
    await upsertBadgeAward(env, userId, 'founder_first_9999', 'founder_number', String(progress.founder_number), now);
  }
  if (totalClears >= 1) {
    await upsertBadgeAward(env, userId, 'player_first_clear', 'clear_count', String(totalClears), now);
  }
  if (totalClears >= 10) {
    await upsertBadgeAward(env, userId, 'player_10_clears', 'clear_count', String(totalClears), now);
  }
  if (totalClears >= 100) {
    await upsertBadgeAward(env, userId, 'player_100_clears', 'clear_count', String(totalClears), now);
  }
  if (parseRowNumber(top10Event?.found) === 1) {
    await upsertBadgeAward(env, userId, 'player_top10_entrant', 'pxp_event', 'top10_entry', now);
  }
  if (parseRowNumber(top1Event?.found) === 1) {
    await upsertBadgeAward(env, userId, 'player_top1_finisher', 'pxp_event', 'top1_take', now);
  }
  if (metrics.roomPublishCount >= 1) {
    await upsertBadgeAward(env, userId, 'builder_first_published_challenge', 'publish_count', String(metrics.roomPublishCount), now);
  }
  if (metrics.coursePublishCount >= 1) {
    await upsertBadgeAward(env, userId, 'builder_first_published_course', 'course_publish_count', String(metrics.coursePublishCount), now);
  }
  if (metrics.creatorUniqueCompletionCount >= 10) {
    await upsertBadgeAward(env, userId, 'builder_10_unique_players', 'creator_unique_completion_count', String(metrics.creatorUniqueCompletionCount), now);
  }
  if (metrics.creatorUniqueCompletionCount >= 100) {
    await upsertBadgeAward(env, userId, 'builder_100_unique_players', 'creator_unique_completion_count', String(metrics.creatorUniqueCompletionCount), now);
  }
  if (await countOwnedTrophies(env, userId)) {
    await upsertBadgeAward(env, userId, 'builder_first_trophy_room', 'trophy_count', '1', now);
  }
  if (metrics.ratingCount >= 1) {
    await upsertBadgeAward(env, userId, 'curator_first_rating', 'rating_count', String(metrics.ratingCount), now);
  }
  if (metrics.ratingCount >= 50) {
    await upsertBadgeAward(env, userId, 'curator_50_ratings', 'rating_count', String(metrics.ratingCount), now);
  }
  if (metrics.ratingCount >= 200) {
    await upsertBadgeAward(env, userId, 'curator_200_ratings', 'rating_count', String(metrics.ratingCount), now);
  }

  await syncBadgeAndTrophyCounts(env, userId);
}

export async function loadPublicProgressionSummary(
  env: Env,
  userId: string,
): Promise<ProgressionSummary> {
  const progress = await loadReadOnlyUserProgress(env, userId);
  const [badgeRows, roomTrophies, courseTrophies, expandedRoomTrophies] = await Promise.all([
    loadBadgeAwardRows(env, userId),
    loadOwnedRoomTrophyRows(env, userId),
    loadOwnedCourseTrophyRows(env, userId),
    loadOwnedExpandedRoomTrophyRows(env, userId),
  ]);
  const ownedTrophies = dedupePlayableTrophies([...roomTrophies, ...courseTrophies, ...expandedRoomTrophies]);
  const recentTrophies = ownedTrophies
    .sort((left, right) => Date.parse(right.awardedAt) - Date.parse(left.awardedAt))
    .slice(0, 6);
  const builderCaps = await loadBuilderCapabilitySummary(env, progress, 'session');

  return {
    founderNumber: progress.founder_number,
    player: buildLaneSummary('player', progress.total_pxp),
    builder: buildLaneSummary('builder', progress.total_bxp),
    curator: buildLaneSummary('curator', progress.total_cxp),
    builderCaps,
    featuredBadges: badgeRows
      .map<BadgeAwardSummary | null>((row) => {
        const definition = BADGE_DEFINITIONS[row.badge_id];
        if (!definition) {
          return null;
        }
        return {
          badgeId: row.badge_id,
          category: definition.category,
          label: definition.label,
          description: definition.description,
          awardedAt: row.awarded_at,
        };
      })
      .filter((value): value is BadgeAwardSummary => value !== null)
      .slice(0, 6),
    badgeCount: badgeRows.length,
    trophyCount: ownedTrophies.length,
    recentTrophies,
  };
}


export async function syncContentTrophy(
  env: Env,
  contentType: TrophyContentType,
  contentId: string,
  versionKey: number,
  quality: QualityRatingSummary,
): Promise<void> {
  if (
    quality.adjustedAverage !== null &&
    quality.adjustedAverage >= TROPHY_THRESHOLD &&
    quality.weightedVoteCount >= TROPHY_MIN_WEIGHTED_VOTES
  ) {
    await env.DB.batch([
      env.DB.prepare(
        `
          INSERT INTO content_trophies (
            content_type,
            content_id,
            version_key,
            trophy_type,
            metric_value,
            weighted_vote_count,
            awarded_at
          )
          VALUES (?, ?, ?, 'quality', ?, ?, ?)
          ON CONFLICT(content_type, content_id, version_key, trophy_type) DO UPDATE SET
            metric_value = excluded.metric_value,
            weighted_vote_count = excluded.weighted_vote_count
        `
      ).bind(
        contentType,
        contentId,
        versionKey,
        quality.adjustedAverage,
        quality.weightedVoteCount,
        new Date().toISOString(),
      ),
    ]);
    return;
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        DELETE FROM content_trophies
        WHERE content_type = ?
          AND content_id = ?
          AND version_key = ?
          AND trophy_type = 'quality'
      `
    ).bind(contentType, contentId, versionKey),
  ]);
}

export async function refreshContentOwnerProgressCounts(
  env: Env,
  contentType: TrophyContentType,
  contentId: string,
  versionKey: number,
): Promise<void> {
  const ownerRow = await loadContentOwnerRow(env, contentType, contentId, versionKey);

  const ownerUserId = ownerRow?.user_id ?? null;
  if (!ownerUserId) {
    return;
  }

  await syncUserBadges(env, ownerUserId);
}

async function loadContentOwnerRow(
  env: Env,
  contentType: TrophyContentType,
  contentId: string,
  versionKey: number,
): Promise<{ user_id: string | null } | null> {
  if (contentType === 'room') {
    return env.DB.prepare(
      `
        SELECT published_by_user_id AS user_id
        FROM room_versions
        WHERE room_id = ?
          AND version = ?
        LIMIT 1
      `
    )
      .bind(contentId, versionKey)
      .first<{ user_id: string | null }>();
  }

  if (contentType === 'expanded_room') {
    return env.DB.prepare(
      `
        SELECT published_by_user_id AS user_id
        FROM expanded_room_versions
        WHERE expanded_room_id = ?
          AND version = ?
        LIMIT 1
      `
    )
      .bind(contentId, versionKey)
      .first<{ user_id: string | null }>();
  }

  return env.DB.prepare(
    `
      SELECT published_by_user_id AS user_id
      FROM course_versions
      WHERE course_id = ?
        AND version = ?
      LIMIT 1
    `
  )
    .bind(contentId, versionKey)
    .first<{ user_id: string | null }>();
}

function dedupePlayableTrophies(trophies: TrophyAwardSummary[]): TrophyAwardSummary[] {
  const byKey = new Map<string, TrophyAwardSummary>();
  const sorted = [...trophies].sort((left, right) => trophyPriority(right) - trophyPriority(left));
  for (const trophy of sorted) {
    const key = getPlayableTrophyKey(trophy);
    if (!byKey.has(key)) {
      byKey.set(key, trophy);
    }
  }
  return [...byKey.values()];
}

function getPlayableTrophyKey(trophy: TrophyAwardSummary): string {
  if (trophy.contentType === 'course') {
    return `expanded_room:course:${trophy.contentId}:${trophy.versionKey}:${trophy.trophyType}`;
  }
  return `${trophy.contentType}:${trophy.contentId}:${trophy.versionKey}:${trophy.trophyType}`;
}

function trophyPriority(trophy: TrophyAwardSummary): number {
  if (trophy.contentType === 'expanded_room') {
    return 2;
  }
  if (trophy.contentType === 'course') {
    return 1;
  }
  return 0;
}
