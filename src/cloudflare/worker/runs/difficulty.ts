import { cloneRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import type {
  RoomDifficulty,
  RoomDifficultyCounts,
  RoomDifficultySummary,
  RoomDiscoveryEntry,
  RoomDiscoveryResponse,
} from '../../../runs/model';
import { normalizeRoomDifficulty, ROOM_DIFFICULTIES } from '../../../runs/model';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';

interface RoomDifficultyVoteRow {
  room_id: string;
  room_version: number;
  user_id: string;
  difficulty: string;
  created_at: string;
  updated_at: string;
  carried_from_version: number | null;
}

interface RoomDifficultyAggregateRow {
  room_id: string;
  room_version: number;
  easy_votes: number | string | null;
  medium_votes: number | string | null;
  hard_votes: number | string | null;
  extreme_votes: number | string | null;
}

interface PublishedRoomDiscoveryRow {
  id: string;
  published_json: string;
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
  roomVersion: number
): Promise<RoomDifficultyCounts> {
  const row = await env.DB.prepare(
    `
      SELECT
        room_id,
        room_version,
        SUM(CASE WHEN difficulty = 'easy' THEN 1 ELSE 0 END) AS easy_votes,
        SUM(CASE WHEN difficulty = 'medium' THEN 1 ELSE 0 END) AS medium_votes,
        SUM(CASE WHEN difficulty = 'hard' THEN 1 ELSE 0 END) AS hard_votes,
        SUM(CASE WHEN difficulty = 'extreme' THEN 1 ELSE 0 END) AS extreme_votes
      FROM room_difficulty_votes
      WHERE room_id = ?
        AND room_version = ?
      GROUP BY room_id, room_version
    `
  )
    .bind(roomId, roomVersion)
    .first<RoomDifficultyAggregateRow>();

  if (!row) {
    return createEmptyRoomDifficultyCounts();
  }

  return mapDifficultyAggregateRow(row);
}

export async function loadViewerRoomDifficultyVote(
  env: Env,
  roomId: string,
  roomVersion: number,
  userId: string
): Promise<RoomDifficulty | null> {
  const row = await env.DB.prepare(
    `
      SELECT difficulty
      FROM room_difficulty_votes
      WHERE room_id = ?
        AND room_version = ?
        AND user_id = ?
      LIMIT 1
    `
  )
    .bind(roomId, roomVersion, userId)
    .first<{ difficulty: string | null }>();

  return normalizeRoomDifficulty(row?.difficulty ?? null);
}

export async function hasViewerRatedRoomVersion(
  env: Env,
  roomId: string,
  roomVersion: number,
  userId: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM room_runs
      WHERE room_id = ?
        AND room_version = ?
        AND user_id = ?
        AND result != 'active'
      LIMIT 1
    `
  )
    .bind(roomId, roomVersion, userId)
    .first<{ found: number | string | null }>();

  return Number(row?.found ?? 0) === 1;
}

export async function buildRoomDifficultySummary(
  env: Env,
  snapshot: RoomSnapshot,
  viewerUserId: string | null,
  currentPublishedVersion: number | null
): Promise<RoomDifficultySummary> {
  const counts = await loadRoomDifficultyCounts(env, snapshot.id, snapshot.version);
  const viewerSignedIn = viewerUserId !== null;
  const viewerVote =
    viewerUserId === null
      ? null
      : await loadViewerRoomDifficultyVote(env, snapshot.id, snapshot.version, viewerUserId);
  const viewerCanRateCurrentVersion =
    viewerUserId !== null &&
    currentPublishedVersion === snapshot.version &&
    (await hasViewerRatedRoomVersion(env, snapshot.id, snapshot.version, viewerUserId));

  return {
    consensus: resolveRoomDifficultyConsensus(counts),
    counts,
    totalVotes: getRoomDifficultyVoteTotal(counts),
    viewerVote,
    viewerSignedIn,
    viewerCanVote: viewerCanRateCurrentVersion,
    viewerNeedsRun:
      viewerUserId !== null &&
      currentPublishedVersion === snapshot.version &&
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

export async function cloneRoomDifficultyVotesToVersion(
  env: Env,
  roomId: string,
  sourceVersion: number,
  targetVersion: number,
  now: string
): Promise<void> {
  if (
    !Number.isInteger(sourceVersion) ||
    !Number.isInteger(targetVersion) ||
    sourceVersion < 1 ||
    targetVersion < 1 ||
    sourceVersion === targetVersion
  ) {
    return;
  }

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
        SELECT
          ?,
          ?,
          user_id,
          difficulty,
          ?,
          ?,
          ?
        FROM room_difficulty_votes
        WHERE room_id = ?
          AND room_version = ?
      `
    ).bind(roomId, targetVersion, now, now, sourceVersion, roomId, sourceVersion),
  ]);
}

export async function loadRoomDiscoveryResponse(
  env: Env,
  difficultyFilter: RoomDifficulty | null,
  limit: number
): Promise<RoomDiscoveryResponse> {
  const publishedRooms = await env.DB.prepare(
    `
      SELECT id, published_json
      FROM rooms
      WHERE published_json IS NOT NULL
    `
  ).all<PublishedRoomDiscoveryRow>();

  const challengeSnapshots = publishedRooms.results
    .map((row) => parseStoredSnapshot(row.published_json))
    .filter((snapshot) => snapshot.goal !== null);

  if (challengeSnapshots.length === 0) {
    return {
      difficultyFilter,
      results: [],
    };
  }

  const roomIds = challengeSnapshots.map((snapshot) => snapshot.id);
  const aggregates = await env.DB.prepare(
    `
      SELECT
        room_id,
        room_version,
        SUM(CASE WHEN difficulty = 'easy' THEN 1 ELSE 0 END) AS easy_votes,
        SUM(CASE WHEN difficulty = 'medium' THEN 1 ELSE 0 END) AS medium_votes,
        SUM(CASE WHEN difficulty = 'hard' THEN 1 ELSE 0 END) AS hard_votes,
        SUM(CASE WHEN difficulty = 'extreme' THEN 1 ELSE 0 END) AS extreme_votes
      FROM room_difficulty_votes
      WHERE room_id IN (${roomIds.map(() => '?').join(', ')})
      GROUP BY room_id, room_version
    `
  )
    .bind(...roomIds)
    .all<RoomDifficultyAggregateRow>();

  const aggregateByVersion = new Map<string, RoomDifficultyCounts>();
  for (const row of aggregates.results) {
    aggregateByVersion.set(`${row.room_id}:${row.room_version}`, mapDifficultyAggregateRow(row));
  }

  const results = challengeSnapshots
    .map<RoomDiscoveryEntry>((snapshot) => {
      const counts =
        aggregateByVersion.get(`${snapshot.id}:${snapshot.version}`) ?? createEmptyRoomDifficultyCounts();
      return {
        roomId: snapshot.id,
        roomCoordinates: { ...snapshot.coordinates },
        roomTitle: snapshot.title,
        roomVersion: snapshot.version,
        goalType: snapshot.goal!.type,
        consensusDifficulty: resolveRoomDifficultyConsensus(counts),
        voteCount: getRoomDifficultyVoteTotal(counts),
        publishedAt: snapshot.publishedAt ?? null,
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

function mapDifficultyAggregateRow(row: RoomDifficultyAggregateRow): RoomDifficultyCounts {
  return {
    easy: Number(row.easy_votes ?? 0),
    medium: Number(row.medium_votes ?? 0),
    hard: Number(row.hard_votes ?? 0),
    extreme: Number(row.extreme_votes ?? 0),
  };
}

function parseStoredSnapshot(raw: string): RoomSnapshot {
  try {
    return cloneRoomSnapshot(JSON.parse(raw) as RoomSnapshot);
  } catch {
    throw new HttpError(500, 'Failed to parse published room snapshot.');
  }
}
