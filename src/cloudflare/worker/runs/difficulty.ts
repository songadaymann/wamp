import { ROOM_GOAL_TYPES, type RoomGoalType } from '../../../goals/roomGoals';
import type { RoomSnapshot } from '../../../persistence/roomModel';
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

interface RoomDifficultyAggregateRow {
  room_id: string;
  room_version: number;
  easy_votes: number | string | null;
  medium_votes: number | string | null;
  hard_votes: number | string | null;
  extreme_votes: number | string | null;
}

interface PublishedRoomDiscoveryRow {
  room_id: string;
  room_x: number;
  room_y: number;
  room_title: string | null;
  room_version: number | string | null;
  goal_type: string | null;
  consensus_difficulty: string | null;
  vote_count: number | string | null;
  published_at: string | null;
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
        AND is_held = 0
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
      WITH latest_versions AS (
        SELECT room_versions.room_id, room_versions.version, room_versions.created_at
        FROM room_versions
        INNER JOIN (
          SELECT room_id, MAX(version) AS version
          FROM room_versions
          GROUP BY room_id
        ) AS latest
          ON latest.room_id = room_versions.room_id
         AND latest.version = room_versions.version
      ),
      vote_aggregates AS (
        SELECT
          room_id,
          room_version,
          SUM(CASE WHEN difficulty = 'easy' THEN 1 ELSE 0 END) AS easy_votes,
          SUM(CASE WHEN difficulty = 'medium' THEN 1 ELSE 0 END) AS medium_votes,
          SUM(CASE WHEN difficulty = 'hard' THEN 1 ELSE 0 END) AS hard_votes,
          SUM(CASE WHEN difficulty = 'extreme' THEN 1 ELSE 0 END) AS extreme_votes
        FROM room_difficulty_votes
        GROUP BY room_id, room_version
      ),
      room_vote_counts AS (
        SELECT
          rooms.id AS room_id,
          rooms.x AS room_x,
          rooms.y AS room_y,
          rooms.published_title AS room_title,
          latest_versions.version AS room_version,
          rooms.published_goal_type AS goal_type,
          latest_versions.created_at AS published_at,
          COALESCE(vote_aggregates.easy_votes, 0) AS easy_votes,
          COALESCE(vote_aggregates.medium_votes, 0) AS medium_votes,
          COALESCE(vote_aggregates.hard_votes, 0) AS hard_votes,
          COALESCE(vote_aggregates.extreme_votes, 0) AS extreme_votes
        FROM rooms
        INNER JOIN latest_versions
          ON latest_versions.room_id = rooms.id
        LEFT JOIN vote_aggregates
          ON vote_aggregates.room_id = rooms.id
         AND vote_aggregates.room_version = latest_versions.version
        WHERE rooms.published_json IS NOT NULL
          AND rooms.published_goal_type IS NOT NULL
      ),
      challenge_rooms AS (
        SELECT
          room_id,
          room_x,
          room_y,
          room_title,
          room_version,
          goal_type,
          published_at,
          easy_votes + medium_votes + hard_votes + extreme_votes AS vote_count,
          CASE
            WHEN easy_votes > 0
              AND easy_votes >= medium_votes
              AND easy_votes >= hard_votes
              AND easy_votes >= extreme_votes
            THEN 'easy'
            WHEN medium_votes > easy_votes
              AND medium_votes > 0
              AND medium_votes >= hard_votes
              AND medium_votes >= extreme_votes
            THEN 'medium'
            WHEN hard_votes > easy_votes
              AND hard_votes > medium_votes
              AND hard_votes > 0
              AND hard_votes >= extreme_votes
            THEN 'hard'
            WHEN extreme_votes > easy_votes
              AND extreme_votes > medium_votes
              AND extreme_votes > hard_votes
            THEN 'extreme'
            ELSE NULL
          END AS consensus_difficulty
        FROM room_vote_counts
      )
      SELECT
        room_id,
        room_x,
        room_y,
        room_title,
        room_version,
        goal_type,
        consensus_difficulty,
        vote_count,
        published_at
      FROM challenge_rooms
      WHERE (? IS NULL OR consensus_difficulty = ?)
      ORDER BY vote_count DESC, published_at DESC
      LIMIT ?
    `
  )
    .bind(difficultyFilter, difficultyFilter, limit)
    .all<PublishedRoomDiscoveryRow>();

  if (publishedRooms.results.length === 0) {
    return {
      difficultyFilter,
      results: [],
    };
  }

  return {
    difficultyFilter,
    results: publishedRooms.results.map(mapRoomDiscoveryRow),
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

function mapRoomDiscoveryRow(row: PublishedRoomDiscoveryRow): RoomDiscoveryEntry {
  const goalType = parseRoomGoalType(row.goal_type);
  if (!goalType) {
    throw new HttpError(500, 'Failed to parse published room goal type.');
  }

  return {
    roomId: row.room_id,
    roomCoordinates: {
      x: Number(row.room_x),
      y: Number(row.room_y),
    },
    roomTitle: row.room_title,
    roomVersion: Number(row.room_version ?? 0),
    goalType,
    consensusDifficulty: normalizeRoomDifficulty(row.consensus_difficulty),
    voteCount: Number(row.vote_count ?? 0),
    publishedAt: row.published_at,
  };
}

function parseRoomGoalType(value: string | null): RoomGoalType | null {
  return value && ROOM_GOAL_TYPES.includes(value as RoomGoalType)
    ? (value as RoomGoalType)
    : null;
}
