import type {
  ProfilePublishedRoomEntry,
  ProfilePublishedRoomExpandedRoomTarget,
  ProfileStatsSummary,
  UserProfilePlaylistsResponse,
  UserProfileRoomsResponse,
  UserProfileSummaryResponse,
  UserProfileResponse,
} from '../../../profiles/model';
import type { ResolvedExpandedRoomTarget } from '../../../expandedRooms/model';
import { listPlayerAvatarChoicesForLevel, resolveSelectablePlayerAvatarId } from '../../../player/avatar/unlocks';
import type { QualityRatingSummary } from '../../../progression/model';
import { ROOM_DIFFICULTIES, type RoomDifficulty } from '../../../runs/model';
import type { Env } from '../core/types';
import type { ServerTiming } from '../core/serverTiming';
import { HttpError } from '../core/http';
import { findUserById, loadPublicUserProfileCourseCount, loadPublishedRoomsByCreator, loadUserStatsRow } from '../auth/store';
import { loadPublicProgressionSummary } from '../progression/store';
import { parseStoredSnapshot } from '../rooms/store';
import { mapUserStatsRow } from '../runs/points';
import { loadViewerRankedGlobalLeaderboardRow } from '../runs/leaderboards';
import { loadPublicPlaylistSummariesForUser } from '../playlists/store';
import {
  loadExpandedRoomTarget,
  loadPublishedExpandedRoomMembershipsForRoomIds,
} from '../expandedRooms/store';

const EMPTY_PROFILE_STATS: ProfileStatsSummary = {
  totalPoints: 0,
  totalScore: 0,
  totalDeaths: 0,
  totalCollectibles: 0,
  totalEnemiesDefeated: 0,
  totalCheckpoints: 0,
  totalRoomsPublished: 0,
  completedRuns: 0,
  failedRuns: 0,
  abandonedRuns: 0,
  pvpWins: 0,
  pvpLosses: 0,
  pvpDraws: 0,
  bestScore: 0,
  fastestClearMs: null,
  globalRank: null,
};

const QUALITY_PRIOR_MEAN = 3.5;
const QUALITY_PRIOR_WEIGHT = 5;

type ProfilePublishedRoomBaseEntry = Omit<
  ProfilePublishedRoomEntry,
  'consensusDifficulty' | 'quality'
>;

interface ProfileRoomRatingAggregateRow {
  room_id: string;
  version_key: number | string | null;
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

export async function loadUserProfile(
  env: Env,
  targetUserId: string,
  viewerUserId: string | null = null,
  timing: ServerTiming | null = null,
): Promise<UserProfileResponse | null> {
  const user = await measure(timing, 'profile_user', () => findUserById(env, targetUserId));
  if (!user) {
    return null;
  }

  const [statsRow, rankedStatsRow, publishedRoomRows, publishedCourseCount, playlists] = await Promise.all([
    measure(timing, 'profile_stats', () => loadUserStatsRow(env, targetUserId)),
    measure(timing, 'profile_rank', () => loadViewerRankedGlobalLeaderboardRow(env, targetUserId)),
    measure(timing, 'profile_room_rows', () => loadPublishedRoomsByCreator(env, targetUserId)),
    measure(timing, 'profile_course_count', () => loadPublicUserProfileCourseCount(env, targetUserId)),
    measure(timing, 'profile_playlists', () => loadPublicPlaylistSummariesForUser(env, targetUserId)),
  ]);

  const publishedRooms = await measure(timing, 'profile_rooms', () => buildPublishedRooms(env, publishedRoomRows));
  const stats = buildProfileStats(statsRow, rankedStatsRow, publishedRooms.length);
  const isSelf = viewerUserId === targetUserId;
  const progression = await measure(timing, 'profile_progression', () => loadPublicProgressionSummary(env, targetUserId));
  const selectedAvatarId = resolveSelectablePlayerAvatarId(user.selectedAvatarId);

  return {
    userId: user.id,
    displayName: user.displayName,
    username: user.username ?? null,
    createdAt: user.createdAt ?? new Date(0).toISOString(),
    avatarUrl: user.avatarUrl ?? null,
    bio: user.bio ?? null,
    selectedAvatarId,
    avatarChoices: listPlayerAvatarChoicesForLevel(progression.player.level, selectedAvatarId),
    isSelf,
    canEdit: isSelf,
    stats,
    progression,
    publishedRooms,
    playlists,
    publishedCourseCount,
  };
}

export async function loadUserProfileSummary(
  env: Env,
  targetUserId: string,
  viewerUserId: string | null = null,
  timing: ServerTiming | null = null,
): Promise<UserProfileSummaryResponse | null> {
  const user = await measure(timing, 'profile_user', () => findUserById(env, targetUserId));
  if (!user) return null;

  const [statsRow, rankedStatsRow, publishedRoomCount, publishedCourseCount, progression] = await Promise.all([
    measure(timing, 'profile_stats', () => loadUserStatsRow(env, targetUserId)),
    measure(timing, 'profile_rank', () => loadViewerRankedGlobalLeaderboardRow(env, targetUserId)),
    measure(timing, 'profile_room_count', () => loadPublishedPlayableCountForBuilder(env, targetUserId)),
    measure(timing, 'profile_course_count', () => loadPublicUserProfileCourseCount(env, targetUserId)),
    measure(timing, 'profile_progression', () => loadPublicProgressionSummary(env, targetUserId)),
  ]);
  const isSelf = viewerUserId === targetUserId;
  const selectedAvatarId = resolveSelectablePlayerAvatarId(user.selectedAvatarId);
  return {
    userId: user.id,
    displayName: user.displayName,
    username: user.username ?? null,
    createdAt: user.createdAt ?? new Date(0).toISOString(),
    avatarUrl: user.avatarUrl ?? null,
    bio: user.bio ?? null,
    selectedAvatarId,
    avatarChoices: listPlayerAvatarChoicesForLevel(progression.player.level, selectedAvatarId),
    isSelf,
    canEdit: isSelf,
    stats: buildProfileStats(statsRow, rankedStatsRow, publishedRoomCount),
    progression,
    publishedCourseCount,
  };
}

export async function loadUserProfileRoomsPage(
  env: Env,
  targetUserId: string,
  limit: number,
  cursor: string | null,
  timing: ServerTiming | null = null,
): Promise<UserProfileRoomsResponse> {
  const offset = decodeProfileRoomsCursor(cursor);
  if (playableContentIndexReadsEnabled(env)) {
    try {
      const result = await measure(timing, 'profile_index_rooms', () => env.DB.prepare(
        `
          SELECT
            target_key,
            target_type,
            content_id,
            version_key,
            representative_room_id,
            room_x,
            room_y,
            title,
            goal_type,
            published_at,
            cell_count,
            anchor_x,
            anchor_y,
            source_type,
            legacy_course_id,
            quality_adjusted_average,
            quality_vote_count,
            consensus_difficulty
          FROM playable_content_index
          WHERE builder_user_id = ?
          ORDER BY published_at DESC, target_key ASC
          LIMIT ? OFFSET ?
        `,
      ).bind(targetUserId, limit + 1, offset).all<ProfilePlayableContentRow>());
      const hasMore = result.results.length > limit;
      return {
        results: result.results.slice(0, limit).map(mapProfilePlayableContentRow),
        ...(hasMore ? { nextCursor: encodeProfileRoomsCursor(offset + limit) } : {}),
      };
    } catch (error) {
      if (!String(error).toLowerCase().includes('playable_content_index')) throw error;
      console.warn('Playable-content index is enabled but unavailable; falling back to legacy profile rooms.');
    }
  }

  const rows = await measure(timing, 'profile_room_rows', () => loadPublishedRoomsByCreator(env, targetUserId));
  const rooms = await measure(timing, 'profile_rooms', () => buildPublishedRooms(env, rows));
  return {
    results: rooms.slice(offset, offset + limit),
    ...(offset + limit < rooms.length ? { nextCursor: encodeProfileRoomsCursor(offset + limit) } : {}),
  };
}

export async function loadUserProfilePlaylists(
  env: Env,
  targetUserId: string,
  timing: ServerTiming | null = null,
): Promise<UserProfilePlaylistsResponse> {
  return {
    results: await measure(timing, 'profile_playlists', () => loadPublicPlaylistSummariesForUser(env, targetUserId)),
  };
}

interface ProfilePlayableContentRow {
  target_key: string;
  target_type: 'room' | 'expanded_room';
  content_id: string;
  version_key: number | string;
  representative_room_id: string;
  room_x: number;
  room_y: number;
  title: string | null;
  goal_type: string | null;
  published_at: string;
  cell_count: number | string;
  anchor_x: number;
  anchor_y: number;
  source_type: 'native_expanded_room' | 'standalone_room' | 'legacy_course';
  legacy_course_id: string | null;
  quality_adjusted_average: number | string | null;
  quality_vote_count: number | string | null;
  consensus_difficulty: string | null;
}

function mapProfilePlayableContentRow(row: ProfilePlayableContentRow): ProfilePublishedRoomEntry {
  const roomVersion = Number(row.version_key);
  const qualityVoteCount = Number(row.quality_vote_count ?? 0);
  const adjustedAverage = row.quality_adjusted_average === null
    ? null
    : Number(row.quality_adjusted_average);
  const coordinates = { x: row.room_x, y: row.room_y };
  const expandedRoom = row.target_type === 'expanded_room'
    ? {
        expandedRoomId: row.content_id,
        expandedRoomVersion: roomVersion,
        title: row.title,
        source: row.source_type,
        legacyCourseId: row.legacy_course_id,
        cellCount: Number(row.cell_count),
        anchorCoordinates: { x: row.anchor_x, y: row.anchor_y },
        focusedCoordinates: { ...coordinates },
      }
    : null;
  return {
    roomId: row.representative_room_id,
    roomCoordinates: coordinates,
    roomTitle: row.title,
    roomVersion,
    goalType: normalizeProfileGoalType(row.goal_type),
    publishedAt: row.published_at,
    consensusDifficulty: normalizeProfileDifficulty(row.consensus_difficulty),
    quality: {
      adjustedAverage,
      rawAverage: adjustedAverage,
      voteCount: qualityVoteCount,
      weightedVoteCount: qualityVoteCount,
      counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 },
    },
    expandedRoom,
  };
}

function normalizeProfileGoalType(value: string | null): ProfilePublishedRoomEntry['goalType'] {
  return value && ['reach_exit', 'collect_target', 'collect_race', 'defeat_all', 'checkpoint_sprint', 'survival'].includes(value)
    ? value as ProfilePublishedRoomEntry['goalType']
    : null;
}

function normalizeProfileDifficulty(value: string | null): RoomDifficulty | null {
  return value && ROOM_DIFFICULTIES.includes(value as RoomDifficulty) ? value as RoomDifficulty : null;
}

async function loadPublishedPlayableCountForBuilder(env: Env, userId: string): Promise<number> {
  if (playableContentIndexReadsEnabled(env)) {
    try {
      const row = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM playable_content_index WHERE builder_user_id = ?',
      ).bind(userId).first<{ count: number | string | null }>();
      return Number(row?.count ?? 0);
    } catch (error) {
      if (!String(error).toLowerCase().includes('playable_content_index')) throw error;
    }
  }
  return buildPublishedRooms(env, await loadPublishedRoomsByCreator(env, userId)).then((rooms) => rooms.length);
}

function playableContentIndexReadsEnabled(env: Env): boolean {
  const raw = env.PLAYABLE_CONTENT_INDEX_READS?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

function encodeProfileRoomsCursor(offset: number): string {
  return btoa(JSON.stringify({ v: 1, offset }));
}

function decodeProfileRoomsCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(atob(cursor)) as { v?: unknown; offset?: unknown };
    if (value.v === 1 && Number.isInteger(value.offset) && Number(value.offset) >= 0) {
      return Number(value.offset);
    }
  } catch {
    // Invalid cursors are rejected below.
  }
  throw new HttpError(400, 'Invalid profile rooms cursor.');
}

function measure<T>(
  timing: ServerTiming | null,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  return timing ? timing.measure(name, operation) : operation();
}

function buildProfileStats(
  statsRow: Awaited<ReturnType<typeof loadUserStatsRow>>,
  rankedStatsRow: Awaited<ReturnType<typeof loadViewerRankedGlobalLeaderboardRow>>,
  publishedRoomCount: number
): ProfileStatsSummary {
  if (!statsRow) {
    return {
      ...EMPTY_PROFILE_STATS,
      totalRoomsPublished: publishedRoomCount,
    };
  }

  const stats = mapUserStatsRow(statsRow);
  const publicStats = rankedStatsRow ? mapUserStatsRow(rankedStatsRow) : null;

  return {
    totalPoints: publicStats?.totalPoints ?? 0,
    totalScore: publicStats?.totalScore ?? 0,
    totalDeaths: stats.totalDeaths,
    totalCollectibles: stats.totalCollectibles,
    totalEnemiesDefeated: stats.totalEnemiesDefeated,
    totalCheckpoints: stats.totalCheckpoints,
    totalRoomsPublished: publishedRoomCount,
    completedRuns: publicStats?.completedRuns ?? 0,
    failedRuns: publicStats?.failedRuns ?? 0,
    abandonedRuns: publicStats?.abandonedRuns ?? 0,
    pvpWins: stats.pvpWins,
    pvpLosses: stats.pvpLosses,
    pvpDraws: stats.pvpDraws,
    bestScore: publicStats?.bestScore ?? 0,
    fastestClearMs: publicStats?.fastestClearMs ?? null,
    globalRank: rankedStatsRow ? Number(rankedStatsRow.overall_rank) : null,
  };
}

async function buildPublishedRooms(
  env: Env,
  rows: Awaited<ReturnType<typeof loadPublishedRoomsByCreator>>
): Promise<ProfilePublishedRoomEntry[]> {
  const entries: ProfilePublishedRoomBaseEntry[] = [];

  for (const row of rows) {
    try {
      const snapshot = parseStoredSnapshot(row.published_json, 'profile room');
      entries.push({
        roomId: row.id,
        roomCoordinates: { x: row.x, y: row.y },
        roomTitle: row.published_title ?? snapshot.title ?? null,
        roomVersion: snapshot.version,
        goalType: snapshot.goal?.type ?? null,
        publishedAt: snapshot.publishedAt,
        expandedRoom: null,
      });
    } catch (error) {
      console.warn('Skipping malformed published room while building profile.', row.id, error);
    }
  }

  const resolvedEntries = await resolveProfilePublishedRoomEntries(env, entries);
  const sortedEntries = resolvedEntries
    .sort((left, right) => {
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      if (left.roomCoordinates.y !== right.roomCoordinates.y) {
        return left.roomCoordinates.y - right.roomCoordinates.y;
      }
      return left.roomCoordinates.x - right.roomCoordinates.x;
    });
  const ratingSummaries = await loadProfileRoomRatingSummaries(
    env,
    sortedEntries.map((entry) => ({
      roomId: entry.roomId,
      roomVersion: entry.roomVersion,
    })),
  );

  return sortedEntries.map((entry) => ({
    ...entry,
    ...(ratingSummaries.get(buildProfileRoomRatingKey(entry.roomId, entry.roomVersion))
      ?? createEmptyProfileRoomRatingSummary()),
  }));
}

async function resolveProfilePublishedRoomEntries(
  env: Env,
  entries: ProfilePublishedRoomBaseEntry[],
): Promise<ProfilePublishedRoomBaseEntry[]> {
  if (!isExpandedRoomsEnabled(env)) {
    return entries;
  }

  const memberships = await loadPublishedExpandedRoomMembershipsForRoomIds(
    env,
    entries.map((entry) => entry.roomId),
  );
  const membershipByRoomId = new Map(memberships.map((membership) => [membership.roomId, membership]));
  const expandedRoomIds = Array.from(
    new Set(
      memberships
        .filter((membership) => membership.cellCount > 1)
        .map((membership) => membership.expandedRoomId),
    ),
  );
  const expandedTargets = await Promise.all(
    expandedRoomIds.map(async (expandedRoomId) => [
      expandedRoomId,
      await loadExpandedRoomTarget(env, expandedRoomId),
    ] as const),
  );
  const expandedTargetById = new Map(expandedTargets);
  const resolvedEntries: ProfilePublishedRoomBaseEntry[] = [];
  for (const entry of entries) {
    const membership = membershipByRoomId.get(entry.roomId);
    const candidateTarget = membership?.cellCount && membership.cellCount > 1
      ? expandedTargetById.get(membership.expandedRoomId) ?? null
      : null;
    const expandedRoomTarget = candidateTarget && targetContainsPinnedProfileCell(candidateTarget, entry)
      ? candidateTarget
      : null;
    const resolvedEntry = expandedRoomTarget
      ? mapProfileEntryToExpandedRoom(entry, expandedRoomTarget)
      : { ...entry, expandedRoom: null };
    resolvedEntries.push(resolvedEntry);
  }

  return dedupeResolvedProfilePublishedRoomEntries(resolvedEntries);
}

export function dedupeResolvedProfilePublishedRoomEntries(
  entries: ProfilePublishedRoomBaseEntry[],
): ProfilePublishedRoomBaseEntry[] {
  const entriesByPlayableTarget = new Map<string, ProfilePublishedRoomBaseEntry>();
  for (const resolvedEntry of entries) {
    const playableTargetKey = resolvedEntry.expandedRoom
      ? `expanded-room:${resolvedEntry.expandedRoom.expandedRoomId}:v${resolvedEntry.expandedRoom.expandedRoomVersion ?? 'published'}`
      : getStandaloneProfileTargetKey(resolvedEntry);
    const existingEntry = entriesByPlayableTarget.get(playableTargetKey);
    if (!existingEntry || shouldReplaceProfileRepresentative(existingEntry, resolvedEntry)) {
      entriesByPlayableTarget.set(playableTargetKey, resolvedEntry);
    }
  }

  return Array.from(entriesByPlayableTarget.values());
}

function targetContainsPinnedProfileCell(
  target: ResolvedExpandedRoomTarget,
  entry: ProfilePublishedRoomBaseEntry,
): boolean {
  return target.cellCount > 1 && target.cells.some(
    (cell) => cell.roomId === entry.roomId && normalizeProfileVersion(cell.roomVersion) === entry.roomVersion,
  );
}

function mapProfileEntryToExpandedRoom(
  entry: ProfilePublishedRoomBaseEntry,
  target: ResolvedExpandedRoomTarget,
): ProfilePublishedRoomBaseEntry {
  return {
    ...entry,
    roomTitle: target.title?.trim() || entry.roomTitle,
    goalType: target.goalType ?? entry.goalType,
    publishedAt: target.publishedAt ?? entry.publishedAt,
    expandedRoom: mapProfileExpandedRoomTarget(target, entry.roomCoordinates),
  };
}

function mapProfileExpandedRoomTarget(
  target: ResolvedExpandedRoomTarget,
  focusedCoordinates: ProfilePublishedRoomBaseEntry['roomCoordinates'],
): ProfilePublishedRoomExpandedRoomTarget {
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

function shouldReplaceProfileRepresentative(
  existingEntry: ProfilePublishedRoomBaseEntry,
  nextEntry: ProfilePublishedRoomBaseEntry,
): boolean {
  if (!nextEntry.expandedRoom) {
    return false;
  }
  if (!existingEntry.expandedRoom) {
    return true;
  }

  const nextIsAnchor = coordinatesEqual(nextEntry.roomCoordinates, nextEntry.expandedRoom.anchorCoordinates);
  const existingIsAnchor = coordinatesEqual(existingEntry.roomCoordinates, existingEntry.expandedRoom.anchorCoordinates);
  if (nextIsAnchor !== existingIsAnchor) {
    return nextIsAnchor;
  }

  const nextTime = nextEntry.publishedAt ? Date.parse(nextEntry.publishedAt) : 0;
  const existingTime = existingEntry.publishedAt ? Date.parse(existingEntry.publishedAt) : 0;
  if (nextTime !== existingTime) {
    return nextTime > existingTime;
  }

  if (nextEntry.roomCoordinates.y !== existingEntry.roomCoordinates.y) {
    return nextEntry.roomCoordinates.y < existingEntry.roomCoordinates.y;
  }
  return nextEntry.roomCoordinates.x < existingEntry.roomCoordinates.x;
}

function getStandaloneProfileTargetKey(entry: ProfilePublishedRoomBaseEntry): string {
  return `room:${entry.roomId}:v${entry.roomVersion}`;
}

function normalizeProfileVersion(value: unknown): number | null {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function coordinatesEqual(
  left: ProfilePublishedRoomBaseEntry['roomCoordinates'],
  right: ProfilePublishedRoomBaseEntry['roomCoordinates'],
): boolean {
  return left.x === right.x && left.y === right.y;
}

function isExpandedRoomsEnabled(env: Env): boolean {
  const raw = env.EXPANDED_ROOMS_ENABLED?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

async function loadProfileRoomRatingSummaries(
  env: Env,
  roomVersionKeys: Array<{ roomId: string; roomVersion: number }>
): Promise<Map<string, { consensusDifficulty: RoomDifficulty | null; quality: QualityRatingSummary }>> {
  const summaries = new Map<string, { consensusDifficulty: RoomDifficulty | null; quality: QualityRatingSummary }>();
  if (roomVersionKeys.length === 0) {
    return summaries;
  }

  for (const chunk of chunkValues(roomVersionKeys, 40)) {
    const whereClause = chunk
      .map(() => '(room_id = ? AND version_key = ?)')
      .join(' OR ');
    const bindings = chunk.flatMap((entry) => [entry.roomId, entry.roomVersion]);
    const result = await env.DB.prepare(
      `
        SELECT
          room_id,
          version_key,
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
        GROUP BY room_id, version_key
      `
    )
      .bind(...bindings)
      .all<ProfileRoomRatingAggregateRow>();

    for (const row of result.results) {
      summaries.set(
        buildProfileRoomRatingKey(row.room_id, parseRatingRowNumber(row.version_key)),
        buildProfileRoomRatingSummary(row),
      );
    }
  }

  return summaries;
}

function buildProfileRoomRatingSummary(
  row: ProfileRoomRatingAggregateRow
): { consensusDifficulty: RoomDifficulty | null; quality: QualityRatingSummary } {
  const qualityVoteCount = parseRatingRowNumber(row.quality_vote_count);
  const qualityWeightedVoteCount = parseRatingRowFloat(row.quality_weighted_vote_count);
  const quality =
    qualityVoteCount === 0 || qualityWeightedVoteCount <= 0
      ? createEmptyProfileQualitySummary()
      : {
          adjustedAverage: roundQuality(
            (QUALITY_PRIOR_MEAN * QUALITY_PRIOR_WEIGHT + parseRatingRowFloat(row.quality_weighted_sum)) /
              (QUALITY_PRIOR_WEIGHT + qualityWeightedVoteCount),
          ),
          rawAverage: roundQuality(parseRatingRowFloat(row.quality_raw_sum) / qualityVoteCount),
          voteCount: qualityVoteCount,
          weightedVoteCount: roundQuality(qualityWeightedVoteCount),
          counts: {
            oneStar: parseRatingRowNumber(row.one_star_count),
            twoStar: parseRatingRowNumber(row.two_star_count),
            threeStar: parseRatingRowNumber(row.three_star_count),
            fourStar: parseRatingRowNumber(row.four_star_count),
            fiveStar: parseRatingRowNumber(row.five_star_count),
          },
        };

  const weightedDifficulty = {
    easy: parseRatingRowFloat(row.easy_weight),
    medium: parseRatingRowFloat(row.medium_weight),
    hard: parseRatingRowFloat(row.hard_weight),
    extreme: parseRatingRowFloat(row.extreme_weight),
  };
  const totalDifficultyVotes =
    parseRatingRowNumber(row.easy_count)
    + parseRatingRowNumber(row.medium_count)
    + parseRatingRowNumber(row.hard_count)
    + parseRatingRowNumber(row.extreme_count);
  let consensusDifficulty: RoomDifficulty | null = null;
  let bestWeight = 0;
  for (const difficulty of ROOM_DIFFICULTIES) {
    if (weightedDifficulty[difficulty] > bestWeight) {
      bestWeight = weightedDifficulty[difficulty];
      consensusDifficulty = difficulty;
    }
  }

  return {
    consensusDifficulty: totalDifficultyVotes > 0 ? consensusDifficulty : null,
    quality,
  };
}

function createEmptyProfileRoomRatingSummary(): {
  consensusDifficulty: RoomDifficulty | null;
  quality: QualityRatingSummary;
} {
  return {
    consensusDifficulty: null,
    quality: createEmptyProfileQualitySummary(),
  };
}

function createEmptyProfileQualitySummary(): QualityRatingSummary {
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

function buildProfileRoomRatingKey(roomId: string, roomVersion: number): string {
  return `${roomId}:${roomVersion}`;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function roundQuality(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseRatingRowNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseRatingRowFloat(value: number | string | null | undefined): number {
  return parseRatingRowNumber(value);
}
