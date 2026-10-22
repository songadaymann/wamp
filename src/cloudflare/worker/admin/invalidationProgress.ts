import type { SuspiciousRunCase } from '../../../admin/model';
import type { D1PreparedStatement, Env } from '../core/types';
import { isExpandedRoomSchemaMissingError } from '../expandedRooms/schemaErrors';
import { loadQualifyingActivityBadges, revokeBadges } from '../progression/badgesTrophies';
import { refreshProgressLevels } from '../progression/laneEvents';
import { refreshRatedContentTrophy } from '../progression/ratings';

type Lane = 'pxp' | 'bxp' | 'cxp' | 'trust';
const LANE_TABLES: Record<Lane, string> = { pxp: 'pxp_events', bxp: 'bxp_events', cxp: 'cxp_events', trust: 'trust_events' };
const LANES = Object.keys(LANE_TABLES) as Lane[];

export interface ProgressRollbackEvent {
  lane: Lane;
  id: string;
  userId: string;
  amount: number;
  eventType: string;
}

export interface ProgressRollbackRating {
  contentId: string;
  versionKey: number;
  userId: string;
}

/** Everything the invalidated runs earned that no remaining accepted clear still supports. */
export interface ProgressRollback {
  events: ProgressRollbackEvent[];
  /** Room ratings only; Expanded Room ratings are left in place. */
  ratings: ProgressRollbackRating[];
  /** Activity badges each affected player qualified for before the rollback. */
  badgesBefore: Array<{ userId: string; badgeIds: string[] }>;
}

interface EventRow { id: string; user_id: string; amount: number | string; event_type: string }

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

async function selectEvents(env: Env, lane: Lane, where: string, values: unknown[]): Promise<ProgressRollbackEvent[]> {
  const rows = await env.DB.prepare(`SELECT id, user_id, amount, event_type FROM ${LANE_TABLES[lane]} WHERE ${where}`)
    .bind(...values)
    .all<EventRow>();
  return rows.results.map((row) => ({ lane, id: row.id, userId: row.user_id, amount: Number(row.amount), eventType: row.event_type }));
}

/** Expanded Room runs name the Expanded Room; their rewards use the legacy course id. */
async function resolveCourseRewardId(env: Env, sourceId: string): Promise<string> {
  try {
    const row = await env.DB.prepare('SELECT legacy_course_id FROM expanded_rooms WHERE id = ? LIMIT 1')
      .bind(sourceId).first<{ legacy_course_id: string | null }>();
    return row?.legacy_course_id ?? sourceId;
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) return sourceId;
    throw error;
  }
}

/** UTC days on which the player still has an accepted clear of this content, any version. */
async function remainingClearDays(
  env: Env,
  kind: 'room' | 'course',
  userId: string,
  sourceId: string,
  rewardId: string,
  excluded: string,
): Promise<Set<string>> {
  const queries = kind === 'room'
    ? [env.DB.prepare(`SELECT DISTINCT substr(finished_at, 1, 10) AS day FROM room_runs
        WHERE user_id = ? AND room_id = ? AND result = 'completed' AND verification_status IN ('not_required', 'passed')
          AND attempt_id NOT IN (SELECT value FROM json_each(?))`).bind(userId, rewardId, excluded)]
    : [env.DB.prepare(`SELECT DISTINCT substr(finished_at, 1, 10) AS day FROM course_runs
        WHERE user_id = ? AND course_id = ? AND result = 'completed' AND verification_status IN ('not_required', 'passed')
          AND attempt_id NOT IN (SELECT value FROM json_each(?))`).bind(userId, rewardId, excluded),
      env.DB.prepare(`SELECT DISTINCT substr(finished_at, 1, 10) AS day FROM expanded_room_runs
        WHERE user_id = ? AND expanded_room_id = ? AND result = 'completed'
          AND attempt_id NOT IN (SELECT value FROM json_each(?))`).bind(userId, sourceId, excluded)];
  // Verified guest clears a player later claimed earn the same first-clear reward.
  queries.push(env.DB.prepare(`SELECT DISTINCT substr(finished_at, 1, 10) AS day FROM guest_run_attempts
    WHERE claimed_user_id = ? AND progress_source_type = ? AND progress_source_id IN (?, ?)
      AND result = 'completed' AND verification_status = 'passed'`).bind(userId, kind, rewardId, sourceId));
  const days = new Set<string>();
  for (const query of queries) {
    try {
      for (const row of (await query.all<{ day: string | null }>()).results) if (row.day) days.add(row.day);
    } catch (error) {
      if (!isExpandedRoomSchemaMissingError(error)) throw error;
    }
  }
  return days;
}

/**
 * XP and trust events are keyed by content and version, not by run, so a run's rewards go only
 * when the player has no other accepted clear of that content left (any version, guest clears
 * included); personal-best and daily-room rewards also need no clear left that day. Rank rewards
 * name the run itself and always go. This never takes rewards a legitimate clear still earns, at
 * the cost of sometimes leaving some behind. Planned before the runs are deleted.
 */
export async function planProgressRollback(env: Env, runs: SuspiciousRunCase[]): Promise<ProgressRollback> {
  const excluded = JSON.stringify(runs.map((run) => run.attemptId));
  const events = new Map<string, ProgressRollbackEvent>();
  const ratings: ProgressRollbackRating[] = [];
  const add = (found: ProgressRollbackEvent[]) => { for (const event of found) events.set(`${event.lane}:${event.id}`, event); };
  const dedupeKeys: string[] = [];

  add(await selectEvents(env, 'pxp', `source_type IN ('room_attempt', 'course_attempt')
    AND source_id IN (SELECT value FROM json_each(?)) AND event_type IN ('top10_entry', 'top10_improve', 'top1_take')`, [excluded]));

  const groups = new Map<string, SuspiciousRunCase[]>();
  for (const run of runs) {
    const key = `${run.kind}\u0000${run.userId}\u0000${run.sourceId}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  for (const group of groups.values()) {
    const { kind, userId, sourceId } = group[0];
    const rewardId = kind === 'room' ? sourceId : await resolveCourseRewardId(env, sourceId);
    const days = await remainingClearDays(env, kind, userId, sourceId, rewardId, excluded);
    for (const run of group) {
      const day = run.finishedAt?.slice(0, 10);
      if (!day || days.has(day)) continue;
      dedupeKeys.push(`pxp:daily_${kind}_pb:${userId}:${rewardId}:${run.version}:${day}`);
      const daily = await env.DB.prepare(`SELECT 1 AS found FROM daily_rooms WHERE date = ?
        AND (target_type = 'room' AND ? = 'room' AND content_id = ?
          OR target_type = 'expanded_room' AND ? = 'course' AND (content_id = ? OR legacy_course_id = ?)) LIMIT 1`)
        .bind(day, kind, rewardId, kind, sourceId, rewardId).first<{ found: number }>();
      if (daily) dedupeKeys.push(`pxp:daily_clear:${userId}:${day}`);
    }
    if (days.size > 0) continue;
    for (const run of group) dedupeKeys.push(`pxp:${kind}_clear_first:${userId}:${rewardId}:${run.version}`);
    add(await selectEvents(env, 'trust', 'user_id = ? AND source_type = ? AND source_id IN (SELECT value FROM json_each(?))',
      [userId, `${kind}_attempt`, JSON.stringify(group.map((run) => run.attemptId))]));
    // The builder's unique-player rewards for this player, and (rooms) the ratings a clear unlocked.
    const creatorEventTypes = kind === 'room' ? ['unique_completion_room', 'unique_rating_room'] : ['unique_completion_course'];
    for (const lane of ['bxp', 'trust'] as const) {
      add(await selectEvents(env, lane, `event_type IN (SELECT value FROM json_each(?)) AND source_id LIKE ? ESCAPE '\\'`,
        [JSON.stringify(creatorEventTypes), `${likeEscape(rewardId)}:%:${likeEscape(userId)}`]));
    }
    if (kind !== 'room') continue;
    const rated = await env.DB.prepare('SELECT version_key FROM room_ratings WHERE room_id = ? AND user_id = ?')
      .bind(rewardId, userId)
      .all<{ version_key: number }>();
    for (const { version_key: versionKey } of rated.results) {
      ratings.push({ contentId: rewardId, versionKey, userId });
      for (const lane of ['pxp', 'cxp', 'trust'] as const) {
        add(await selectEvents(env, lane, 'user_id = ? AND event_type = ? AND source_id = ?',
          [userId, 'room_rating_submit', `${rewardId}:${versionKey}`]));
      }
    }
  }
  if (dedupeKeys.length > 0) {
    add(await selectEvents(env, 'pxp', 'dedupe_key IN (SELECT value FROM json_each(?))', [JSON.stringify(dedupeKeys)]));
  }

  const affected = new Set([...runs.map((run) => run.userId), ...[...events.values()].map((event) => event.userId)]);
  const badgesBefore = [];
  for (const userId of affected) badgesBefore.push({ userId, badgeIds: [...await loadQualifyingActivityBadges(env, userId)] });
  return { events: [...events.values()], ratings, badgesBefore };
}

/**
 * Runs in the same batch as the run deletes. Each total loses only the events still present
 * when the batch runs, so two overlapping invalidations cannot subtract the same reward twice.
 */
export function prepareProgressRollbackStatements(env: Env, rollback: ProgressRollback, now: string): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const users = new Set(rollback.events.map((event) => event.userId));
  for (const userId of users) {
    const ids = (lane: Lane) => JSON.stringify(rollback.events.filter((event) => event.lane === lane && event.userId === userId)
      .map((event) => event.id));
    const removed = (lane: Lane) => `(SELECT COALESCE(SUM(amount), 0) FROM ${LANE_TABLES[lane]}
      WHERE user_id = ? AND id IN (SELECT value FROM json_each(?)))`;
    statements.push(env.DB.prepare(`UPDATE user_progress SET total_pxp = MAX(0, total_pxp - ${removed('pxp')}),
      total_bxp = MAX(0, total_bxp - ${removed('bxp')}), total_cxp = MAX(0, total_cxp - ${removed('cxp')}),
      hidden_trust_score = MAX(0, hidden_trust_score - ${removed('trust')}), updated_at = ? WHERE user_id = ?`)
      .bind(userId, ids('pxp'), userId, ids('bxp'), userId, ids('cxp'), userId, ids('trust'), now, userId));
  }
  for (const lane of LANES) {
    const ids = rollback.events.filter((event) => event.lane === lane).map((event) => event.id);
    if (ids.length > 0) {
      statements.push(env.DB.prepare(`DELETE FROM ${LANE_TABLES[lane]} WHERE id IN (SELECT value FROM json_each(?))`)
        .bind(JSON.stringify(ids)));
    }
  }
  for (const rating of rollback.ratings) {
    statements.push(env.DB.prepare('DELETE FROM room_ratings WHERE room_id = ? AND version_key = ? AND user_id = ?')
      .bind(rating.contentId, rating.versionKey, rating.userId));
  }
  return statements;
}

/**
 * After the runs and stats are updated: levels, activity badges this rollback took below their
 * threshold (badges that had already lapsed for other reasons are left alone), and trophies.
 * Everything here can be recomputed, so a failure is logged rather than failing the admin action.
 */
export async function finishProgressRollback(env: Env, rollback: ProgressRollback): Promise<void> {
  try {
    for (const { userId, badgeIds } of rollback.badgesBefore) {
      await refreshProgressLevels(env, userId).catch(() => undefined);
      const after = await loadQualifyingActivityBadges(env, userId);
      await revokeBadges(env, userId, badgeIds.filter((badgeId) => !after.has(badgeId)));
    }
    const rated = new Map(rollback.ratings.map((rating) => [`${rating.contentId}:${rating.versionKey}`, rating]));
    for (const rating of rated.values()) {
      await refreshRatedContentTrophy(env, 'room', rating.contentId, rating.versionKey);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'invalidation-progress-finish-failed', error: error instanceof Error ? error.message : String(error) }));
  }
}

export function summarizeProgressRollback(rollback: ProgressRollback) {
  const xp = { pxp: 0, bxp: 0, cxp: 0, trust: 0 };
  for (const event of rollback.events) xp[event.lane] += event.amount;
  return { eventsRemoved: rollback.events.length, ratingsRemoved: rollback.ratings.length, ...xp };
}
