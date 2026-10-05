import type { DailyPick, DailyResponse, DailyLeaderboardEntry } from '../../../daily/model';
import { DAILY_CLEAR_PXP } from '../../../daily/model';
import { normalizeRoomGoal } from '../../../goals/roomGoals';
import { normalizeCourseGoal } from '../../../courses/model';
import { getLeaderboardRankingMode } from '../../../runs/scoring';
import { getCourseLeaderboardRankingMode } from '../../../courses/scoring';
import type { Env } from '../core/types';
import { HttpError } from '../core/http';
import { sqlIsVerificationAccepted } from '../runs/verificationSql';
import { sqlUserIdIsNotLegacyGeneratedOnly, sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix } from '../generatedUsers/leaderboardIsolation';
import { DISCOVERY_RUN_METRICS_CTE } from '../playableContentIndex/runMetrics';
import { awardLaneDelta } from '../progression/laneEvents';

export interface DailyRow {
  date: string; target_key: string; target_type: 'room' | 'expanded_room'; content_id: string; version: number;
  room_id: string; room_version: number; room_x: number; room_y: number; title: string;
  builder_user_id: string; builder_display_name: string; goal_json: string; cell_count: number;
  legacy_course_id: string | null; picked_by: 'automatic' | 'admin'; picked_at: string;
}
interface Candidate extends DailyRow {
  quality: number | null; difficulty: string | null; staff: number; last_picked: string | null; builder_last_picked: string | null;
}
const currentPublished = `
  (i.target_type = 'room' AND r.published_json IS NOT NULL
    AND CAST(json_extract(r.published_json, '$.version') AS INTEGER) = i.version_key)
  OR (i.target_type = 'expanded_room' AND (e.published_json IS NOT NULL AND e.archived_at IS NULL
    AND e.published_version = i.version_key OR e.id IS NULL AND c.published_json IS NOT NULL AND c.published_version = i.version_key))`;
const publicBuilder = `NOT EXISTS (SELECT 1 FROM school_students WHERE user_id = i.builder_user_id)
  AND ${sqlUserIdIsNotLegacyGeneratedOnly('i.builder_user_id')}
  AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('i.builder_user_id')}
  AND NOT EXISTS (SELECT 1 FROM playable_content_index_members m JOIN world_room_claims w ON w.room_id = m.room_id
    WHERE m.target_key = i.target_key AND w.world_id <> 'wamp-prime')
  AND NOT EXISTS (SELECT 1 FROM world_room_claims w WHERE w.room_id = i.representative_room_id AND w.world_id <> 'wamp-prime')`;

export function dailyWindow(now: string): { date: string; start: string; end: string } {
  const parsed = new Date(now);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid daily clock.');
  const date = parsed.toISOString().slice(0, 10);
  const start = `${date}T00:00:00.000Z`;
  return { date, start, end: new Date(Date.parse(start) + 86400000).toISOString() };
}
function staffEmails(env: Env): string[] {
  return (env.CHAT_OWNER_EMAILS ?? env.ADMIN_REVIEW_EMAIL ?? '').split(/[\s,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean);
}
async function loadCandidates(env: Env, now: string, roomId?: string): Promise<Candidate[]> {
  const { date } = dailyWindow(now);
  const result = await env.DB.prepare(`WITH ${DISCOVERY_RUN_METRICS_CTE}
    SELECT ? AS date, i.target_key, i.target_type, i.content_id, i.version_key AS version,
      i.representative_room_id AS room_id, COALESCE(member.room_version, i.version_key) AS room_version,
      i.room_x, i.room_y, COALESCE(NULLIF(trim(i.title), ''), 'Untitled Level') AS title,
      i.builder_user_id, COALESCE(NULLIF(trim(i.builder_display_name), ''), 'Builder') AS builder_display_name,
      CASE i.target_type WHEN 'room' THEN json_extract(r.published_json, '$.goal')
        ELSE json_extract(COALESCE(e.published_json,c.published_json), '$.goal') END AS goal_json,
      i.cell_count, i.legacy_course_id, 'automatic' AS picked_by, ? AS picked_at,
      i.quality_adjusted_average AS quality,
      CASE WHEN i.difficulty_vote_count >= 3 THEN i.consensus_difficulty
        ELSE COALESCE(metrics.measured_difficulty, i.consensus_difficulty) END AS difficulty,
      EXISTS (SELECT 1 FROM json_each(?) WHERE lower(value) = lower(u.email)) AS staff,
      (SELECT MAX(date) FROM daily_rooms WHERE target_key = i.target_key AND date < ?) AS last_picked,
      (SELECT MAX(date) FROM daily_rooms WHERE builder_user_id = i.builder_user_id AND date < ?) AS builder_last_picked
    FROM playable_content_index i JOIN users u ON u.id = i.builder_user_id
    LEFT JOIN rooms r ON i.target_type = 'room' AND r.id = i.content_id
    LEFT JOIN expanded_rooms e ON i.target_type = 'expanded_room' AND e.id = i.content_id
    LEFT JOIN courses c ON i.target_type = 'expanded_room' AND c.id = i.legacy_course_id
    LEFT JOIN playable_content_index_members member ON member.target_key = i.target_key AND member.room_id = i.representative_room_id
    LEFT JOIN run_metrics metrics ON metrics.target_key = i.target_key AND metrics.version_key = i.version_key
    WHERE i.goal_type IS NOT NULL AND (${currentPublished}) AND ${publicBuilder}
      AND (? IS NULL OR i.representative_room_id = ? OR EXISTS
        (SELECT 1 FROM playable_content_index_members m WHERE m.target_key = i.target_key AND m.room_id = ?))
      AND (EXISTS (SELECT 1 FROM discovery_run_players players
        WHERE players.target_key = i.target_key AND players.version_key = i.version_key AND players.sampled_at IS NOT NULL
          AND ${sqlUserIdIsNotLegacyGeneratedOnly('players.user_id')}
          AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('players.user_id')})
        OR EXISTS (SELECT 1 FROM room_runs runs WHERE i.target_type = 'room' AND runs.room_id = i.content_id
          AND runs.room_version = i.version_key AND runs.result = 'completed' AND ${sqlIsVerificationAccepted('runs')}
          AND ${sqlUserIdIsNotLegacyGeneratedOnly('runs.user_id')} AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('runs.user_id')})
        OR EXISTS (SELECT 1 FROM expanded_room_runs runs WHERE i.target_type = 'expanded_room' AND runs.expanded_room_id = i.content_id
          AND runs.expanded_room_version = i.version_key AND runs.result = 'completed' AND ${sqlIsVerificationAccepted('runs')}
          AND ${sqlUserIdIsNotLegacyGeneratedOnly('runs.user_id')} AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('runs.user_id')})
        OR EXISTS (SELECT 1 FROM course_runs runs WHERE i.target_type = 'expanded_room' AND runs.course_id = i.legacy_course_id
          AND runs.course_version = i.version_key AND runs.result = 'completed' AND ${sqlIsVerificationAccepted('runs')}
          AND ${sqlUserIdIsNotLegacyGeneratedOnly('runs.user_id')} AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('runs.user_id')})
        OR EXISTS (SELECT 1 FROM guest_run_attempts runs WHERE runs.content_version = i.version_key
          AND (runs.content_type = i.target_type AND runs.content_id = i.content_id
            OR i.target_type = 'expanded_room' AND runs.content_type = 'course' AND runs.content_id = i.legacy_course_id)
          AND runs.result = 'completed' AND runs.verification_status = 'passed'))
    ORDER BY i.target_key`)
    .bind(new Date(Date.parse(now) - 14 * 86400000).toISOString(), date, now, JSON.stringify(staffEmails(env)), date, date,
      roomId ?? null, roomId ?? null, roomId ?? null).all<Candidate>();
  return result.results;
}
export function chooseDailyCandidate(candidates: Candidate[], date: string): Candidate | null {
  if (!candidates.length) return null;
  const cutoff = new Date(Date.parse(`${date}T00:00:00Z`) - 90 * 86400000).toISOString().slice(0, 10);
  const fresh = candidates.filter(candidate => !candidate.last_picked || candidate.last_picked < cutoff);
  // If the pool is smaller than 90 levels, rotate the oldest pick instead of leaving days empty.
  const oldest = candidates.reduce((value, row) => row.last_picked && row.last_picked < value ? row.last_picked : value, date);
  const pool = fresh.length ? fresh : candidates.filter(row => row.last_picked === oldest);
  const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  const builderCutoff = new Date(Date.parse(`${date}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const priority = (row: Candidate) => {
    let hash = 2166136261;
    for (const char of `${date}:${row.target_key}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    const difficultyWeight = (weekend ? row.difficulty === 'hard' : ['easy', 'medium'].includes(row.difficulty ?? '')) ? 3 : 1;
    const weight = (row.staff ? 1 : 8) * (row.quality ?? 3.5) / 3.5 * difficultyWeight
      * (row.builder_last_picked && row.builder_last_picked >= builderCutoff ? 0.25 : 1);
    return -Math.log((hash + 1) / 4294967297) / weight;
  };
  return [...pool].sort((left, right) => priority(left) - priority(right) || left.target_key.localeCompare(right.target_key))[0] ?? null;
}
export async function loadDailyRow(env: Env, date: string): Promise<DailyRow | null> {
  return env.DB.prepare('SELECT * FROM daily_rooms WHERE date = ?').bind(date).first<DailyRow>();
}
export async function ensureDailyPick(env: Env, now = new Date().toISOString()): Promise<DailyRow | null> {
  const { date } = dailyWindow(now);
  const existing = await loadDailyRow(env, date);
  if (existing) return existing;
  const candidate = chooseDailyCandidate(await loadCandidates(env, now), date);
  if (!candidate) return null;
  await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO daily_rooms
    (date,target_key,target_type,content_id,version,room_id,room_version,room_x,room_y,title,builder_user_id,builder_display_name,
      goal_json,cell_count,legacy_course_id,picked_by,picked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(candidate.date,candidate.target_key,candidate.target_type,candidate.content_id,candidate.version,candidate.room_id,
      candidate.room_version,candidate.room_x,candidate.room_y,candidate.title,candidate.builder_user_id,candidate.builder_display_name,
      candidate.goal_json,candidate.cell_count,candidate.legacy_course_id,'automatic',now), ...featureStatements(env, date)]);
  // Read the winning row, not this request's candidate, after concurrent first visits.
  return loadDailyRow(env, date);
}
function featureStatements(env: Env, date: string) {
  return [env.DB.prepare(`INSERT INTO featured_rooms (room_id,room_version,featured_at,target_key,target_version)
    SELECT room_id,room_version,picked_at,target_key,version FROM daily_rooms WHERE date = ?
    ON CONFLICT(room_id) DO UPDATE SET room_version=excluded.room_version,featured_at=excluded.featured_at,
      target_key=excluded.target_key,target_version=excluded.target_version`).bind(date),
  env.DB.prepare(`UPDATE playable_content_index SET featured_at = (SELECT picked_at FROM daily_rooms WHERE date = ?)
    WHERE target_key = (SELECT target_key FROM daily_rooms WHERE date = ?)
      AND version_key = (SELECT version FROM daily_rooms WHERE date = ?)`).bind(date,date,date)];
}
export async function dailyPickAvailable(env: Env, row: DailyRow): Promise<boolean> {
  const live = await env.DB.prepare(`SELECT 1 AS found FROM playable_content_index i
    LEFT JOIN rooms r ON i.target_type = 'room' AND r.id = i.content_id
    LEFT JOIN expanded_rooms e ON i.target_type = 'expanded_room' AND e.id = i.content_id
    LEFT JOIN courses c ON i.target_type = 'expanded_room' AND c.id = i.legacy_course_id
    WHERE i.target_key = ? AND i.version_key = ? AND (${currentPublished}) AND ${publicBuilder}`)
    .bind(row.target_key,row.version).first<{ found: number }>();
  return Boolean(live);
}
function mapPick(row: DailyRow, available: boolean): DailyPick {
  return { date: row.date, targetKey: row.target_key, contentType: row.target_type, contentId: row.content_id,
    version: row.version, roomId: row.room_id, roomVersion: row.room_version, coordinates: { x: row.room_x, y: row.room_y },
    title: row.title, builderUserId: row.builder_user_id, builderDisplayName: row.builder_display_name,
    cellCount: row.cell_count, legacyCourseId: row.legacy_course_id,
    playPath: `/r/${row.room_x}/${row.room_y}?from=share&daily=${row.date}`, available };
}
/** One public best run per signed-in player; guest claims remain unranked. */
export function dailyRunsSql(): string {
  const signed = (table: string, type: string, id: string, version: string) => `
    SELECT runs.attempt_id, runs.user_id, users.display_name, runs.elapsed_ms, runs.deaths, runs.score, runs.finished_at
    FROM ${table} runs JOIN users ON users.id = runs.user_id JOIN daily_rooms d
      ON d.date = ? AND d.target_type = '${type}' AND (${id}) AND runs.${version} = d.version
    WHERE runs.result = 'completed' AND runs.elapsed_ms IS NOT NULL AND runs.finished_at >= ? AND runs.finished_at < ?
      AND ${sqlIsVerificationAccepted('runs')}
      AND ${sqlUserIdIsNotLegacyGeneratedOnly('runs.user_id')} AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('runs.user_id')}
      AND NOT EXISTS (SELECT 1 FROM school_students WHERE user_id = runs.user_id)`;
  return [signed('room_runs','room','runs.room_id = d.content_id','room_version'),
    signed('expanded_room_runs','expanded_room','runs.expanded_room_id = d.content_id','expanded_room_version'),
    signed('course_runs','expanded_room','runs.course_id = d.legacy_course_id','course_version')].join(' UNION ALL ');
}
function runBindings(row: DailyRow): string[] {
  const window = dailyWindow(row.picked_at);
  return Array.from({ length: 3 }, () => [row.date, window.start, window.end]).flat();
}
export async function loadDailyResponse(env: Env, userId: string | null, now = new Date().toISOString()): Promise<DailyResponse> {
  const window = dailyWindow(now);
  const row = await ensureDailyPick(env, now);
  const cutoff = new Date(Date.parse(window.start) - 6 * 86400000).toISOString().slice(0,10);
  const history = await env.DB.prepare('SELECT date,target_type,content_id,version,legacy_course_id FROM daily_rooms WHERE date >= ? AND date <= ? ORDER BY date DESC')
    .bind(cutoff,window.date).all<DailyRow>();
  const completed = userId ? await env.DB.prepare(`SELECT COUNT(DISTINCT source_id) AS count, MAX(source_id = ?) AS today
    FROM pxp_events WHERE user_id = ? AND event_type = 'daily_clear' AND source_id >= ? AND source_id <= ?`)
    .bind(window.date,userId,cutoff,window.date).first<{ count: number; today: number | null }>() : null;
  let rankingMode: 'time' | 'score' = 'time';
  let leaderboard: DailyLeaderboardEntry[] = [], viewerRank: number | null = null;
  const available = row ? await dailyPickAvailable(env,row) : false;
  if (row) {
    const rawGoal: unknown = JSON.parse(row.goal_json);
    const roomGoal = row.target_type === 'room' ? normalizeRoomGoal(rawGoal) : null;
    const courseGoal = row.target_type === 'expanded_room' ? normalizeCourseGoal(rawGoal) : null;
    if (roomGoal) rankingMode = getLeaderboardRankingMode(roomGoal);
    else if (courseGoal) rankingMode = getCourseLeaderboardRankingMode(courseGoal);
    const order = roomGoal?.type === 'npc_quest' && roomGoal.questType === 'protect'
      ? 'elapsed_ms DESC, deaths ASC, finished_at ASC, attempt_id ASC'
      : rankingMode === 'time' ? 'elapsed_ms ASC, deaths ASC, score DESC, finished_at ASC, attempt_id ASC'
        : 'score DESC, deaths ASC, elapsed_ms ASC, finished_at ASC, attempt_id ASC';
    const rows = await env.DB.prepare(`WITH accepted AS (${dailyRunsSql()}), best AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ${order}) AS player_row FROM accepted), ranked AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY ${order}) AS rank FROM best WHERE player_row = 1)
      SELECT * FROM ranked WHERE rank <= 10 OR user_id = ? ORDER BY rank`)
      .bind(...runBindings(row),userId).all<{ rank: number; user_id: string; display_name: string; elapsed_ms: number; deaths: number; score: number }>();
    leaderboard = rows.results.filter(value => value.rank <= 10).map(value => ({ rank: value.rank,userId:value.user_id,
      displayName:value.display_name,elapsedMs:value.elapsed_ms,deaths:value.deaths,score:value.score }));
    viewerRank = rows.results.find(value => value.user_id === userId)?.rank ?? null;
  }
  return { date:window.date,resetsAt:window.end,pick: row ? mapPick(row,available) : null,rankingMode,leaderboard,
    recentPicks:history.results.map(value=>({date:value.date,contentType:value.target_type,contentId:value.content_id,
      version:value.version,legacyCourseId:value.legacy_course_id})),
    viewer:userId ? {completed:Boolean(completed?.today),completedLast7:completed?.count ?? 0,rank:viewerRank} : null,bonusPxp:DAILY_CLEAR_PXP };
}
export async function overrideDailyPick(env: Env, roomId: string, now = new Date().toISOString()): Promise<void> {
  const { date, start, end } = dailyWindow(now);
  const candidate = (await loadCandidates(env,now,roomId))[0];
  if (!candidate) throw new HttpError(409,'Choose a public published goal level with a verified clear.');
  // No arbitrary dates or versions: overrides apply to today, before anyone starts a challenge run.
  const locked = `EXISTS (SELECT 1 FROM room_runs runs JOIN daily_rooms d ON d.date = ? AND d.target_type = 'room'
    AND runs.room_id = d.content_id AND runs.room_version = d.version WHERE runs.started_at >= ? AND runs.started_at < ?)
    OR EXISTS (SELECT 1 FROM expanded_room_runs runs JOIN daily_rooms d ON d.date = ? AND d.target_type = 'expanded_room'
      AND runs.expanded_room_id = d.content_id AND runs.expanded_room_version = d.version WHERE runs.started_at >= ? AND runs.started_at < ?)
    OR EXISTS (SELECT 1 FROM course_runs runs JOIN daily_rooms d ON d.date = ? AND d.target_type = 'expanded_room'
      AND runs.course_id = d.legacy_course_id AND runs.course_version = d.version WHERE runs.started_at >= ? AND runs.started_at < ?)
    OR EXISTS (SELECT 1 FROM guest_run_attempts runs JOIN daily_rooms d ON d.date = ? AND runs.content_version = d.version
      AND (runs.content_type = d.target_type AND runs.content_id = d.content_id
        OR d.target_type = 'expanded_room' AND runs.content_type = 'course' AND runs.content_id = d.legacy_course_id)
      WHERE runs.started_at >= ? AND runs.started_at < ?)`;
  const values = [candidate.date,candidate.target_key,candidate.target_type,candidate.content_id,candidate.version,candidate.room_id,
    candidate.room_version,candidate.room_x,candidate.room_y,candidate.title,candidate.builder_user_id,candidate.builder_display_name,
    candidate.goal_json,candidate.cell_count,candidate.legacy_course_id,'admin',now];
  const result = await env.DB.prepare(`INSERT INTO daily_rooms
    (date,target_key,target_type,content_id,version,room_id,room_version,room_x,room_y,title,builder_user_id,builder_display_name,
      goal_json,cell_count,legacy_course_id,picked_by,picked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET target_key=excluded.target_key,target_type=excluded.target_type,content_id=excluded.content_id,
      version=excluded.version,room_id=excluded.room_id,room_version=excluded.room_version,room_x=excluded.room_x,room_y=excluded.room_y,
      title=excluded.title,builder_user_id=excluded.builder_user_id,builder_display_name=excluded.builder_display_name,
      goal_json=excluded.goal_json,cell_count=excluded.cell_count,legacy_course_id=excluded.legacy_course_id,
      picked_by='admin',picked_at=excluded.picked_at,notice_sent_at=NULL,notice_attempts=0,
      notice_lease_token=NULL,notice_lease_until=NULL,notice_last_error=NULL
    WHERE NOT (${locked}) AND daily_rooms.notice_attempts = 0 AND daily_rooms.notice_sent_at IS NULL AND daily_rooms.notice_lease_token IS NULL RETURNING date`)
    .bind(...values,...Array.from({length:4},()=>[date,start,end]).flat()).first<{ date: string }>();
  if (!result) throw new HttpError(409,'Today’s challenge has already started or its builder has been notified. Choose tomorrow’s pick after midnight UTC.');
  await env.DB.batch(featureStatements(env,date));
}
export async function awardDailyClear(env: Env, userId: string, type: 'room' | 'course', id: string, version: number, completedAt: string): Promise<number> {
  const { date } = dailyWindow(completedAt);
  const row = await env.DB.prepare(`SELECT date FROM daily_rooms WHERE date = ? AND version = ?
    AND (? = 'room' AND target_type = 'room' AND content_id = ?
      OR ? = 'course' AND target_type = 'expanded_room' AND (content_id = ? OR legacy_course_id = ?))`)
    .bind(date,version,type,id,type,id,id).first<{date:string}>();
  if (!row) return 0;
  return awardLaneDelta(env,userId,'pxp','daily_clear','daily_room',date,`pxp:daily_clear:${userId}:${date}`,DAILY_CLEAR_PXP,completedAt);
}
