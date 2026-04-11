import {
  normalizeCourseGoal,
  normalizeCourseSnapshot,
  type CourseSnapshot,
} from '../../../courses/model';
import type {
  CourseProgressRatingRequestBody,
  CourseRunFinishRequestBody,
  CourseRunStartRequestBody,
} from '../../../courses/runModel';
import { normalizeRankedRunVerificationTrace } from '../../../runs/verificationTrace';
import {
  HttpError,
  normalizeIsoTimestamp,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  parseJsonBody,
} from '../core/http';

export async function parseCourseSnapshotBody(
  request: Request,
  fallbackCourseId: string = crypto.randomUUID()
): Promise<CourseSnapshot> {
  const body = await parseJsonBody<CourseSnapshot>(request);
  return normalizeCourseSnapshot(body, fallbackCourseId);
}

export async function parseCourseRunStartBody(
  request: Request,
  fallbackCourseId: string
): Promise<CourseRunStartRequestBody> {
  const body = await parseJsonBody<CourseRunStartRequestBody>(request);
  const courseId =
    typeof body.courseId === 'string' && body.courseId.trim() ? body.courseId.trim() : fallbackCourseId;
  const courseVersion = normalizePositiveInteger(body.courseVersion, 'courseVersion');
  const goal = normalizeCourseGoal(body.goal);

  if (!courseId) {
    throw new HttpError(400, 'courseId is required.');
  }
  if (!goal) {
    throw new HttpError(400, 'goal must be a valid course goal.');
  }

  return {
    courseId,
    courseVersion,
    goal,
    startedAt: normalizeIsoTimestamp(body.startedAt),
  };
}

export async function parseCourseRunFinishBody(
  request: Request
): Promise<CourseRunFinishRequestBody> {
  const body = await parseJsonBody<CourseRunFinishRequestBody>(request);
  const verificationTrace =
    body.verificationTrace === undefined
      ? null
      : normalizeRankedRunVerificationTrace(body.verificationTrace);

  if (body.result !== 'completed' && body.result !== 'failed' && body.result !== 'abandoned') {
    throw new HttpError(400, 'result must be completed, failed, or abandoned.');
  }

  return {
    result: body.result,
    elapsedMs: normalizeNonNegativeInteger(body.elapsedMs, 'elapsedMs'),
    deaths: normalizeNonNegativeInteger(body.deaths, 'deaths'),
    collectiblesCollected: normalizeNonNegativeInteger(
      body.collectiblesCollected,
      'collectiblesCollected'
    ),
    enemiesDefeated: normalizeNonNegativeInteger(body.enemiesDefeated, 'enemiesDefeated'),
    checkpointsReached: normalizeNonNegativeInteger(
      body.checkpointsReached,
      'checkpointsReached'
    ),
    score: null,
    finishedAt: normalizeIsoTimestamp(body.finishedAt),
    verificationTrace,
  };
}

export async function parseCourseRatingBody(
  request: Request
): Promise<CourseProgressRatingRequestBody> {
  const body = await parseJsonBody<CourseProgressRatingRequestBody>(request);
  return {
    courseVersion: normalizePositiveInteger(body.courseVersion, 'courseVersion'),
    qualityStars:
      body.qualityStars === null || body.qualityStars === undefined
        ? null
        : normalizePositiveInteger(body.qualityStars, 'qualityStars'),
    difficultyChoice: body.difficultyChoice ? parseCourseDifficulty(body.difficultyChoice) : null,
    autoSuggestedDifficulty: body.autoSuggestedDifficulty
      ? parseCourseDifficulty(body.autoSuggestedDifficulty)
      : null,
  };
}

function parseCourseDifficulty(
  value: unknown
): NonNullable<CourseProgressRatingRequestBody['difficultyChoice']> {
  const normalized =
    typeof value === 'string' && ['easy', 'medium', 'hard', 'extreme'].includes(value)
      ? (value as CourseProgressRatingRequestBody['difficultyChoice'])
      : null;
  if (!normalized) {
    throw new HttpError(400, 'difficultyChoice must be easy, medium, hard, extreme, or null.');
  }

  return normalized;
}

export function computeEffectiveElapsedMs(
  startedAt: string,
  finishedAt: string,
  reportedElapsedMs: number
): number {
  const observedStart = Date.parse(startedAt);
  const observedFinish = Date.parse(finishedAt);
  const observedElapsedMs =
    Number.isFinite(observedStart) && Number.isFinite(observedFinish)
      ? Math.max(0, observedFinish - observedStart)
      : 0;
  return Math.max(Math.round(reportedElapsedMs), observedElapsedMs);
}

export function normalizeFinalizedCourseRunBody(
  goal: CourseSnapshot['goal'],
  body: CourseRunFinishRequestBody,
  reportedElapsedMs: number
): CourseRunFinishRequestBody {
  if (!goal) {
    return body;
  }

  if (body.result !== 'completed') {
    return {
      ...body,
      collectiblesCollected: 0,
      enemiesDefeated: 0,
      checkpointsReached: 0,
    };
  }

  if (
    'timeLimitMs' in goal &&
    goal.timeLimitMs !== null &&
    reportedElapsedMs > goal.timeLimitMs
  ) {
    throw new HttpError(409, 'Completed course runs must finish within the published time limit.');
  }

  switch (goal.type) {
    case 'collect_target':
      if (body.collectiblesCollected < goal.requiredCount) {
        throw new HttpError(409, 'Completed collect-target course runs must meet the published goal.');
      }
      break;
    case 'checkpoint_sprint':
      if (body.checkpointsReached < goal.checkpoints.length) {
        throw new HttpError(409, 'Completed checkpoint course runs must hit every checkpoint.');
      }
      break;
    case 'survival':
      if (body.elapsedMs < goal.durationMs) {
        throw new HttpError(409, 'Completed survival course runs must last the full published duration.');
      }
      break;
    case 'defeat_all':
    case 'reach_exit':
      break;
  }

  return body;
}
