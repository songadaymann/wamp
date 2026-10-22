import { HttpError } from '../core/http';
import { hashRateLimitKey, takeRateLimitSlots, type RateLimitRule } from '../core/rateLimit';
import type { Env } from '../core/types';
import type { RoomChainSyncFailureMode } from './service';

/** Stored ownership stands in for a chain read of the same room made this recently. */
export const ROOM_CHAIN_SAVE_FRESH_RULE: RateLimitRule = { bucket: 'room-chain:checked', limit: 1, windowMs: 15_000 };
export const ROOM_CHAIN_REFRESH_FRESH_RULE: RateLimitRule = { bucket: 'room-chain:refreshed', limit: 1, windowMs: 5_000 };
/** Chain reads one account can cause, sessions and agent tokens alike. Saves past it use stored ownership. */
export const ROOM_CHAIN_SAVE_USER_RULE: RateLimitRule = { bucket: 'room-chain:user-save', limit: 120, windowMs: 10 * 60_000 };
export const ROOM_CHAIN_CHECK_USER_RULE: RateLimitRule = { bucket: 'room-chain:user', limit: 30, windowMs: 10 * 60_000 };

/**
 * Takes the slots for one room ownership read from the chain. Returns null when the read should be
 * skipped in favour of stored ownership, or the room's freshness slot to give back if the read fails.
 */
export async function takeRoomChainReadSlots(
  env: Env,
  roomId: string,
  actorUserId: string | null,
  mode: RoomChainSyncFailureMode,
): Promise<{ freshnessSlot: number | null } | null> {
  // Minting confirms against the chain itself, so only saves and explicit refreshes share recent reads.
  const freshness = mode === 'use-stored' ? ROOM_CHAIN_SAVE_FRESH_RULE
    : mode === 'require-fresh' ? ROOM_CHAIN_REFRESH_FRESH_RULE : null;
  const userRule = mode === 'use-stored' ? ROOM_CHAIN_SAVE_USER_RULE : ROOM_CHAIN_CHECK_USER_RULE;
  const checks = [
    ...(freshness ? [{ rule: freshness, keyHash: await hashRateLimitKey(env, `room:${roomId}`) }] : []),
    ...(actorUserId ? [{ rule: userRule, keyHash: await hashRateLimitKey(env, `user:${actorUserId}`) }] : []),
  ];
  if (checks.length === 0) return { freshnessSlot: null };
  const { ids, limitedBy } = await takeRateLimitSlots(env, checks);
  if (!limitedBy) return { freshnessSlot: freshness ? ids[0] : null };
  if (limitedBy === freshness || mode === 'use-stored') return null;
  throw new HttpError(429, 'Too many ownership checks. Please wait a few minutes and try again.');
}
