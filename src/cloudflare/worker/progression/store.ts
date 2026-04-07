import { getObjectById, type PlacedObject } from '../../../config';
import type { CourseGoal, CourseRecord, CourseSnapshot } from '../../../courses/model';
import { compareCourseLeaderboardEntries } from '../../../courses/scoring';
import type { CourseRunRecord } from '../../../courses/runModel';
import type { RoomGoal } from '../../../goals/roomGoals';
import type { RoomRecord, RoomSnapshot, RoomVersionRecord } from '../../../persistence/roomModel';
import {
  type BuilderCapabilitySummary,
  type BadgeAwardSummary,
  type CourseRatingResponse,
  type CourseRatingRequestBody,
  type DifficultyRatingSummary,
  type ProgressionDelta,
  type ProgressionDifficulty,
  PROGRESSION_DIFFICULTIES,
  type ProgressionDifficultyCounts,
  type ProgressionLane,
  type ProgressionLaneSummary,
  type ProgressionQualityCounts,
  type ProgressionSummary,
  type QualityRatingSummary,
  type RatingAggregateSummary,
  type RoomRatingResponse,
  type RoomRatingRequestBody,
  type TrustTier,
  type TrophyAwardSummary,
  type ViewerRatingSummary,
} from '../../../progression/model';
import { sortCompletedRunsForLeaderboard } from '../../../runs/scoring';
import type { RoomRunRecord } from '../../../runs/model';
import { HttpError } from '../core/http';
import type {
  BadgeAwardRow,
  ContentTrophyRow,
  CourseRatingRow,
  CourseRunRow,
  D1PreparedStatement,
  Env,
  ProgressEventRow,
  RoomRatingRow,
  RoomRunRow,
  RoomVersionAttributionRow,
  UserProgressRow,
  UserRow,
} from '../core/types';

export interface RoomCapabilitySnapshot {
  trustTier: TrustTier;
  claimLimitPerDay: number;
  publishLimitPerDay: number;
  objectLimit: number;
  collectibleLimit: number;
}

interface LaneEventConfig {
  table: 'pxp_events' | 'bxp_events' | 'cxp_events' | 'trust_events';
  amount: number;
  eventType: string;
  sourceType: string;
  sourceId: string;
  dedupeKey: string;
  createdAt: string;
  breakdown?: Record<string, unknown> | null;
}

interface ProgressSeedMetrics {
  roomClearCount: number;
  courseClearCount: number;
  ratingCount: number;
  roomPublishCount: number;
  coursePublishCount: number;
  creatorUniqueCompletionCount: number;
}

interface RatingWindow {
  versionKey: number;
  lineageKey: string;
  versionFamily: number[];
}

interface RatingSummaryOptions {
  viewerUserId: string | null;
  viewerCanVote: boolean;
  viewerNeedsRun: boolean;
}

interface DifficultyAccumulator {
  easy: number;
  medium: number;
  hard: number;
  extreme: number;
}

const QUALITY_PRIOR_MEAN = 3.5;
const QUALITY_PRIOR_WEIGHT = 5;
const TROPHY_THRESHOLD = 4.2;
const TROPHY_MIN_WEIGHTED_VOTES = 10;
const ROOM_SIGNIFICANT_CHANGE_THRESHOLD = 0.1;
const COURSE_SIGNIFICANT_CHANGE_THRESHOLD = 0.1;
const UTC_WEEK_PREFIX = 'UTC';

const LANE_BASE_XP = {
  roomClear: 20,
  courseClear: 40,
  ratingPxp: 5,
  roomRatingCxp: 5,
  courseRatingCxp: 7,
  weeklyPlay: 10,
  weeklyCuration: 3,
  dailyPb: 8,
  top10Entry: 10,
  top10Improve: 5,
  top1: 15,
  roomPublish: 25,
  coursePublish: 40,
  uniqueRoomCompletion: 10,
  uniqueCourseCompletion: 16,
  uniqueRating: 5,
} as const;

const TRUST_TIER_CAPABILITIES: Record<
  TrustTier,
  { claimLimitPerDay: number; publishLimitPerDay: number; objectLimit: number; collectibleLimit: number }
> = {
  T0: { claimLimitPerDay: 1, publishLimitPerDay: 1, objectLimit: 250, collectibleLimit: 25 },
  T1: { claimLimitPerDay: 2, publishLimitPerDay: 2, objectLimit: 400, collectibleLimit: 40 },
  T2: { claimLimitPerDay: 4, publishLimitPerDay: 3, objectLimit: 700, collectibleLimit: 70 },
  T3: { claimLimitPerDay: 6, publishLimitPerDay: 5, objectLimit: 1000, collectibleLimit: 100 },
  T4: { claimLimitPerDay: 9, publishLimitPerDay: 8, objectLimit: 1500, collectibleLimit: 150 },
};

interface AdminProgressionIdentitySummary {
  userId: string;
  displayName: string;
  email: string | null;
  founderNumber: number | null;
  builderCaps: BuilderCapabilitySummary;
  override: {
    claimLimitPerDay: number | null;
    publishLimitPerDay: number | null;
    objectLimit: number | null;
    collectibleLimit: number | null;
    reason: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  };
}

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
    label: 'First Course',
    description: 'Published a course.',
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

export function createEmptyProgressionDelta(): ProgressionDelta {
  return {
    pxp: 0,
    bxp: 0,
    cxp: 0,
    trust: 0,
  };
}

export function createEmptyDifficultyCounts(): ProgressionDifficultyCounts {
  return {
    easy: 0,
    medium: 0,
    hard: 0,
    extreme: 0,
  };
}

export function createEmptyQualityCounts(): ProgressionQualityCounts {
  return {
    oneStar: 0,
    twoStar: 0,
    threeStar: 0,
    fourStar: 0,
    fiveStar: 0,
  };
}

function normalizeDifficulty(value: unknown): ProgressionDifficulty | null {
  return typeof value === 'string' && PROGRESSION_DIFFICULTIES.includes(value as ProgressionDifficulty)
    ? (value as ProgressionDifficulty)
    : null;
}

function normalizeQualityStars(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
    throw new HttpError(400, 'qualityStars must be an integer from 1 to 5 or null.');
  }

  return numeric;
}

function getUtcDayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

function getUtcWeekKey(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${UTC_WEEK_PREFIX}-${utcDate.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`;
}

function xpRequiredForLevel(level: number): number {
  if (level <= 1) {
    return 0;
  }

  return Math.round(Math.pow(level - 1, 2) * 100);
}

function levelForXp(totalXp: number): number {
  let level = 1;
  while (xpRequiredForLevel(level + 1) <= totalXp) {
    level += 1;
  }

  return level;
}

function trustTierFromScore(score: number): TrustTier {
  if (score >= 260) {
    return 'T4';
  }
  if (score >= 160) {
    return 'T3';
  }
  if (score >= 90) {
    return 'T2';
  }
  if (score >= 40) {
    return 'T1';
  }
  return 'T0';
}

function trustWeightFromTier(tier: TrustTier): number {
  switch (tier) {
    case 'T0':
      return 0.6;
    case 'T1':
      return 0.85;
    case 'T2':
      return 1;
    case 'T3':
      return 1.1;
    case 'T4':
      return 1.2;
  }
}

function sanitizeOptionalOverride(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function hasBuilderCapOverride(progress: UserProgressRow): boolean {
  return (
    progress.builder_claim_limit_override !== null ||
    progress.builder_publish_limit_override !== null ||
    progress.builder_object_limit_override !== null ||
    progress.builder_collectible_limit_override !== null
  );
}

function buildBuilderCapabilitySummary(
  env: Env,
  progress: UserProgressRow,
  requestAuthSource: 'session' | 'playfun' | 'api_token' | 'agent_token' | null,
): BuilderCapabilitySummary {
  const trustTier = trustTierFromScore(progress.hidden_trust_score);
  const base = TRUST_TIER_CAPABILITIES[trustTier];
  const roomClaimCap =
    requestAuthSource === 'playfun'
      ? parseOptionalPositiveInteger(env.PLAYFUN_ROOM_DAILY_CLAIM_LIMIT)
      : parseOptionalPositiveInteger(env.ROOM_DAILY_CLAIM_LIMIT);
  const playfunObjectCap =
    requestAuthSource === 'playfun'
      ? parseOptionalPositiveInteger(env.PLAYFUN_ROOM_MAX_PLACED_OBJECTS)
      : null;

  const claimLimitPerDay = progress.builder_claim_limit_override ?? base.claimLimitPerDay;
  const publishLimitPerDay = progress.builder_publish_limit_override ?? base.publishLimitPerDay;
  const objectLimit = progress.builder_object_limit_override ?? base.objectLimit;
  const collectibleLimit = progress.builder_collectible_limit_override ?? base.collectibleLimit;

  return {
    trustTier,
    claimLimitPerDay: roomClaimCap === null ? claimLimitPerDay : Math.min(claimLimitPerDay, roomClaimCap),
    publishLimitPerDay,
    objectLimit: playfunObjectCap === null ? objectLimit : Math.min(objectLimit, playfunObjectCap),
    collectibleLimit,
    overrideActive: hasBuilderCapOverride(progress),
  };
}

function builderContributionWeightFromTier(tier: TrustTier): number {
  switch (tier) {
    case 'T0':
      return 0.6;
    case 'T1':
      return 0.8;
    case 'T2':
      return 1;
    case 'T3':
      return 1.1;
    case 'T4':
      return 1.2;
  }
}

function buildLaneSummary(lane: ProgressionLane, xp: number): ProgressionLaneSummary {
  const level = levelForXp(xp);
  const currentLevelStartXp = xpRequiredForLevel(level);
  const nextLevelXp = xpRequiredForLevel(level + 1);
  const progressFraction =
    nextLevelXp <= currentLevelStartXp
      ? 1
      : Math.max(0, Math.min(1, (xp - currentLevelStartXp) / (nextLevelXp - currentLevelStartXp)));
  const tierIndex =
    level >= 25 ? 4 : level >= 15 ? 3 : level >= 8 ? 2 : level >= 4 ? 1 : 0;
  const tint = ['#9f8163', '#aab5d6', '#d5ba57', '#4db7ac', '#e47f5f'][tierIndex] ?? '#9f8163';
  const labelPrefix =
    lane === 'player' ? 'Player' : lane === 'builder' ? 'Builder' : 'Curator';
  const emblem =
    lane === 'player' ? 'crown' : lane === 'builder' ? 'hammer' : 'star';

  return {
    lane,
    xp,
    level,
    currentLevelStartXp,
    nextLevelXp,
    progressFraction,
    medalLabel: `${labelPrefix} Lv.${level}`,
    medalTint: tint,
    emblem,
    crown: level >= 20,
    ribbons: level >= 12 ? 2 : level >= 6 ? 1 : 0,
  };
}

function parseRowNumber(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function parseRowFloat(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

async function loadUserIdentityRow(env: Env, userId: string): Promise<UserRow | null> {
  return env.DB.prepare(
    `
      SELECT
        id,
        email,
        wallet_address,
        display_name,
        avatar_url,
        bio,
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

async function loadUserProgressRow(env: Env, userId: string): Promise<UserProgressRow | null> {
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

async function upsertUserProgressRow(env: Env, row: UserProgressRow): Promise<void> {
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

async function loadBackfillSeedMetrics(env: Env, userId: string): Promise<ProgressSeedMetrics> {
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

export async function ensureFounderIdentityQualification(
  env: Env,
  userId: string,
  qualifiedAt: string = new Date().toISOString(),
): Promise<number | null> {
  const identity = await loadUserIdentityRow(env, userId);
  if (!identity || (!identity.email && !identity.wallet_address)) {
    return null;
  }

  const progress = await loadOrBackfillUserProgress(env, userId);
  if (progress.founder_number !== null) {
    return progress.founder_number;
  }

  const nextFounderRow = await env.DB.prepare(
    `
      SELECT COALESCE(MAX(founder_number), 0) + 1 AS next_founder_number
      FROM user_progress
    `
  ).first<{ next_founder_number: number | string | null }>();

  const founderNumber = Math.max(1, parseRowNumber(nextFounderRow?.next_founder_number));
  const updated: UserProgressRow = {
    ...progress,
    founder_number: founderNumber,
    first_identity_qualified_at: progress.first_identity_qualified_at ?? qualifiedAt,
    updated_at: qualifiedAt,
  };
  await upsertUserProgressRow(env, updated);
  await syncUserBadges(env, userId);
  return founderNumber;
}

async function persistProgressIncrement(
  env: Env,
  userId: string,
  delta: ProgressionDelta,
  updatedAt: string,
): Promise<UserProgressRow> {
  const progress = await loadOrBackfillUserProgress(env, userId);
  const totalPxp = progress.total_pxp + delta.pxp;
  const totalBxp = progress.total_bxp + delta.bxp;
  const totalCxp = progress.total_cxp + delta.cxp;
  const trustScore = Math.max(0, progress.hidden_trust_score + delta.trust);
  const updated: UserProgressRow = {
    ...progress,
    total_pxp: totalPxp,
    total_bxp: totalBxp,
    total_cxp: totalCxp,
    player_level: levelForXp(totalPxp),
    builder_level: levelForXp(totalBxp),
    curator_level: levelForXp(totalCxp),
    hidden_trust_score: trustScore,
    trust_tier_internal: trustTierFromScore(trustScore),
    updated_at: updatedAt,
  };
  await upsertUserProgressRow(env, updated);
  return updated;
}

async function progressEventExists(
  env: Env,
  table: LaneEventConfig['table'],
  dedupeKey: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM ${table}
      WHERE dedupe_key = ?
      LIMIT 1
    `
  )
    .bind(dedupeKey)
    .first<{ found: number | string | null }>();

  return parseRowNumber(row?.found) === 1;
}

async function insertProgressEvent(
  env: Env,
  config: LaneEventConfig,
): Promise<boolean> {
  if (config.amount <= 0) {
    return false;
  }

  if (await progressEventExists(env, config.table, config.dedupeKey)) {
    return false;
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO ${config.table} (
          id,
          user_id,
          event_type,
          source_type,
          source_id,
          dedupe_key,
          amount,
          breakdown_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      crypto.randomUUID(),
      config.sourceId.includes(':user:') ? config.sourceId.split(':user:')[1] : undefined,
    ),
  ]);

  return true;
}

async function recordLaneEvent(
  env: Env,
  userId: string,
  config: LaneEventConfig,
): Promise<boolean> {
  if (config.amount <= 0) {
    return false;
  }

  if (await progressEventExists(env, config.table, config.dedupeKey)) {
    return false;
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO ${config.table} (
          id,
          user_id,
          event_type,
          source_type,
          source_id,
          dedupe_key,
          amount,
          breakdown_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      crypto.randomUUID(),
      userId,
      config.eventType,
      config.sourceType,
      config.sourceId,
      config.dedupeKey,
      config.amount,
      config.breakdown ? JSON.stringify(config.breakdown) : null,
      config.createdAt,
    ),
  ]);

  return true;
}

async function awardLaneDelta(
  env: Env,
  userId: string,
  lane: 'pxp' | 'bxp' | 'cxp' | 'trust',
  eventType: string,
  sourceType: string,
  sourceId: string,
  dedupeKey: string,
  amount: number,
  createdAt: string,
  breakdown?: Record<string, unknown> | null,
): Promise<number> {
  const table =
    lane === 'pxp'
      ? 'pxp_events'
      : lane === 'bxp'
        ? 'bxp_events'
        : lane === 'cxp'
          ? 'cxp_events'
          : 'trust_events';
  const inserted = await recordLaneEvent(env, userId, {
    table,
    amount,
    eventType,
    sourceType,
    sourceId,
    dedupeKey,
    createdAt,
    breakdown,
  });
  return inserted ? amount : 0;
}

function mergeDelta(target: ProgressionDelta, patch: Partial<ProgressionDelta>): void {
  target.pxp += patch.pxp ?? 0;
  target.bxp += patch.bxp ?? 0;
  target.cxp += patch.cxp ?? 0;
  target.trust += patch.trust ?? 0;
}

function createLineageKey(contentId: string, versionKey: number): string {
  return `${contentId}:${versionKey}`;
}

function roundQuality(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarizeQualityRatings(
  rows: Array<{ quality_stars: number | null; trust_weight: number }>,
): QualityRatingSummary {
  const counts = createEmptyQualityCounts();
  let rawSum = 0;
  let voteCount = 0;
  let weightedSum = 0;
  let weightedVoteCount = 0;

  for (const row of rows) {
    if (row.quality_stars === null) {
      continue;
    }

    voteCount += 1;
    rawSum += row.quality_stars;
    weightedSum += row.quality_stars * row.trust_weight;
    weightedVoteCount += row.trust_weight;
    if (row.quality_stars === 1) counts.oneStar += 1;
    if (row.quality_stars === 2) counts.twoStar += 1;
    if (row.quality_stars === 3) counts.threeStar += 1;
    if (row.quality_stars === 4) counts.fourStar += 1;
    if (row.quality_stars === 5) counts.fiveStar += 1;
  }

  if (voteCount === 0 || weightedVoteCount <= 0) {
    return {
      adjustedAverage: null,
      rawAverage: null,
      voteCount: 0,
      weightedVoteCount: 0,
      counts,
    };
  }

  return {
    adjustedAverage: roundQuality(
      (QUALITY_PRIOR_MEAN * QUALITY_PRIOR_WEIGHT + weightedSum) /
        (QUALITY_PRIOR_WEIGHT + weightedVoteCount),
    ),
    rawAverage: roundQuality(rawSum / voteCount),
    voteCount,
    weightedVoteCount: roundQuality(weightedVoteCount),
    counts,
  };
}

function summarizeDifficultyRatings(
  rows: Array<{
    difficulty_choice: string | null;
    trust_weight: number;
    user_id: string;
  }>,
  viewerUserId: string | null,
  viewerCanVote: boolean,
  viewerNeedsRun: boolean,
): DifficultyRatingSummary {
  const counts = createEmptyDifficultyCounts();
  const weighted: DifficultyAccumulator = {
    easy: 0,
    medium: 0,
    hard: 0,
    extreme: 0,
  };
  let viewerVote: ProgressionDifficulty | null = null;

  for (const row of rows) {
    const difficulty = normalizeDifficulty(row.difficulty_choice);
    if (!difficulty) {
      continue;
    }

    counts[difficulty] += 1;
    weighted[difficulty] += row.trust_weight;
    if (viewerUserId !== null && row.user_id === viewerUserId) {
      viewerVote = difficulty;
    }
  }

  let consensus: ProgressionDifficulty | null = null;
  let bestWeight = 0;
  for (const difficulty of PROGRESSION_DIFFICULTIES) {
    if (weighted[difficulty] > bestWeight) {
      bestWeight = weighted[difficulty];
      consensus = difficulty;
    }
  }

  const totalVotes = counts.easy + counts.medium + counts.hard + counts.extreme;
  return {
    consensus: totalVotes > 0 ? consensus : null,
    counts,
    totalVotes,
    viewerVote,
    viewerSignedIn: viewerUserId !== null,
    viewerCanVote,
    viewerNeedsRun,
  };
}

async function loadRoomRatingsForVersionKey(
  env: Env,
  roomId: string,
  versionKey: number,
): Promise<RoomRatingRow[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        room_id,
        lineage_key,
        version_key,
        user_id,
        quality_stars,
        difficulty_choice,
        auto_difficulty_choice,
        trust_weight,
        completed_attempt_id,
        first_rated_at,
        updated_at,
        rewarded_at
      FROM room_ratings
      WHERE room_id = ?
        AND version_key = ?
    `
  )
    .bind(roomId, versionKey)
    .all<RoomRatingRow>();

  return result.results.map((row) => ({
    ...row,
    version_key: parseRowNumber(row.version_key),
    quality_stars: row.quality_stars === null ? null : parseRowNumber(row.quality_stars),
    trust_weight: parseRowFloat(row.trust_weight),
  }));
}

async function loadCourseRatingsForVersionKey(
  env: Env,
  courseId: string,
  versionKey: number,
): Promise<CourseRatingRow[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        course_id,
        lineage_key,
        version_key,
        user_id,
        quality_stars,
        difficulty_choice,
        auto_difficulty_choice,
        trust_weight,
        completed_attempt_id,
        first_rated_at,
        updated_at,
        rewarded_at
      FROM course_ratings
      WHERE course_id = ?
        AND version_key = ?
    `
  )
    .bind(courseId, versionKey)
    .all<CourseRatingRow>();

  return result.results.map((row) => ({
    ...row,
    version_key: parseRowNumber(row.version_key),
    quality_stars: row.quality_stars === null ? null : parseRowNumber(row.quality_stars),
    trust_weight: parseRowFloat(row.trust_weight),
  }));
}

async function loadTrophyForContentVersion(
  env: Env,
  contentType: 'room' | 'course',
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

async function buildRoomRatingSummary(
  env: Env,
  roomId: string,
  ratingWindow: RatingWindow,
  options: RatingSummaryOptions,
): Promise<RatingAggregateSummary> {
  const rows = await loadRoomRatingsForVersionKey(env, roomId, ratingWindow.versionKey);
  const viewerRow =
    options.viewerUserId === null
      ? null
      : rows.find((row) => row.user_id === options.viewerUserId) ?? null;

  return {
    quality: summarizeQualityRatings(rows),
    difficulty: summarizeDifficultyRatings(rows, options.viewerUserId, options.viewerCanVote, options.viewerNeedsRun),
    viewerRating: viewerRow
      ? {
          qualityStars: viewerRow.quality_stars,
          difficultyChoice: normalizeDifficulty(viewerRow.difficulty_choice),
          autoSuggestedDifficulty: normalizeDifficulty(viewerRow.auto_difficulty_choice),
          updatedAt: viewerRow.updated_at,
        }
      : null,
    trophy: await loadTrophyForContentVersion(env, 'room', roomId, ratingWindow.versionKey),
  };
}

async function buildCourseRatingSummary(
  env: Env,
  courseId: string,
  ratingWindow: RatingWindow,
  options: RatingSummaryOptions,
): Promise<RatingAggregateSummary> {
  const rows = await loadCourseRatingsForVersionKey(env, courseId, ratingWindow.versionKey);
  const viewerRow =
    options.viewerUserId === null
      ? null
      : rows.find((row) => row.user_id === options.viewerUserId) ?? null;

  return {
    quality: summarizeQualityRatings(rows),
    difficulty: summarizeDifficultyRatings(rows, options.viewerUserId, options.viewerCanVote, options.viewerNeedsRun),
    viewerRating: viewerRow
      ? {
          qualityStars: viewerRow.quality_stars,
          difficultyChoice: normalizeDifficulty(viewerRow.difficulty_choice),
          autoSuggestedDifficulty: normalizeDifficulty(viewerRow.auto_difficulty_choice),
          updatedAt: viewerRow.updated_at,
        }
      : null,
    trophy: await loadTrophyForContentVersion(env, 'course', courseId, ratingWindow.versionKey),
  };
}

function computeTileLayerChangeRatio(
  beforeLayer: (number | -1)[][],
  afterLayer: (number | -1)[][],
): number {
  const rows = Math.max(beforeLayer.length, afterLayer.length);
  let changed = 0;
  let total = 0;
  for (let y = 0; y < rows; y += 1) {
    const beforeRow = beforeLayer[y] ?? [];
    const afterRow = afterLayer[y] ?? [];
    const cols = Math.max(beforeRow.length, afterRow.length);
    for (let x = 0; x < cols; x += 1) {
      total += 1;
      if ((beforeRow[x] ?? -1) !== (afterRow[x] ?? -1)) {
        changed += 1;
      }
    }
  }

  return total > 0 ? changed / total : 0;
}

function serializePlacedObjectFingerprint(object: PlacedObject): string {
  return [
    object.id,
    object.x,
    object.y,
    object.facing ?? '',
    object.layer ?? '',
    object.triggerTargetInstanceId ?? '',
    object.containedObjectId ?? '',
    object.instanceId ?? '',
  ].join(':');
}

function computePlacedObjectsChangeRatio(
  beforeObjects: PlacedObject[],
  afterObjects: PlacedObject[],
): number {
  const beforeFingerprints = beforeObjects.map(serializePlacedObjectFingerprint).sort();
  const afterFingerprints = afterObjects.map(serializePlacedObjectFingerprint).sort();
  const size = Math.max(beforeFingerprints.length, afterFingerprints.length);
  if (size === 0) {
    return 0;
  }

  let changed = 0;
  for (let index = 0; index < size; index += 1) {
    if (beforeFingerprints[index] !== afterFingerprints[index]) {
      changed += 1;
    }
  }

  return changed / size;
}

export function computeRoomWeightedChange(
  previous: RoomSnapshot | null,
  next: RoomSnapshot,
): number {
  if (!previous) {
    return 1;
  }

  const tileWeights = {
    background: 0.08,
    terrain: 0.24,
    foreground: 0.08,
  } as const;
  let score = 0;
  score += computeTileLayerChangeRatio(previous.tileData.background, next.tileData.background) * tileWeights.background;
  score += computeTileLayerChangeRatio(previous.tileData.terrain, next.tileData.terrain) * tileWeights.terrain;
  score += computeTileLayerChangeRatio(previous.tileData.foreground, next.tileData.foreground) * tileWeights.foreground;
  score += computePlacedObjectsChangeRatio(previous.placedObjects, next.placedObjects) * 0.28;
  score += (JSON.stringify(previous.goal) === JSON.stringify(next.goal) ? 0 : 0.16);
  score += (JSON.stringify(previous.spawnPoint) === JSON.stringify(next.spawnPoint) ? 0 : 0.08);
  score += (previous.background === next.background ? 0 : 0.04);
  score += (JSON.stringify(previous.lighting) === JSON.stringify(next.lighting) ? 0 : 0.04);

  return Math.max(0, Math.min(1, score));
}

export function computeCourseWeightedChange(
  previous: CourseSnapshot | null,
  next: CourseSnapshot,
): number {
  if (!previous) {
    return 1;
  }

  const previousRooms = previous.roomRefs.map((room) => `${room.roomId}:${room.roomVersion}`).join('|');
  const nextRooms = next.roomRefs.map((room) => `${room.roomId}:${room.roomVersion}`).join('|');
  const previousLinks = previous.pressurePlateLinks
    .map((link) => `${link.triggerRoomId}:${link.triggerInstanceId}:${link.targetRoomId}:${link.targetInstanceId}`)
    .sort()
    .join('|');
  const nextLinks = next.pressurePlateLinks
    .map((link) => `${link.triggerRoomId}:${link.triggerInstanceId}:${link.targetRoomId}:${link.targetInstanceId}`)
    .sort()
    .join('|');

  let score = 0;
  score += previousRooms === nextRooms ? 0 : 0.42;
  score += JSON.stringify(previous.startPoint) === JSON.stringify(next.startPoint) ? 0 : 0.14;
  score += JSON.stringify(previous.goal) === JSON.stringify(next.goal) ? 0 : 0.24;
  score += previousLinks === nextLinks ? 0 : 0.2;

  return Math.max(0, Math.min(1, score));
}

function buildRoomRatingWindow(versions: RoomVersionRecord[], targetVersion: number): RatingWindow {
  const sorted = [...versions].sort((left, right) => left.version - right.version);
  let currentKey = sorted[0]?.version ?? targetVersion;
  const bucketByVersion = new Map<number, number>();
  for (let index = 0; index < sorted.length; index += 1) {
    const version = sorted[index];
    if (!version) {
      continue;
    }

    const previous = index > 0 ? sorted[index - 1]?.snapshot ?? null : null;
    const significant =
      index === 0 || computeRoomWeightedChange(previous, version.snapshot) >= ROOM_SIGNIFICANT_CHANGE_THRESHOLD;
    if (significant) {
      currentKey = version.version;
    }

    bucketByVersion.set(version.version, currentKey);
  }

  const versionKey = bucketByVersion.get(targetVersion) ?? targetVersion;
  const versionFamily = sorted
    .filter((version) => (bucketByVersion.get(version.version) ?? version.version) === versionKey)
    .map((version) => version.version);

  return {
    versionKey,
    lineageKey: createLineageKey(sorted[0]?.snapshot.id ?? 'room', versionKey),
    versionFamily,
  };
}

function buildCourseRatingWindow(
  versions: CourseRecord['versions'],
  targetVersion: number,
  courseId: string,
): RatingWindow {
  const sorted = [...versions].sort((left, right) => left.version - right.version);
  let currentKey = sorted[0]?.version ?? targetVersion;
  const bucketByVersion = new Map<number, number>();
  for (let index = 0; index < sorted.length; index += 1) {
    const version = sorted[index];
    if (!version) {
      continue;
    }

    const previous = index > 0 ? sorted[index - 1]?.snapshot ?? null : null;
    const significant =
      index === 0 || computeCourseWeightedChange(previous, version.snapshot) >= COURSE_SIGNIFICANT_CHANGE_THRESHOLD;
    if (significant) {
      currentKey = version.version;
    }
    bucketByVersion.set(version.version, currentKey);
  }

  const versionKey = bucketByVersion.get(targetVersion) ?? targetVersion;
  const versionFamily = sorted
    .filter((version) => (bucketByVersion.get(version.version) ?? version.version) === versionKey)
    .map((version) => version.version);

  return {
    versionKey,
    lineageKey: createLineageKey(courseId, versionKey),
    versionFamily,
  };
}

async function hasCompletedRoomRatingWindow(
  env: Env,
  roomId: string,
  versionFamily: number[],
  userId: string,
): Promise<boolean> {
  if (versionFamily.length === 0) {
    return false;
  }

  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM room_runs
      WHERE room_id = ?
        AND room_version IN (${versionFamily.map(() => '?').join(', ')})
        AND user_id = ?
        AND result = 'completed'
      LIMIT 1
    `
  )
    .bind(roomId, ...versionFamily, userId)
    .first<{ found: number | string | null }>();

  return parseRowNumber(row?.found) === 1;
}

async function hasCompletedCourseRatingWindow(
  env: Env,
  courseId: string,
  versionFamily: number[],
  userId: string,
): Promise<boolean> {
  if (versionFamily.length === 0) {
    return false;
  }

  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM course_runs
      WHERE course_id = ?
        AND course_version IN (${versionFamily.map(() => '?').join(', ')})
        AND user_id = ?
        AND result = 'completed'
      LIMIT 1
    `
  )
    .bind(courseId, ...versionFamily, userId)
    .first<{ found: number | string | null }>();

  return parseRowNumber(row?.found) === 1;
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

async function countOwnedTrophies(env: Env, userId: string): Promise<number> {
  const [roomRows, courseRows] = await Promise.all([
    loadOwnedRoomTrophyRows(env, userId),
    loadOwnedCourseTrophyRows(env, userId),
  ]);
  return roomRows.length + courseRows.length;
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
  const progress = await loadOrBackfillUserProgress(env, userId);
  await syncUserBadges(env, userId);
  const [badgeRows, roomTrophies, courseTrophies] = await Promise.all([
    loadBadgeAwardRows(env, userId),
    loadOwnedRoomTrophyRows(env, userId),
    loadOwnedCourseTrophyRows(env, userId),
  ]);
  const recentTrophies = [...roomTrophies, ...courseTrophies]
    .sort((left, right) => Date.parse(right.awardedAt) - Date.parse(left.awardedAt))
    .slice(0, 6);
  const builderCaps = buildBuilderCapabilitySummary(env, progress, 'session');

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
    trophyCount: recentTrophies.length,
    recentTrophies,
  };
}

function buildAdminProgressionIdentitySummary(
  env: Env,
  identity: UserRow,
  progress: UserProgressRow,
): AdminProgressionIdentitySummary {
  return {
    userId: identity.id,
    displayName: identity.display_name,
    email: identity.email,
    founderNumber: progress.founder_number,
    builderCaps: buildBuilderCapabilitySummary(env, progress, 'session'),
    override: {
      claimLimitPerDay: progress.builder_claim_limit_override,
      publishLimitPerDay: progress.builder_publish_limit_override,
      objectLimit: progress.builder_object_limit_override,
      collectibleLimit: progress.builder_collectible_limit_override,
      reason: progress.builder_cap_override_reason,
      updatedAt: progress.builder_cap_override_updated_at,
      updatedBy: progress.builder_cap_override_updated_by,
    },
  };
}

export async function searchAdminProgressionUsers(
  env: Env,
  query: string,
): Promise<AdminProgressionIdentitySummary[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const lowered = trimmed.toLowerCase();
  const like = `%${lowered}%`;
  const rows = await env.DB.prepare(
    `
      SELECT
        id,
        email,
        wallet_address,
        display_name,
        avatar_url,
        bio,
        created_at,
        updated_at
      FROM users
      WHERE id = ?
         OR lower(display_name) = ?
         OR lower(COALESCE(email, '')) = ?
         OR id LIKE ?
         OR lower(display_name) LIKE ?
         OR lower(COALESCE(email, '')) LIKE ?
      ORDER BY
        CASE
          WHEN id = ? THEN 0
          WHEN lower(display_name) = ? THEN 1
          WHEN lower(COALESCE(email, '')) = ? THEN 2
          ELSE 3
        END,
        updated_at DESC
      LIMIT 12
    `
  )
    .bind(trimmed, lowered, lowered, like, like, like, trimmed, lowered, lowered)
    .all<UserRow>();

  return Promise.all(
    rows.results.map(async (identity) => {
      const progress = await loadOrBackfillUserProgress(env, identity.id);
      return buildAdminProgressionIdentitySummary(env, identity, progress);
    }),
  );
}

export async function loadAdminProgressionUser(
  env: Env,
  userId: string,
): Promise<AdminProgressionIdentitySummary> {
  const identity = await loadUserIdentityRow(env, userId);
  if (!identity) {
    throw new HttpError(404, 'User not found.');
  }
  const progress = await loadOrBackfillUserProgress(env, userId);
  return buildAdminProgressionIdentitySummary(env, identity, progress);
}

export async function updateAdminBuilderCapOverride(
  env: Env,
  params: {
    userId: string;
    claimLimitPerDay: number | null;
    publishLimitPerDay: number | null;
    objectLimit: number | null;
    collectibleLimit: number | null;
    reason: string | null;
    operatorLabel: string;
  },
): Promise<AdminProgressionIdentitySummary> {
  const progress = await loadOrBackfillUserProgress(env, params.userId);
  const claimLimitPerDay = sanitizeOptionalOverride(params.claimLimitPerDay);
  const publishLimitPerDay = sanitizeOptionalOverride(params.publishLimitPerDay);
  const objectLimit = sanitizeOptionalOverride(params.objectLimit);
  const collectibleLimit = sanitizeOptionalOverride(params.collectibleLimit);
  const overrideActive =
    claimLimitPerDay !== null ||
    publishLimitPerDay !== null ||
    objectLimit !== null ||
    collectibleLimit !== null;
  const now = new Date().toISOString();
  const normalizedReason = params.reason?.trim() ? params.reason.trim() : null;
  const normalizedOperator = params.operatorLabel.trim() || 'Admin';

  await upsertUserProgressRow(env, {
    ...progress,
    builder_claim_limit_override: claimLimitPerDay,
    builder_publish_limit_override: publishLimitPerDay,
    builder_object_limit_override: objectLimit,
    builder_collectible_limit_override: collectibleLimit,
    builder_cap_override_reason: overrideActive ? normalizedReason : null,
    builder_cap_override_updated_at: overrideActive ? now : null,
    builder_cap_override_updated_by: overrideActive ? normalizedOperator : null,
    updated_at: now,
  });

  return loadAdminProgressionUser(env, params.userId);
}

function countCollectibleObjects(placedObjects: PlacedObject[]): number {
  let total = 0;
  for (const object of placedObjects) {
    const config = getObjectById(object.id);
    if (config?.category === 'collectible') {
      total += 1;
    }
  }

  return total;
}

function parseOptionalPositiveInteger(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function resolveRoomCapabilities(
  env: Env,
  userId: string,
  requestAuthSource: 'session' | 'playfun' | 'api_token' | 'agent_token' | null,
): Promise<RoomCapabilitySnapshot> {
  const progress = await loadOrBackfillUserProgress(env, userId);
  const summary = buildBuilderCapabilitySummary(env, progress, requestAuthSource);
  return {
    trustTier: summary.trustTier,
    claimLimitPerDay: summary.claimLimitPerDay,
    publishLimitPerDay: summary.publishLimitPerDay,
    objectLimit: summary.objectLimit,
    collectibleLimit: summary.collectibleLimit,
  };
}

async function countDailyRoomPublishes(env: Env, userId: string, dayStartIso: string): Promise<number> {
  const [roomRow, courseRow] = await Promise.all([
    env.DB.prepare(
      `
        SELECT COUNT(*) AS count
        FROM room_versions
        WHERE published_by_user_id = ?
          AND created_at >= ?
      `
    )
      .bind(userId, dayStartIso)
      .first<{ count: number | string | null }>(),
    env.DB.prepare(
      `
        SELECT COUNT(*) AS count
        FROM course_versions
        WHERE published_by_user_id = ?
          AND created_at >= ?
      `
    )
      .bind(userId, dayStartIso)
      .first<{ count: number | string | null }>(),
  ]);

  return parseRowNumber(roomRow?.count) + parseRowNumber(courseRow?.count);
}

export async function assertUserCanPublishContent(
  env: Env,
  userId: string,
  requestAuthSource: 'session' | 'playfun' | 'api_token' | 'agent_token' | null,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const capabilities = await resolveRoomCapabilities(env, userId, requestAuthSource);
  const utcDayStart = `${getUtcDayKey(nowIso)}T00:00:00.000Z`;
  const publishCount = await countDailyRoomPublishes(env, userId, utcDayStart);
  if (publishCount >= capabilities.publishLimitPerDay) {
    throw new HttpError(
      429,
      `Daily publish limit reached. You can publish ${capabilities.publishLimitPerDay} meaningful room or course updates per UTC day.`,
    );
  }
}

export async function awardRoomPublishProgression(
  env: Env,
  params: {
    userId: string;
    roomId: string;
    roomVersion: number;
    publishedSnapshot: RoomSnapshot;
    previousPublishedSnapshot: RoomSnapshot | null;
    hasGoal: boolean;
    hasPriorGoalPublish: boolean;
    publishedAt: string;
  },
): Promise<ProgressionDelta> {
  const percentChange = computeRoomWeightedChange(params.previousPublishedSnapshot, params.publishedSnapshot);
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT OR REPLACE INTO room_version_attribution (
          room_id,
          version_key,
          prior_version_key,
          percent_change,
          contributor_weight_breakdown,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).bind(
      params.roomId,
      params.roomVersion,
      params.previousPublishedSnapshot?.version ?? null,
      percentChange,
      JSON.stringify([{ userId: params.userId, weight: 1 }]),
      params.publishedAt,
    ),
  ]);

  const delta = createEmptyProgressionDelta();
  const significant = percentChange >= ROOM_SIGNIFICANT_CHANGE_THRESHOLD || params.previousPublishedSnapshot === null;
  if (!params.hasGoal || !significant) {
    return delta;
  }

  if (!params.hasPriorGoalPublish) {
    delta.bxp += await awardLaneDelta(
      env,
      params.userId,
      'bxp',
      'room_publish_first',
      'room',
      `${params.roomId}:${params.roomVersion}`,
      `bxp:room_publish_first:${params.roomId}`,
      LANE_BASE_XP.roomPublish,
      params.publishedAt,
      { roomVersion: params.roomVersion },
    );
  }

  delta.trust += await awardLaneDelta(
    env,
    params.userId,
    'trust',
    'room_publish_significant',
    'room',
    `${params.roomId}:${params.roomVersion}`,
    `trust:room_publish_significant:${params.roomId}:${params.roomVersion}`,
    params.hasPriorGoalPublish ? 3 : 6,
    params.publishedAt,
    { percentChange },
  );

  await persistProgressIncrement(env, params.userId, delta, params.publishedAt);
  await syncUserBadges(env, params.userId);
  return delta;
}

export async function awardCoursePublishProgression(
  env: Env,
  params: {
    userId: string;
    courseId: string;
    courseVersion: number;
    publishedSnapshot: CourseSnapshot;
    previousPublishedSnapshot: CourseSnapshot | null;
    publishedAt: string;
    isFirstPublish: boolean;
  },
): Promise<ProgressionDelta> {
  const delta = createEmptyProgressionDelta();
  const percentChange = computeCourseWeightedChange(params.previousPublishedSnapshot, params.publishedSnapshot);
  const significant = percentChange >= COURSE_SIGNIFICANT_CHANGE_THRESHOLD || params.previousPublishedSnapshot === null;
  if (!params.publishedSnapshot.goal || !significant) {
    return delta;
  }

  if (params.isFirstPublish) {
    delta.bxp += await awardLaneDelta(
      env,
      params.userId,
      'bxp',
      'course_publish_first',
      'course',
      `${params.courseId}:${params.courseVersion}`,
      `bxp:course_publish_first:${params.courseId}`,
      LANE_BASE_XP.coursePublish,
      params.publishedAt,
      { courseVersion: params.courseVersion },
    );
  }
  delta.trust += await awardLaneDelta(
    env,
    params.userId,
    'trust',
    'course_publish_significant',
    'course',
    `${params.courseId}:${params.courseVersion}`,
    `trust:course_publish_significant:${params.courseId}:${params.courseVersion}`,
    params.isFirstPublish ? 8 : 4,
    params.publishedAt,
    { percentChange },
  );
  await persistProgressIncrement(env, params.userId, delta, params.publishedAt);
  await syncUserBadges(env, params.userId);
  return delta;
}

async function loadCompletedRoomRunsForVersion(
  env: Env,
  roomId: string,
  roomVersion: number,
): Promise<RoomRunRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        room_id,
        room_x,
        room_y,
        room_version,
        goal_type,
        goal_json,
        user_id,
        user_display_name,
        started_at,
        finished_at,
        result,
        elapsed_ms,
        deaths,
        score,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached
      FROM room_runs
      WHERE room_id = ?
        AND room_version = ?
        AND result = 'completed'
    `
  )
    .bind(roomId, roomVersion)
    .all<RoomRunRow>();

  return result.results.map((row) => ({
    attemptId: row.attempt_id,
    roomId: row.room_id,
    roomCoordinates: { x: parseRowNumber(row.room_x), y: parseRowNumber(row.room_y) },
    roomVersion: parseRowNumber(row.room_version),
    goalType: row.goal_type as RoomRunRecord['goalType'],
    goal: JSON.parse(row.goal_json) as RoomRunRecord['goal'],
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result,
    elapsedMs: row.elapsed_ms === null ? null : parseRowNumber(row.elapsed_ms),
    deaths: parseRowNumber(row.deaths),
    score: parseRowNumber(row.score),
    collectiblesCollected: parseRowNumber(row.collectibles_collected),
    enemiesDefeated: parseRowNumber(row.enemies_defeated),
    checkpointsReached: parseRowNumber(row.checkpoints_reached),
  }));
}

async function loadCompletedCourseRunsForVersion(
  env: Env,
  courseId: string,
  courseVersion: number,
): Promise<CourseRunRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        attempt_id,
        course_id,
        course_version,
        goal_type,
        goal_json,
        user_id,
        user_display_name,
        started_at,
        finished_at,
        result,
        elapsed_ms,
        deaths,
        score,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached
      FROM course_runs
      WHERE course_id = ?
        AND course_version = ?
        AND result = 'completed'
    `
  )
    .bind(courseId, courseVersion)
    .all<CourseRunRow>();

  return result.results.map((row) => ({
    attemptId: row.attempt_id,
    courseId: row.course_id,
    courseVersion: parseRowNumber(row.course_version),
    goalType: row.goal_type as CourseRunRecord['goalType'],
    goal: JSON.parse(row.goal_json) as CourseRunRecord['goal'],
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result,
    elapsedMs: row.elapsed_ms === null ? null : parseRowNumber(row.elapsed_ms),
    deaths: parseRowNumber(row.deaths),
    score: parseRowNumber(row.score),
    collectiblesCollected: parseRowNumber(row.collectibles_collected),
    enemiesDefeated: parseRowNumber(row.enemies_defeated),
    checkpointsReached: parseRowNumber(row.checkpoints_reached),
  }));
}

function computeRoomRankForAttempt(
  runs: RoomRunRecord[],
  goal: RoomGoal,
  attemptId: string,
): number | null {
  const bestByUser = new Map<string, RoomRunRecord>();
  for (const run of runs) {
    const existing = bestByUser.get(run.userId);
    if (!existing || sortCompletedRunsForLeaderboard([existing, run], goal)[0]?.attemptId === run.attemptId) {
      bestByUser.set(run.userId, run);
    }
  }

  const ranked = sortCompletedRunsForLeaderboard([...bestByUser.values()], goal);
  const index = ranked.findIndex((entry) => entry.attemptId === attemptId);
  return index >= 0 ? index + 1 : null;
}

function computeCourseRankForAttempt(
  runs: CourseRunRecord[],
  goal: CourseGoal,
  attemptId: string,
): number | null {
  const bestByUser = new Map<string, CourseRunRecord>();
  for (const run of runs) {
    const existing = bestByUser.get(run.userId);
    if (!existing || compareCourseLeaderboardEntries(existing, run, goal) > 0) {
      bestByUser.set(run.userId, run);
    }
  }

  const ranked = [...bestByUser.values()].sort((left, right) => compareCourseLeaderboardEntries(left, right, goal));
  const index = ranked.findIndex((entry) => entry.attemptId === attemptId);
  return index >= 0 ? index + 1 : null;
}

export async function awardRoomRunProgression(
  env: Env,
  params: {
    run: RoomRunRecord;
    goal: RoomGoal;
    isFirstCompletion: boolean;
    isNewPersonalBest: boolean;
    creatorUserId: string | null;
    roomRecord: RoomRecord;
    completedAt: string;
  },
): Promise<ProgressionDelta> {
  const delta = createEmptyProgressionDelta();
  if (params.run.result !== 'completed') {
    return delta;
  }

  const dayKey = getUtcDayKey(params.completedAt);
  const weekKey = getUtcWeekKey(params.completedAt);

  if (params.isFirstCompletion) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'room_clear_first',
      'room',
      `${params.run.roomId}:${params.run.roomVersion}`,
      `pxp:room_clear_first:${params.run.userId}:${params.run.roomId}:${params.run.roomVersion}`,
      LANE_BASE_XP.roomClear,
      params.completedAt,
    );
  }

  delta.pxp += await awardLaneDelta(
    env,
    params.run.userId,
    'pxp',
    'weekly_play',
    'user_week',
    weekKey,
    `pxp:weekly_play:${params.run.userId}:${weekKey}`,
    LANE_BASE_XP.weeklyPlay,
    params.completedAt,
  );

  if (params.isNewPersonalBest) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'daily_personal_best',
      'room',
      `${params.run.roomId}:${params.run.roomVersion}:${dayKey}`,
      `pxp:daily_room_pb:${params.run.userId}:${params.run.roomId}:${params.run.roomVersion}:${dayKey}`,
      LANE_BASE_XP.dailyPb,
      params.completedAt,
    );
  }

  const runs = await loadCompletedRoomRunsForVersion(env, params.run.roomId, params.run.roomVersion);
  const currentRank = computeRoomRankForAttempt(runs, params.goal, params.run.attemptId);
  const previousRank = computeRoomRankForAttempt(
    runs.filter((entry) => entry.attemptId !== params.run.attemptId),
    params.goal,
    params.run.attemptId,
  );

  if (currentRank !== null && currentRank <= 10 && (previousRank === null || previousRank > 10)) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'top10_entry',
      'room_attempt',
      params.run.attemptId,
      `pxp:room_top10_entry:${params.run.attemptId}`,
      LANE_BASE_XP.top10Entry,
      params.completedAt,
      { rank: currentRank },
    );
  }
  if (currentRank !== null && previousRank !== null && currentRank < previousRank && currentRank <= 10) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'top10_improve',
      'room_attempt',
      params.run.attemptId,
      `pxp:room_top10_improve:${params.run.attemptId}`,
      LANE_BASE_XP.top10Improve,
      params.completedAt,
      { previousRank, currentRank },
    );
  }
  if (currentRank === 1 && previousRank !== 1) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'top1_take',
      'room_attempt',
      params.run.attemptId,
      `pxp:room_top1_take:${params.run.attemptId}`,
      LANE_BASE_XP.top1,
      params.completedAt,
    );
  }

  delta.trust += await awardLaneDelta(
    env,
    params.run.userId,
    'trust',
    'room_clear_completed',
    'room_attempt',
    params.run.attemptId,
    `trust:room_clear_completed:${params.run.attemptId}`,
    1,
    params.completedAt,
  );

  if (params.creatorUserId && params.creatorUserId !== params.run.userId) {
    const ratingWindow = buildRoomRatingWindow(params.roomRecord.versions, params.run.roomVersion);
    const creatorProgress = await loadOrBackfillUserProgress(env, params.creatorUserId);
    const creatorWeight = builderContributionWeightFromTier(trustTierFromScore(creatorProgress.hidden_trust_score));
    const creatorBxp = Math.max(1, Math.round(LANE_BASE_XP.uniqueRoomCompletion * creatorWeight));
    delta.bxp += await awardLaneDelta(
      env,
      params.creatorUserId,
      'bxp',
      'unique_completion_room',
      'room_completion',
      `${params.run.roomId}:${ratingWindow.versionKey}:${params.run.userId}`,
      `bxp:room_unique_completion:${params.creatorUserId}:${params.run.roomId}:${ratingWindow.versionKey}:${params.run.userId}`,
      creatorBxp,
      params.completedAt,
    );
    delta.trust += await awardLaneDelta(
      env,
      params.creatorUserId,
      'trust',
      'unique_completion_room',
      'room_completion',
      `${params.run.roomId}:${ratingWindow.versionKey}:${params.run.userId}`,
      `trust:room_unique_completion:${params.creatorUserId}:${params.run.roomId}:${ratingWindow.versionKey}:${params.run.userId}`,
      2,
      params.completedAt,
    );
    await persistProgressIncrement(env, params.creatorUserId, {
      pxp: 0,
      bxp: delta.bxp,
      cxp: 0,
      trust: delta.trust,
    }, params.completedAt);
    await syncUserBadges(env, params.creatorUserId);
    delta.bxp = 0;
    delta.trust = 0;
  }

  await persistProgressIncrement(env, params.run.userId, delta, params.completedAt);
  await syncUserBadges(env, params.run.userId);
  return delta;
}

export async function awardCourseRunProgression(
  env: Env,
  params: {
    run: CourseRunRecord;
    goal: CourseGoal;
    isFirstCompletion: boolean;
    isNewPersonalBest: boolean;
    creatorUserId: string | null;
    courseRecord: CourseRecord;
    completedAt: string;
  },
): Promise<ProgressionDelta> {
  const delta = createEmptyProgressionDelta();
  if (params.run.result !== 'completed') {
    return delta;
  }

  const dayKey = getUtcDayKey(params.completedAt);
  const weekKey = getUtcWeekKey(params.completedAt);

  if (params.isFirstCompletion) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'course_clear_first',
      'course',
      `${params.run.courseId}:${params.run.courseVersion}`,
      `pxp:course_clear_first:${params.run.userId}:${params.run.courseId}:${params.run.courseVersion}`,
      LANE_BASE_XP.courseClear,
      params.completedAt,
    );
  }
  delta.pxp += await awardLaneDelta(
    env,
    params.run.userId,
    'pxp',
    'weekly_play',
    'user_week',
    weekKey,
    `pxp:weekly_play:${params.run.userId}:${weekKey}`,
    LANE_BASE_XP.weeklyPlay,
    params.completedAt,
  );
  if (params.isNewPersonalBest) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'daily_personal_best',
      'course',
      `${params.run.courseId}:${params.run.courseVersion}:${dayKey}`,
      `pxp:daily_course_pb:${params.run.userId}:${params.run.courseId}:${params.run.courseVersion}:${dayKey}`,
      LANE_BASE_XP.dailyPb,
      params.completedAt,
    );
  }

  const runs = await loadCompletedCourseRunsForVersion(env, params.run.courseId, params.run.courseVersion);
  const currentRank = computeCourseRankForAttempt(runs, params.goal, params.run.attemptId);
  const previousRank = computeCourseRankForAttempt(
    runs.filter((entry) => entry.attemptId !== params.run.attemptId),
    params.goal,
    params.run.attemptId,
  );

  if (currentRank !== null && currentRank <= 10 && (previousRank === null || previousRank > 10)) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'top10_entry',
      'course_attempt',
      params.run.attemptId,
      `pxp:course_top10_entry:${params.run.attemptId}`,
      LANE_BASE_XP.top10Entry,
      params.completedAt,
      { rank: currentRank },
    );
  }
  if (currentRank !== null && previousRank !== null && currentRank < previousRank && currentRank <= 10) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'top10_improve',
      'course_attempt',
      params.run.attemptId,
      `pxp:course_top10_improve:${params.run.attemptId}`,
      LANE_BASE_XP.top10Improve,
      params.completedAt,
      { previousRank, currentRank },
    );
  }
  if (currentRank === 1 && previousRank !== 1) {
    delta.pxp += await awardLaneDelta(
      env,
      params.run.userId,
      'pxp',
      'top1_take',
      'course_attempt',
      params.run.attemptId,
      `pxp:course_top1_take:${params.run.attemptId}`,
      LANE_BASE_XP.top1,
      params.completedAt,
    );
  }

  delta.trust += await awardLaneDelta(
    env,
    params.run.userId,
    'trust',
    'course_clear_completed',
    'course_attempt',
    params.run.attemptId,
    `trust:course_clear_completed:${params.run.attemptId}`,
    1,
    params.completedAt,
  );

  if (params.creatorUserId && params.creatorUserId !== params.run.userId) {
    const ratingWindow = buildCourseRatingWindow(params.courseRecord.versions, params.run.courseVersion, params.run.courseId);
    const creatorProgress = await loadOrBackfillUserProgress(env, params.creatorUserId);
    const creatorWeight = builderContributionWeightFromTier(trustTierFromScore(creatorProgress.hidden_trust_score));
    const creatorBxp = Math.max(1, Math.round(LANE_BASE_XP.uniqueCourseCompletion * creatorWeight));
    const creatorDelta: ProgressionDelta = {
      pxp: 0,
      bxp: await awardLaneDelta(
        env,
        params.creatorUserId,
        'bxp',
        'unique_completion_course',
        'course_completion',
        `${params.run.courseId}:${ratingWindow.versionKey}:${params.run.userId}`,
        `bxp:course_unique_completion:${params.creatorUserId}:${params.run.courseId}:${ratingWindow.versionKey}:${params.run.userId}`,
        creatorBxp,
        params.completedAt,
      ),
      cxp: 0,
      trust: await awardLaneDelta(
        env,
        params.creatorUserId,
        'trust',
        'unique_completion_course',
        'course_completion',
        `${params.run.courseId}:${ratingWindow.versionKey}:${params.run.userId}`,
        `trust:course_unique_completion:${params.creatorUserId}:${params.run.courseId}:${ratingWindow.versionKey}:${params.run.userId}`,
        3,
        params.completedAt,
      ),
    };
    await persistProgressIncrement(env, params.creatorUserId, creatorDelta, params.completedAt);
    await syncUserBadges(env, params.creatorUserId);
  }

  await persistProgressIncrement(env, params.run.userId, delta, params.completedAt);
  await syncUserBadges(env, params.run.userId);
  return delta;
}

async function upsertRoomRatingRow(
  env: Env,
  params: {
    roomId: string;
    ratingWindow: RatingWindow;
    userId: string;
    qualityStars: number | null;
    difficultyChoice: ProgressionDifficulty | null;
    autoSuggestedDifficulty: ProgressionDifficulty | null;
    trustWeight: number;
    now: string;
  },
): Promise<RoomRatingRow | null> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO room_ratings (
          room_id,
          lineage_key,
          version_key,
          user_id,
          quality_stars,
          difficulty_choice,
          auto_difficulty_choice,
          trust_weight,
          completed_attempt_id,
          first_rated_at,
          updated_at,
          rewarded_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
        ON CONFLICT(room_id, version_key, user_id) DO UPDATE SET
          quality_stars = excluded.quality_stars,
          difficulty_choice = excluded.difficulty_choice,
          auto_difficulty_choice = excluded.auto_difficulty_choice,
          trust_weight = excluded.trust_weight,
          updated_at = excluded.updated_at
      `
    ).bind(
      params.roomId,
      params.ratingWindow.lineageKey,
      params.ratingWindow.versionKey,
      params.userId,
      params.qualityStars,
      params.difficultyChoice,
      params.autoSuggestedDifficulty,
      params.trustWeight,
      params.now,
      params.now,
    ),
  ]);

  const rows = await loadRoomRatingsForVersionKey(env, params.roomId, params.ratingWindow.versionKey);
  return rows.find((row) => row.user_id === params.userId) ?? null;
}

async function upsertCourseRatingRow(
  env: Env,
  params: {
    courseId: string;
    ratingWindow: RatingWindow;
    userId: string;
    qualityStars: number | null;
    difficultyChoice: ProgressionDifficulty | null;
    autoSuggestedDifficulty: ProgressionDifficulty | null;
    trustWeight: number;
    now: string;
  },
): Promise<CourseRatingRow | null> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO course_ratings (
          course_id,
          lineage_key,
          version_key,
          user_id,
          quality_stars,
          difficulty_choice,
          auto_difficulty_choice,
          trust_weight,
          completed_attempt_id,
          first_rated_at,
          updated_at,
          rewarded_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
        ON CONFLICT(course_id, version_key, user_id) DO UPDATE SET
          quality_stars = excluded.quality_stars,
          difficulty_choice = excluded.difficulty_choice,
          auto_difficulty_choice = excluded.auto_difficulty_choice,
          trust_weight = excluded.trust_weight,
          updated_at = excluded.updated_at
      `
    ).bind(
      params.courseId,
      params.ratingWindow.lineageKey,
      params.ratingWindow.versionKey,
      params.userId,
      params.qualityStars,
      params.difficultyChoice,
      params.autoSuggestedDifficulty,
      params.trustWeight,
      params.now,
      params.now,
    ),
  ]);

  const rows = await loadCourseRatingsForVersionKey(env, params.courseId, params.ratingWindow.versionKey);
  return rows.find((row) => row.user_id === params.userId) ?? null;
}

async function markRoomRatingRewarded(
  env: Env,
  roomId: string,
  versionKey: number,
  userId: string,
  rewardedAt: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE room_ratings
        SET rewarded_at = ?
        WHERE room_id = ?
          AND version_key = ?
          AND user_id = ?
      `
    ).bind(rewardedAt, roomId, versionKey, userId),
  ]);
}

async function markCourseRatingRewarded(
  env: Env,
  courseId: string,
  versionKey: number,
  userId: string,
  rewardedAt: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE course_ratings
        SET rewarded_at = ?
        WHERE course_id = ?
          AND version_key = ?
          AND user_id = ?
      `
    ).bind(rewardedAt, courseId, versionKey, userId),
  ]);
}

async function syncContentTrophy(
  env: Env,
  contentType: 'room' | 'course',
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

async function refreshContentOwnerProgressCounts(
  env: Env,
  contentType: 'room' | 'course',
  contentId: string,
  versionKey: number,
): Promise<void> {
  const ownerRow =
    contentType === 'room'
      ? await env.DB.prepare(
          `
            SELECT published_by_user_id AS user_id
            FROM room_versions
            WHERE room_id = ?
              AND version = ?
            LIMIT 1
          `
        )
          .bind(contentId, versionKey)
          .first<{ user_id: string | null }>()
      : await env.DB.prepare(
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

  const ownerUserId = ownerRow?.user_id ?? null;
  if (!ownerUserId) {
    return;
  }

  await syncUserBadges(env, ownerUserId);
}

export async function submitRoomRating(
  env: Env,
  params: {
    roomRecord: RoomRecord;
    userId: string;
    body: RoomRatingRequestBody;
    now?: string;
  },
): Promise<RoomRatingResponse> {
  const now = params.now ?? new Date().toISOString();
  const published = params.roomRecord.published;
  if (!published || published.version !== params.body.roomVersion) {
    throw new HttpError(409, 'Ratings are only available on the current published room version.');
  }

  if (params.roomRecord.claimerUserId === params.userId) {
    throw new HttpError(409, 'You cannot rate your own room.');
  }

  const qualityStars = normalizeQualityStars(params.body.qualityStars);
  const difficultyChoice = normalizeDifficulty(params.body.difficultyChoice);
  const autoSuggestedDifficulty = normalizeDifficulty(params.body.autoSuggestedDifficulty);
  const ratingWindow = buildRoomRatingWindow(params.roomRecord.versions, params.body.roomVersion);
  const hasCompleted = await hasCompletedRoomRatingWindow(
    env,
    published.id,
    ratingWindow.versionFamily,
    params.userId,
  );
  if (!hasCompleted) {
    throw new HttpError(409, 'Complete this room version window once before rating it.');
  }

  const progress = await loadOrBackfillUserProgress(env, params.userId);
  const trustTier = trustTierFromScore(progress.hidden_trust_score);
  const trustWeight = trustWeightFromTier(trustTier);
  const existingRows = await loadRoomRatingsForVersionKey(env, published.id, ratingWindow.versionKey);
  const existingViewerRow = existingRows.find((row) => row.user_id === params.userId) ?? null;

  await upsertRoomRatingRow(env, {
    roomId: published.id,
    ratingWindow,
    userId: params.userId,
    qualityStars,
    difficultyChoice,
    autoSuggestedDifficulty,
    trustWeight,
    now,
  });

  const delta = createEmptyProgressionDelta();
  const firstRewardedSubmission =
    existingViewerRow === null || existingViewerRow.rewarded_at === null;
  if (firstRewardedSubmission) {
    delta.pxp += await awardLaneDelta(
      env,
      params.userId,
      'pxp',
      'room_rating_submit',
      'room_rating',
      `${published.id}:${ratingWindow.versionKey}`,
      `pxp:room_rating_submit:${params.userId}:${published.id}:${ratingWindow.versionKey}`,
      LANE_BASE_XP.ratingPxp,
      now,
    );
    delta.cxp += await awardLaneDelta(
      env,
      params.userId,
      'cxp',
      'room_rating_submit',
      'room_rating',
      `${published.id}:${ratingWindow.versionKey}`,
      `cxp:room_rating_submit:${params.userId}:${published.id}:${ratingWindow.versionKey}`,
      LANE_BASE_XP.roomRatingCxp,
      now,
    );
    delta.cxp += await awardLaneDelta(
      env,
      params.userId,
      'cxp',
      'weekly_curation',
      'user_week',
      getUtcWeekKey(now),
      `cxp:weekly_curation:${params.userId}:${getUtcWeekKey(now)}`,
      LANE_BASE_XP.weeklyCuration,
      now,
    );
    delta.trust += await awardLaneDelta(
      env,
      params.userId,
      'trust',
      'room_rating_submit',
      'room_rating',
      `${published.id}:${ratingWindow.versionKey}`,
      `trust:room_rating_submit:${params.userId}:${published.id}:${ratingWindow.versionKey}`,
      1,
      now,
    );
    await markRoomRatingRewarded(env, published.id, ratingWindow.versionKey, params.userId, now);
  }

  if (params.roomRecord.claimerUserId && params.roomRecord.claimerUserId !== params.userId && firstRewardedSubmission) {
    const creatorDelta: ProgressionDelta = {
      pxp: 0,
      bxp: await awardLaneDelta(
        env,
        params.roomRecord.claimerUserId,
        'bxp',
        'unique_rating_room',
        'room_rating',
        `${published.id}:${ratingWindow.versionKey}:${params.userId}`,
        `bxp:room_unique_rating:${params.roomRecord.claimerUserId}:${published.id}:${ratingWindow.versionKey}:${params.userId}`,
        LANE_BASE_XP.uniqueRating,
        now,
      ),
      cxp: 0,
      trust: await awardLaneDelta(
        env,
        params.roomRecord.claimerUserId,
        'trust',
        'unique_rating_room',
        'room_rating',
        `${published.id}:${ratingWindow.versionKey}:${params.userId}`,
        `trust:room_unique_rating:${params.roomRecord.claimerUserId}:${published.id}:${ratingWindow.versionKey}:${params.userId}`,
        1,
        now,
      ),
    };
    await persistProgressIncrement(env, params.roomRecord.claimerUserId, creatorDelta, now);
    await syncUserBadges(env, params.roomRecord.claimerUserId);
  }

  await persistProgressIncrement(env, params.userId, delta, now);
  const summary = await buildRoomRatingSummary(env, published.id, ratingWindow, {
    viewerUserId: params.userId,
    viewerCanVote: true,
    viewerNeedsRun: false,
  });
  await syncContentTrophy(env, 'room', published.id, ratingWindow.versionKey, summary.quality);
  await refreshContentOwnerProgressCounts(env, 'room', published.id, ratingWindow.versionKey);
  await syncUserBadges(env, params.userId);

  return {
    ok: true,
    roomId: published.id,
    roomVersion: published.version,
    progressionDelta: delta,
    summary: await buildRoomRatingSummary(env, published.id, ratingWindow, {
      viewerUserId: params.userId,
      viewerCanVote: true,
      viewerNeedsRun: false,
    }),
    progression: await loadPublicProgressionSummary(env, params.userId),
  };
}

export async function submitCourseRating(
  env: Env,
  params: {
    courseRecord: CourseRecord;
    userId: string;
    body: CourseRatingRequestBody;
    now?: string;
  },
): Promise<CourseRatingResponse> {
  const now = params.now ?? new Date().toISOString();
  const published = params.courseRecord.published;
  if (!published || published.version !== params.body.courseVersion) {
    throw new HttpError(409, 'Ratings are only available on the current published course version.');
  }
  if (params.courseRecord.ownerUserId === params.userId) {
    throw new HttpError(409, 'You cannot rate your own course.');
  }

  const qualityStars = normalizeQualityStars(params.body.qualityStars);
  const difficultyChoice = normalizeDifficulty(params.body.difficultyChoice);
  const autoSuggestedDifficulty = normalizeDifficulty(params.body.autoSuggestedDifficulty);
  const ratingWindow = buildCourseRatingWindow(
    params.courseRecord.versions,
    params.body.courseVersion,
    published.id,
  );
  const hasCompleted = await hasCompletedCourseRatingWindow(
    env,
    published.id,
    ratingWindow.versionFamily,
    params.userId,
  );
  if (!hasCompleted) {
    throw new HttpError(409, 'Complete this course version window once before rating it.');
  }

  const progress = await loadOrBackfillUserProgress(env, params.userId);
  const trustWeight = trustWeightFromTier(trustTierFromScore(progress.hidden_trust_score));
  const existingRows = await loadCourseRatingsForVersionKey(env, published.id, ratingWindow.versionKey);
  const existingViewerRow = existingRows.find((row) => row.user_id === params.userId) ?? null;

  await upsertCourseRatingRow(env, {
    courseId: published.id,
    ratingWindow,
    userId: params.userId,
    qualityStars,
    difficultyChoice,
    autoSuggestedDifficulty,
    trustWeight,
    now,
  });

  const delta = createEmptyProgressionDelta();
  const firstRewardedSubmission =
    existingViewerRow === null || existingViewerRow.rewarded_at === null;
  if (firstRewardedSubmission) {
    delta.pxp += await awardLaneDelta(
      env,
      params.userId,
      'pxp',
      'course_rating_submit',
      'course_rating',
      `${published.id}:${ratingWindow.versionKey}`,
      `pxp:course_rating_submit:${params.userId}:${published.id}:${ratingWindow.versionKey}`,
      LANE_BASE_XP.ratingPxp,
      now,
    );
    delta.cxp += await awardLaneDelta(
      env,
      params.userId,
      'cxp',
      'course_rating_submit',
      'course_rating',
      `${published.id}:${ratingWindow.versionKey}`,
      `cxp:course_rating_submit:${params.userId}:${published.id}:${ratingWindow.versionKey}`,
      LANE_BASE_XP.courseRatingCxp,
      now,
    );
    delta.cxp += await awardLaneDelta(
      env,
      params.userId,
      'cxp',
      'weekly_curation',
      'user_week',
      getUtcWeekKey(now),
      `cxp:weekly_curation:${params.userId}:${getUtcWeekKey(now)}`,
      LANE_BASE_XP.weeklyCuration,
      now,
    );
    delta.trust += await awardLaneDelta(
      env,
      params.userId,
      'trust',
      'course_rating_submit',
      'course_rating',
      `${published.id}:${ratingWindow.versionKey}`,
      `trust:course_rating_submit:${params.userId}:${published.id}:${ratingWindow.versionKey}`,
      1,
      now,
    );
    await markCourseRatingRewarded(env, published.id, ratingWindow.versionKey, params.userId, now);
  }

  if (params.courseRecord.ownerUserId && params.courseRecord.ownerUserId !== params.userId && firstRewardedSubmission) {
    const creatorDelta: ProgressionDelta = {
      pxp: 0,
      bxp: await awardLaneDelta(
        env,
        params.courseRecord.ownerUserId,
        'bxp',
        'unique_rating_course',
        'course_rating',
        `${published.id}:${ratingWindow.versionKey}:${params.userId}`,
        `bxp:course_unique_rating:${params.courseRecord.ownerUserId}:${published.id}:${ratingWindow.versionKey}:${params.userId}`,
        LANE_BASE_XP.uniqueRating,
        now,
      ),
      cxp: 0,
      trust: await awardLaneDelta(
        env,
        params.courseRecord.ownerUserId,
        'trust',
        'unique_rating_course',
        'course_rating',
        `${published.id}:${ratingWindow.versionKey}:${params.userId}`,
        `trust:course_unique_rating:${params.courseRecord.ownerUserId}:${published.id}:${ratingWindow.versionKey}:${params.userId}`,
        1,
        now,
      ),
    };
    await persistProgressIncrement(env, params.courseRecord.ownerUserId, creatorDelta, now);
    await syncUserBadges(env, params.courseRecord.ownerUserId);
  }

  await persistProgressIncrement(env, params.userId, delta, now);
  const summary = await buildCourseRatingSummary(env, published.id, ratingWindow, {
    viewerUserId: params.userId,
    viewerCanVote: true,
    viewerNeedsRun: false,
  });
  await syncContentTrophy(env, 'course', published.id, ratingWindow.versionKey, summary.quality);
  await refreshContentOwnerProgressCounts(env, 'course', published.id, ratingWindow.versionKey);
  await syncUserBadges(env, params.userId);

  return {
    ok: true,
    courseId: published.id,
    courseVersion: published.version,
    progressionDelta: delta,
    summary: await buildCourseRatingSummary(env, published.id, ratingWindow, {
      viewerUserId: params.userId,
      viewerCanVote: true,
      viewerNeedsRun: false,
    }),
    progression: await loadPublicProgressionSummary(env, params.userId),
  };
}

export async function loadRoomAggregateRatingSummaryForVersion(
  env: Env,
  roomRecord: RoomRecord,
  roomVersion: number,
  viewerUserId: string | null,
  currentPublishedVersion: number | null,
): Promise<RatingAggregateSummary> {
  return loadRoomAggregateRatingSummaryFromVersions(
    env,
    roomRecord.draft.id,
    roomRecord.versions,
    roomVersion,
    viewerUserId,
    currentPublishedVersion,
  );
}

export async function loadRoomAggregateRatingSummaryFromVersions(
  env: Env,
  roomId: string,
  versions: RoomVersionRecord[],
  roomVersion: number,
  viewerUserId: string | null,
  currentPublishedVersion: number | null,
): Promise<RatingAggregateSummary> {
  const ratingWindow = buildRoomRatingWindow(versions, roomVersion);
  const viewerNeedsRun =
    viewerUserId !== null &&
    currentPublishedVersion === roomVersion &&
    !(await hasCompletedRoomRatingWindow(env, roomId, ratingWindow.versionFamily, viewerUserId));

  return buildRoomRatingSummary(env, roomId, ratingWindow, {
    viewerUserId,
    viewerCanVote: viewerUserId !== null && currentPublishedVersion === roomVersion && !viewerNeedsRun,
    viewerNeedsRun,
  });
}

export async function loadCourseAggregateRatingSummaryForVersion(
  env: Env,
  courseRecord: CourseRecord,
  courseVersion: number,
  viewerUserId: string | null,
): Promise<RatingAggregateSummary> {
  const ratingWindow = buildCourseRatingWindow(courseRecord.versions, courseVersion, courseRecord.draft.id);
  const viewerNeedsRun =
    viewerUserId !== null &&
    courseRecord.published?.version === courseVersion &&
    !(await hasCompletedCourseRatingWindow(env, courseRecord.draft.id, ratingWindow.versionFamily, viewerUserId));

  return buildCourseRatingSummary(env, courseRecord.draft.id, ratingWindow, {
    viewerUserId,
    viewerCanVote: viewerUserId !== null && courseRecord.published?.version === courseVersion && !viewerNeedsRun,
    viewerNeedsRun,
  });
}

export function validateRoomObjectsAgainstCapabilities(
  room: RoomSnapshot,
  capabilities: RoomCapabilitySnapshot,
  previousRoom: RoomSnapshot | null,
): void {
  const previousPlacedObjectsCount = previousRoom?.placedObjects.length ?? 0;
  if (
    room.placedObjects.length > capabilities.objectLimit &&
    room.placedObjects.length > previousPlacedObjectsCount
  ) {
    throw new HttpError(
      429,
      `Builder cap reached. Your current trust tier allows ${capabilities.objectLimit} placed objects per room.`,
    );
  }

  const collectibleCount = countCollectibleObjects(room.placedObjects);
  const previousCollectibleCount = previousRoom ? countCollectibleObjects(previousRoom.placedObjects) : 0;
  if (
    collectibleCount > capabilities.collectibleLimit &&
    collectibleCount > previousCollectibleCount
  ) {
    throw new HttpError(
      429,
      `Builder cap reached. Your current trust tier allows ${capabilities.collectibleLimit} collectibles per room.`,
    );
  }
}
