import { LOST_SONG_DAILY_XP_LIMIT, LOST_SONG_XP, type LostSongFindReceipt, type LostSongProgress } from '../../../lostSongs/model';
import type { Env } from '../core/types';
import { loadOrBackfillUserProgress } from '../progression/progressRows';
import { refreshProgressLevels } from '../progression/laneEvents';

export async function loadLostSongProgress(env: Env, userId: string, cursor = ''): Promise<LostSongProgress & { nextCursor: string | null }> {
  const [page, count] = await Promise.all([
    env.DB.prepare('SELECT room_id FROM user_lost_songs WHERE user_id = ? AND room_id > ? ORDER BY room_id LIMIT 513')
      .bind(userId, cursor).all<{ room_id: string }>(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM user_lost_songs WHERE user_id = ?').bind(userId).first<{ total: number }>(),
  ]);
  const rows = page.results ?? [];
  return { roomIds: rows.slice(0, 512).map(row => row.room_id), total: Number(count?.total ?? 0),
    nextCursor: rows.length > 512 ? rows[511].room_id : null };
}

/** The winning receipt, XP event and increment share one D1 transaction. Retries increment zero. */
export async function saveUserLostSong(env: Env, userId: string, find: { roomId: string; roomVersion: number; sessionId: string; foundAt: string }): Promise<LostSongFindReceipt> {
  await loadOrBackfillUserProgress(env, userId);
  const now = new Date().toISOString(), day = now.slice(0, 10), eventId = crypto.randomUUID();
  const eventKey = `pxp:lost_song:${userId}:${find.roomId}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO user_lost_songs
      (user_id,room_id,room_version,source_session_id,found_at,saved_at,xp_day,xp_amount)
      SELECT ?,?,?,?,?,?,?,CASE WHEN (SELECT COUNT(*) FROM user_lost_songs
        WHERE user_id = ? AND xp_day = ? AND xp_amount > 0) < ? THEN ? ELSE 0 END`)
      .bind(userId, find.roomId, find.roomVersion, find.sessionId, find.foundAt, now, day,
        userId, day, LOST_SONG_DAILY_XP_LIMIT, LOST_SONG_XP),
    env.DB.prepare(`INSERT OR IGNORE INTO pxp_events
      (id,user_id,event_type,source_type,source_id,dedupe_key,amount,breakdown_json,created_at)
      SELECT ?,?,'lost_song_found','room',?,?,xp_amount,NULL,? FROM user_lost_songs
      WHERE user_id = ? AND room_id = ? AND source_session_id = ? AND xp_amount > 0`)
      .bind(eventId, userId, find.roomId, eventKey, now, userId, find.roomId, find.sessionId),
    env.DB.prepare(`UPDATE user_progress SET total_pxp = total_pxp + COALESCE((SELECT amount FROM pxp_events WHERE id = ?),0),
      updated_at = ? WHERE user_id = ?`).bind(eventId, now, userId),
    ...[[1, 'player_first_lost_song'], [10, 'player_10_lost_songs'], [100, 'player_100_lost_songs']].map(([minimum, badge]) =>
      env.DB.prepare(`INSERT OR IGNORE INTO badge_awards(user_id,badge_id,source_type,source_id,metadata_json,awarded_at)
        SELECT ?,?,'lost_song',?,NULL,? WHERE (SELECT COUNT(*) FROM user_lost_songs WHERE user_id = ?) >= ?`)
        .bind(userId, badge, find.roomId, now, userId, minimum)),
  ]);
  const [saved, event] = await Promise.all([
    env.DB.prepare('SELECT found_at FROM user_lost_songs WHERE user_id = ? AND room_id = ?').bind(userId, find.roomId).first<{ found_at: string }>(),
    env.DB.prepare('SELECT amount FROM pxp_events WHERE id = ?').bind(eventId).first<{ amount: number }>(),
  ]);
  if (!saved) throw new Error('Lost Song receipt was not stored.');
  await refreshProgressLevels(env, userId);
  return { roomId: find.roomId, foundAt: saved.found_at, xp: Number(event?.amount ?? 0) };
}
