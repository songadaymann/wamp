import type { ActivityFeedResponse, ActivityPreferences, ActivityResponse, BuilderActivity, GuestActivityResponse } from '../../../activity/model';
import { activityGuestName } from '../../../activity/guestName';
import type { D1DatabaseSession } from '../core/types';
import { sqlUserIdIsNotLegacyGeneratedOnly } from '../generatedUsers/leaderboardIsolation';
import { HttpError } from '../core/http';

export interface PreferenceRow {
  user_id: string; seen_id: number; weekly_digest: number; dethrone_alerts: number;
  digest_enabled_at: string | null; dethrone_enabled_at: string | null; unsubscribe_secret: string;
  daily_features?: number; daily_enabled_at?: string | null;
}
interface ActivityRow {
  id: number; kind: BuilderActivity['kind']; actor_name: string; actor_user_id: string; source_kind: string; content_title: string | null;
  content_version: number; x: number | null; y: number | null; quality_stars: number | null; created_at: string;
}
// Both feeds exclude removed awards, moderated comments and unpublished targets.
const CONTENT_VISIBLE = `${sqlUserIdIsNotLegacyGeneratedOnly('a.actor_user_id')}
  AND (e.id IS NULL OR e.archived_at IS NULL)
  AND (r.published_json IS NOT NULL OR c.published_json IS NOT NULL OR e.published_json IS NOT NULL)`;
const PUBLIC_SOURCE = `(a.source_kind = 'bxp' AND EXISTS (SELECT 1 FROM bxp_events WHERE id = a.source_id)
    OR a.source_kind = 'pxp' AND EXISTS (SELECT 1 FROM pxp_events WHERE id = a.source_id)
    OR a.source_kind = 'comment' AND EXISTS (SELECT 1 FROM room_comments WHERE id = a.source_id AND status = 'approved')
    OR a.source_kind = 'guest')`;
const PUBLIC_VISIBLE = `${CONTENT_VISIBLE} AND ${PUBLIC_SOURCE}`;
// Edits by other builders are a private notice for the room's claimer, never public activity.
const VISIBLE = `a.recipient_user_id = ? AND ${CONTENT_VISIBLE} AND (${PUBLIC_SOURCE}
    OR a.source_kind = 'edit' AND EXISTS (SELECT 1 FROM room_versions WHERE room_id = a.content_id AND version = a.content_version))`;
const ROOM_VISIBLE = `${VISIBLE} AND COALESCE(rv.published_by_user_id, ev.published_by_user_id,
  cv.published_by_user_id, r.last_published_by_user_id, r.claimer_user_id, e.owner_user_id, c.owner_user_id) = a.recipient_user_id`;
const JOINS = `FROM builder_activity a
  LEFT JOIN users actor ON actor.id = a.actor_user_id
  LEFT JOIN rooms r ON a.content_type = 'room' AND r.id = a.content_id
  LEFT JOIN room_versions rv ON rv.room_id = r.id AND rv.version = a.content_version
  LEFT JOIN courses c ON a.content_type = 'course' AND c.id = a.content_id
  LEFT JOIN course_versions cv ON cv.course_id = c.id AND cv.version = a.content_version
  LEFT JOIN expanded_rooms e ON
    (a.content_type = 'expanded_room' AND e.id = a.content_id)
    OR (a.content_type = 'course' AND (e.legacy_course_id = a.content_id OR e.id = 'course:' || a.content_id OR e.id = a.content_id))
  LEFT JOIN expanded_room_versions ev ON ev.expanded_room_id = e.id AND ev.version = a.content_version`;
const SELECT = `SELECT a.id, a.kind, a.actor_user_id, a.source_kind, COALESCE(actor.display_name, 'Player') AS actor_name,
  COALESCE(rv.title, ev.title, cv.title, r.published_title, e.published_title, c.published_title) AS content_title,
  a.content_version, COALESCE(r.x, e.anchor_x, (SELECT room_x FROM course_room_refs WHERE course_id = c.id AND course_version = a.content_version ORDER BY room_order LIMIT 1)) AS x,
  COALESCE(r.y, e.anchor_y, (SELECT room_y FROM course_room_refs WHERE course_id = c.id AND course_version = a.content_version ORDER BY room_order LIMIT 1)) AS y,
  a.quality_stars, a.created_at ${JOINS}`;

export function emailActivityExistsSql(kind?: 'dethroned'): string {
  return `EXISTS (SELECT 1 ${JOINS} WHERE ${VISIBLE.replace('a.recipient_user_id = ?', 'a.recipient_user_id = p.user_id')}
    AND a.created_at >= ? AND a.created_at > ${kind ? 'p.dethrone_enabled_at' : 'p.digest_enabled_at'} AND a.created_at < ?
    ${kind ? "AND a.kind = 'dethroned' AND a.id > COALESCE((SELECT MAX(latest_activity_id) FROM builder_activity_emails WHERE user_id = p.user_id AND kind = 'dethroned'), 0)" : ''})`;
}

async function mapEntry(row: ActivityRow, seenId: number): Promise<BuilderActivity> {
  return { id: row.id, kind: row.kind, actorName: row.source_kind === 'guest' ? await activityGuestName(row.actor_user_id) : row.actor_name,
    ...(row.source_kind === 'guest' ? { guestActivityRef: row.id } : {}),
    contentTitle: row.content_title?.trim() || 'Untitled Room',
    contentVersion: row.content_version, contentPath: row.x === null || row.y === null ? '/?activity=1' : `/r/${row.x}/${row.y}`,
    qualityStars: row.quality_stars, createdAt: row.created_at, unread: row.id > seenId };
}
export async function loadActivityPreferences(db: D1DatabaseSession, userId: string): Promise<PreferenceRow> {
  await db.prepare(`INSERT OR IGNORE INTO builder_activity_preferences (user_id, unsubscribe_secret, updated_at) VALUES (?, ?, ?)`)
    .bind(userId, crypto.randomUUID() + crypto.randomUUID(), new Date().toISOString()).all();
  const row = await db.prepare('SELECT * FROM builder_activity_preferences WHERE user_id = ?').bind(userId).first<PreferenceRow>();
  if (!row) throw new Error('Activity preferences unavailable.');
  return row;
}
export function publicPreferences(row: PreferenceRow, emailAvailable: boolean): ActivityPreferences {
  return { weeklyDigest: row.weekly_digest === 1, dethroneAlerts: row.dethrone_alerts === 1, dailyFeatures: row.daily_features === 1, emailAvailable };
}
export async function loadActivity(db: D1DatabaseSession, userId: string, emailAvailable: boolean, before?: number,
  scope: 'inbox' | 'rooms' = 'inbox'): Promise<ActivityResponse> {
  const visible = scope === 'rooms' ? ROOM_VISIBLE : VISIBLE;
  const prefs = await loadActivityPreferences(db, userId);
  const counts = await db.prepare(`SELECT COALESCE(MAX(a.id), 0) AS latest_id,
    SUM(CASE WHEN a.id > ? THEN 1 ELSE 0 END) AS unread_count ${JOINS} WHERE ${visible}`)
    .bind(prefs.seen_id, userId).first<{ latest_id: number; unread_count: number | null }>();
  // Cap at the response watermark so events arriving during pagination remain unread.
  const rows = await db.prepare(`${SELECT} WHERE ${visible} AND a.id <= ? AND a.id < ? ORDER BY a.id DESC LIMIT 31`)
    .bind(userId, counts?.latest_id ?? 0, before ?? Number.MAX_SAFE_INTEGER).all<ActivityRow>();
  const entries = await Promise.all(rows.results.slice(0, 30).map(row => mapEntry(row, prefs.seen_id)));
  return { entries, latestId: counts?.latest_id ?? 0, unreadCount: counts?.unread_count ?? 0,
    nextBefore: rows.results.length > 30 ? entries.at(-1)?.id ?? null : null, preferences: publicPreferences(prefs, emailAvailable) };
}
/** One public fact per event; a top-1 change also has a private dethrone recipient. */
export async function loadAllActivity(db: D1DatabaseSession, before?: number): Promise<ActivityFeedResponse> {
  return loadPublicActivity(db, before);
}
/** Resolve only an already-public guest event, without exposing its browser identity. */
export async function loadGuestActivity(db: D1DatabaseSession, activityRef: number, before?: number): Promise<GuestActivityResponse> {
  const actor = await db.prepare(`SELECT a.actor_user_id ${JOINS}
    WHERE a.id = ? AND a.source_kind = 'guest' AND ${PUBLIC_VISIBLE} LIMIT 1`)
    .bind(activityRef).first<{ actor_user_id: string }>();
  if (!actor) throw new HttpError(404, 'Guest activity not found.');
  const feed = await loadPublicActivity(db, before, actor.actor_user_id);
  return { ...feed, guestName: await activityGuestName(actor.actor_user_id) };
}
async function loadPublicActivity(db: D1DatabaseSession, before?: number, guestUserId?: string): Promise<ActivityFeedResponse> {
  const rows = await db.prepare(`${SELECT} WHERE ${PUBLIC_VISIBLE}
    ${guestUserId ? "AND a.source_kind = 'guest' AND a.actor_user_id = ?" : ''} AND a.id < ?
    AND (a.kind <> 'dethroned' OR NOT EXISTS (
      SELECT 1 FROM builder_activity duplicate WHERE duplicate.dedupe_key = 'pxp:top1:' || a.source_id
    )) ORDER BY a.id DESC LIMIT 31`)
    .bind(...(guestUserId ? [guestUserId, before ?? Number.MAX_SAFE_INTEGER] : [before ?? Number.MAX_SAFE_INTEGER])).all<ActivityRow>();
  const entries = await Promise.all(rows.results.slice(0, 30).map(row =>
    mapEntry({ ...row, kind: row.kind === 'dethroned' ? 'top1' : row.kind }, Number.MAX_SAFE_INTEGER)));
  return { entries, latestId: entries[0]?.id ?? 0,
    nextBefore: rows.results.length > 30 ? entries.at(-1)?.id ?? null : null };
}
export async function markActivitySeen(db: D1DatabaseSession, userId: string, id: number): Promise<void> {
  await loadActivityPreferences(db, userId);
  await db.prepare(`UPDATE builder_activity_preferences SET seen_id = MAX(seen_id, ?), updated_at = ?
    WHERE user_id = ? AND (? = 0 OR EXISTS (SELECT 1 FROM builder_activity WHERE recipient_user_id = ? AND id = ?))`)
    .bind(id, new Date().toISOString(), userId, id, userId, id).all();
}
export async function saveActivityPreferences(db: D1DatabaseSession, userId: string, prefs: Pick<ActivityPreferences, 'weeklyDigest' | 'dethroneAlerts' | 'dailyFeatures'>, now: string): Promise<void> {
  await loadActivityPreferences(db, userId);
  await db.batch([
    db.prepare(`UPDATE builder_activity_preferences SET
      digest_enabled_at = CASE WHEN ? = 1 AND weekly_digest = 0 THEN ? WHEN ? = 0 THEN NULL ELSE digest_enabled_at END,
      dethrone_enabled_at = CASE WHEN ? = 1 AND dethrone_alerts = 0 THEN ? WHEN ? = 0 THEN NULL ELSE dethrone_enabled_at END,
      weekly_digest = ?, dethrone_alerts = ?, updated_at = ? WHERE user_id = ?`)
      .bind(+prefs.weeklyDigest, now, +prefs.weeklyDigest, +prefs.dethroneAlerts, now, +prefs.dethroneAlerts,
        +prefs.weeklyDigest, +prefs.dethroneAlerts, now, userId),
    // Never revive a queued message from a previous opt-in period.
    db.prepare(`UPDATE builder_activity_emails SET cancelled_at = ? WHERE user_id = ? AND sent_at IS NULL
      AND (kind = 'digest' AND ? = 0 OR kind = 'dethroned' AND ? = 0)`)
      .bind(now, userId, +prefs.weeklyDigest, +prefs.dethroneAlerts),
  ]);
  if (prefs.dailyFeatures !== undefined) await db.prepare(`UPDATE builder_activity_preferences SET
    daily_enabled_at = CASE WHEN ? = 1 AND daily_features = 0 THEN ? WHEN ? = 0 THEN NULL ELSE daily_enabled_at END,
    daily_features = ?, updated_at = ? WHERE user_id = ?`)
    .bind(+prefs.dailyFeatures,now,+prefs.dailyFeatures,+prefs.dailyFeatures,now,userId).all();
}
export async function unsubscribeActivityEmail(db: D1DatabaseSession, userId: string, kind: 'digest' | 'dethroned' | 'daily', now: string): Promise<void> {
  const flag = kind === 'digest' ? 'weekly_digest' : kind === 'daily' ? 'daily_features' : 'dethrone_alerts';
  const enabledAt = kind === 'digest' ? 'digest_enabled_at' : kind === 'daily' ? 'daily_enabled_at' : 'dethrone_enabled_at';
  // Change only the signed scope. A concurrent opt-out for the other email must survive.
  await db.batch([
    db.prepare(`UPDATE builder_activity_preferences SET ${flag} = 0, ${enabledAt} = NULL, updated_at = ? WHERE user_id = ?`).bind(now, userId),
    db.prepare('UPDATE builder_activity_emails SET cancelled_at = ? WHERE user_id = ? AND kind = ? AND sent_at IS NULL').bind(now, userId, kind),
  ]);
}
export async function loadEmailActivity(db: D1DatabaseSession, userId: string, from: string, until: string, kind?: 'dethroned'): Promise<BuilderActivity[]> {
  const rows = await db.prepare(`${SELECT} WHERE ${VISIBLE} AND a.created_at >= ? AND a.created_at < ?
    ${kind ? "AND a.kind = 'dethroned'" : ''} ORDER BY a.id DESC LIMIT 100`)
    .bind(userId, from, until).all<ActivityRow>();
  return Promise.all(rows.results.map(row => mapEntry(row, 0)));
}
