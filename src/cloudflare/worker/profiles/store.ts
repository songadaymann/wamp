import type { UserProfileResponse, ProfilePublishedRoomEntry, ProfileStatsSummary } from '../../../profiles/model';
import type { Env } from '../core/types';
import { findUserById, loadAllUserStatsRows, loadPublicUserProfileCourseCount, loadPublishedRoomsByAuthor, loadUserStatsRow } from '../auth/store';
import { parseStoredSnapshot } from '../rooms/store';
import { compareGlobalLeaderboardEntries, mapUserStatsRow } from '../runs/points';

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
  bestScore: 0,
  fastestClearMs: null,
  globalRank: null,
};

export async function loadUserProfile(
  env: Env,
  targetUserId: string,
  viewerUserId: string | null = null
): Promise<UserProfileResponse | null> {
  const user = await findUserById(env, targetUserId);
  if (!user) {
    return null;
  }

  const [statsRow, allStatsRows, publishedRoomRows, publishedCourseCount] = await Promise.all([
    loadUserStatsRow(env, targetUserId),
    loadAllUserStatsRows(env),
    loadPublishedRoomsByAuthor(env, targetUserId),
    loadPublicUserProfileCourseCount(env, targetUserId),
  ]);

  const stats = buildProfileStats(statsRow, allStatsRows);
  const publishedRooms = buildPublishedRooms(publishedRoomRows);
  const isSelf = viewerUserId === targetUserId;

  return {
    userId: user.id,
    displayName: user.displayName,
    createdAt: user.createdAt ?? new Date(0).toISOString(),
    avatarUrl: user.avatarUrl ?? null,
    bio: user.bio ?? null,
    isSelf,
    canEdit: isSelf,
    stats,
    publishedRooms,
    publishedCourseCount,
  };
}

function buildProfileStats(
  statsRow: Awaited<ReturnType<typeof loadUserStatsRow>>,
  allStatsRows: Awaited<ReturnType<typeof loadAllUserStatsRows>>
): ProfileStatsSummary {
  if (!statsRow) {
    return { ...EMPTY_PROFILE_STATS };
  }

  const stats = mapUserStatsRow(statsRow);
  const rankedEntries = allStatsRows
    .map(mapUserStatsRow)
    .sort(compareGlobalLeaderboardEntries);
  const globalRank = rankedEntries.findIndex((entry) => entry.userId === stats.userId);

  return {
    totalPoints: stats.totalPoints,
    totalScore: stats.totalScore,
    totalDeaths: stats.totalDeaths,
    totalCollectibles: stats.totalCollectibles,
    totalEnemiesDefeated: stats.totalEnemiesDefeated,
    totalCheckpoints: stats.totalCheckpoints,
    totalRoomsPublished: stats.totalRoomsPublished,
    completedRuns: stats.completedRuns,
    failedRuns: stats.failedRuns,
    abandonedRuns: stats.abandonedRuns,
    bestScore: stats.bestScore,
    fastestClearMs: stats.fastestClearMs,
    globalRank: globalRank >= 0 ? globalRank + 1 : null,
  };
}

function buildPublishedRooms(
  rows: Awaited<ReturnType<typeof loadPublishedRoomsByAuthor>>
): ProfilePublishedRoomEntry[] {
  const entries: ProfilePublishedRoomEntry[] = [];

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
      });
    } catch (error) {
      console.warn('Skipping malformed published room while building profile.', row.id, error);
    }
  }

  return entries
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
    })
    .slice(0, 32);
}
