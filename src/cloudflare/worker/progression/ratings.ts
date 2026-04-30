import type { CourseRecord } from '../../../courses/model';
import type { RoomRecord, RoomVersionRecord } from '../../../persistence/roomModel';
import {
  type CourseRatingRequestBody,
  type CourseRatingResponse,
  type DifficultyRatingSummary,
  type ProgressionDelta,
  type ProgressionDifficulty,
  PROGRESSION_DIFFICULTIES,
  type QualityRatingSummary,
  type RatingAggregateSummary,
  type RoomRatingRequestBody,
  type RoomRatingResponse,
} from '../../../progression/model';
import { HttpError } from '../core/http';
import type { CourseRatingRow, Env, RoomRatingRow } from '../core/types';
import {
  computeCourseWeightedChange,
  computeRoomWeightedChange,
} from './changeMetrics';
import {
  COURSE_SIGNIFICANT_CHANGE_THRESHOLD,
  createEmptyDifficultyCounts,
  createEmptyProgressionDelta,
  createEmptyQualityCounts,
  createLineageKey,
  getUtcWeekKey,
  LANE_BASE_XP,
  normalizeDifficulty,
  normalizeQualityStars,
  parseRowFloat,
  parseRowNumber,
  QUALITY_PRIOR_MEAN,
  QUALITY_PRIOR_WEIGHT,
  type DifficultyAccumulator,
  type RatingSummaryOptions,
  type RatingWindow,
  ROOM_SIGNIFICANT_CHANGE_THRESHOLD,
  roundQuality,
  trustWeightFromTier,
} from './shared';
import {
  loadPublicProgressionSummary,
  loadTrophyForContentVersion,
  refreshContentOwnerProgressCounts,
  syncContentTrophy,
  syncUserBadges,
} from './badgesTrophies';
import { awardLaneDelta, persistProgressIncrement } from './laneEvents';
import { loadOrBackfillUserProgress } from './progressRows';
import { loadEffectiveTrustTier } from './trustCaps';

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

export function buildRoomRatingWindow(versions: RoomVersionRecord[], targetVersion: number): RatingWindow {
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

export function buildCourseRatingWindow(
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
  const trustWeight = trustWeightFromTier(
    await loadEffectiveTrustTier(env, params.userId, progress),
  );
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
  const trustWeight = trustWeightFromTier(
    await loadEffectiveTrustTier(env, params.userId, progress),
  );
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
