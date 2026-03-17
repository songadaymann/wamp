import { getObjectById } from '../../../config';
import type { CourseRunRecord } from '../../../courses/runModel';
import type { RoomGoal } from '../../../goals/roomGoals';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { RoomRunRecord, UserStatsRecord } from '../../../runs/model';
import { compareLeaderboardEntries } from '../../../runs/scoring';
import type { CourseRunRow, Env, PointEventRow, RoomRunRow, UserRow, UserStatsRow } from '../core/types';

export type PointEventType =
  | 'room_first_publish'
  | 'room_publish_update'
  | 'course_first_publish'
  | 'course_publish_update'
  | 'run_finalized'
  | 'room_creator_completion'
  | 'course_creator_completion';

const ROOM_FIRST_PUBLISH_POINTS = 300;
const ROOM_PUBLISH_UPDATE_POINTS = 75;
const COURSE_FIRST_PUBLISH_POINTS = ROOM_FIRST_PUBLISH_POINTS;
const COURSE_PUBLISH_UPDATE_POINTS = ROOM_PUBLISH_UPDATE_POINTS;
const ROOM_CREATOR_COMPLETION_POINTS = 50;
const COURSE_CREATOR_COMPLETION_POINTS = 50;
const RUN_COLLECTIBLE_POINTS = 2;
const RUN_ENEMY_POINTS = 5;
const RUN_CHECKPOINT_POINTS = 10;
const RUN_CLEAR_POINTS = 100;
const RUN_ZERO_DEATH_CLEAR_POINTS = 25;
const RUN_PERSONAL_BEST_POINTS = 25;

export async function awardRoomPublishPoints(
  env: Env,
  userId: string,
  roomId: string,
  roomVersion: number,
  isFirstPublish: boolean,
): Promise<PointEventRow> {
  const eventType: PointEventType = isFirstPublish ? 'room_first_publish' : 'room_publish_update';
  const points = isFirstPublish ? ROOM_FIRST_PUBLISH_POINTS : ROOM_PUBLISH_UPDATE_POINTS;
  return recordPointEvent(env, {
    userId,
    eventType,
    sourceKey: `${roomId}:${roomVersion}`,
    points,
    breakdown: {
      roomId,
      roomVersion,
      firstPublish: isFirstPublish,
    },
  });
}

export async function awardRunFinalizePoints(
  env: Env,
  run: Pick<
    RoomRunRecord | CourseRunRecord,
    | 'attemptId'
    | 'userId'
    | 'collectiblesCollected'
    | 'enemiesDefeated'
    | 'checkpointsReached'
    | 'result'
    | 'deaths'
  >,
  isNewPersonalBest: boolean,
): Promise<PointEventRow> {
  let points = 0;
  const breakdown = {
    collectibles: Math.max(0, run.collectiblesCollected) * RUN_COLLECTIBLE_POINTS,
    enemies: Math.max(0, run.enemiesDefeated) * RUN_ENEMY_POINTS,
    checkpoints: Math.max(0, run.checkpointsReached) * RUN_CHECKPOINT_POINTS,
    clear: 0,
    zeroDeath: 0,
    personalBest: 0,
  };

  points += breakdown.collectibles + breakdown.enemies + breakdown.checkpoints;

  if (run.result === 'completed') {
    breakdown.clear = RUN_CLEAR_POINTS;
    points += RUN_CLEAR_POINTS;

    if (run.deaths === 0) {
      breakdown.zeroDeath = RUN_ZERO_DEATH_CLEAR_POINTS;
      points += RUN_ZERO_DEATH_CLEAR_POINTS;
    }

    if (isNewPersonalBest) {
      breakdown.personalBest = RUN_PERSONAL_BEST_POINTS;
      points += RUN_PERSONAL_BEST_POINTS;
    }
  }

  return recordPointEvent(env, {
    userId: run.userId,
    eventType: 'run_finalized',
    sourceKey: run.attemptId,
    points,
    breakdown,
  });
}

export async function awardCoursePublishPoints(
  env: Env,
  userId: string,
  courseId: string,
  courseVersion: number,
  isFirstPublish: boolean
): Promise<PointEventRow> {
  const eventType: PointEventType = isFirstPublish
    ? 'course_first_publish'
    : 'course_publish_update';
  const points = isFirstPublish
    ? COURSE_FIRST_PUBLISH_POINTS
    : COURSE_PUBLISH_UPDATE_POINTS;
  return recordPointEvent(env, {
    userId,
    eventType,
    sourceKey: `${courseId}:${courseVersion}`,
    points,
    breakdown: {
      courseId,
      courseVersion,
      firstPublish: isFirstPublish,
    },
  });
}

export async function awardRoomCreatorCompletionPoints(
  env: Env,
  input: {
    creatorUserId: string | null;
    roomId: string;
    roomVersion: number;
    finisherUserId: string;
    attemptId: string;
  }
): Promise<PointEventRow | null> {
  if (!input.creatorUserId || input.creatorUserId === input.finisherUserId) {
    return null;
  }

  return recordPointEvent(env, {
    userId: input.creatorUserId,
    eventType: 'room_creator_completion',
    sourceKey: `${input.roomId}:${input.roomVersion}:${input.finisherUserId}`,
    points: ROOM_CREATOR_COMPLETION_POINTS,
    breakdown: {
      roomId: input.roomId,
      roomVersion: input.roomVersion,
      finisherUserId: input.finisherUserId,
      attemptId: input.attemptId,
    },
  });
}

export async function awardCourseCreatorCompletionPoints(
  env: Env,
  input: {
    creatorUserId: string | null;
    courseId: string;
    courseVersion: number;
    finisherUserId: string;
    attemptId: string;
  }
): Promise<PointEventRow | null> {
  if (!input.creatorUserId || input.creatorUserId === input.finisherUserId) {
    return null;
  }

  return recordPointEvent(env, {
    userId: input.creatorUserId,
    eventType: 'course_creator_completion',
    sourceKey: `${input.courseId}:${input.courseVersion}:${input.finisherUserId}`,
    points: COURSE_CREATOR_COMPLETION_POINTS,
    breakdown: {
      courseId: input.courseId,
      courseVersion: input.courseVersion,
      finisherUserId: input.finisherUserId,
      attemptId: input.attemptId,
    },
  });
}

export async function loadBestCompletedRunForUserAndRoomVersion(
  env: Env,
  userId: string,
  roomId: string,
  roomVersion: number,
  goal: RoomGoal,
  excludeAttemptId: string | null = null
): Promise<RoomRunRecord | null> {
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
      WHERE user_id = ?
        AND room_id = ?
        AND room_version = ?
        AND result = 'completed'
        AND (? IS NULL OR attempt_id != ?)
    `
  )
    .bind(userId, roomId, roomVersion, excludeAttemptId, excludeAttemptId)
    .all<RoomRunRow>();

  const runs = result.results
    .filter(
      (row): row is RoomRunRow & { elapsed_ms: number; finished_at: string } =>
        typeof row.elapsed_ms === 'number' && typeof row.finished_at === 'string'
    )
    .map(mapRoomRunRow);

  if (runs.length === 0) {
    return null;
  }

  runs.sort((left, right) =>
    compareLeaderboardEntries(
      {
        elapsedMs: left.elapsedMs ?? 0,
        deaths: left.deaths,
        score: left.score,
        finishedAt: left.finishedAt ?? left.startedAt,
      },
      {
        elapsedMs: right.elapsedMs ?? 0,
        deaths: right.deaths,
        score: right.score,
        finishedAt: right.finishedAt ?? right.startedAt,
      },
      goal
    )
  );

  return runs[0] ?? null;
}

export async function upsertUserStats(env: Env, userId: string): Promise<void> {
  const user = await env.DB.prepare(
    `
      SELECT id, email, wallet_address, display_name, created_at, updated_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<UserRow>();

  if (!user) {
    return;
  }

  const runResult = await env.DB.prepare(
    `
      SELECT
        result,
        elapsed_ms,
        score,
        deaths,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached
      FROM course_runs
      WHERE user_id = ?
        AND result != 'active'
      UNION ALL
      SELECT
        result,
        elapsed_ms,
        score,
        deaths,
        collectibles_collected,
        enemies_defeated,
        checkpoints_reached
      FROM room_runs
      WHERE user_id = ?
        AND result != 'active'
    `
  )
    .bind(userId, userId)
    .all<
      Pick<
        RoomRunRow | CourseRunRow,
        | 'result'
        | 'elapsed_ms'
        | 'score'
        | 'deaths'
        | 'collectibles_collected'
        | 'enemies_defeated'
        | 'checkpoints_reached'
      >
    >();

  const pointResult = await env.DB.prepare(
    `
      SELECT COALESCE(SUM(points), 0) AS total_points
      FROM point_events
      WHERE user_id = ?
    `
  )
    .bind(userId)
    .first<{ total_points: number | null }>();

  const publishedCountRow = await env.DB.prepare(
    `
      SELECT COUNT(DISTINCT room_id) AS total_rooms_published
      FROM room_versions
      WHERE published_by_user_id = ?
    `
  )
    .bind(userId)
    .first<{ total_rooms_published: number | null }>();

  let totalScore = 0;
  let totalDeaths = 0;
  let totalCollectibles = 0;
  let totalEnemiesDefeated = 0;
  let totalCheckpoints = 0;
  let completedRuns = 0;
  let failedRuns = 0;
  let abandonedRuns = 0;
  let bestScore = 0;
  let fastestClearMs: number | null = null;

  for (const row of runResult.results) {
    totalScore += Math.max(0, Number(row.score ?? 0));
    totalDeaths += Math.max(0, Number(row.deaths ?? 0));
    totalCollectibles += Math.max(0, Number(row.collectibles_collected ?? 0));
    totalEnemiesDefeated += Math.max(0, Number(row.enemies_defeated ?? 0));
    totalCheckpoints += Math.max(0, Number(row.checkpoints_reached ?? 0));
    bestScore = Math.max(bestScore, Number(row.score ?? 0));

    if (row.result === 'completed') {
      completedRuns += 1;
      if (typeof row.elapsed_ms === 'number') {
        fastestClearMs =
          fastestClearMs === null ? row.elapsed_ms : Math.min(fastestClearMs, row.elapsed_ms);
      }
    } else if (row.result === 'failed') {
      failedRuns += 1;
    } else if (row.result === 'abandoned') {
      abandonedRuns += 1;
    }
  }

  const updatedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO user_stats (
          user_id,
          user_display_name,
          total_points,
          total_score,
          total_deaths,
          total_collectibles,
          total_enemies_defeated,
          total_checkpoints,
          total_rooms_published,
          completed_runs,
          failed_runs,
          abandoned_runs,
          best_score,
          fastest_clear_ms,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          user_display_name = excluded.user_display_name,
          total_points = excluded.total_points,
          total_score = excluded.total_score,
          total_deaths = excluded.total_deaths,
          total_collectibles = excluded.total_collectibles,
          total_enemies_defeated = excluded.total_enemies_defeated,
          total_checkpoints = excluded.total_checkpoints,
          total_rooms_published = excluded.total_rooms_published,
          completed_runs = excluded.completed_runs,
          failed_runs = excluded.failed_runs,
          abandoned_runs = excluded.abandoned_runs,
          best_score = excluded.best_score,
          fastest_clear_ms = excluded.fastest_clear_ms,
          updated_at = excluded.updated_at
      `
    ).bind(
      user.id,
      user.display_name,
      Math.max(0, Number(pointResult?.total_points ?? 0)),
      totalScore,
      totalDeaths,
      totalCollectibles,
      totalEnemiesDefeated,
      totalCheckpoints,
      Math.max(0, Number(publishedCountRow?.total_rooms_published ?? 0)),
      completedRuns,
      failedRuns,
      abandonedRuns,
      bestScore,
      fastestClearMs,
      updatedAt
    ),
  ]);
}

export function mapUserStatsRow(row: UserStatsRow): UserStatsRecord {
  return {
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    totalPoints: row.total_points,
    totalScore: row.total_score,
    totalDeaths: row.total_deaths,
    totalCollectibles: row.total_collectibles,
    totalEnemiesDefeated: row.total_enemies_defeated,
    totalCheckpoints: row.total_checkpoints,
    totalRoomsPublished: row.total_rooms_published,
    completedRuns: row.completed_runs,
    failedRuns: row.failed_runs,
    abandonedRuns: row.abandoned_runs,
    bestScore: row.best_score,
    fastestClearMs: row.fastest_clear_ms,
    updatedAt: row.updated_at,
  };
}

export function compareGlobalLeaderboardEntries(
  left: UserStatsRecord,
  right: UserStatsRecord
): number {
  return (
    right.totalPoints - left.totalPoints ||
    right.completedRuns - left.completedRuns ||
    right.totalRoomsPublished - left.totalRoomsPublished ||
    left.userDisplayName.localeCompare(right.userDisplayName)
  );
}

export function clampRunMetricsToSnapshot(
  room: RoomSnapshot,
  metrics: Pick<
    RoomRunRecord,
    'collectiblesCollected' | 'enemiesDefeated' | 'checkpointsReached'
  > & {
    collectiblesCollected: number;
    enemiesDefeated: number;
    checkpointsReached: number;
  }
): {
  collectiblesCollected: number;
  enemiesDefeated: number;
  checkpointsReached: number;
} {
  const maxCollectibles = countRoomObjectsByCategory(room, 'collectible');
  const maxEnemies = countRoomObjectsByCategory(room, 'enemy');
  const maxCheckpoints =
    room.goal?.type === 'checkpoint_sprint' ? room.goal.checkpoints.length : 0;

  return {
    collectiblesCollected: clampMetric(metrics.collectiblesCollected, maxCollectibles),
    enemiesDefeated: clampMetric(metrics.enemiesDefeated, maxEnemies),
    checkpointsReached: clampMetric(metrics.checkpointsReached, maxCheckpoints),
  };
}

function clampMetric(value: number, max: number): number {
  return Math.max(0, Math.min(Math.round(value), Math.max(0, max)));
}

function countRoomObjectsByCategory(room: RoomSnapshot, category: string): number {
  let count = 0;
  for (const placed of room.placedObjects) {
    const object = getObjectById(placed.id);
    if (object?.category === category) {
      count += 1;
    }
  }
  return count;
}

function mapRoomRunRow(row: RoomRunRow): RoomRunRecord {
  const parsedGoal = JSON.parse(row.goal_json) as RoomGoal;
  return {
    attemptId: row.attempt_id,
    roomId: row.room_id,
    roomCoordinates: {
      x: row.room_x,
      y: row.room_y,
    },
    roomVersion: row.room_version,
    goalType: parsedGoal.type,
    goal: parsedGoal,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result,
    elapsedMs: row.elapsed_ms,
    deaths: row.deaths,
    score: row.score,
    collectiblesCollected: row.collectibles_collected,
    enemiesDefeated: row.enemies_defeated,
    checkpointsReached: row.checkpoints_reached,
  };
}

async function recordPointEvent(
  env: Env,
  input: {
    userId: string;
    eventType: PointEventType;
    sourceKey: string;
    points: number;
    breakdown: Record<string, unknown>;
  }
): Promise<PointEventRow> {
  const eventId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT OR IGNORE INTO point_events (
          id,
          user_id,
          event_type,
          source_key,
          points,
          breakdown_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      eventId,
      input.userId,
      input.eventType,
      input.sourceKey,
      Math.max(0, Math.round(input.points)),
      JSON.stringify(input.breakdown),
      createdAt
    ),
  ]);

  const row = await env.DB.prepare(
    `
      SELECT
        id,
        user_id,
        event_type,
        source_key,
        points,
        breakdown_json,
        created_at
      FROM point_events
      WHERE event_type = ?
        AND source_key = ?
      LIMIT 1
    `
  )
    .bind(input.eventType, input.sourceKey)
    .first<PointEventRow>();

  if (!row) {
    throw new Error('Failed to reload recorded point event.');
  }

  return row;
}
