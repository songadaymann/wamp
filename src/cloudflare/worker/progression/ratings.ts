import { mirrorCourseRatingToExpandedRoomRating } from './ratingMirror';
import type { CourseRecord } from '../../../courses/model';
import { getRoomVersionFacts, type RoomRecordView, type RoomVersionSource } from '../../../persistence/roomVersionLineage';
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
import { sqlIsVerificationAccepted } from '../runs/verificationSql';

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
  const [rows, trophy] = await Promise.all([
    loadRoomRatingsForVersionKey(env, roomId, ratingWindow.versionKey),
    loadTrophyForContentVersion(env, 'room', roomId, ratingWindow.versionKey),
  ]);
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
    trophy,
  };
}

async function buildCourseRatingSummary(
  env: Env,
  courseId: string,
  ratingWindow: RatingWindow,
  options: RatingSummaryOptions,
  expandedRoomId?: string,
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
    trophy: (expandedRoomId ? await loadTrophyForContentVersion(env, 'expanded_room', expandedRoomId, ratingWindow.versionKey) : null)
      ?? await loadTrophyForContentVersion(env, 'course', courseId, ratingWindow.versionKey),
  };
}

export function buildRoomRatingWindow(versions: readonly RoomVersionSource[], targetVersion: number): RatingWindow {
  return buildRatingWindow(versions,targetVersion,ROOM_SIGNIFICANT_CHANGE_THRESHOLD,getRoomVersionChange,
    (first,key) => createLineageKey(first ? getRoomVersionFacts(first).snapshotId : 'room',key));
}

/** The stored change for a described version, or the change computed from both snapshots. */
function getRoomVersionChange(previous: RoomVersionSource | undefined, version: RoomVersionSource): number {
  if ('changeFromPrevious' in version) return version.changeFromPrevious;
  return computeRoomWeightedChange(previous && 'snapshot' in previous ? previous.snapshot : null, version.snapshot);
}

export function buildCourseRatingWindow(
  versions: CourseRecord['versions'], targetVersion: number, courseId: string,
): RatingWindow {
  return buildRatingWindow(versions,targetVersion,COURSE_SIGNIFICANT_CHANGE_THRESHOLD,
    (previous,current) => computeCourseWeightedChange(previous?.snapshot ?? null,current.snapshot),
    (_first,key) => createLineageKey(courseId,key));
}

function buildRatingWindow<V extends { version: number }>(
  versions: readonly V[], targetVersion: number, threshold: number,
  change: (previous: V | undefined,current: V) => number,
  lineage: (first: V | undefined,key: number) => string,
): RatingWindow {
  const sorted = [...versions].sort((left,right) => left.version-right.version);
  let currentKey = sorted[0]?.version ?? targetVersion;
  const bucketByVersion = new Map<number,number>();
  for (let index=0;index<sorted.length;index+=1) {
    const version=sorted[index];
    if (!version) continue;
    if (index===0 || change(sorted[index-1],version)>=threshold) currentKey=version.version;
    bucketByVersion.set(version.version,currentKey);
  }
  const versionKey=bucketByVersion.get(targetVersion) ?? targetVersion;
  return {versionKey,lineageKey:lineage(sorted[0],versionKey),versionFamily:sorted
    .filter(version => (bucketByVersion.get(version.version) ?? version.version)===versionKey)
    .map(version => version.version)};
}

export async function hasCompletedRoomRatingWindow(
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
        AND room_version IN (
          SELECT CAST(value AS INTEGER)
          FROM json_each(?)
        )
        AND user_id = ?
        AND result = 'completed'
        AND ${sqlIsVerificationAccepted('room_runs')}
      LIMIT 1
    `
  )
    .bind(roomId, JSON.stringify(versionFamily), userId)
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
        AND course_version IN (
          SELECT CAST(value AS INTEGER)
          FROM json_each(?)
        )
        AND user_id = ?
        AND result = 'completed'
        AND ${sqlIsVerificationAccepted('course_runs')}
      LIMIT 1
    `
  )
    .bind(courseId, JSON.stringify(versionFamily), userId)
    .first<{ found: number | string | null }>();

  return parseRowNumber(row?.found) === 1;
}

async function upsertRoomRatingRow(
  env: Env,
  params: {
    roomId: string;
    publishedVersion: number;
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, (
          SELECT attempt_id FROM room_runs
          WHERE room_id = ? AND room_version = ? AND user_id = ? AND result = 'completed'
            AND ${sqlIsVerificationAccepted('room_runs')}
          ORDER BY finished_at DESC, attempt_id DESC LIMIT 1
        ), ?, ?, NULL)
        ON CONFLICT(room_id, version_key, user_id) DO UPDATE SET
          quality_stars = excluded.quality_stars,
          difficulty_choice = excluded.difficulty_choice,
          auto_difficulty_choice = excluded.auto_difficulty_choice,
          trust_weight = excluded.trust_weight,
          completed_attempt_id = excluded.completed_attempt_id,
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
      params.roomId,
      params.publishedVersion,
      params.userId,
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
    publishedVersion: number;
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, (
          SELECT attempt_id FROM course_runs
          WHERE course_id = ? AND course_version = ? AND user_id = ? AND result = 'completed'
            AND ${sqlIsVerificationAccepted('course_runs')}
          ORDER BY finished_at DESC, attempt_id DESC LIMIT 1
        ), ?, ?, NULL)
        ON CONFLICT(course_id, version_key, user_id) DO UPDATE SET
          quality_stars = excluded.quality_stars,
          difficulty_choice = excluded.difficulty_choice,
          auto_difficulty_choice = excluded.auto_difficulty_choice,
          trust_weight = excluded.trust_weight,
          completed_attempt_id = excluded.completed_attempt_id,
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
      params.courseId,
      params.publishedVersion,
      params.userId,
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
    roomRecord: RoomRecordView;
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

  const summary=(window:RatingWindow)=>buildRoomRatingSummary(env,published.id,window,{
    viewerUserId:params.userId,viewerCanVote:true,viewerNeedsRun:false,
  });
  const result=await submitRating(env,{userId:params.userId,body:params.body,now},{
    kind:'room',id:published.id,version:published.version,ownerUserId:params.roomRecord.claimerUserId,
    ratingCxp:LANE_BASE_XP.roomRatingCxp,trophyType:'room',trophyId:published.id,
    window:()=>buildRoomRatingWindow(params.roomRecord.versions,params.body.roomVersion),
    hasCompleted:window=>hasCompletedRoomRatingWindow(env,published.id,window.versionFamily,params.userId),
    rows:window=>loadRoomRatingsForVersionKey(env,published.id,window.versionKey),
    write:(window,values)=>upsertRoomRatingRow(env,{...values,roomId:published.id,publishedVersion:published.version,ratingWindow:window}),
    markRewarded:(key,at)=>markRoomRatingRewarded(env,published.id,key,params.userId,at),
    summary,finalSummary:window=>summary(window),
    publisher:key=>params.roomRecord.versions.find(version=>version.version===key)?.publishedByUserId,
  });
  return {ok:true,roomId:published.id,roomVersion:published.version,...result};
}

export async function submitCourseRating(
  env: Env,
  params: {
    courseRecord: CourseRecord;
    expandedRoomId?: string;
    userId: string;
    body: CourseRatingRequestBody;
    now?: string;
  },
): Promise<CourseRatingResponse> {
  const now = params.now ?? new Date().toISOString();
  const published = params.courseRecord.published;
  if (!published || published.version !== params.body.courseVersion) {
    throw new HttpError(409, 'Ratings are only available on the current published expanded room version.');
  }
  if (params.courseRecord.ownerUserId === params.userId) {
    throw new HttpError(409, 'You cannot rate your own expanded room.');
  }

  const trophyType=params.expandedRoomId ? 'expanded_room' : 'course';
  const trophyId=params.expandedRoomId ?? published.id;
  const result=await submitRating(env,{userId:params.userId,body:params.body,now},{
    kind:'course',id:published.id,version:published.version,ownerUserId:params.courseRecord.ownerUserId,
    ratingCxp:LANE_BASE_XP.courseRatingCxp,trophyType,trophyId,
    window:()=>buildCourseRatingWindow(params.courseRecord.versions,params.body.courseVersion,published.id),
    hasCompleted:window=>hasCompletedCourseRatingWindow(env,published.id,window.versionFamily,params.userId),
    rows:window=>loadCourseRatingsForVersionKey(env,published.id,window.versionKey),
    write:(window,values)=>upsertCourseRatingRow(env,{...values,courseId:published.id,publishedVersion:published.version,ratingWindow:window}),
    markRewarded:(key,at)=>markCourseRatingRewarded(env,published.id,key,params.userId,at),
    summary:window=>buildCourseRatingSummary(env,published.id,window,{
      viewerUserId:params.userId,viewerCanVote:true,viewerNeedsRun:false,
    }),
    finalSummary:async(window,initial)=>({...initial,trophy:await loadTrophyForContentVersion(env,trophyType,trophyId,window.versionKey)}),
    publisher:key=>params.courseRecord.versions.find(version=>version.version===key)?.publishedByUserId,
    syncProjection:async(window)=>{
      if (params.expandedRoomId) {
        await mirrorCourseRatingToExpandedRoomRating(env, {
          expandedRoomId: params.expandedRoomId, legacyCourseId: published.id,
          versionKey: window.versionKey, userId: params.userId,
        });
        // Retire derived duplicate quality trophies for this window, including the old
        // route's raw-version copies. Keep other trophy types and historical windows.
        await env.DB.batch([env.DB.prepare(`DELETE FROM content_trophies WHERE trophy_type = 'quality'
          AND ((content_type = 'course' AND content_id = ? AND version_key IN (SELECT value FROM json_each(?)))
            OR (content_type = 'expanded_room' AND content_id = ? AND version_key IN (SELECT value FROM json_each(?)) AND version_key <> ?))`)
          .bind(published.id, JSON.stringify(window.versionFamily), params.expandedRoomId,
            JSON.stringify(window.versionFamily), window.versionKey)]);
      }
    },
  });
  return {ok:true,courseId:published.id,courseVersion:published.version,...result};
}

type RatingWriteValues=Pick<Parameters<typeof upsertRoomRatingRow>[1],
  'userId'|'qualityStars'|'difficultyChoice'|'autoSuggestedDifficulty'|'trustWeight'|'now'>;
interface RatingTarget {
  kind:'room'|'course'; id:string; version:number; ownerUserId:string|null; ratingCxp:number;
  trophyType:'room'|'course'|'expanded_room'; trophyId:string;
  window:()=>RatingWindow;
  hasCompleted:(window:RatingWindow)=>Promise<boolean>;
  rows:(window:RatingWindow)=>Promise<Pick<RoomRatingRow,'user_id'|'rewarded_at'>[]>;
  write:(window:RatingWindow,values:RatingWriteValues)=>Promise<unknown>;
  markRewarded:(key:number,at:string)=>Promise<void>;
  summary:(window:RatingWindow)=>Promise<RatingAggregateSummary>;
  finalSummary:(window:RatingWindow,initial:RatingAggregateSummary)=>Promise<RatingAggregateSummary>;
  publisher:(key:number)=>string|null|undefined;
  syncProjection?:(window:RatingWindow)=>Promise<void>;
}

/** Validation/storage adapters retain identity; voting rewards and bookkeeping run once here. */
async function submitRating(
  env:Env,params:{userId:string;body:Pick<RoomRatingRequestBody,'qualityStars'|'difficultyChoice'|'autoSuggestedDifficulty'>;now:string},
  target:RatingTarget,
):Promise<Pick<RoomRatingResponse,'progressionDelta'|'summary'|'progression'>> {
  const now=params.now;
  const qualityStars = normalizeQualityStars(params.body.qualityStars);
  const difficultyChoice = normalizeDifficulty(params.body.difficultyChoice);
  const autoSuggestedDifficulty = normalizeDifficulty(params.body.autoSuggestedDifficulty);
  const ratingWindow=target.window();
  const hasCompleted=await target.hasCompleted(ratingWindow);
  if (!hasCompleted) {
    throw new HttpError(409, `Complete this ${target.kind==='room' ? 'room' : 'expanded room'} version window once before rating it.`);
  }

  const progress = await loadOrBackfillUserProgress(env, params.userId);
  const trustWeight = trustWeightFromTier(
    await loadEffectiveTrustTier(env, params.userId, progress),
  );
  const existingRows = await target.rows(ratingWindow);
  const existingViewerRow = existingRows.find((row) => row.user_id === params.userId) ?? null;

  await target.write(ratingWindow,{userId:params.userId,qualityStars,difficultyChoice,autoSuggestedDifficulty,trustWeight,now});

  const delta = createEmptyProgressionDelta();
  const firstRewardedSubmission =
    existingViewerRow === null || existingViewerRow.rewarded_at === null;
  if (firstRewardedSubmission) {
    delta.pxp += await awardLaneDelta(
      env,
      params.userId,
      'pxp',
      `${target.kind}_rating_submit`,
      `${target.kind}_rating`,
      `${target.id}:${ratingWindow.versionKey}`,
      `pxp:${target.kind}_rating_submit:${params.userId}:${target.id}:${ratingWindow.versionKey}`,
      LANE_BASE_XP.ratingPxp,
      now,
    );
    delta.cxp += await awardLaneDelta(
      env,
      params.userId,
      'cxp',
      `${target.kind}_rating_submit`,
      `${target.kind}_rating`,
      `${target.id}:${ratingWindow.versionKey}`,
      `cxp:${target.kind}_rating_submit:${params.userId}:${target.id}:${ratingWindow.versionKey}`,
      target.ratingCxp,
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
      `${target.kind}_rating_submit`,
      `${target.kind}_rating`,
      `${target.id}:${ratingWindow.versionKey}`,
      `trust:${target.kind}_rating_submit:${params.userId}:${target.id}:${ratingWindow.versionKey}`,
      1,
      now,
    );
    await target.markRewarded(ratingWindow.versionKey,now);
  }

  if (target.ownerUserId && target.ownerUserId !== params.userId && firstRewardedSubmission) {
    const creatorDelta: ProgressionDelta = {
      pxp: 0,
      bxp: await awardLaneDelta(
        env,
        target.ownerUserId,
        'bxp',
        `unique_rating_${target.kind}`,
        `${target.kind}_rating`,
        `${target.id}:${ratingWindow.versionKey}:${params.userId}`,
        `bxp:${target.kind}_unique_rating:${target.ownerUserId}:${target.id}:${ratingWindow.versionKey}:${params.userId}`,
        LANE_BASE_XP.uniqueRating,
        now,
        { activity: { contentType: target.kind, contentId: target.id, version: target.version, actorUserId: params.userId, qualityStars } },
      ),
      cxp: 0,
      trust: await awardLaneDelta(
        env,
        target.ownerUserId,
        'trust',
        `unique_rating_${target.kind}`,
        `${target.kind}_rating`,
        `${target.id}:${ratingWindow.versionKey}:${params.userId}`,
        `trust:${target.kind}_unique_rating:${target.ownerUserId}:${target.id}:${ratingWindow.versionKey}:${params.userId}`,
        1,
        now,
      ),
    };
    await persistProgressIncrement(env, target.ownerUserId, creatorDelta, now);
  }

  await persistProgressIncrement(env, params.userId, delta, now);
  const summary=await target.summary(ratingWindow);
  await target.syncProjection?.(ratingWindow);
  await syncContentTrophy(env,target.trophyType,target.trophyId,ratingWindow.versionKey,summary.quality);
  await refreshContentOwnerProgressCounts(env,target.trophyType,target.trophyId,ratingWindow.versionKey);
  const trophyOwner=target.publisher(ratingWindow.versionKey);
  if (firstRewardedSubmission && target.ownerUserId && target.ownerUserId!==trophyOwner) {
    await syncUserBadges(env,target.ownerUserId);
  }
  if (trophyOwner!==params.userId) await syncUserBadges(env,params.userId);
  return {progressionDelta:delta,summary:await target.finalSummary(ratingWindow,summary),
    progression:await loadPublicProgressionSummary(env,params.userId)};
}

/** Recomputes a quality trophy and the owner's counts after ratings were removed (F205). */
export async function refreshRatedContentTrophy(
  env: Env,
  kind: 'room' | 'course',
  contentId: string,
  versionKey: number,
): Promise<void> {
  const rows = kind === 'room'
    ? await loadRoomRatingsForVersionKey(env, contentId, versionKey)
    : await loadCourseRatingsForVersionKey(env, contentId, versionKey);
  await syncContentTrophy(env, kind, contentId, versionKey, summarizeQualityRatings(rows));
  await refreshContentOwnerProgressCounts(env, kind, contentId, versionKey);
}

export async function loadRoomAggregateRatingSummaryForVersion(
  env: Env,
  roomRecord: RoomRecordView,
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
  versions: readonly RoomVersionSource[],
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
  expandedRoomId?: string,
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
  }, expandedRoomId);
}
