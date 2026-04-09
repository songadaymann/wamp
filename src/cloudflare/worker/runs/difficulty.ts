import type { RoomSnapshot } from '../../../persistence/roomModel';
import { ROOM_GOAL_TYPES, type RoomGoalType } from '../../../goals/roomGoals';
import type { RoomDifficulty,
  RoomDifficultyCounts,
  RoomDifficultySummary,
  RoomDiscoveryEntry,
  RoomDiscoveryResponse,
  RoomDiscoverySort,
} from '../../../runs/model';
import type { QualityRatingSummary, TrophyAwardSummary } from '../../../progression/model';
import {
  normalizeRoomDifficulty,
  normalizeRoomDiscoverySort,
  ROOM_DIFFICULTIES,
} from '../../../runs/model';
import { HttpError } from '../core/http';
import type { ContentTrophyRow, Env, RoomDifficultyVoteRow } from '../core/types';

interface RoomDifficultyAggregateRow {
  easy_votes: number | string | null;
  medium_votes: number | string | null;
  hard_votes: number | string | null;
  extreme_votes: number | string | null;
}

interface PublishedRoomDiscoveryRow {
  id: string;
  x: number;
  y: number;
  published_title: string | null;
  published_goal_type: string | null;
  last_published_by_user_id: string | null;
  last_published_by_display_name: string | null;
  current_published_version: number;
  published_at: string;
  canonical_version: number | null;
}

interface FeaturedRoomRow {
  room_id: string;
  room_version: number;
  featured_at: string;
}

interface BuilderProgressionRow {
  user_id: string;
  total_bxp: number | string | null;
  builder_level: number | string | null;
}

interface RoomDiscoveryRatingAggregateRow {
  room_id: string;
  quality_vote_count: number | string | null;
  quality_raw_sum: number | string | null;
  quality_weighted_sum: number | string | null;
  quality_weighted_vote_count: number | string | null;
  one_star_count: number | string | null;
  two_star_count: number | string | null;
  three_star_count: number | string | null;
  four_star_count: number | string | null;
  five_star_count: number | string | null;
  easy_count: number | string | null;
  medium_count: number | string | null;
  hard_count: number | string | null;
  extreme_count: number | string | null;
  easy_weight: number | string | null;
  medium_weight: number | string | null;
  hard_weight: number | string | null;
  extreme_weight: number | string | null;
}

interface DiscoveryRoomVersionKey {
  roomId: string;
  roomVersion: number;
}

const QUALITY_PRIOR_MEAN = 3.5;
const QUALITY_PRIOR_WEIGHT = 5;

export function createEmptyRoomDifficultyCounts(): RoomDifficultyCounts {
  return {
    easy: 0,
    medium: 0,
    hard: 0,
    extreme: 0,
  };
}

export function getRoomDifficultyVoteTotal(counts: RoomDifficultyCounts): number {
  return counts.easy + counts.medium + counts.hard + counts.extreme;
}

export function resolveRoomDifficultyConsensus(
  counts: RoomDifficultyCounts
): RoomDifficulty | null {
  let bestDifficulty: RoomDifficulty | null = null;
  let bestCount = 0;
  for (const difficulty of ROOM_DIFFICULTIES) {
    const nextCount = counts[difficulty];
    if (nextCount > bestCount) {
      bestCount = nextCount;
      bestDifficulty = difficulty;
    }
  }

  return bestCount > 0 ? bestDifficulty : null;
}

export async function loadRoomDifficultyCounts(
  env: Env,
  roomId: string,
  roomVersions: number[]
): Promise<RoomDifficultyCounts> {
  const dedupedVotes = await loadLatestDifficultyVotesByUser(env, roomId, roomVersions);
  return summarizeDifficultyVotes(dedupedVotes);
}

export async function loadViewerRoomDifficultyVote(
  env: Env,
  roomId: string,
  roomVersions: number[],
  userId: string
): Promise<RoomDifficulty | null> {
  const votes = await loadLatestDifficultyVotesByUser(env, roomId, roomVersions);
  return normalizeRoomDifficulty(
    votes.find((vote) => vote.user_id === userId)?.difficulty ?? null
  );
}

export async function hasViewerRatedRoomVersion(
  env: Env,
  roomId: string,
  roomVersions: number[],
  userId: string
): Promise<boolean> {
  if (roomVersions.length === 0) {
    return false;
  }

  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM room_runs
      WHERE room_id = ?
        AND room_version IN (${roomVersions.map(() => '?').join(', ')})
        AND user_id = ?
        AND result != 'active'
      LIMIT 1
    `
  )
    .bind(roomId, ...roomVersions, userId)
    .first<{ found: number | string | null }>();

  return Number(row?.found ?? 0) === 1;
}

export async function buildRoomDifficultySummary(
  env: Env,
  snapshot: RoomSnapshot,
  viewerUserId: string | null,
  currentPublishedVersion: number | null,
  effectiveRoomVersion: number,
  leaderboardFamilyVersions: number[]
): Promise<RoomDifficultySummary> {
  const counts = await loadRoomDifficultyCounts(env, snapshot.id, leaderboardFamilyVersions);
  const viewerSignedIn = viewerUserId !== null;
  const viewerVote =
    viewerUserId === null
      ? null
      : await loadViewerRoomDifficultyVote(env, snapshot.id, leaderboardFamilyVersions, viewerUserId);
  const viewerCanRateCurrentVersion =
    viewerUserId !== null &&
    currentPublishedVersion === effectiveRoomVersion &&
    (await hasViewerRatedRoomVersion(env, snapshot.id, leaderboardFamilyVersions, viewerUserId));

  return {
    consensus: resolveRoomDifficultyConsensus(counts),
    counts,
    totalVotes: getRoomDifficultyVoteTotal(counts),
    viewerVote,
    viewerSignedIn,
    viewerCanVote: viewerCanRateCurrentVersion,
    viewerNeedsRun:
      viewerUserId !== null &&
      currentPublishedVersion === effectiveRoomVersion &&
      !viewerCanRateCurrentVersion,
  };
}

export async function upsertRoomDifficultyVote(
  env: Env,
  roomId: string,
  roomVersion: number,
  userId: string,
  difficulty: RoomDifficulty,
  now: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO room_difficulty_votes (
          room_id,
          room_version,
          user_id,
          difficulty,
          created_at,
          updated_at,
          carried_from_version
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(room_id, room_version, user_id) DO UPDATE SET
          difficulty = excluded.difficulty,
          updated_at = excluded.updated_at,
          carried_from_version = NULL
      `
    ).bind(roomId, roomVersion, userId, difficulty, now, now),
  ]);
}

export async function loadRoomDiscoveryResponse(
  env: Env,
  difficultyFilter: RoomDifficulty | null,
  limit: number,
  sort: RoomDiscoverySort,
): Promise<RoomDiscoveryResponse> {
  const publishedRooms = await env.DB.prepare(
    `
      SELECT
        rooms.id,
        rooms.x,
        rooms.y,
        rooms.published_title,
        rooms.published_goal_type,
        rooms.last_published_by_user_id,
        rooms.last_published_by_display_name,
        latest.version AS current_published_version,
        latest.created_at AS published_at,
        rooms.canonical_version
      FROM rooms
      INNER JOIN (
        SELECT room_id, MAX(version) AS version
        FROM room_versions
        GROUP BY room_id
      ) AS latest_index
        ON latest_index.room_id = rooms.id
      INNER JOIN room_versions AS latest
        ON latest.room_id = latest_index.room_id
       AND latest.version = latest_index.version
      WHERE rooms.published_json IS NOT NULL
        AND rooms.published_goal_type IS NOT NULL
    `
  ).all<PublishedRoomDiscoveryRow>();

  const challengeRooms = publishedRooms.results.map((row) => mapPublishedRoomDiscoveryRow(row));

  if (challengeRooms.length === 0) {
    return {
      difficultyFilter,
      sort,
      results: [],
    };
  }

  const roomIds = challengeRooms.map((entry) => entry.roomId);
  const builderUserIds = Array.from(
    new Set(
      challengeRooms
        .map((entry) => entry.builderUserId?.trim() ?? '')
        .filter((value) => value.length > 0),
    ),
  );
  const roomVersionKeys = challengeRooms.map((entry) => ({
    roomId: entry.roomId,
    roomVersion: entry.roomVersion,
  }));
  const [featuredRows, ratingRows, trophyRows, builderRows] = await Promise.all([
    loadFeaturedRoomRows(env, roomIds),
    loadRoomDiscoveryRatingAggregateRows(env, roomVersionKeys),
    loadRoomDiscoveryTrophyRows(env, roomVersionKeys),
    loadBuilderProgressionRows(env, builderUserIds),
  ]);
  const featuredByRoomId = new Map(
    featuredRows.results.map((row) => [row.room_id, row] as const),
  );
  const ratingByRoomId = new Map(
    ratingRows.results.map((row) => [row.room_id, row] as const),
  );
  const trophyByRoomId = new Map<string, TrophyAwardSummary>();
  for (const row of trophyRows.results) {
    if (trophyByRoomId.has(row.content_id)) {
      continue;
    }
    trophyByRoomId.set(row.content_id, {
      contentType: 'room',
      contentId: row.content_id,
      versionKey: parseRowNumber(row.version_key),
      trophyType: row.trophy_type,
      awardedAt: row.awarded_at,
    });
  }
  const builderProgressByUserId = new Map(
    builderRows.results.map((row) => [
      row.user_id,
      {
        builderLevel: parseRowNumber(row.builder_level),
        builderTotalBxp: parseRowNumber(row.total_bxp),
      },
    ] as const),
  );

  const results = challengeRooms
    .map((room): RoomDiscoveryEntry => {
      const featured = featuredByRoomId.get(room.roomId) ?? null;
      const ratingSummary = buildDiscoveryRatingSummary(
        ratingByRoomId.get(room.roomId) ?? null,
      );
      const builderProgress =
        room.builderUserId ? (builderProgressByUserId.get(room.builderUserId) ?? null) : null;
      const voteCount = Math.max(
        ratingSummary.quality.voteCount,
        ratingSummary.totalDifficultyVotes,
      );

      return {
        roomId: room.roomId,
        roomCoordinates: { ...room.roomCoordinates },
        roomTitle: room.roomTitle,
        builderUserId: room.builderUserId,
        builderDisplayName: room.builderDisplayName,
        builderLevel: builderProgress?.builderLevel ?? null,
        builderTotalBxp: builderProgress?.builderTotalBxp ?? null,
        roomVersion: room.roomVersion,
        displayRoomVersion: room.roomVersion,
        leaderboardSourceVersion: null,
        canonicalRoomVersion: room.canonicalRoomVersion,
        goalType: room.goalType,
        consensusDifficulty: ratingSummary.consensusDifficulty,
        voteCount,
        quality: ratingSummary.quality,
        trophy: trophyByRoomId.get(room.roomId) ?? null,
        publishedAt: room.publishedAt,
        featured:
          featured !== null
          && featured.room_version === room.roomVersion,
        featuredAt:
          featured !== null && featured.room_version === room.roomVersion
            ? featured.featured_at
            : null,
      };
    })
    .filter((entry) => difficultyFilter === null || entry.consensusDifficulty === difficultyFilter)
    .sort((left, right) => compareRoomDiscoveryEntries(left, right, sort))
    .slice(0, limit);

  return {
    difficultyFilter,
    sort,
    results,
  };
}

export function parseRoomDifficultyOrThrow(value: unknown): RoomDifficulty {
  const normalized = normalizeRoomDifficulty(value);
  if (!normalized) {
    throw new HttpError(400, 'difficulty must be easy, medium, hard, or extreme.');
  }

  return normalized;
}

export function parseRoomDiscoverySortOrThrow(value: unknown): RoomDiscoverySort {
  const normalized = normalizeRoomDiscoverySort(value);
  if (!normalized) {
    throw new HttpError(400, 'sort must be featured, quality, newest, or builder.');
  }

  return normalized;
}

function compareRoomDiscoveryEntries(
  left: RoomDiscoveryEntry,
  right: RoomDiscoveryEntry,
  sort: RoomDiscoverySort,
): number {
  if (sort === 'featured') {
    const featuredCompare = compareBooleansDesc(left.featured, right.featured);
    if (featuredCompare !== 0) {
      return featuredCompare;
    }
    const featuredAtCompare = compareTimestampsDesc(left.featuredAt, right.featuredAt);
    if (featuredAtCompare !== 0) {
      return featuredAtCompare;
    }
    const qualityCompare = compareQualityDesc(left, right);
    if (qualityCompare !== 0) {
      return qualityCompare;
    }
    const voteCompare = right.voteCount - left.voteCount;
    if (voteCompare !== 0) {
      return voteCompare;
    }
    return compareTimestampsDesc(left.publishedAt, right.publishedAt);
  }

  if (sort === 'quality') {
    const qualityCompare = compareQualityDesc(left, right);
    if (qualityCompare !== 0) {
      return qualityCompare;
    }
    const voteCompare = right.voteCount - left.voteCount;
    if (voteCompare !== 0) {
      return voteCompare;
    }
    return compareTimestampsDesc(left.publishedAt, right.publishedAt);
  }

  if (sort === 'builder') {
    const builderLevelCompare = (right.builderLevel ?? 0) - (left.builderLevel ?? 0);
    if (builderLevelCompare !== 0) {
      return builderLevelCompare;
    }
    const builderXpCompare = (right.builderTotalBxp ?? 0) - (left.builderTotalBxp ?? 0);
    if (builderXpCompare !== 0) {
      return builderXpCompare;
    }
    const qualityCompare = compareQualityDesc(left, right);
    if (qualityCompare !== 0) {
      return qualityCompare;
    }
    const voteCompare = right.voteCount - left.voteCount;
    if (voteCompare !== 0) {
      return voteCompare;
    }
    const builderCompare = compareNullableStringsAsc(left.builderDisplayName, right.builderDisplayName);
    if (builderCompare !== 0) {
      return builderCompare;
    }
    const titleCompare = compareNullableStringsAsc(left.roomTitle, right.roomTitle);
    if (titleCompare !== 0) {
      return titleCompare;
    }
    return compareTimestampsDesc(left.publishedAt, right.publishedAt);
  }

  return compareTimestampsDesc(left.publishedAt, right.publishedAt);
}

function compareQualityDesc(left: RoomDiscoveryEntry, right: RoomDiscoveryEntry): number {
  const leftQuality = left.quality.adjustedAverage ?? -1;
  const rightQuality = right.quality.adjustedAverage ?? -1;
  if (rightQuality !== leftQuality) {
    return rightQuality - leftQuality;
  }
  return 0;
}

function compareTimestampsDesc(left: string | null, right: string | null): number {
  const leftMs = left ? Date.parse(left) : 0;
  const rightMs = right ? Date.parse(right) : 0;
  return rightMs - leftMs;
}

function compareBooleansDesc(left: boolean, right: boolean): number {
  if (left === right) {
    return 0;
  }
  return right ? 1 : -1;
}

function compareNullableStringsAsc(left: string | null, right: string | null): number {
  const leftValue = left?.trim() || '';
  const rightValue = right?.trim() || '';
  if (!leftValue && !rightValue) {
    return 0;
  }
  if (!leftValue) {
    return 1;
  }
  if (!rightValue) {
    return -1;
  }
  return leftValue.localeCompare(rightValue, undefined, { sensitivity: 'base' });
}

async function loadBuilderProgressionRows(
  env: Env,
  userIds: string[],
): Promise<{ results: BuilderProgressionRow[] }> {
  if (userIds.length === 0) {
    return { results: [] };
  }

  const results: BuilderProgressionRow[] = [];
  for (const userIdChunk of chunkValues(userIds, 50)) {
    const chunkRows = await env.DB.prepare(
      `
        SELECT
          user_id,
          total_bxp,
          builder_level
        FROM user_progress
        WHERE user_id IN (${userIdChunk.map(() => '?').join(', ')})
      `
    )
      .bind(...userIdChunk)
      .all<BuilderProgressionRow>();
    results.push(...chunkRows.results);
  }

  return { results };
}

async function loadFeaturedRoomRows(
  env: Env,
  roomIds: string[],
): Promise<{ results: FeaturedRoomRow[] }> {
  const results: FeaturedRoomRow[] = [];
  for (const roomIdChunk of chunkValues(roomIds, 50)) {
    const chunkRows = await env.DB.prepare(
      `
        SELECT
          room_id,
          room_version,
          featured_at
        FROM featured_rooms
        WHERE room_id IN (${roomIdChunk.map(() => '?').join(', ')})
      `
    )
      .bind(...roomIdChunk)
      .all<FeaturedRoomRow>();
    results.push(...chunkRows.results);
  }

  return { results };
}

async function loadRoomDiscoveryRatingAggregateRows(
  env: Env,
  roomVersionKeys: DiscoveryRoomVersionKey[],
): Promise<{ results: RoomDiscoveryRatingAggregateRow[] }> {
  const results: RoomDiscoveryRatingAggregateRow[] = [];
  for (const roomVersionChunk of chunkValues(roomVersionKeys, 40)) {
    const whereClause = roomVersionChunk
      .map(() => '(room_id = ? AND version_key = ?)')
      .join(' OR ');
    const bindings = roomVersionChunk.flatMap((entry) => [entry.roomId, entry.roomVersion]);
    const chunkRows = await env.DB.prepare(
      `
        SELECT
          room_id,
          SUM(CASE WHEN quality_stars IS NOT NULL THEN 1 ELSE 0 END) AS quality_vote_count,
          SUM(CASE WHEN quality_stars IS NOT NULL THEN quality_stars ELSE 0 END) AS quality_raw_sum,
          SUM(CASE WHEN quality_stars IS NOT NULL THEN quality_stars * trust_weight ELSE 0 END) AS quality_weighted_sum,
          SUM(CASE WHEN quality_stars IS NOT NULL THEN trust_weight ELSE 0 END) AS quality_weighted_vote_count,
          SUM(CASE WHEN quality_stars = 1 THEN 1 ELSE 0 END) AS one_star_count,
          SUM(CASE WHEN quality_stars = 2 THEN 1 ELSE 0 END) AS two_star_count,
          SUM(CASE WHEN quality_stars = 3 THEN 1 ELSE 0 END) AS three_star_count,
          SUM(CASE WHEN quality_stars = 4 THEN 1 ELSE 0 END) AS four_star_count,
          SUM(CASE WHEN quality_stars = 5 THEN 1 ELSE 0 END) AS five_star_count,
          SUM(CASE WHEN difficulty_choice = 'easy' THEN 1 ELSE 0 END) AS easy_count,
          SUM(CASE WHEN difficulty_choice = 'medium' THEN 1 ELSE 0 END) AS medium_count,
          SUM(CASE WHEN difficulty_choice = 'hard' THEN 1 ELSE 0 END) AS hard_count,
          SUM(CASE WHEN difficulty_choice = 'extreme' THEN 1 ELSE 0 END) AS extreme_count,
          SUM(CASE WHEN difficulty_choice = 'easy' THEN trust_weight ELSE 0 END) AS easy_weight,
          SUM(CASE WHEN difficulty_choice = 'medium' THEN trust_weight ELSE 0 END) AS medium_weight,
          SUM(CASE WHEN difficulty_choice = 'hard' THEN trust_weight ELSE 0 END) AS hard_weight,
          SUM(CASE WHEN difficulty_choice = 'extreme' THEN trust_weight ELSE 0 END) AS extreme_weight
        FROM room_ratings
        WHERE ${whereClause}
        GROUP BY room_id
      `
    )
      .bind(...bindings)
      .all<RoomDiscoveryRatingAggregateRow>();
    results.push(...chunkRows.results);
  }

  return { results };
}

async function loadRoomDiscoveryTrophyRows(
  env: Env,
  roomVersionKeys: DiscoveryRoomVersionKey[],
): Promise<{ results: ContentTrophyRow[] }> {
  const results: ContentTrophyRow[] = [];
  for (const roomVersionChunk of chunkValues(roomVersionKeys, 40)) {
    const whereClause = roomVersionChunk
      .map(() => '(content_id = ? AND version_key = ?)')
      .join(' OR ');
    const bindings = roomVersionChunk.flatMap((entry) => [entry.roomId, entry.roomVersion]);
    const chunkRows = await env.DB.prepare(
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
        WHERE content_type = 'room'
          AND (${whereClause})
        ORDER BY awarded_at DESC
      `
    )
      .bind(...bindings)
      .all<ContentTrophyRow>();
    results.push(...chunkRows.results);
  }

  return { results };
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function buildDiscoveryRatingSummary(row: RoomDiscoveryRatingAggregateRow | null): {
  quality: QualityRatingSummary;
  consensusDifficulty: RoomDifficulty | null;
  totalDifficultyVotes: number;
} {
  if (!row) {
    return {
      quality: createEmptyDiscoveryQualitySummary(),
      consensusDifficulty: null,
      totalDifficultyVotes: 0,
    };
  }

  const qualityVoteCount = parseRowNumber(row.quality_vote_count);
  const qualityWeightedVoteCount = parseRowFloat(row.quality_weighted_vote_count);
  const qualityCounts = {
    oneStar: parseRowNumber(row.one_star_count),
    twoStar: parseRowNumber(row.two_star_count),
    threeStar: parseRowNumber(row.three_star_count),
    fourStar: parseRowNumber(row.four_star_count),
    fiveStar: parseRowNumber(row.five_star_count),
  };
  const quality =
    qualityVoteCount === 0 || qualityWeightedVoteCount <= 0
      ? createEmptyDiscoveryQualitySummary()
      : {
          adjustedAverage: roundQuality(
            (QUALITY_PRIOR_MEAN * QUALITY_PRIOR_WEIGHT + parseRowFloat(row.quality_weighted_sum)) /
              (QUALITY_PRIOR_WEIGHT + qualityWeightedVoteCount),
          ),
          rawAverage: roundQuality(parseRowFloat(row.quality_raw_sum) / qualityVoteCount),
          voteCount: qualityVoteCount,
          weightedVoteCount: roundQuality(qualityWeightedVoteCount),
          counts: qualityCounts,
        };

  const difficultyCounts = {
    easy: parseRowNumber(row.easy_count),
    medium: parseRowNumber(row.medium_count),
    hard: parseRowNumber(row.hard_count),
    extreme: parseRowNumber(row.extreme_count),
  };
  const weightedDifficulty = {
    easy: parseRowFloat(row.easy_weight),
    medium: parseRowFloat(row.medium_weight),
    hard: parseRowFloat(row.hard_weight),
    extreme: parseRowFloat(row.extreme_weight),
  };
  const totalDifficultyVotes =
    difficultyCounts.easy + difficultyCounts.medium + difficultyCounts.hard + difficultyCounts.extreme;
  let consensusDifficulty: RoomDifficulty | null = null;
  let bestWeight = 0;
  for (const difficulty of ROOM_DIFFICULTIES) {
    if (weightedDifficulty[difficulty] > bestWeight) {
      bestWeight = weightedDifficulty[difficulty];
      consensusDifficulty = difficulty;
    }
  }

  return {
    quality,
    consensusDifficulty: totalDifficultyVotes > 0 ? consensusDifficulty : null,
    totalDifficultyVotes,
  };
}

function createEmptyDiscoveryQualitySummary(): QualityRatingSummary {
  return {
    adjustedAverage: null,
    rawAverage: null,
    voteCount: 0,
    weightedVoteCount: 0,
    counts: {
      oneStar: 0,
      twoStar: 0,
      threeStar: 0,
      fourStar: 0,
      fiveStar: 0,
    },
  };
}

function roundQuality(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseRowNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseRowFloat(value: number | string | null | undefined): number {
  return parseRowNumber(value);
}

async function loadLatestDifficultyVotesByUser(
  env: Env,
  roomId: string,
  roomVersions: number[]
): Promise<RoomDifficultyVoteRow[]> {
  if (roomVersions.length === 0) {
    return [];
  }

  const result = await env.DB.prepare(
    `
      SELECT
        room_id,
        room_version,
        user_id,
        difficulty,
        created_at,
        updated_at,
        carried_from_version
      FROM room_difficulty_votes
      WHERE room_id = ?
        AND room_version IN (${roomVersions.map(() => '?').join(', ')})
    `
  )
    .bind(roomId, ...roomVersions)
    .all<RoomDifficultyVoteRow>();

  return dedupeLatestDifficultyVotesByUser(result.results);
}

function dedupeLatestDifficultyVotesByUser(rows: RoomDifficultyVoteRow[]): RoomDifficultyVoteRow[] {
  const latestByUser = new Map<string, RoomDifficultyVoteRow>();

  for (const row of rows) {
    const existing = latestByUser.get(row.user_id);
    if (!existing) {
      latestByUser.set(row.user_id, row);
      continue;
    }

    const existingUpdatedAt = Date.parse(existing.updated_at);
    const nextUpdatedAt = Date.parse(row.updated_at);
    if (
      nextUpdatedAt > existingUpdatedAt ||
      (nextUpdatedAt === existingUpdatedAt && row.room_version > existing.room_version)
    ) {
      latestByUser.set(row.user_id, row);
    }
  }

  return Array.from(latestByUser.values());
}

function summarizeDifficultyVotes(rows: RoomDifficultyVoteRow[]): RoomDifficultyCounts {
  const counts = createEmptyRoomDifficultyCounts();
  for (const row of rows) {
    const difficulty = normalizeRoomDifficulty(row.difficulty);
    if (!difficulty) {
      continue;
    }

    counts[difficulty] += 1;
  }
  return counts;
}

function mapPublishedRoomDiscoveryRow(
  row: PublishedRoomDiscoveryRow
): {
  roomId: string;
  roomCoordinates: { x: number; y: number };
  roomTitle: string | null;
  builderUserId: string | null;
  builderDisplayName: string | null;
  roomVersion: number;
  canonicalRoomVersion: number | null;
  goalType: RoomGoalType;
  publishedAt: string;
} {
  const goalType = parseRoomGoalType(row.published_goal_type);
  if (!goalType) {
    throw new HttpError(500, 'Failed to parse published room goal type.');
  }

  return {
    roomId: row.id,
    roomCoordinates: {
      x: row.x,
      y: row.y,
    },
    roomTitle: row.published_title,
    builderUserId: row.last_published_by_user_id,
    builderDisplayName: row.last_published_by_display_name,
    roomVersion: row.current_published_version,
    canonicalRoomVersion: row.canonical_version,
    goalType,
    publishedAt: row.published_at,
  };
}

function parseRoomGoalType(value: string | null): RoomGoalType | null {
  return value && ROOM_GOAL_TYPES.includes(value as RoomGoalType)
    ? (value as RoomGoalType)
    : null;
}
