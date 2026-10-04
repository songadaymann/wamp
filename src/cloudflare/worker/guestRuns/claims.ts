import type { GuestRunClaimResponse } from '../../../guestRooms/runModel';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { loadOrBackfillUserProgress } from '../progression/progressRows';
import { refreshProgressLevels } from '../progression/laneEvents';
import { LANE_BASE_XP } from '../progression/shared';
import { GUEST_RUN_RETENTION_MS } from './attempts';
import type { GuestRunIdentity } from './identity';

interface ClaimRow {
  id: string; guest_user_id: string; recovery_token_hash: string; user_id: string;
  clear_count: number; pxp_awarded: number; applied: number;
}
const FRESH_CLAIM = `EXISTS (SELECT 1 FROM guest_run_claims WHERE id = ? AND user_id = ?
  AND guest_user_id = ? AND recovery_token_hash = ? AND applied = 0)`;
const ELIGIBLE = `guest_user_id = ? AND recovery_token_hash = ? AND claim_id IS NULL
  AND result = 'completed' AND verification_status = 'passed' AND finished_at >= ? AND expires_at > ?`;

export async function claimGuestRuns(env: Env, identity: GuestRunIdentity, userId: string, claimId: string): Promise<GuestRunClaimResponse> {
  const load = () => env.DB.prepare('SELECT * FROM guest_run_claims WHERE id = ?').bind(claimId).first<ClaimRow>();
  function requireOwner(row: ClaimRow): void {
    if (row.user_id !== userId || row.guest_user_id !== identity.guestUserId || row.recovery_token_hash !== identity.recoveryTokenHash) {
      throw new HttpError(409, 'This claim id belongs to another account or guest identity.');
    }
  }
  const existing = await load();
  if (existing) requireOwner(existing);
  const now = new Date().toISOString();
  const cutoff = new Date(Date.parse(now) - GUEST_RUN_RETENTION_MS).toISOString();
  const fresh = [claimId, userId, identity.guestUserId, identity.recoveryTokenHash];
  const eligible = [identity.guestUserId, identity.recoveryTokenHash, cutoff, now];
  if (!existing?.applied) {
    await loadOrBackfillUserProgress(env, userId);
    // D1 executes the whole batch transactionally. Either ownership, ledger, balance and
    // receipt are all saved, or none are. applied guards retries and competing tabs.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO guest_run_claims
        (id, guest_user_id, recovery_token_hash, user_id, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(claimId, identity.guestUserId, identity.recoveryTokenHash, userId, now),
      env.DB.prepare(`UPDATE guest_run_attempts SET claimed_user_id = ?, claim_id = ?, claimed_at = ?
        WHERE attempt_id IN (SELECT attempt_id FROM guest_run_attempts WHERE ${ELIGIBLE}
          ORDER BY finished_at, attempt_id LIMIT 50) AND ${FRESH_CLAIM}`)
        .bind(userId, claimId, now, ...eligible, ...fresh),
      env.DB.prepare(`INSERT OR IGNORE INTO pxp_events
        (id, user_id, event_type, source_type, source_id, dedupe_key, amount, breakdown_json, created_at)
        SELECT 'guest-claim:' || ? || ':' || attempt_id, ?, progress_source_type || '_clear_first', progress_source_type,
          progress_source_id || ':' || content_version,
          'pxp:' || progress_source_type || '_clear_first:' || ? || ':' || progress_source_id || ':' || content_version,
          CASE progress_source_type WHEN 'room' THEN ? ELSE ? END,
          json_object('guestClaimId', ?, 'guestAttemptId', attempt_id), finished_at
        FROM guest_run_attempts guest WHERE claim_id = ? AND claimed_user_id = ? AND ${FRESH_CLAIM}
          AND NOT EXISTS (SELECT 1 FROM room_runs ranked WHERE guest.progress_source_type = 'room'
            AND ranked.user_id = ? AND ranked.room_id = guest.progress_source_id
            AND ranked.room_version = guest.content_version AND ranked.result = 'completed')
          AND NOT EXISTS (SELECT 1 FROM course_runs ranked WHERE guest.progress_source_type = 'course'
            AND ranked.user_id = ? AND ranked.course_id = guest.progress_source_id
            AND ranked.course_version = guest.content_version AND ranked.result = 'completed')
        ORDER BY finished_at, attempt_id`)
        .bind(claimId, userId, userId, LANE_BASE_XP.roomClear, LANE_BASE_XP.courseClear, claimId,
          claimId, userId, ...fresh, userId, userId),
      env.DB.prepare(`UPDATE guest_run_claims SET clear_count = (SELECT COUNT(*) FROM guest_run_attempts WHERE claim_id = ? AND claimed_user_id = ?),
        pxp_awarded = (SELECT COALESCE(SUM(amount), 0) FROM pxp_events WHERE id LIKE ? AND user_id = ?)
        WHERE id = ? AND ${FRESH_CLAIM}`)
        .bind(claimId, userId, `guest-claim:${claimId}:%`, userId, claimId, ...fresh),
      env.DB.prepare(`UPDATE user_progress SET total_pxp = total_pxp +
        (SELECT pxp_awarded FROM guest_run_claims WHERE id = ?), updated_at = ?
        WHERE user_id = ? AND ${FRESH_CLAIM}`)
        .bind(claimId, now, userId, ...fresh),
      env.DB.prepare(`UPDATE guest_run_claims SET applied = 1 WHERE id = ? AND ${FRESH_CLAIM}`)
        .bind(claimId, ...fresh),
    ]);
  }
  const receipt = await load();
  if (!receipt) throw new Error('Guest claim receipt was not saved.');
  requireOwner(receipt);
  if (!receipt.applied) throw new Error('Guest claim did not finish.');
  await refreshProgressLevels(env, userId);
  const remaining = await env.DB.prepare(`SELECT COUNT(*) AS count FROM guest_run_attempts WHERE ${ELIGIBLE}`)
    .bind(...eligible).first<{ count: number }>();
  return { claimId, userId, clearsSaved: receipt.clear_count, pxpAwarded: receipt.pxp_awarded, remainingClears: remaining?.count ?? 0 };
}
