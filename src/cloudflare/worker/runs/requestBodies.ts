import { normalizeRoomGoal } from '../../../goals/roomGoals';
import { roomIdFromCoordinates } from '../../../persistence/roomModel';
import type {
  RoomDifficultyVoteRequestBody,
  RoomProgressRatingRequestBody,
  RoomRushDifficulty,
  RoomRushRouteStepRecord,
  RoomRushRunStartRequestBody,
  RoomRushRunSubmissionRequestBody,
  RoomRushStartRule,
  RunFinishRequestBody,
  RunStartRequestBody,
} from '../../../runs/model';
import {
  ROOM_RUSH_DIFFICULTIES,
  ROOM_RUSH_START_RULES,
} from '../../../runs/model';
import { normalizeRankedRunVerificationTrace } from '../../../runs/verificationTrace';
import {
  HttpError,
  normalizeIsoTimestamp,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  normalizeRoomCoordinates,
  parseJsonBody,
} from '../core/http';
import { parseRoomDifficultyOrThrow } from './difficulty';

const MAX_ROOM_RUSH_ROUTE_STEPS = 2048;

export async function parseRunStartBody(request: Request): Promise<RunStartRequestBody> {
  const body = await parseJsonBody<RunStartRequestBody>(request);
  const roomCoordinates = normalizeRoomCoordinates(body.roomCoordinates);
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
  const roomVersion = normalizePositiveInteger(body.roomVersion, 'roomVersion');
  const goal = normalizeRoomGoal(body.goal);

  if (!roomId) {
    throw new HttpError(400, 'roomId is required.');
  }

  if (!goal) {
    throw new HttpError(400, 'goal must be a valid room goal.');
  }

  if (roomId !== roomIdFromCoordinates(roomCoordinates)) {
    throw new HttpError(400, 'roomId must match roomCoordinates.');
  }

  return {
    roomId,
    roomCoordinates,
    roomVersion,
    goal,
    startedAt: normalizeIsoTimestamp(body.startedAt),
  };
}

export async function parseRunFinishBody(request: Request): Promise<RunFinishRequestBody> {
  const body = await parseJsonBody<RunFinishRequestBody>(request);
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
    enemyCollectiblesCollected: normalizeNonNegativeInteger(
      body.enemyCollectiblesCollected,
      'enemyCollectiblesCollected'
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

export async function parseRoomRushRunSubmissionBody(
  request: Request
): Promise<RoomRushRunSubmissionRequestBody> {
  const body = await parseJsonBody<RoomRushRunSubmissionRequestBody>(request);
  const startId = normalizeNonEmptyString(body.startId, 'startId', 128);
  const clientRunId = normalizeNonEmptyString(body.clientRunId, 'clientRunId', 128);
  const difficulty = normalizeRoomRushDifficulty(body.difficulty);
  const startRule = normalizeRoomRushStartRule(body.startRule);
  const result = normalizeRoomRushResult(body.result);
  const route = normalizeRoomRushRoute(body.route);
  const visitedRoomIds = normalizeRoomRushVisitedRoomIds(body.visitedRoomIds, route);
  const startCoordinates = normalizeRoomCoordinates(body.startCoordinates);
  const finishCoordinates = normalizeRoomCoordinates(body.finishCoordinates);

  return {
    startId,
    clientRunId,
    difficulty,
    startRule,
    result,
    elapsedMs: normalizeNonNegativeInteger(body.elapsedMs, 'elapsedMs'),
    deaths: normalizeNonNegativeInteger(body.deaths, 'deaths'),
    visitedRoomIds,
    route,
    startCoordinates,
    finishCoordinates,
    finishedAt: normalizeIsoTimestamp(body.finishedAt),
  };
}

export async function parseRoomRushRunStartBody(
  request: Request
): Promise<RoomRushRunStartRequestBody> {
  const body = await parseJsonBody<RoomRushRunStartRequestBody>(request);

  return {
    difficulty: normalizeRoomRushDifficulty(body.difficulty),
    startRule: normalizeRoomRushStartRule(body.startRule),
    startCoordinates: normalizeRoomCoordinates(body.startCoordinates),
  };
}

export async function parseRoomDifficultyVoteBody(
  request: Request
): Promise<RoomDifficultyVoteRequestBody> {
  const body = await parseJsonBody<RoomDifficultyVoteRequestBody>(request);

  return {
    roomCoordinates: normalizeRoomCoordinates(body.roomCoordinates),
    roomVersion: normalizePositiveInteger(body.roomVersion, 'roomVersion'),
    difficulty: parseRoomDifficultyOrThrow(body.difficulty),
  };
}

export async function parseRoomRatingBody(
  request: Request
): Promise<RoomProgressRatingRequestBody> {
  const body = await parseJsonBody<RoomProgressRatingRequestBody>(request);
  return {
    roomCoordinates: normalizeRoomCoordinates(body.roomCoordinates),
    roomVersion: normalizePositiveInteger(body.roomVersion, 'roomVersion'),
    qualityStars:
      body.qualityStars === null || body.qualityStars === undefined
        ? null
        : normalizePositiveInteger(body.qualityStars, 'qualityStars'),
    difficultyChoice: body.difficultyChoice ? parseRoomDifficultyOrThrow(body.difficultyChoice) : null,
    autoSuggestedDifficulty: body.autoSuggestedDifficulty
      ? parseRoomDifficultyOrThrow(body.autoSuggestedDifficulty)
      : null,
  };
}

function normalizeRoomRushDifficulty(value: unknown): RoomRushDifficulty {
  if (typeof value === 'string' && ROOM_RUSH_DIFFICULTIES.includes(value as RoomRushDifficulty)) {
    return value as RoomRushDifficulty;
  }

  throw new HttpError(400, 'difficulty must be easy or hard.');
}

function normalizeRoomRushStartRule(value: unknown): RoomRushStartRule {
  if (typeof value === 'string' && ROOM_RUSH_START_RULES.includes(value as RoomRushStartRule)) {
    return value as RoomRushStartRule;
  }

  throw new HttpError(400, 'startRule must be selected or origin.');
}

function normalizeRoomRushResult(
  value: unknown
): RoomRushRunSubmissionRequestBody['result'] {
  if (value === 'completed' || value === 'failed') {
    return value;
  }

  throw new HttpError(400, 'result must be completed or failed.');
}

function normalizeRoomRushRoute(value: unknown): RoomRushRouteStepRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'route must contain at least one room.');
  }

  if (value.length > MAX_ROOM_RUSH_ROUTE_STEPS) {
    throw new HttpError(400, `route must contain ${MAX_ROOM_RUSH_ROUTE_STEPS} rooms or fewer.`);
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new HttpError(400, 'route entries must be objects.');
    }

    const step = raw as Partial<RoomRushRouteStepRecord>;
    const coordinates = normalizeRoomCoordinates(step.coordinates);
    const canonicalRoomId = roomIdFromCoordinates(coordinates);
    const roomId = normalizeNonEmptyString(step.roomId, 'route.roomId', 64);
    if (roomId !== canonicalRoomId) {
      throw new HttpError(400, 'route roomId must match route coordinates.');
    }

    return {
      routeIndex: normalizeRouteIndex(step.routeIndex, index),
      roomId,
      expandedRoomId:
        step.expandedRoomId === null || step.expandedRoomId === undefined
          ? null
          : normalizeNonEmptyString(step.expandedRoomId, 'route.expandedRoomId', 128),
      coordinates,
      uniqueVisitIndex: normalizePositiveInteger(step.uniqueVisitIndex, 'route.uniqueVisitIndex'),
      uniqueAreaVisitIndex:
        step.uniqueAreaVisitIndex === null || step.uniqueAreaVisitIndex === undefined
          ? null
          : normalizePositiveInteger(step.uniqueAreaVisitIndex, 'route.uniqueAreaVisitIndex'),
    };
  });
}

function normalizeRouteIndex(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  return normalizeNonNegativeInteger(value, 'route.routeIndex');
}

function normalizeRoomRushVisitedRoomIds(
  value: unknown,
  route: RoomRushRouteStepRecord[]
): string[] {
  const fromRoute = Array.from(new Set(route.map((step) => step.expandedRoomId ?? step.roomId)));
  if (!Array.isArray(value)) {
    return fromRoute;
  }

  const normalized = Array.from(
    new Set(
      value
        .filter((roomId): roomId is string => typeof roomId === 'string')
        .map((roomId) => roomId.trim())
        .filter(Boolean)
    )
  ).slice(0, MAX_ROOM_RUSH_ROUTE_STEPS);

  return normalized.length > 0 ? normalized : fromRoute;
}

function normalizeNonEmptyString(value: unknown, label: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new HttpError(400, `${label} is required.`);
  }

  if (text.length > maxLength) {
    throw new HttpError(400, `${label} is too long.`);
  }

  return text;
}
