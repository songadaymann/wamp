import type { GuestRunClearListResponse, GuestRunContentType } from '../../../guestRooms/runModel';
import type { Env } from '../core/types';
import { GUEST_RUN_RETENTION_MS } from './attempts';
import type { GuestRunIdentity } from './identity';

interface ClearRow {
  attempt_id: string; content_type: GuestRunContentType; content_id: string; content_title: string | null;
  content_version: number; finished_at: string; metrics_json: string;
}
async function listClears(env: Env, filter: string, values: string[], order: 'ASC' | 'DESC'): Promise<GuestRunClearListResponse> {
  const predicate = `result = 'completed' AND verification_status = 'passed' AND ${filter}`;
  const rows = await env.DB.prepare(`SELECT attempt_id, content_type, content_id, content_title, content_version,
    finished_at, metrics_json FROM guest_run_attempts WHERE ${predicate}
    ORDER BY finished_at ${order}, attempt_id ${order} LIMIT 50`).bind(...values).all<ClearRow>();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM guest_run_attempts WHERE ${predicate}`)
    .bind(...values).first<{ count: number }>();
  return { totalClears: total?.count ?? 0, clears: rows.results.map(row => {
    const metrics: { elapsedMs?: number; deaths?: number } = JSON.parse(row.metrics_json);
    return { attemptId: row.attempt_id, contentType: row.content_type, contentId: row.content_id, contentTitle: row.content_title,
      version: row.content_version, completedAt: row.finished_at, elapsedMs: metrics.elapsedMs ?? 0, deaths: metrics.deaths ?? 0 };
  }) };
}
export function listPendingGuestClears(env: Env, identity: GuestRunIdentity): Promise<GuestRunClearListResponse> {
  const now = new Date().toISOString();
  return listClears(env, `guest_user_id = ? AND recovery_token_hash = ? AND claim_id IS NULL AND finished_at >= ? AND expires_at > ?`,
    [identity.guestUserId, identity.recoveryTokenHash, new Date(Date.parse(now) - GUEST_RUN_RETENTION_MS).toISOString(), now], 'ASC');
}
export function listClaimedGuestClears(env: Env, userId: string): Promise<GuestRunClearListResponse> {
  return listClears(env, 'claimed_user_id = ?', [userId], 'DESC');
}
