import { HttpError } from '../core/http';
import type { Env } from '../core/types';

// Cutover only: a pre-release client may still hold an attempt present only in course_runs.
// Call only after authentication. Never rebind its nonce, snapshot, user, time or outcome.
export async function promoteLegacyCourseRun(env: Env, attemptId: string, userId: string): Promise<void> {
  const legacy = await env.DB.prepare('SELECT user_id FROM course_runs WHERE attempt_id = ? LIMIT 1')
    .bind(attemptId).first<{ user_id: string }>();
  if (!legacy) return;
  if (legacy.user_id !== userId) throw new HttpError(403, 'You can only finish your own expanded room run attempts.');
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO expanded_room_runs (
      attempt_id, expanded_room_id, expanded_room_version, goal_type, goal_json, user_id, user_display_name,
      started_at, finished_at, result, elapsed_ms, deaths, score, collectibles_collected, enemies_defeated,
      checkpoints_reached, legacy_course_attempt_id, verification_status, verification_reason,
      verification_nonce, verification_snapshot_hash, insight_deaths_json, insight_play_ms
    ) SELECT attempt_id, 'course:' || course_id, course_version, goal_type, goal_json, user_id, user_display_name,
      started_at, finished_at, result, elapsed_ms, deaths, score, collectibles_collected, enemies_defeated,
      checkpoints_reached, attempt_id, verification_status, verification_reason,
      verification_nonce, verification_snapshot_hash, insight_deaths_json, insight_play_ms
    FROM course_runs WHERE attempt_id = ? AND user_id = ?`).bind(attemptId, userId),
    settlementStatement(env, attemptId),
  ]);
}

// A rolling deployment can leave an old Worker finishing its course-only attempt after
// promotion. Reconcile only a still-active canonical row, never replace a winning outcome.
export async function reconcileLegacyCourseRun(env: Env, attemptId: string): Promise<void> {
  const fields = ['finished_at', 'result', 'elapsed_ms', 'deaths', 'score', 'collectibles_collected',
    'enemies_defeated', 'checkpoints_reached', 'verification_status', 'verification_reason',
    'insight_deaths_json', 'insight_play_ms'];
  await env.DB.batch([
    env.DB.prepare(`UPDATE expanded_room_runs SET (${fields.join(', ')}) = (
      SELECT ${fields.map(field => 'c.' + field).join(', ')} FROM course_runs c
      WHERE c.attempt_id = expanded_room_runs.legacy_course_attempt_id
        AND c.user_id = expanded_room_runs.user_id
    ) WHERE attempt_id = ? AND result = 'active' AND EXISTS (
      SELECT 1 FROM course_runs c WHERE c.attempt_id = expanded_room_runs.legacy_course_attempt_id
        AND c.user_id = expanded_room_runs.user_id AND c.result <> 'active'
    )`).bind(attemptId),
    settlementStatement(env, attemptId),
  ]);
}

export async function inheritLegacyCourseSettlement(env: Env, attemptId: string): Promise<void> {
  await env.DB.batch([settlementStatement(env, attemptId)]);
}

function settlementStatement(env: Env, attemptId: string) {
  return env.DB.prepare(`INSERT OR IGNORE INTO run_settlements (attempt_kind, attempt_id, settled_at)
    SELECT 'expanded_room', s.attempt_id, s.settled_at FROM run_settlements s
    JOIN course_runs c ON c.attempt_id = s.attempt_id
    JOIN expanded_room_runs e ON e.legacy_course_attempt_id = c.attempt_id AND e.user_id = c.user_id
    WHERE s.attempt_kind = 'course' AND s.attempt_id = ?`).bind(attemptId);
}
