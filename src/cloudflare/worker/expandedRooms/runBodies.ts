import { expandedRoomIdFromLegacyCourseId } from '../../../expandedRooms/model';
import { normalizeCourseGoal } from '../../../courses/model';
import type { CourseProgressRatingRequestBody } from '../../../courses/runModel';
import type { ExpandedRoomProgressRatingRequestBody, ExpandedRoomRunStartRequestBody } from '../../../expandedRooms/runModel';
import { HttpError, normalizeIsoTimestamp, normalizePositiveInteger, parseJsonBody } from '../core/http';
import { parseCourseRatingBody, parseCourseRunStartBody } from '../courses/requestBodies';

export async function parseExpandedRoomRunStartBody(
  request: Request,
  fallbackExpandedRoomId: string,
  legacyCourseId?: string,
): Promise<ExpandedRoomRunStartRequestBody> {
  if (legacyCourseId) {
    const body = await parseCourseRunStartBody(request, legacyCourseId);
    // The legacy parser lets the body's courseId override the URL; preserve that contract.
    return { expandedRoomId: expandedRoomIdFromLegacyCourseId(body.courseId), expandedRoomVersion: body.courseVersion, goal: body.goal, startedAt: body.startedAt };
  }
  const body = await parseJsonBody<
    Partial<ExpandedRoomRunStartRequestBody> & {
      courseVersion?: unknown;
    }
  >(request);
  const expandedRoomId =
    typeof body.expandedRoomId === 'string' && body.expandedRoomId.trim()
      ? body.expandedRoomId.trim()
      : fallbackExpandedRoomId;
  const expandedRoomVersion = normalizePositiveInteger(
    body.expandedRoomVersion ?? body.courseVersion,
    'expandedRoomVersion',
  );
  const goal = normalizeCourseGoal(body.goal);

  if (!expandedRoomId) {
    throw new HttpError(400, 'expandedRoomId is required.');
  }
  if (expandedRoomId !== fallbackExpandedRoomId) {
    throw new HttpError(400, 'expandedRoomId must match the URL.');
  }
  if (!goal) {
    throw new HttpError(400, 'goal must be a valid expanded room goal.');
  }

  return {
    expandedRoomId,
    expandedRoomVersion,
    goal,
    startedAt: normalizeIsoTimestamp(body.startedAt),
  };
}

export async function parseExpandedRoomRatingBody(
  request: Request,
  legacyBody = false,
): Promise<ExpandedRoomProgressRatingRequestBody> {
  if (legacyBody) {
    const { courseVersion, ...body } = await parseCourseRatingBody(request);
    return { ...body, expandedRoomVersion: courseVersion };
  }
  const body = await parseJsonBody<
    Partial<ExpandedRoomProgressRatingRequestBody & CourseProgressRatingRequestBody>
  >(request);
  return {
    expandedRoomVersion: normalizePositiveInteger(
      body.expandedRoomVersion ?? body.courseVersion,
      'expandedRoomVersion',
    ),
    qualityStars:
      body.qualityStars === null || body.qualityStars === undefined
        ? null
        : normalizePositiveInteger(body.qualityStars, 'qualityStars'),
    difficultyChoice: parseExpandedRoomDifficulty(body.difficultyChoice),
    autoSuggestedDifficulty: parseExpandedRoomDifficulty(body.autoSuggestedDifficulty),
  };
}

function parseExpandedRoomDifficulty(
  value: unknown,
): CourseProgressRatingRequestBody['difficultyChoice'] {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'string' && ['easy', 'medium', 'hard', 'extreme'].includes(value)) {
    return value as CourseProgressRatingRequestBody['difficultyChoice'];
  }
  throw new HttpError(400, 'difficultyChoice must be easy, medium, hard, extreme, or null.');
}

