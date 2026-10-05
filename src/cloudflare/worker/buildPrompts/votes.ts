import { sqlIsVerificationAccepted } from '../runs/verificationSql';

// Match the actual completed run, even when a rating uses an older lineage key.
// Expanded-room and legacy course bridges can write either rating table.
export function promptVoteSelect(table: 'room_ratings' | 'expanded_room_ratings' | 'course_ratings', source: string): string {
  const room = table === 'room_ratings';
  const expanded = table === 'expanded_room_ratings';
  const id = room ? 'room_id' : expanded ? 'expanded_room_id' : 'course_id';
  const match = room ? `entry.content_type = 'room' AND entry.content_id = ${source}.${id}`
    : `entry.content_type = 'expanded_room' AND (${source}.${id} = entry.content_id OR ${source}.${id} = entry.legacy_course_id)`;
  const accepted = room ? `EXISTS (SELECT 1 FROM room_runs run WHERE run.attempt_id = ${source}.completed_attempt_id
    AND run.room_id = entry.content_id AND run.room_version = entry.version AND run.user_id = ${source}.user_id
    AND run.result = 'completed' AND ${sqlIsVerificationAccepted('run')}
    AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)`
    : `(EXISTS (SELECT 1 FROM expanded_room_runs run WHERE run.attempt_id = ${source}.completed_attempt_id
      AND run.expanded_room_id = entry.content_id AND run.expanded_room_version = entry.version AND run.user_id = ${source}.user_id
      AND run.result = 'completed' AND ${sqlIsVerificationAccepted('run')}
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)
    OR EXISTS (SELECT 1 FROM course_runs run WHERE run.attempt_id = ${source}.completed_attempt_id
      AND (run.course_id = entry.content_id OR run.course_id = entry.legacy_course_id) AND run.course_version = entry.version
      AND run.user_id = ${source}.user_id AND run.result = 'completed' AND ${sqlIsVerificationAccepted('run')}
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at))`;
  const from = source === 'NEW' ? '' : `FROM ${table} ${source}`;
  return `SELECT entry.prompt_slug, entry.target_key, entry.version, ${source}.user_id, ${source}.quality_stars,
    ${source}.trust_weight, ${source}.completed_attempt_id, ${source}.updated_at
    ${from} ${from ? 'JOIN' : 'FROM'} build_prompt_entries entry ${from ? 'ON' : 'WHERE'} ${match}
    ${from ? 'JOIN build_prompts prompt ON prompt.slug = entry.prompt_slug WHERE' : 'AND EXISTS (SELECT 1 FROM build_prompts prompt WHERE prompt.slug = entry.prompt_slug AND'}
    ${source}.quality_stars BETWEEN 1 AND 5 AND ${source}.trust_weight > 0
    AND ${source}.user_id <> entry.builder_user_id AND ${source}.completed_attempt_id IS NOT NULL
    AND ${source}.updated_at >= prompt.starts_at AND ${source}.updated_at < prompt.ends_at
    AND prompt.settled_at IS NULL
    AND ${accepted} ${from ? '' : ')'}`;
}
