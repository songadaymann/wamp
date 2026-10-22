import { HttpError } from '../core/http';
import { hashRateLimitKey, takeRateLimitSlot, type RateLimitRule } from '../core/rateLimit';
import type { Env } from '../core/types';
import type { RoomChainSyncFailureMode } from './service';

/** Saves use stored ownership when a chain read of the same room finished this recently. */
export const ROOM_CHAIN_READ_BUCKET = 'room-chain:checked';
export const ROOM_CHAIN_READ_REUSE_MS = 15_000;
/** Chain reads one account can cause, sessions and agent tokens alike. */
export const ROOM_CHAIN_SAVE_USER_RULE: RateLimitRule = { bucket: 'room-chain:user-save', limit: 120, windowMs: 10 * 60_000 };
export const ROOM_CHAIN_CHECK_USER_RULE: RateLimitRule = { bucket: 'room-chain:user', limit: 30, windowMs: 10 * 60_000 };

/**
 * Decides whether one room ownership read goes to the chain. Returns false when a save should use
 * stored ownership instead: a read of the room finished moments ago, or the account is past its save
 * budget for a room whose access does not follow the token owner. Throws 429 in every other case
 * past the budget, so a minted room is never edited on ownership the chain was not asked about.
 */
export async function takeRoomChainRead(
  env: Env,
  roomId: string,
  actorUserId: string | null,
  mode: RoomChainSyncFailureMode,
  accessFollowsTokenOwner: boolean,
): Promise<boolean> {
  // Minting and explicit refreshes always read; only saves reuse a recent finished read.
  if (mode === 'use-stored' && await roomChainReadFinishedSince(env, roomId, Date.now() - ROOM_CHAIN_READ_REUSE_MS)) {
    return false;
  }
  if (!actorUserId) return true;
  const rule = mode === 'use-stored' ? ROOM_CHAIN_SAVE_USER_RULE : ROOM_CHAIN_CHECK_USER_RULE;
  if (await takeRateLimitSlot(env, rule, await hashRateLimitKey(env, `user:${actorUserId}`)) !== null) return true;
  if (mode === 'use-stored' && !accessFollowsTokenOwner) return false;
  throw new HttpError(429, 'Too many ownership checks. Please wait a few minutes and try again.');
}

/** Records a chain read of the room once its result is stored. */
export async function recordRoomChainRead(env: Env, roomId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO rate_limit_events (bucket, key_hash, created_at) VALUES (?, ?, ?)')
      .bind(ROOM_CHAIN_READ_BUCKET, await hashRateLimitKey(env, `room:${roomId}`), new Date().toISOString()),
  ]);
}

async function roomChainReadFinishedSince(env: Env, roomId: string, since: number): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS found FROM rate_limit_events WHERE bucket = ? AND key_hash = ? AND created_at > ? LIMIT 1'
  )
    .bind(ROOM_CHAIN_READ_BUCKET, await hashRateLimitKey(env, `room:${roomId}`), new Date(since).toISOString())
    .first<{ found: number }>();
  return row !== null;
}
