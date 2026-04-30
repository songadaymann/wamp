import type { CourseGoal, CourseRecord, CourseSnapshot } from '../../../courses/model';
import { compareCourseLeaderboardEntries } from '../../../courses/scoring';
import type { CourseRunRecord } from '../../../courses/runModel';
import type { RoomGoal } from '../../../goals/roomGoals';
import type { RoomRecord, RoomSnapshot } from '../../../persistence/roomModel';
import type { ProgressionDelta } from '../../../progression/model';
import type { RoomRunRecord } from '../../../runs/model';
import { sortCompletedRunsForLeaderboard } from '../../../runs/scoring';
import type { CourseRunRow, Env, RoomRunRow, UserProgressRow } from '../core/types';
import {
  computeCourseWeightedChange,
  computeRoomWeightedChange,
} from './changeMetrics';
import { syncUserBadges } from './badgesTrophies';
import { awardLaneDelta, persistProgressIncrement } from './laneEvents';
import {
  loadOrBackfillUserProgress,
  loadUserIdentityRow,
  upsertUserProgressRow,
} from './progressRows';
import {
  builderContributionWeightFromTier,
  COURSE_SIGNIFICANT_CHANGE_THRESHOLD,
  createEmptyProgressionDelta,
  getUtcDayKey,
  getUtcWeekKey,
  LANE_BASE_XP,
  parseRowNumber,
  ROOM_SIGNIFICANT_CHANGE_THRESHOLD,
} from './shared';
import { buildCourseRatingWindow, buildRoomRatingWindow } from './ratings';
import { loadEffectiveTrustTier } from './trustCaps';

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
    const creatorWeight = builderContributionWeightFromTier(
      await loadEffectiveTrustTier(env, params.creatorUserId, creatorProgress),
    );
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
    const creatorWeight = builderContributionWeightFromTier(
      await loadEffectiveTrustTier(env, params.creatorUserId, creatorProgress),
    );
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
