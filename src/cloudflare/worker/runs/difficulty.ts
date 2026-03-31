import {
  createRoomVersionRecord,
  type RoomSnapshot,
  type RoomVersionRecord,
} from '../../../persistence/roomModel';
import { buildRoomLeaderboardLineage } from '../../../persistence/roomLeaderboardLineage';
import { ROOM_GOAL_TYPES, type RoomGoalType } from '../../../goals/roomGoals';
import type {
  RoomDifficulty,
  RoomDifficultyCounts,
  RoomDifficultySummary,
  RoomDiscoveryEntry,
  RoomDiscoveryResponse,
} from '../../../runs/model';
import { normalizeRoomDifficulty, ROOM_DIFFICULTIES } from '../../../runs/model';
import { HttpError } from '../core/http';
import type { Env, RoomDifficultyVoteRow, RoomVersionRow } from '../core/types';

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
  current_published_version: number;
  published_at: string;
  canonical_version: number | null;
}

interface RoomVersionDiscoveryRow extends RoomVersionRow {
  room_id: string;
}

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
  limit: number
): Promise<RoomDiscoveryResponse> {
  const publishedRooms = await env.DB.prepare(
    `
      SELECT
        rooms.id,
        rooms.x,
        rooms.y,
        rooms.published_title,
        rooms.published_goal_type,
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
      results: [],
    };
  }

  const roomIds = challengeRooms.map((entry) => entry.roomId);
  const versionRows = await env.DB.prepare(
    `
      SELECT
        room_id,
        version,
        snapshot_json,
        title,
        created_at,
        published_by_user_id,
        published_by_principal_type,
        published_by_agent_id,
        published_by_display_name,
        reverted_from_version,
        leaderboard_source_version
      FROM room_versions
      WHERE room_id IN (${roomIds.map(() => '?').join(', ')})
      ORDER BY room_id ASC, version ASC
    `
  )
    .bind(...roomIds)
    .all<RoomVersionDiscoveryRow>();

  const versionsByRoomId = new Map<string, RoomVersionRecord[]>();
  for (const row of versionRows.results) {
    const snapshot = parseStoredSnapshot(row.snapshot_json);
    const version = createRoomVersionRecord(snapshot, {
      version: row.version,
      createdAt: row.created_at,
      publishedByUserId: row.published_by_user_id,
      publishedByPrincipalKind: row.published_by_principal_type,
      publishedByAgentId: row.published_by_agent_id,
      publishedByDisplayName: row.published_by_display_name,
      revertedFromVersion: row.reverted_from_version,
      leaderboardSourceVersion: row.leaderboard_source_version,
    });
    const bucket = versionsByRoomId.get(row.room_id);
    if (bucket) {
      bucket.push(version);
    } else {
      versionsByRoomId.set(row.room_id, [version]);
    }
  }

  const voteRows = await env.DB.prepare(
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
      WHERE room_id IN (${roomIds.map(() => '?').join(', ')})
    `
  )
    .bind(...roomIds)
    .all<RoomDifficultyVoteRow>();

  const votesByRoomId = new Map<string, RoomDifficultyVoteRow[]>();
  for (const row of voteRows.results) {
    const bucket = votesByRoomId.get(row.room_id);
    if (bucket) {
      bucket.push(row);
    } else {
      votesByRoomId.set(row.room_id, [row]);
    }
  }

  const results = challengeRooms
    .map<RoomDiscoveryEntry>((room) => {
      const versions = versionsByRoomId.get(room.roomId) ?? [];
      const lineage = buildRoomLeaderboardLineage(
        versions,
        room.canonicalRoomVersion,
        room.roomVersion
      );
      const lineageEntry = lineage.byVersion.get(room.roomVersion) ?? null;
      const leaderboardFamilyVersions = lineageEntry?.leaderboardFamilyVersions ?? [room.roomVersion];
      const votes = (votesByRoomId.get(room.roomId) ?? []).filter((vote) =>
        leaderboardFamilyVersions.includes(vote.room_version)
      );
      const counts = summarizeDifficultyVotes(dedupeLatestDifficultyVotesByUser(votes));

      return {
        roomId: room.roomId,
        roomCoordinates: { ...room.roomCoordinates },
        roomTitle: room.roomTitle,
        roomVersion: room.roomVersion,
        displayRoomVersion: lineageEntry?.representativeVersion ?? room.roomVersion,
        leaderboardSourceVersion: lineageEntry?.leaderboardSourceRepresentativeVersion ?? null,
        canonicalRoomVersion: room.canonicalRoomVersion,
        goalType: room.goalType,
        consensusDifficulty: resolveRoomDifficultyConsensus(counts),
        voteCount: getRoomDifficultyVoteTotal(counts),
        publishedAt: room.publishedAt,
      };
    })
    .filter((entry) => difficultyFilter === null || entry.consensusDifficulty === difficultyFilter)
    .sort((left, right) => {
      if (right.voteCount !== left.voteCount) {
        return right.voteCount - left.voteCount;
      }

      const rightPublishedAt = right.publishedAt ? Date.parse(right.publishedAt) : 0;
      const leftPublishedAt = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      return rightPublishedAt - leftPublishedAt;
    })
    .slice(0, limit);

  return {
    difficultyFilter,
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

function parseStoredSnapshot(raw: string): RoomSnapshot {
  try {
    return JSON.parse(raw) as RoomSnapshot;
  } catch {
    throw new HttpError(500, 'Failed to parse published room snapshot.');
  }
}
