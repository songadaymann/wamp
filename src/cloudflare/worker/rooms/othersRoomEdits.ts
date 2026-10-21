import { isRoomMinted, type RoomRecord } from '../../../persistence/roomModel';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { getUtcDayKey } from '../progression/shared';
import { resolveRoomCapabilities } from '../progression/trustCaps';

type RequestAuthSource = 'session' | 'api_token' | 'agent_token' | null;

const OTHERS_ROOM_EDIT_BUCKET_PREFIX = 'others-room-edit:';

/**
 * A published, unminted room claimed by someone else (or nobody) is open to any builder.
 * Minted rooms only accept their owner, and World rooms follow the World's own policy.
 */
export function isEditOfOthersRoom(
  record: Pick<RoomRecord, 'published' | 'claimerUserId' | 'mintedChainId' | 'mintedContractAddress' | 'mintedTokenId' | 'world'>,
  userId: string,
  isAdmin: boolean,
): boolean {
  return !isAdmin
    && !record.world
    && record.published !== null
    && record.claimerUserId !== userId
    && !isRoomMinted(record);
}

/** Set as a Worker secret (`wrangler secret put OTHERS_ROOM_EDITS_PAUSED`, value 1) during a raid. */
export function assertOthersRoomEditsOpen(env: Env): void {
  if (env.OTHERS_ROOM_EDITS_PAUSED?.trim() === '1') {
    throw new HttpError(
      503,
      "Editing other builders' rooms is paused right now. Your own rooms still save and publish.",
    );
  }
}

/**
 * Publishing over other builders' rooms gets its own daily allowance, equal to the builder's
 * new-room publish limit. Each distinct room counts once per UTC day. Every allowed attempt
 * records its own row in one statement, so parallel publishes cannot all pass the count, and a
 * failed attempt that releases its row never uncounts another publish of the same room.
 */
export async function takeOthersRoomEditSlot(
  env: Env,
  userId: string,
  roomId: string,
  requestAuthSource: RequestAuthSource,
  now: Date = new Date(),
): Promise<number> {
  assertOthersRoomEditsOpen(env);
  const { publishLimitPerDay } = await resolveRoomCapabilities(env, userId, requestAuthSource);
  const bucket = `${OTHERS_ROOM_EDIT_BUCKET_PREFIX}${userId}`;
  const dayStart = `${getUtcDayKey(now.toISOString())}T00:00:00.000Z`;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limit_events (bucket, key_hash, created_at)
     SELECT ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM rate_limit_events WHERE bucket = ? AND key_hash = ? AND created_at >= ?)
       OR (SELECT COUNT(DISTINCT key_hash) FROM rate_limit_events WHERE bucket = ? AND created_at >= ?) < ?
     RETURNING id`,
  )
    .bind(bucket, roomId, now.toISOString(), bucket, roomId, dayStart, bucket, dayStart, publishLimitPerDay)
    .first<{ id: number | string }>();
  if (!row) {
    throw new HttpError(
      429,
      `Daily limit reached for other builders' rooms. You can publish over ${publishLimitPerDay} rooms claimed by someone else per UTC day.`,
    );
  }
  return Number(row.id);
}
