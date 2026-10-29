import { normalizeChallengeAttemptId } from '../../../social/ghostChallengeLinks';
import type { GhostOption } from '../../../runs/ghostRace';
import type { Env } from '../core/types';
import { sqlUserIdIsNotLegacyGeneratedOnly } from '../generatedUsers/leaderboardIsolation';
import { loadArchivedRunGhost } from './ghostArchive';
import { sqlIsVerificationAccepted } from './verificationSql';

/** Opaque run IDs share public, verified movement only; personal-best lookup stays session-owned. */
export async function loadChallengeGhost(env: Env, roomId: string, equivalents: number[], value: string | null): Promise<GhostOption> {
  const attemptId = normalizeChallengeAttemptId(value);
  if (!attemptId) return {ghost:null,reason:'no_run'};
  // Check scope and current eligibility in D1 before spending an R2 read. An
  // archived account run stops working if removed/invalidated. Guest progress
  // expires after 14 days; its transactionally verified archive intentionally survives.
  const row = await env.DB.prepare(`SELECT a.room_version FROM run_ghost_archive a
    JOIN room_versions v ON v.room_id=a.room_id AND v.version=a.room_version
    WHERE a.attempt_id=? AND a.room_id=? AND v.redacted_at IS NULL
      AND ((a.source_kind='room' AND EXISTS(SELECT 1 FROM room_runs r
        WHERE r.attempt_id=a.attempt_id AND r.room_id=a.room_id AND r.room_version=a.room_version
          AND r.user_id=a.user_id AND r.result='completed' AND r.elapsed_ms=a.elapsed_ms
          AND ${sqlIsVerificationAccepted('r')}
          AND ${sqlUserIdIsNotLegacyGeneratedOnly('r.user_id')}
          AND NOT EXISTS(SELECT 1 FROM school_students s WHERE s.user_id=r.user_id)))
        OR (a.source_kind='guest_room' AND (NOT EXISTS(SELECT 1 FROM guest_run_attempts g WHERE g.attempt_id=a.attempt_id)
          OR EXISTS(SELECT 1 FROM guest_run_attempts g
          WHERE g.attempt_id=a.attempt_id AND g.content_type='room' AND g.content_id=a.room_id
            AND g.content_version=a.room_version AND g.result='completed' AND g.verification_status='passed'
            AND json_extract(g.metrics_json,'$.elapsedMs')=a.elapsed_ms))))`)
    .bind(attemptId,roomId).first<{room_version:number}>();
  if (!row) return {ghost:null,reason:'no_recording'};
  if (!equivalents.includes(row.room_version)) return {ghost:null,reason:'layout_changed'};
  try {
    const ghost=await loadArchivedRunGhost(env,attemptId);
    return {ghost,reason:ghost ? null : 'no_recording'};
  } catch { return {ghost:null,reason:'no_recording'}; }
}
