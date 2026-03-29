import type { RequestAuthSource } from '../../../agents/model';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';

const DEFAULT_ROOM_DAILY_CLAIM_LIMIT = 1;
const DEFAULT_PLAYFUN_ROOM_DAILY_CLAIM_LIMIT = 1;
const DEFAULT_PLAYFUN_MAX_PLACED_OBJECTS = 16;

function parseOptionalPositiveInteger(
  raw: string | undefined,
  fallback: number | null,
): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback;
  }

  if (parsed <= 0) {
    return null;
  }

  return parsed;
}

export function getDailyRoomClaimLimitForSource(
  env: Env,
  requestAuthSource: RequestAuthSource | null,
): number | null {
  if (requestAuthSource === 'playfun') {
    return parseOptionalPositiveInteger(
      env.PLAYFUN_ROOM_DAILY_CLAIM_LIMIT,
      DEFAULT_PLAYFUN_ROOM_DAILY_CLAIM_LIMIT,
    );
  }

  return parseOptionalPositiveInteger(
    env.ROOM_DAILY_CLAIM_LIMIT,
    DEFAULT_ROOM_DAILY_CLAIM_LIMIT,
  );
}

export function getPlacedObjectLimitForSource(
  env: Env,
  requestAuthSource: RequestAuthSource | null,
): number | null {
  if (requestAuthSource !== 'playfun') {
    return null;
  }

  return parseOptionalPositiveInteger(
    env.PLAYFUN_ROOM_MAX_PLACED_OBJECTS,
    DEFAULT_PLAYFUN_MAX_PLACED_OBJECTS,
  );
}

export function enforceRoomMutationGuardrails(
  env: Env,
  room: RoomSnapshot,
  requestAuthSource: RequestAuthSource | null,
): void {
  const placedObjectLimit = getPlacedObjectLimitForSource(env, requestAuthSource);
  if (placedObjectLimit === null) {
    return;
  }

  if (room.placedObjects.length <= placedObjectLimit) {
    return;
  }

  throw new HttpError(
    429,
    `Play.fun room edits are limited to ${placedObjectLimit} placed objects per room right now.`,
  );
}
