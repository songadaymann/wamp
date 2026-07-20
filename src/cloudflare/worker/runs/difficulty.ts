import type {
  RoomCoordinates,
  RoomSnapshot,
} from '../../../persistence/roomModel';
import { ROOM_GOAL_TYPES, type RoomGoalType } from '../../../goals/roomGoals';
import type {
  ExpandedRoomSource,
  ResolvedExpandedRoomTarget,
} from '../../../expandedRooms/model';
import type {
  BuilderDiscoveryEntry,
  BuilderDiscoveryResponse,
  BuilderDiscoverySort,
  RoomDifficulty,
  RoomDifficultyCounts,
  RoomDifficultySummary,
  RoomDiscoveryEntry,
  RoomDiscoveryResponse,
  RoomDiscoverySort,
} from '../../../runs/model';
import type { QualityRatingSummary, TrophyAwardSummary } from '../../../progression/model';
import {
  normalizeBuilderDiscoverySort,
  normalizeRoomDifficulty,
  normalizeRoomDiscoverySort,
  ROOM_DIFFICULTIES,
} from '../../../runs/model';
import { HttpError } from '../core/http';
import type { ServerTiming } from '../core/serverTiming';
import type { ContentTrophyRow, Env, RoomDifficultyVoteRow } from '../core/types';
import {
  sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix,
  sqlUserIdIsNotLegacyGeneratedOnly,
} from '../generatedUsers/leaderboardIsolation';
import {
  loadExpandedRoomTarget,
  loadPublishedExpandedRoomMembershipsForRoomIds,
} from '../expandedRooms/store';
import { isExpandedRoomSchemaMissingError } from '../expandedRooms/schemaErrors';

interface PublishedRoomDiscoveryRow {
  id: string;
  x: number;
  y: number;
  published_title: string | null;
  published_goal_type: string | null;
  claimer_user_id: string | null;
  claimer_display_name: string | null;
  last_published_by_user_id: string | null;
  last_published_by_display_name: string | null;
  current_published_version: number;
  published_at: string;
  first_published_at: string;
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

interface BuilderDiscoveryRow {
  user_id: string;
  display_name: string | null;
  username: string | null;
  room_count: number | string | null;
  latest_published_at: string | null;
  first_published_at: string | null;
}

interface BuilderDiscoveryUserRow {
  id: string;
  display_name: string | null;
  username: string | null;
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

interface DiscoveryExpandedRoomVersionKey {
  expandedRoomId: string;
  expandedRoomVersion: number;
}

interface DiscoveryViewerRoomState {
  visited: boolean;
  completed: boolean;
  rated: boolean;
}

interface RoomDiscoveryAreaCandidate {
  representative: PublishedRoomDiscoveryEntry;
  rooms: PublishedRoomDiscoveryEntry[];
  expandedRoom: ResolvedExpandedRoomTarget | null;
  roomVersionKeys: DiscoveryRoomVersionKey[];
  expandedRoomVersionKey: DiscoveryExpandedRoomVersionKey | null;
}

interface IndexedDiscoveryRow {
  target_type: 'room' | 'expanded_room';
  content_id: string;
  version_key: number | string;
  representative_room_id: string;
  representative_room_version: number | string;
  room_x: number | string;
  room_y: number | string;
  builder_user_id: string | null;
  builder_display_name: string | null;
  title: string | null;
  goal_type: string | null;
  published_at: string;
  first_published_at: string | null;
  cell_count: number | string;
  anchor_x: number | string;
  anchor_y: number | string;
  source_type: ExpandedRoomSource;
  legacy_course_id: string | null;
  canonical_room_version: number | string | null;
  featured_at: string | null;
  quality_adjusted_average: number | string | null;
  quality_vote_count: number | string | null;
  consensus_difficulty: string | null;
  difficulty_vote_count: number | string | null;
}

type PublishedRoomDiscoveryEntry = ReturnType<typeof mapPublishedRoomDiscoveryRow>;

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
  includeGoalLessRooms: boolean = false,
  viewerUserId: string | null = null,
  timing: ServerTiming | null = null,
  cursorOffset: number = 0,
): Promise<RoomDiscoveryResponse> {
  const includeAllPublishedRooms = includeGoalLessRooms && sort === 'newest' && difficultyFilter === null;
  const expandedRoomsEnabled = isExpandedRoomsEnabled(env);
  if (isPersonalRoomDiscoverySort(sort) && !viewerUserId) {
    throw new HttpError(401, 'Sign in to sort by your room history.');
  }
  const indexedRows = await measureDiscovery(
    timing,
    'discovery_index',
    () => loadIndexedDiscoveryRows(
      env,
      difficultyFilter,
      limit,
      sort,
      includeAllPublishedRooms,
      cursorOffset,
    ),
  );
  if (indexedRows !== null) {
    return buildIndexedDiscoveryResponse(env, indexedRows, difficultyFilter, sort, limit, cursorOffset, viewerUserId, timing);
  }
  const publishedRooms = await measureDiscovery(timing, 'discovery_rows', () => env.DB.prepare(
    `
      SELECT
        rooms.id,
        rooms.x,
        rooms.y,
        rooms.published_title,
        rooms.published_goal_type,
        rooms.claimer_user_id,
        rooms.claimer_display_name,
        rooms.last_published_by_user_id,
        rooms.last_published_by_display_name,
        latest.version AS current_published_version,
        latest.created_at AS published_at,
        first_published.first_published_at AS first_published_at,
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
      INNER JOIN (
        SELECT room_id, MIN(created_at) AS first_published_at
        FROM room_versions
        GROUP BY room_id
      ) AS first_published
        ON first_published.room_id = rooms.id
      WHERE rooms.published_json IS NOT NULL
        AND (? = 1 OR rooms.published_goal_type IS NOT NULL)
    `
  )
    .bind(
      includeAllPublishedRooms || expandedRoomsEnabled ? 1 : 0,
    )
    .all<PublishedRoomDiscoveryRow>());

  const challengeRooms = publishedRooms.results.map((row) => mapPublishedRoomDiscoveryRow(row));

  if (challengeRooms.length === 0) {
    return {
      difficultyFilter,
      sort,
      results: [],
    };
  }

  const discoveryAreas = await measureDiscovery(timing, 'discovery_areas', () => resolveRoomDiscoveryAreaCandidates(
    env,
    challengeRooms,
    expandedRoomsEnabled,
  ));
  const roomIds = Array.from(
    new Set(discoveryAreas.flatMap((area) => area.roomVersionKeys.map((key) => key.roomId))),
  );
  const builderUserIds = Array.from(
    new Set(
      discoveryAreas
        .map((area) => getDiscoveryAreaBuilderUserId(area)?.trim() ?? '')
        .filter((value) => value.length > 0),
    ),
  );
  const roomVersionKeys = dedupeDiscoveryRoomVersionKeys(
    discoveryAreas.flatMap((area) => area.roomVersionKeys),
  );
  const expandedRoomVersionKeys = dedupeDiscoveryExpandedRoomVersionKeys(
    discoveryAreas.flatMap((area) => area.expandedRoomVersionKey ? [area.expandedRoomVersionKey] : []),
  );
  const [
    featuredRows,
    ratingRows,
    expandedRoomRatingRows,
    trophyRows,
    builderRows,
    viewerStates,
    expandedRoomViewerStates,
  ] = await Promise.all([
    measureDiscovery(timing, 'discovery_featured', () => loadFeaturedRoomRows(env, roomIds)),
    measureDiscovery(timing, 'discovery_ratings', () => loadRoomDiscoveryRatingAggregateRows(env, roomVersionKeys)),
    measureDiscovery(timing, 'discovery_expanded_ratings', () => loadExpandedRoomDiscoveryRatingAggregateRows(env, expandedRoomVersionKeys)),
    measureDiscovery(timing, 'discovery_trophies', () => loadRoomDiscoveryTrophyRows(env, roomVersionKeys)),
    measureDiscovery(timing, 'discovery_builders', () => loadBuilderProgressionRows(env, builderUserIds)),
    viewerUserId
      ? measureDiscovery(timing, 'discovery_viewer', () => loadDiscoveryViewerRoomStates(env, viewerUserId, roomVersionKeys))
      : Promise.resolve(new Map<string, DiscoveryViewerRoomState>()),
    viewerUserId
      ? measureDiscovery(timing, 'discovery_expanded_viewer', () => loadDiscoveryViewerExpandedRoomStates(env, viewerUserId, expandedRoomVersionKeys))
      : Promise.resolve(new Map<string, DiscoveryViewerRoomState>()),
  ]);
  const featuredByRoomId = new Map(
    featuredRows.results.map((row) => [row.room_id, row] as const),
  );
  const ratingByRoomId = new Map(
    ratingRows.results.map((row) => [row.room_id, row] as const),
  );
  const expandedRatingByRoomId = new Map(
    expandedRoomRatingRows.results.map((row) => [row.room_id, row] as const),
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

  const orderedResults = discoveryAreas
    .map((area): RoomDiscoveryEntry => {
      const room = area.representative;
      const featured = getDiscoveryAreaFeaturedRow(area, featuredByRoomId);
      const expandedRatingSummary = area.expandedRoomVersionKey
        ? expandedRatingByRoomId.get(area.expandedRoomVersionKey.expandedRoomId) ?? null
        : null;
      const ratingSummary = buildDiscoveryRatingSummary(
        expandedRatingSummary ?? combineRoomDiscoveryRatingRows(
          area.roomVersionKeys
            .map((key) => ratingByRoomId.get(key.roomId) ?? null)
            .filter((row): row is RoomDiscoveryRatingAggregateRow => row !== null),
        ),
      );
      const builderUserId = getDiscoveryAreaBuilderUserId(area);
      const builderProgress =
        builderUserId ? (builderProgressByUserId.get(builderUserId) ?? null) : null;
      const voteCount = Math.max(
        ratingSummary.quality.voteCount,
        ratingSummary.totalDifficultyVotes,
      );
      const viewerState =
        viewerUserId === null
          ? null
          : getDiscoveryAreaViewerState(area, viewerStates, expandedRoomViewerStates);
      const expandedRoom = area.expandedRoom;

      return {
        roomId: room.roomId,
        roomCoordinates: { ...room.roomCoordinates },
        roomTitle: expandedRoom?.title?.trim() || room.roomTitle,
        builderUserId,
        builderDisplayName: expandedRoom?.ownerDisplayName ?? room.builderDisplayName,
        builderLevel: builderProgress?.builderLevel ?? null,
        builderTotalBxp: builderProgress?.builderTotalBxp ?? null,
        roomVersion: room.roomVersion,
        displayRoomVersion: room.roomVersion,
        leaderboardSourceVersion: null,
        canonicalRoomVersion: room.canonicalRoomVersion,
        goalType: normalizeDiscoveryGoalType(expandedRoom?.goalType ?? room.goalType),
        consensusDifficulty: ratingSummary.consensusDifficulty,
        voteCount,
        quality: ratingSummary.quality,
        trophy: getDiscoveryAreaTrophy(area, trophyByRoomId),
        publishedAt: expandedRoom?.publishedAt ?? room.publishedAt,
        firstPublishedAt: expandedRoom?.publishedAt ?? getDiscoveryAreaFirstPublishedAt(area),
        featured:
          featured !== null
          && area.roomVersionKeys.some((key) => key.roomId === featured.room_id && key.roomVersion === featured.room_version),
        featuredAt:
          featured !== null
            ? featured.featured_at
            : null,
        viewerState:
          viewerState === null
            ? null
            : {
                visited: viewerState.visited,
                completed: viewerState.completed,
                rated: viewerState.rated,
              },
        expandedRoom: expandedRoom
          ? mapDiscoveryExpandedRoomTarget(expandedRoom, room.roomCoordinates)
          : null,
      };
    })
    .filter((entry) => includeAllPublishedRooms || entry.goalType !== null)
    .filter((entry) => difficultyFilter === null || entry.consensusDifficulty === difficultyFilter)
    .filter((entry) => {
      if (!isPersonalRoomDiscoverySort(sort)) {
        return true;
      }

      const state = entry.viewerState ?? createEmptyDiscoveryViewerRoomState();
      switch (sort) {
        case 'unbeaten':
          return !state.completed;
        case 'unvisited':
          return !state.visited;
        case 'unrated':
          return state.completed && !state.rated && !isViewerRoomBuilder(entry, viewerUserId);
        default:
          return true;
      }
    })
    .sort((left, right) => compareRoomDiscoveryEntries(left, right, sort));
  const pageOffset = cursorOffset;
  const results = orderedResults.slice(pageOffset, pageOffset + limit);
  const hasMore = orderedResults.length > pageOffset + limit;

  return {
    difficultyFilter,
    sort,
    results,
    ...(hasMore ? { nextCursor: encodeRoomDiscoveryCursor(sort, cursorOffset + limit) } : {}),
  };
}

async function loadIndexedDiscoveryRows(
  env: Env,
  difficultyFilter: RoomDifficulty | null,
  limit: number,
  sort: RoomDiscoverySort,
  includeAllPublishedRooms: boolean,
  cursorOffset: number,
): Promise<IndexedDiscoveryRow[] | null> {
  if (
    !playableContentIndexReadsEnabled(env)
    || (sort !== 'newest' && sort !== 'featured' && sort !== 'quality')
  ) {
    return null;
  }

  const orderClause = sort === 'newest'
    ? 'index_row.first_published_at DESC, index_row.published_at DESC, index_row.target_key ASC'
    : sort === 'quality'
      ? 'index_row.quality_adjusted_average DESC, index_row.quality_vote_count DESC, index_row.published_at DESC, index_row.target_key ASC'
      : '(index_row.featured_at IS NOT NULL) DESC, index_row.featured_at DESC, index_row.quality_adjusted_average DESC, index_row.quality_vote_count DESC, index_row.published_at DESC, index_row.target_key ASC';
  const candidateLimit = limit + 1;

  try {
    const rows = await env.DB.prepare(
      `
        SELECT
          index_row.target_type,
          index_row.content_id,
          index_row.version_key,
          index_row.representative_room_id,
          COALESCE(member.room_version, index_row.version_key) AS representative_room_version,
          index_row.room_x,
          index_row.room_y,
          index_row.builder_user_id,
          index_row.builder_display_name,
          index_row.title,
          index_row.goal_type,
          index_row.published_at,
          index_row.first_published_at,
          index_row.cell_count,
          index_row.anchor_x,
          index_row.anchor_y,
          index_row.source_type,
          index_row.legacy_course_id,
          index_row.canonical_room_version,
          index_row.featured_at,
          index_row.quality_adjusted_average,
          index_row.quality_vote_count,
          index_row.consensus_difficulty,
          index_row.difficulty_vote_count
        FROM playable_content_index index_row
        LEFT JOIN playable_content_index_members member
          ON member.target_key = index_row.target_key
         AND member.room_id = index_row.representative_room_id
        WHERE (? = 1 OR index_row.goal_type IS NOT NULL)
          AND (? IS NULL OR index_row.consensus_difficulty = ?)
        ORDER BY ${orderClause}
        LIMIT ? OFFSET ?
      `,
    )
      .bind(
        includeAllPublishedRooms ? 1 : 0,
        difficultyFilter,
        difficultyFilter,
        candidateLimit,
        cursorOffset,
      )
      .all<IndexedDiscoveryRow>();
    return rows.results;
  } catch (error) {
    if (String(error).toLowerCase().includes('playable_content_index')) {
      console.warn('Playable-content index is enabled but unavailable; falling back to legacy discovery reads.');
      return null;
    }
    throw error;
  }
}

async function buildIndexedDiscoveryResponse(
  env: Env,
  rows: IndexedDiscoveryRow[],
  difficultyFilter: RoomDifficulty | null,
  sort: RoomDiscoverySort,
  limit: number,
  cursorOffset: number,
  viewerUserId: string | null,
  timing: ServerTiming | null,
): Promise<RoomDiscoveryResponse> {
  const pageRows = rows.slice(0, limit);
  const roomVersionKeys = pageRows.map((row) => ({
    roomId: row.representative_room_id,
    roomVersion: parseRowNumber(row.representative_room_version),
  }));
  const expandedRoomVersionKeys = pageRows
    .filter((row) => row.target_type === 'expanded_room')
    .map((row) => ({
      expandedRoomId: row.content_id,
      expandedRoomVersion: parseRowNumber(row.version_key),
    }));
  const builderUserIds = Array.from(new Set(
    pageRows.map((row) => row.builder_user_id?.trim() ?? '').filter(Boolean),
  ));
  const [trophyRows, builderRows, viewerStates, expandedViewerStates] = await Promise.all([
    measureDiscovery(timing, 'discovery_trophies', () => loadRoomDiscoveryTrophyRows(env, roomVersionKeys)),
    measureDiscovery(timing, 'discovery_builders', () => loadBuilderProgressionRows(env, builderUserIds)),
    viewerUserId
      ? measureDiscovery(timing, 'discovery_viewer', () => loadDiscoveryViewerRoomStates(env, viewerUserId, roomVersionKeys))
      : Promise.resolve(new Map<string, DiscoveryViewerRoomState>()),
    viewerUserId
      ? measureDiscovery(timing, 'discovery_expanded_viewer', () => loadDiscoveryViewerExpandedRoomStates(env, viewerUserId, expandedRoomVersionKeys))
      : Promise.resolve(new Map<string, DiscoveryViewerRoomState>()),
  ]);
  const trophies = new Map<string, TrophyAwardSummary>();
  for (const row of trophyRows.results) {
    if (!trophies.has(row.content_id)) {
      trophies.set(row.content_id, {
        contentType: 'room',
        contentId: row.content_id,
        versionKey: parseRowNumber(row.version_key),
        trophyType: row.trophy_type,
        awardedAt: row.awarded_at,
      });
    }
  }
  const builderProgress = new Map(builderRows.results.map((row) => [row.user_id, row] as const));
  const results = pageRows.map((row): RoomDiscoveryEntry => {
    const roomVersion = parseRowNumber(row.representative_room_version);
    const expandedVersion = parseRowNumber(row.version_key);
    const builder = row.builder_user_id ? builderProgress.get(row.builder_user_id) : null;
    const viewerState = viewerUserId === null
      ? null
      : row.target_type === 'expanded_room'
        ? expandedViewerStates.get(buildDiscoveryExpandedRoomVersionKey(row.content_id, expandedVersion))
          ?? createEmptyDiscoveryViewerRoomState()
        : viewerStates.get(buildDiscoveryRoomVersionKey(row.representative_room_id, roomVersion))
          ?? createEmptyDiscoveryViewerRoomState();
    const qualityVoteCount = parseRowNumber(row.quality_vote_count);
    const adjustedAverage = row.quality_adjusted_average === null
      ? null
      : roundQuality(parseRowFloat(row.quality_adjusted_average));
    return {
      roomId: row.representative_room_id,
      roomCoordinates: { x: parseRowNumber(row.room_x), y: parseRowNumber(row.room_y) },
      roomTitle: row.title,
      builderUserId: row.builder_user_id,
      builderDisplayName: row.builder_display_name,
      builderLevel: builder ? parseRowNumber(builder.builder_level) : null,
      builderTotalBxp: builder ? parseRowNumber(builder.total_bxp) : null,
      roomVersion,
      displayRoomVersion: roomVersion,
      leaderboardSourceVersion: null,
      canonicalRoomVersion: row.canonical_room_version === null ? null : parseRowNumber(row.canonical_room_version),
      goalType: normalizeDiscoveryGoalType(row.goal_type),
      consensusDifficulty: normalizeRoomDifficulty(row.consensus_difficulty),
      voteCount: Math.max(qualityVoteCount, parseRowNumber(row.difficulty_vote_count)),
      quality: {
        adjustedAverage,
        rawAverage: adjustedAverage,
        voteCount: qualityVoteCount,
        weightedVoteCount: qualityVoteCount,
        counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 },
      },
      trophy: trophies.get(row.representative_room_id) ?? null,
      publishedAt: row.published_at,
      firstPublishedAt: row.first_published_at,
      featured: row.featured_at !== null,
      featuredAt: row.featured_at,
      viewerState,
      expandedRoom: row.target_type === 'expanded_room'
        ? {
            expandedRoomId: row.content_id,
            expandedRoomVersion: expandedVersion,
            title: row.title,
            source: row.source_type,
            legacyCourseId: row.legacy_course_id,
            cellCount: parseRowNumber(row.cell_count),
            anchorCoordinates: { x: parseRowNumber(row.anchor_x), y: parseRowNumber(row.anchor_y) },
            focusedCoordinates: { x: parseRowNumber(row.room_x), y: parseRowNumber(row.room_y) },
          }
        : null,
    };
  });
  return {
    difficultyFilter,
    sort,
    results,
    ...(rows.length > limit ? { nextCursor: encodeRoomDiscoveryCursor(sort, cursorOffset + limit) } : {}),
  };
}

export function encodeRoomDiscoveryCursor(sort: RoomDiscoverySort, offset: number): string {
  return btoa(JSON.stringify({ version: 1, sort, offset }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function playableContentIndexReadsEnabled(env: Env): boolean {
  const raw = env.PLAYABLE_CONTENT_INDEX_READS?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

function measureDiscovery<T>(
  timing: ServerTiming | null,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  return timing ? timing.measure(name, operation) : operation();
}

async function resolveRoomDiscoveryAreaCandidates(
  env: Env,
  rooms: PublishedRoomDiscoveryEntry[],
  expandedRoomsEnabled: boolean,
): Promise<RoomDiscoveryAreaCandidate[]> {
  if (!expandedRoomsEnabled || rooms.length === 0) {
    return rooms.map((room) => createStandaloneDiscoveryAreaCandidate(room));
  }

  const memberships = await loadPublishedExpandedRoomMembershipsForRoomIds(
    env,
    rooms.map((room) => room.roomId),
  );
  const membershipByRoomId = new Map(
    memberships
      .filter((membership) => membership.cellCount > 1)
      .map((membership) => [membership.roomId, membership] as const),
  );
  const expandedRoomIds = Array.from(
    new Set(
      Array.from(membershipByRoomId.values()).map((membership) => membership.expandedRoomId),
    ),
  );
  const expandedRoomTargets = await Promise.all(
    expandedRoomIds.map((expandedRoomId) => loadExpandedRoomTarget(env, expandedRoomId)),
  );
  const targetById = new Map(
    expandedRoomTargets
      .filter((target): target is ResolvedExpandedRoomTarget => target !== null && target.cellCount > 1)
      .map((target) => [target.expandedRoomId, target] as const),
  );
  const groupedAreas = new Map<string, {
    expandedRoom: ResolvedExpandedRoomTarget | null;
    rooms: PublishedRoomDiscoveryEntry[];
  }>();

  for (const room of rooms) {
    const membership = membershipByRoomId.get(room.roomId) ?? null;
    const expandedRoom =
      membership === null
        ? null
        : targetById.get(membership.expandedRoomId) ?? null;
    const matchedExpandedRoom =
      expandedRoom && expandedRoomContainsRoomVersion(expandedRoom, room.roomId, room.roomVersion)
        ? expandedRoom
        : null;
    const targetKey = matchedExpandedRoom
      ? getExpandedRoomDiscoveryTargetKey(matchedExpandedRoom)
      : getStandaloneDiscoveryTargetKey(room);
    const existing = groupedAreas.get(targetKey);
    if (existing) {
      existing.rooms.push(room);
      continue;
    }
    groupedAreas.set(targetKey, {
      expandedRoom: matchedExpandedRoom,
      rooms: [room],
    });
  }

  return Array.from(groupedAreas.values()).map((area) => {
    const representative = selectDiscoveryAreaRepresentative(area.rooms, area.expandedRoom);
    return {
      representative,
      rooms: area.rooms,
      expandedRoom: area.expandedRoom,
      roomVersionKeys: getDiscoveryAreaRoomVersionKeys(area.rooms, area.expandedRoom),
      expandedRoomVersionKey: getDiscoveryExpandedRoomVersionKey(area.expandedRoom),
    };
  });
}

function createStandaloneDiscoveryAreaCandidate(
  room: PublishedRoomDiscoveryEntry,
): RoomDiscoveryAreaCandidate {
  return {
    representative: room,
    rooms: [room],
    expandedRoom: null,
    roomVersionKeys: [{ roomId: room.roomId, roomVersion: room.roomVersion }],
    expandedRoomVersionKey: null,
  };
}

function selectDiscoveryAreaRepresentative(
  rooms: PublishedRoomDiscoveryEntry[],
  expandedRoom: ResolvedExpandedRoomTarget | null,
): PublishedRoomDiscoveryEntry {
  const sortedRooms = rooms.slice().sort((left, right) => {
    if (expandedRoom) {
      const leftAnchor = coordinatesEqual(left.roomCoordinates, expandedRoom.anchorCoordinates);
      const rightAnchor = coordinatesEqual(right.roomCoordinates, expandedRoom.anchorCoordinates);
      if (leftAnchor !== rightAnchor) {
        return leftAnchor ? -1 : 1;
      }
    }

    const publishedCompare = compareTimestampsDesc(left.publishedAt, right.publishedAt);
    if (publishedCompare !== 0) {
      return publishedCompare;
    }
    if (left.roomCoordinates.y !== right.roomCoordinates.y) {
      return left.roomCoordinates.y - right.roomCoordinates.y;
    }
    if (left.roomCoordinates.x !== right.roomCoordinates.x) {
      return left.roomCoordinates.x - right.roomCoordinates.x;
    }
    return left.roomId.localeCompare(right.roomId);
  });
  return sortedRooms[0];
}

function getDiscoveryAreaRoomVersionKeys(
  rooms: PublishedRoomDiscoveryEntry[],
  expandedRoom: ResolvedExpandedRoomTarget | null,
): DiscoveryRoomVersionKey[] {
  if (!expandedRoom) {
    return rooms.map((room) => ({
      roomId: room.roomId,
      roomVersion: room.roomVersion,
    }));
  }

  const keys = expandedRoom.cells.flatMap((cell) => {
    const roomVersion = normalizeDiscoveryVersion(cell.roomVersion);
    return roomVersion === null
      ? []
      : [{
          roomId: cell.roomId,
          roomVersion,
        }];
  });
  return keys.length > 0
    ? keys
    : rooms.map((room) => ({ roomId: room.roomId, roomVersion: room.roomVersion }));
}

function getDiscoveryExpandedRoomVersionKey(
  expandedRoom: ResolvedExpandedRoomTarget | null,
): DiscoveryExpandedRoomVersionKey | null {
  if (!expandedRoom) {
    return null;
  }
  const expandedRoomVersion = normalizeDiscoveryVersion(expandedRoom.version);
  return expandedRoomVersion === null
    ? null
    : {
        expandedRoomId: expandedRoom.expandedRoomId,
        expandedRoomVersion,
      };
}

function expandedRoomContainsRoomVersion(
  expandedRoom: ResolvedExpandedRoomTarget,
  roomId: string,
  roomVersion: number,
): boolean {
  return expandedRoom.cells.some(
    (cell) => cell.roomId === roomId && normalizeDiscoveryVersion(cell.roomVersion) === roomVersion,
  );
}

function getExpandedRoomDiscoveryTargetKey(target: ResolvedExpandedRoomTarget): string {
  return `expanded-room:${target.expandedRoomId}:v${target.version ?? 'published'}`;
}

function getStandaloneDiscoveryTargetKey(room: PublishedRoomDiscoveryEntry): string {
  return `room:${room.roomId}:v${room.roomVersion}`;
}

function dedupeDiscoveryRoomVersionKeys(
  keys: DiscoveryRoomVersionKey[],
): DiscoveryRoomVersionKey[] {
  const byKey = new Map<string, DiscoveryRoomVersionKey>();
  for (const key of keys) {
    byKey.set(buildDiscoveryRoomVersionKey(key.roomId, key.roomVersion), key);
  }
  return Array.from(byKey.values());
}

function dedupeDiscoveryExpandedRoomVersionKeys(
  keys: DiscoveryExpandedRoomVersionKey[],
): DiscoveryExpandedRoomVersionKey[] {
  const byKey = new Map<string, DiscoveryExpandedRoomVersionKey>();
  for (const key of keys) {
    byKey.set(buildDiscoveryExpandedRoomVersionKey(key.expandedRoomId, key.expandedRoomVersion), key);
  }
  return Array.from(byKey.values());
}

function getDiscoveryAreaBuilderUserId(area: RoomDiscoveryAreaCandidate): string | null {
  return area.expandedRoom?.ownerUserId ?? area.representative.builderUserId;
}

function normalizeDiscoveryGoalType(value: unknown): RoomGoalType | null {
  return ROOM_GOAL_TYPES.includes(value as RoomGoalType) ? (value as RoomGoalType) : null;
}

function getDiscoveryAreaFeaturedRow(
  area: RoomDiscoveryAreaCandidate,
  featuredByRoomId: Map<string, FeaturedRoomRow>,
): FeaturedRoomRow | null {
  let bestRow: FeaturedRoomRow | null = null;
  for (const key of area.roomVersionKeys) {
    const row = featuredByRoomId.get(key.roomId) ?? null;
    if (!row || row.room_version !== key.roomVersion) {
      continue;
    }
    if (!bestRow || compareTimestampsDesc(row.featured_at, bestRow.featured_at) < 0) {
      bestRow = row;
    }
  }
  return bestRow;
}

function getDiscoveryAreaTrophy(
  area: RoomDiscoveryAreaCandidate,
  trophyByRoomId: Map<string, TrophyAwardSummary>,
): TrophyAwardSummary | null {
  let bestTrophy: TrophyAwardSummary | null = null;
  for (const key of area.roomVersionKeys) {
    const trophy = trophyByRoomId.get(key.roomId) ?? null;
    if (!trophy) {
      continue;
    }
    if (!bestTrophy || compareTimestampsDesc(trophy.awardedAt, bestTrophy.awardedAt) < 0) {
      bestTrophy = trophy;
    }
  }
  return bestTrophy;
}

function getDiscoveryAreaFirstPublishedAt(area: RoomDiscoveryAreaCandidate): string | null {
  let bestTimestamp: string | null = null;
  for (const room of area.rooms) {
    if (!bestTimestamp || compareTimestampsDesc(room.firstPublishedAt, bestTimestamp) < 0) {
      bestTimestamp = room.firstPublishedAt;
    }
  }
  return bestTimestamp;
}

function getDiscoveryAreaViewerState(
  area: RoomDiscoveryAreaCandidate,
  viewerStates: Map<string, DiscoveryViewerRoomState>,
  expandedRoomViewerStates: Map<string, DiscoveryViewerRoomState>,
): DiscoveryViewerRoomState {
  if (area.expandedRoomVersionKey) {
    return expandedRoomViewerStates.get(
      buildDiscoveryExpandedRoomVersionKey(
        area.expandedRoomVersionKey.expandedRoomId,
        area.expandedRoomVersionKey.expandedRoomVersion,
      ),
    ) ?? createEmptyDiscoveryViewerRoomState();
  }

  const combined = createEmptyDiscoveryViewerRoomState();
  for (const key of area.roomVersionKeys) {
    const state = viewerStates.get(buildDiscoveryRoomVersionKey(key.roomId, key.roomVersion));
    if (!state) {
      continue;
    }
    combined.visited ||= state.visited;
    combined.completed ||= state.completed;
    combined.rated ||= state.rated;
  }
  return combined;
}

function combineRoomDiscoveryRatingRows(
  rows: RoomDiscoveryRatingAggregateRow[],
): RoomDiscoveryRatingAggregateRow | null {
  if (rows.length === 0) {
    return null;
  }

  return {
    room_id: 'combined',
    quality_vote_count: sumRatingRows(rows, 'quality_vote_count'),
    quality_raw_sum: sumRatingRows(rows, 'quality_raw_sum'),
    quality_weighted_sum: sumRatingRows(rows, 'quality_weighted_sum'),
    quality_weighted_vote_count: sumRatingRows(rows, 'quality_weighted_vote_count'),
    one_star_count: sumRatingRows(rows, 'one_star_count'),
    two_star_count: sumRatingRows(rows, 'two_star_count'),
    three_star_count: sumRatingRows(rows, 'three_star_count'),
    four_star_count: sumRatingRows(rows, 'four_star_count'),
    five_star_count: sumRatingRows(rows, 'five_star_count'),
    easy_count: sumRatingRows(rows, 'easy_count'),
    medium_count: sumRatingRows(rows, 'medium_count'),
    hard_count: sumRatingRows(rows, 'hard_count'),
    extreme_count: sumRatingRows(rows, 'extreme_count'),
    easy_weight: sumRatingRows(rows, 'easy_weight'),
    medium_weight: sumRatingRows(rows, 'medium_weight'),
    hard_weight: sumRatingRows(rows, 'hard_weight'),
    extreme_weight: sumRatingRows(rows, 'extreme_weight'),
  };
}

function sumRatingRows(
  rows: RoomDiscoveryRatingAggregateRow[],
  field: Exclude<keyof RoomDiscoveryRatingAggregateRow, 'room_id'>,
): number {
  return rows.reduce((total, row) => total + parseRowFloat(row[field]), 0);
}

function mapDiscoveryExpandedRoomTarget(
  target: ResolvedExpandedRoomTarget,
  focusedCoordinates: RoomCoordinates,
): NonNullable<RoomDiscoveryEntry['expandedRoom']> {
  return {
    expandedRoomId: target.expandedRoomId,
    expandedRoomVersion: target.version,
    title: target.title,
    source: target.source,
    legacyCourseId: target.legacyCourseId,
    cellCount: target.cellCount,
    anchorCoordinates: { ...target.anchorCoordinates },
    focusedCoordinates: { ...focusedCoordinates },
  };
}

function normalizeDiscoveryVersion(value: unknown): number | null {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function coordinatesEqual(left: RoomCoordinates, right: RoomCoordinates): boolean {
  return left.x === right.x && left.y === right.y;
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
    throw new HttpError(400, 'sort must be featured, quality, newest, builder, unbeaten, unvisited, or unrated.');
  }

  return normalized;
}

export async function loadBuilderDiscoveryResponse(
  env: Env,
  limit: number,
  sort: BuilderDiscoverySort,
): Promise<BuilderDiscoveryResponse> {
  if (playableContentIndexReadsEnabled(env)) {
    try {
      return await loadBuilderDiscoveryResponseFromPlayableIndex(env, limit, sort);
    } catch (error) {
      if (!String(error).toLowerCase().includes('playable_content_index')) throw error;
    }
  }
  if (isExpandedRoomsEnabled(env)) {
    return loadBuilderDiscoveryResponseByPlayableArea(env, limit, sort);
  }

  const rows = await env.DB.prepare(
    `
      WITH latest_index AS (
        SELECT room_id, MAX(version) AS version
        FROM room_versions
        GROUP BY room_id
      ),
      latest AS (
        SELECT room_id, version, created_at
        FROM room_versions
      ),
      first_published AS (
        SELECT room_id, MIN(created_at) AS first_published_at
        FROM room_versions
        GROUP BY room_id
      ),
      published_rooms AS (
        SELECT
          rooms.id AS room_id,
          COALESCE(rooms.claimer_user_id, rooms.last_published_by_user_id) AS builder_user_id,
          latest.created_at AS latest_published_at,
          first_published.first_published_at AS first_published_at
        FROM rooms
        INNER JOIN latest_index
          ON latest_index.room_id = rooms.id
        INNER JOIN latest
          ON latest.room_id = latest_index.room_id
         AND latest.version = latest_index.version
        INNER JOIN first_published
          ON first_published.room_id = rooms.id
        WHERE rooms.published_json IS NOT NULL
          AND COALESCE(rooms.claimer_user_id, rooms.last_published_by_user_id) IS NOT NULL
      ),
      builder_counts AS (
        SELECT
          builder_user_id AS user_id,
          COUNT(*) AS room_count,
          MAX(latest_published_at) AS latest_published_at,
          MIN(first_published_at) AS first_published_at
        FROM published_rooms
        WHERE ${sqlUserIdIsNotLegacyGeneratedOnly('published_rooms.builder_user_id')}
          AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('published_rooms.builder_user_id')}
        GROUP BY builder_user_id
      )
      SELECT
        builder_counts.user_id,
        users.display_name,
        users.username,
        builder_counts.room_count,
        builder_counts.latest_published_at,
        builder_counts.first_published_at
      FROM builder_counts
      INNER JOIN users
        ON users.id = builder_counts.user_id
      ORDER BY ${getBuilderDiscoverySqlOrderClause(sort)}
      LIMIT ?
    `
  )
    .bind(limit)
    .all<BuilderDiscoveryRow>();

  return {
    sort,
    results: rows.results.map(mapBuilderDiscoveryRow),
  };
}

async function loadBuilderDiscoveryResponseFromPlayableIndex(
  env: Env,
  limit: number,
  sort: BuilderDiscoverySort,
): Promise<BuilderDiscoveryResponse> {
  const builderId = 'playable_content_index.builder_user_id';
  const rows = await env.DB.prepare(
    `
      WITH builder_counts AS (
        SELECT
          builder_user_id AS user_id,
          COUNT(*) AS room_count,
          MAX(published_at) AS latest_published_at,
          MIN(first_published_at) AS first_published_at
        FROM playable_content_index
        WHERE builder_user_id IS NOT NULL
          AND ${sqlUserIdIsNotLegacyGeneratedOnly(builderId)}
          AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix(builderId)}
        GROUP BY builder_user_id
      )
      SELECT
        builder_counts.user_id,
        users.display_name,
        users.username,
        builder_counts.room_count,
        builder_counts.latest_published_at,
        builder_counts.first_published_at
      FROM builder_counts
      INNER JOIN users ON users.id = builder_counts.user_id
      ORDER BY ${getBuilderDiscoverySqlOrderClause(sort)}
      LIMIT ?
    `,
  ).bind(limit).all<BuilderDiscoveryRow>();
  return { sort, results: rows.results.map(mapBuilderDiscoveryRow) };
}

async function loadBuilderDiscoveryResponseByPlayableArea(
  env: Env,
  limit: number,
  sort: BuilderDiscoverySort,
): Promise<BuilderDiscoveryResponse> {
  const builderUserIdExpression = 'COALESCE(rooms.claimer_user_id, rooms.last_published_by_user_id)';
  const publishedRooms = await env.DB.prepare(
    `
      SELECT
        rooms.id,
        rooms.x,
        rooms.y,
        rooms.published_title,
        rooms.published_goal_type,
        rooms.claimer_user_id,
        rooms.claimer_display_name,
        rooms.last_published_by_user_id,
        rooms.last_published_by_display_name,
        latest.version AS current_published_version,
        latest.created_at AS published_at,
        first_published.first_published_at AS first_published_at,
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
      INNER JOIN (
        SELECT room_id, MIN(created_at) AS first_published_at
        FROM room_versions
        GROUP BY room_id
      ) AS first_published
        ON first_published.room_id = rooms.id
      WHERE rooms.published_json IS NOT NULL
        AND ${builderUserIdExpression} IS NOT NULL
        AND ${sqlUserIdIsNotLegacyGeneratedOnly(builderUserIdExpression)}
        AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix(builderUserIdExpression)}
    `
  )
    .all<PublishedRoomDiscoveryRow>();

  const roomEntries = publishedRooms.results.map((row) => mapPublishedRoomDiscoveryRow(row));
  const discoveryAreas = await resolveRoomDiscoveryAreaCandidates(env, roomEntries, true);
  const builderCounts = new Map<string, {
    roomCount: number;
    latestPublishedAt: string | null;
    firstPublishedAt: string | null;
  }>();

  for (const area of discoveryAreas) {
    const userId = getDiscoveryAreaBuilderUserId(area);
    if (!userId) {
      continue;
    }
    const publishedAt = area.expandedRoom?.publishedAt ?? area.representative.publishedAt;
    const firstPublishedAt = area.expandedRoom?.publishedAt ?? getDiscoveryAreaFirstPublishedAt(area);
    const existing = builderCounts.get(userId) ?? {
      roomCount: 0,
      latestPublishedAt: null,
      firstPublishedAt: null,
    };
    existing.roomCount += 1;
    if (!existing.latestPublishedAt || compareTimestampsDesc(publishedAt, existing.latestPublishedAt) < 0) {
      existing.latestPublishedAt = publishedAt;
    }
    if (!existing.firstPublishedAt || compareTimestampsAsc(firstPublishedAt, existing.firstPublishedAt) < 0) {
      existing.firstPublishedAt = firstPublishedAt;
    }
    builderCounts.set(userId, existing);
  }

  const usersById = await loadBuilderDiscoveryUsers(env, Array.from(builderCounts.keys()));
  const results = Array.from(builderCounts.entries())
    .flatMap(([userId, counts]): BuilderDiscoveryEntry[] => {
      const user = usersById.get(userId) ?? null;
      if (!user) {
        return [];
      }
      return [{
        userId,
        displayName: user.display_name?.trim() || 'Unknown builder',
        username: user.username?.trim() || null,
        roomCount: counts.roomCount,
        latestPublishedAt: counts.latestPublishedAt,
        firstPublishedAt: counts.firstPublishedAt,
      }];
    })
    .sort((left, right) => compareBuilderDiscoveryEntries(left, right, sort))
    .slice(0, limit);

  return {
    sort,
    results,
  };
}

async function loadBuilderDiscoveryUsers(
  env: Env,
  userIds: string[],
): Promise<Map<string, BuilderDiscoveryUserRow>> {
  const usersById = new Map<string, BuilderDiscoveryUserRow>();
  for (const userIdChunk of chunkValues(userIds, 50)) {
    const rows = await env.DB.prepare(
      `
        SELECT id, display_name, username
        FROM users
        WHERE id IN (${userIdChunk.map(() => '?').join(', ')})
      `
    )
      .bind(...userIdChunk)
      .all<BuilderDiscoveryUserRow>();
    for (const row of rows.results) {
      usersById.set(row.id, row);
    }
  }
  return usersById;
}

function compareBuilderDiscoveryEntries(
  left: BuilderDiscoveryEntry,
  right: BuilderDiscoveryEntry,
  sort: BuilderDiscoverySort,
): number {
  if (sort === 'rooms') {
    const countCompare = right.roomCount - left.roomCount;
    if (countCompare !== 0) {
      return countCompare;
    }
    const latestCompare = compareTimestampsDesc(left.latestPublishedAt, right.latestPublishedAt);
    if (latestCompare !== 0) {
      return latestCompare;
    }
    return compareBuilderNames(left, right);
  }

  if (sort === 'recent') {
    const latestCompare = compareTimestampsDesc(left.latestPublishedAt, right.latestPublishedAt);
    if (latestCompare !== 0) {
      return latestCompare;
    }
    const countCompare = right.roomCount - left.roomCount;
    if (countCompare !== 0) {
      return countCompare;
    }
    return compareBuilderNames(left, right);
  }

  return compareBuilderNames(left, right);
}

function compareBuilderNames(left: BuilderDiscoveryEntry, right: BuilderDiscoveryEntry): number {
  const nameCompare = left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
  return nameCompare !== 0 ? nameCompare : left.userId.localeCompare(right.userId);
}

export function parseBuilderDiscoverySortOrThrow(value: unknown): BuilderDiscoverySort {
  const normalized = normalizeBuilderDiscoverySort(value);
  if (!normalized) {
    throw new HttpError(400, 'sort must be alphabet, rooms, or recent.');
  }

  return normalized;
}

export function compareRoomDiscoveryEntries(
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

  if (isPersonalRoomDiscoverySort(sort)) {
    const featuredCompare = compareBooleansDesc(left.featured, right.featured);
    if (featuredCompare !== 0) {
      return featuredCompare;
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

  const firstPublishedCompare = compareTimestampsDesc(left.firstPublishedAt, right.firstPublishedAt);
  if (firstPublishedCompare !== 0) {
    return firstPublishedCompare;
  }
  return compareTimestampsDesc(left.publishedAt, right.publishedAt);
}

function isPersonalRoomDiscoverySort(sort: RoomDiscoverySort): boolean {
  return sort === 'unbeaten' || sort === 'unvisited' || sort === 'unrated';
}

function isViewerRoomBuilder(entry: RoomDiscoveryEntry, viewerUserId: string | null): boolean {
  return viewerUserId !== null && entry.builderUserId === viewerUserId;
}

function isExpandedRoomsEnabled(env: Env): boolean {
  const raw = env.EXPANDED_ROOMS_ENABLED?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
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

function compareTimestampsAsc(left: string | null, right: string | null): number {
  const leftMs = left ? Date.parse(left) : Number.POSITIVE_INFINITY;
  const rightMs = right ? Date.parse(right) : Number.POSITIVE_INFINITY;
  return leftMs - rightMs;
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

function getBuilderDiscoverySqlOrderClause(sort: BuilderDiscoverySort): string {
  if (sort === 'rooms') {
    return 'builder_counts.room_count DESC, builder_counts.latest_published_at DESC, users.display_name COLLATE NOCASE ASC, builder_counts.user_id ASC';
  }

  if (sort === 'recent') {
    return 'builder_counts.latest_published_at DESC, builder_counts.room_count DESC, users.display_name COLLATE NOCASE ASC, builder_counts.user_id ASC';
  }

  return 'users.display_name COLLATE NOCASE ASC, builder_counts.user_id ASC';
}

function mapBuilderDiscoveryRow(row: BuilderDiscoveryRow): BuilderDiscoveryEntry {
  return {
    userId: row.user_id,
    displayName: row.display_name?.trim() || 'Unknown builder',
    username: row.username?.trim() || null,
    roomCount: parseRowNumber(row.room_count),
    latestPublishedAt: row.latest_published_at,
    firstPublishedAt: row.first_published_at,
  };
}

async function loadDiscoveryViewerRoomStates(
  env: Env,
  userId: string,
  roomVersionKeys: DiscoveryRoomVersionKey[],
): Promise<Map<string, DiscoveryViewerRoomState>> {
  const states = new Map<string, DiscoveryViewerRoomState>();
  for (const key of roomVersionKeys) {
    states.set(buildDiscoveryRoomVersionKey(key.roomId, key.roomVersion), createEmptyDiscoveryViewerRoomState());
  }

  for (const roomVersionChunk of chunkValues(roomVersionKeys, 40)) {
    const whereClause = roomVersionChunk
      .map(() => '(room_id = ? AND room_version = ?)')
      .join(' OR ');
    const bindings = roomVersionChunk.flatMap((entry) => [entry.roomId, entry.roomVersion]);
    const runRows = await env.DB.prepare(
      `
        SELECT
          room_id,
          room_version,
          COUNT(*) AS run_count,
          SUM(CASE WHEN result = 'completed' THEN 1 ELSE 0 END) AS completed_count
        FROM room_runs
        WHERE user_id = ?
          AND (${whereClause})
        GROUP BY room_id, room_version
      `
    )
      .bind(userId, ...bindings)
      .all<{
        room_id: string;
        room_version: number | string | null;
        run_count: number | string | null;
        completed_count: number | string | null;
      }>();

    for (const row of runRows.results) {
      const key = buildDiscoveryRoomVersionKey(row.room_id, parseRowNumber(row.room_version));
      const state = states.get(key) ?? createEmptyDiscoveryViewerRoomState();
      state.visited = parseRowNumber(row.run_count) > 0;
      state.completed = parseRowNumber(row.completed_count) > 0;
      states.set(key, state);
    }

    const ratingWhereClause = roomVersionChunk
      .map(() => '(room_id = ? AND version_key = ?)')
      .join(' OR ');
    const ratingBindings = roomVersionChunk.flatMap((entry) => [entry.roomId, entry.roomVersion]);
    const ratingRows = await env.DB.prepare(
      `
        SELECT
          room_id,
          version_key
        FROM room_ratings
        WHERE user_id = ?
          AND (quality_stars IS NOT NULL OR difficulty_choice IS NOT NULL)
          AND (${ratingWhereClause})
      `
    )
      .bind(userId, ...ratingBindings)
      .all<{ room_id: string; version_key: number | string | null }>();

    for (const row of ratingRows.results) {
      const key = buildDiscoveryRoomVersionKey(row.room_id, parseRowNumber(row.version_key));
      const state = states.get(key) ?? createEmptyDiscoveryViewerRoomState();
      state.rated = true;
      states.set(key, state);
    }
  }

  return states;
}

async function loadDiscoveryViewerExpandedRoomStates(
  env: Env,
  userId: string,
  expandedRoomVersionKeys: DiscoveryExpandedRoomVersionKey[],
): Promise<Map<string, DiscoveryViewerRoomState>> {
  const states = new Map<string, DiscoveryViewerRoomState>();
  for (const key of expandedRoomVersionKeys) {
    states.set(
      buildDiscoveryExpandedRoomVersionKey(key.expandedRoomId, key.expandedRoomVersion),
      createEmptyDiscoveryViewerRoomState(),
    );
  }

  for (const versionChunk of chunkValues(expandedRoomVersionKeys, 40)) {
    const whereClause = versionChunk
      .map(() => '(expanded_room_id = ? AND expanded_room_version = ?)')
      .join(' OR ');
    const bindings = versionChunk.flatMap((entry) => [
      entry.expandedRoomId,
      entry.expandedRoomVersion,
    ]);
    try {
      const runRows = await env.DB.prepare(
        `
          SELECT
            expanded_room_id,
            expanded_room_version,
            COUNT(*) AS run_count,
            SUM(CASE WHEN result = 'completed' THEN 1 ELSE 0 END) AS completed_count
          FROM expanded_room_runs
          WHERE user_id = ?
            AND (${whereClause})
          GROUP BY expanded_room_id, expanded_room_version
        `
      )
        .bind(userId, ...bindings)
        .all<{
          expanded_room_id: string;
          expanded_room_version: number | string | null;
          run_count: number | string | null;
          completed_count: number | string | null;
        }>();

      for (const row of runRows.results) {
        const key = buildDiscoveryExpandedRoomVersionKey(
          row.expanded_room_id,
          parseRowNumber(row.expanded_room_version),
        );
        const state = states.get(key) ?? createEmptyDiscoveryViewerRoomState();
        state.visited = parseRowNumber(row.run_count) > 0;
        state.completed = parseRowNumber(row.completed_count) > 0;
        states.set(key, state);
      }

      const ratingWhereClause = versionChunk
        .map(() => '(expanded_room_id = ? AND version_key = ?)')
        .join(' OR ');
      const ratingBindings = versionChunk.flatMap((entry) => [
        entry.expandedRoomId,
        entry.expandedRoomVersion,
      ]);
      const ratingRows = await env.DB.prepare(
        `
          SELECT
            expanded_room_id,
            version_key
          FROM expanded_room_ratings
          WHERE user_id = ?
            AND (quality_stars IS NOT NULL OR difficulty_choice IS NOT NULL)
            AND (${ratingWhereClause})
        `
      )
        .bind(userId, ...ratingBindings)
        .all<{ expanded_room_id: string; version_key: number | string | null }>();

      for (const row of ratingRows.results) {
        const key = buildDiscoveryExpandedRoomVersionKey(
          row.expanded_room_id,
          parseRowNumber(row.version_key),
        );
        const state = states.get(key) ?? createEmptyDiscoveryViewerRoomState();
        state.rated = true;
        states.set(key, state);
      }
    } catch (error) {
      if (isExpandedRoomSchemaMissingError(error)) {
        return states;
      }
      throw error;
    }
  }

  return states;
}

function createEmptyDiscoveryViewerRoomState(): DiscoveryViewerRoomState {
  return {
    visited: false,
    completed: false,
    rated: false,
  };
}

function buildDiscoveryRoomVersionKey(roomId: string, roomVersion: number): string {
  return `${roomId}:${roomVersion}`;
}

function buildDiscoveryExpandedRoomVersionKey(expandedRoomId: string, expandedRoomVersion: number): string {
  return `${expandedRoomId}:${expandedRoomVersion}`;
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

async function loadExpandedRoomDiscoveryRatingAggregateRows(
  env: Env,
  expandedRoomVersionKeys: DiscoveryExpandedRoomVersionKey[],
): Promise<{ results: RoomDiscoveryRatingAggregateRow[] }> {
  const results: RoomDiscoveryRatingAggregateRow[] = [];
  for (const versionChunk of chunkValues(expandedRoomVersionKeys, 40)) {
    const whereClause = versionChunk
      .map(() => '(expanded_room_id = ? AND version_key = ?)')
      .join(' OR ');
    const bindings = versionChunk.flatMap((entry) => [
      entry.expandedRoomId,
      entry.expandedRoomVersion,
    ]);
    try {
      const chunkRows = await env.DB.prepare(
        `
          SELECT
            expanded_room_id AS room_id,
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
          FROM expanded_room_ratings
          WHERE ${whereClause}
          GROUP BY expanded_room_id
        `
      )
        .bind(...bindings)
        .all<RoomDiscoveryRatingAggregateRow>();
      results.push(...chunkRows.results);
    } catch (error) {
      if (isExpandedRoomSchemaMissingError(error)) {
        return { results };
      }
      throw error;
    }
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
  goalType: RoomGoalType | null;
  publishedAt: string;
  firstPublishedAt: string;
} {
  const goalType = parseRoomGoalType(row.published_goal_type);
  if (!goalType && row.published_goal_type !== null) {
    throw new HttpError(500, 'Failed to parse published room goal type.');
  }

  return {
    roomId: row.id,
    roomCoordinates: {
      x: row.x,
      y: row.y,
    },
    roomTitle: row.published_title,
    builderUserId: row.claimer_user_id ?? row.last_published_by_user_id,
    builderDisplayName: row.claimer_display_name ?? row.last_published_by_display_name,
    roomVersion: row.current_published_version,
    canonicalRoomVersion: row.canonical_version,
    goalType,
    publishedAt: row.published_at,
    firstPublishedAt: row.first_published_at,
  };
}

function parseRoomGoalType(value: string | null): RoomGoalType | null {
  return value && ROOM_GOAL_TYPES.includes(value as RoomGoalType)
    ? (value as RoomGoalType)
    : null;
}
