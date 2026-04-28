import { normalizeRoomGoal } from '../../../goals/roomGoals';
import { roomIdFromCoordinates } from '../../../persistence/roomModel';
import type {
  RoomDifficultyVoteRequestBody,
  RoomProgressRatingRequestBody,
  RunFinishRequestBody,
  RunStartRequestBody,
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
