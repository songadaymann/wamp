import type { Env } from '../core/types';

const BATCH_LIMIT = 5000;
const PROCESSED_OUTBOX_RETENTION_MS = 7 * 86400000;
interface MutationResult { meta?: { changes?: number } }

export async function pruneExpiredRecords(env: Env, date = new Date()): Promise<void> {
  const now = date.toISOString();
  const processedBefore = new Date(date.getTime() - PROCESSED_OUTBOX_RETENTION_MS).toISOString();
  // Expiry indexes bound auth scans; the partial outbox index covers processed records.
  // Pending/dispatching work and records without a completed timestamp are retained.
  const results = await env.DB.batch<MutationResult>([
    env.DB.prepare(`DELETE FROM sessions WHERE id IN
      (SELECT id FROM sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)`).bind(now, BATCH_LIMIT),
    env.DB.prepare(`DELETE FROM magic_link_tokens WHERE id IN
      (SELECT id FROM magic_link_tokens WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)`).bind(now, BATCH_LIMIT),
    env.DB.prepare(`DELETE FROM world_render_tile_outbox WHERE id IN
      (SELECT id FROM world_render_tile_outbox WHERE state = 'dispatched' AND dispatched_at <= ?
        ORDER BY dispatched_at LIMIT ?)`).bind(processedBefore, BATCH_LIMIT),
    // An expired wallet approval can never be used again (F188).
    env.DB.prepare(`DELETE FROM wallet_challenges WHERE id IN
      (SELECT id FROM wallet_challenges WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)`).bind(now, BATCH_LIMIT),
  ]);
  console.log(JSON.stringify({ event: 'expired-records-pruned',
    sessions: results[0]?.meta?.changes ?? null, magicLinks: results[1]?.meta?.changes ?? null,
    processedOutbox: results[2]?.meta?.changes ?? null, walletChallenges: results[3]?.meta?.changes ?? null,
    batchLimit: BATCH_LIMIT }));
}
