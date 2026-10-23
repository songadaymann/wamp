import type { RequestAuthSource } from '../../../agents/model';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { TrustTier } from '../../../progression/model';
import {
  builderCanUseRoomVideo,
  ROOM_VIDEO_TRUST_MESSAGE,
  roomVideoChangeNeedsTrust,
} from '../../../roomVideo/access';
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
  assertRoomVideoTrust(capabilities.trustTier, room, previousRoom);
}

export async function assertCanPersistRoomVideo(
  env: Env,
  room: RoomSnapshot,
  previousRoom: RoomSnapshot | null,
  userId: string,
  requestAuthSource: RequestAuthSource | null,
): Promise<void> {
  if (!roomVideoChangeNeedsTrust(room.video, previousRoom?.video)) return;
  const capabilities = await resolveRoomCapabilities(env, userId, requestAuthSource);
  assertRoomVideoTrust(capabilities.trustTier, room, previousRoom);
}

export function assertRoomVideoTrust(
  tier: TrustTier,
  room: Pick<RoomSnapshot, 'video'>,
  previousRoom: Pick<RoomSnapshot, 'video'> | null,
): void {
  if (!roomVideoChangeNeedsTrust(room.video, previousRoom?.video)) return;
  if (builderCanUseRoomVideo(tier)) return;
  throw new HttpError(403, ROOM_VIDEO_TRUST_MESSAGE);
}
