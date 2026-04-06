import type { RequestAuthSource } from '../../../agents/model';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import {
  resolveRoomCapabilities,
  validateRoomObjectsAgainstCapabilities,
} from '../progression/store';

export async function getDailyRoomClaimLimitForUser(
  env: Env,
  userId: string,
  requestAuthSource: RequestAuthSource | null,
): Promise<number | null> {
  const capabilities = await resolveRoomCapabilities(env, userId, requestAuthSource);
  return capabilities.claimLimitPerDay;
}

export async function enforceRoomMutationGuardrails(
  env: Env,
  room: RoomSnapshot,
  userId: string,
  requestAuthSource: RequestAuthSource | null,
  previousRoom: RoomSnapshot | null,
): Promise<void> {
  const capabilities = await resolveRoomCapabilities(env, userId, requestAuthSource);
  validateRoomObjectsAgainstCapabilities(room, capabilities, previousRoom);
}

export async function enforcePublishLimitForUser(
  env: Env,
  userId: string,
  requestAuthSource: RequestAuthSource | null,
): Promise<void> {
  const capabilities = await resolveRoomCapabilities(env, userId, requestAuthSource);
  if (capabilities.publishLimitPerDay <= 0) {
    throw new HttpError(429, 'Publishing is unavailable for this trust tier.');
  }
}
