import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { sqlUserIdIsNotLegacyGeneratedOnly, sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix } from '../generatedUsers/leaderboardIsolation';
import { loadRoomRushWeek, standalonePublishedRoom, type RoomRushWeekRow, weeklyRoomRushPeriod } from '../runs/weeklyRoomRushStore';

interface Candidate {
  room_id: string; room_version: number; x: number; y: number; title: string;
  quality: number | null; published_at: string | null; neighbors: number; staff: number;
  last_picked: string | null; builder_last_picked: string | null;
}

async function candidates(env: Env, startsAt: string): Promise<Candidate[]> {
  const staff = (env.CHAT_OWNER_EMAILS ?? env.ADMIN_REVIEW_EMAIL ?? '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const rows = await env.DB.prepare(`SELECT i.content_id AS room_id,i.version_key AS room_version,i.room_x AS x,i.room_y AS y,
    COALESCE(NULLIF(trim(i.title),''),i.content_id) AS title,i.quality_adjusted_average AS quality,i.published_at,
    EXISTS(SELECT 1 FROM json_each(?) WHERE lower(value)=lower(builder.email)) AS staff,
    (SELECT COUNT(*) FROM rooms neighbor WHERE neighbor.published_json IS NOT NULL
      AND ((neighbor.x=i.room_x-1 AND neighbor.y=i.room_y) OR (neighbor.x=i.room_x+1 AND neighbor.y=i.room_y)
        OR (neighbor.x=i.room_x AND neighbor.y=i.room_y-1) OR (neighbor.x=i.room_x AND neighbor.y=i.room_y+1))
      AND NOT EXISTS(SELECT 1 FROM world_room_claims w WHERE w.room_id=neighbor.id AND w.world_id<>'wamp-prime')) AS neighbors,
    (SELECT MAX(week.starts_at) FROM room_rush_weeks week WHERE week.start_room_id=i.content_id AND week.starts_at<?) AS last_picked,
    (SELECT MAX(week.starts_at) FROM room_rush_weeks week JOIN playable_content_index previous
      ON previous.target_type='room' AND previous.content_id=week.start_room_id
      WHERE previous.builder_user_id=i.builder_user_id AND week.starts_at<?) AS builder_last_picked
    FROM playable_content_index i JOIN rooms r ON r.id=i.content_id JOIN users builder ON builder.id=i.builder_user_id
    WHERE i.target_type='room' AND r.published_json IS NOT NULL
      AND CAST(json_extract(r.published_json,'$.version') AS INTEGER)=i.version_key
      AND NOT EXISTS(SELECT 1 FROM school_students WHERE user_id=i.builder_user_id)
      AND NOT EXISTS(SELECT 1 FROM world_room_claims w WHERE w.room_id=i.content_id AND w.world_id<>'wamp-prime')
      AND ${sqlUserIdIsNotLegacyGeneratedOnly('i.builder_user_id')}
      AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('i.builder_user_id')}
    ORDER BY i.content_id`).bind(JSON.stringify(staff),startsAt,startsAt).all<Candidate>();
  return rows.results;
}

export function rankAutomaticRushCandidates(rows: Candidate[], startsAt: string): Candidate[] {
  const repeatCutoff = new Date(Date.parse(startsAt) - 8 * 7 * 86400000).toISOString();
  const fresh = rows.filter(row => !row.last_picked || row.last_picked < repeatCutoff);
  const freshIds = new Set(fresh.map(row => row.room_id));
  const stableCutoff = new Date(Date.parse(startsAt) - 14 * 86400000).toISOString();
  const builderCutoff = new Date(Date.parse(startsAt) - 14 * 86400000).toISOString();
  const score = (row: Candidate) => {
    let hash = 2166136261;
    for (const char of `${startsAt}:${row.room_id}`) hash = Math.imul(hash ^ char.charCodeAt(0),16777619) >>> 0;
    const weight = (row.staff ? 1 : 8) * Math.max(1,row.quality ?? 3.5)
      * (row.neighbors >= 3 ? 4 : Math.max(1,row.neighbors))
      * (row.published_at && row.published_at < stableCutoff ? 4 : 1)
      * (row.builder_last_picked && row.builder_last_picked >= builderCutoff ? 0.25 : 1);
    return -Math.log((hash+1)/4294967297)/weight;
  };
  return [...rows].sort((a,b) => Number(!freshIds.has(a.room_id))-Number(!freshIds.has(b.room_id))
    || (!fresh.length ? (a.last_picked ?? '').localeCompare(b.last_picked ?? '') : 0)
    || score(a)-score(b) || a.room_id.localeCompare(b.room_id));
}

async function currentPickIsValid(env: Env, row: RoomRushWeekRow): Promise<boolean> {
  try { return (await standalonePublishedRoom(env,row.start_room_id)).version === row.room_version; }
  catch(error) { if(error instanceof HttpError) return false; throw error; }
}

export async function ensureAutomaticRush(env: Env, startsAt: string, now: string): Promise<boolean> {
  const period = weeklyRoomRushPeriod(new Date(startsAt));
  const row = await loadRoomRushWeek(env,period.weekKey);
  if (row && (row.picked_by !== 'automatic' || row.locked_at || await currentPickIsValid(env,row))) return false;
  if (await env.DB.prepare("SELECT 1 FROM weekly_event_suppressions WHERE event_kind='rush' AND starts_at=?").bind(startsAt).first()) return false;
  for (const candidate of rankAutomaticRushCandidates(await candidates(env,startsAt),startsAt)) {
    try {
      const room = await standalonePublishedRoom(env,candidate.room_id);
      if(room.version !== candidate.room_version) continue;
      const saved = await env.DB.prepare(`INSERT INTO room_rush_weeks
        (week_key,starts_at,ends_at,start_room_id,start_x,start_y,room_version,room_title,updated_at,picked_by)
        SELECT ?,?,?,?,?,?,?,?,?,'automatic'
        WHERE NOT EXISTS(SELECT 1 FROM weekly_event_suppressions WHERE event_kind='rush' AND starts_at=?)
        ON CONFLICT(week_key) DO UPDATE SET start_room_id=excluded.start_room_id,start_x=excluded.start_x,start_y=excluded.start_y,
          room_version=excluded.room_version,room_title=excluded.room_title,updated_at=excluded.updated_at
        WHERE room_rush_weeks.picked_by='automatic' AND room_rush_weeks.locked_at IS NULL
          AND room_rush_weeks.start_room_id=? AND room_rush_weeks.room_version=?
        RETURNING week_key`).bind(period.weekKey,startsAt,period.endsAt,room.id,room.coordinates.x,room.coordinates.y,
          room.version,(room.title ?? room.id).slice(0,100),now,startsAt,row?.start_room_id ?? null,row?.room_version ?? null).first();
      return saved !== null;
    } catch(error) { if(!(error instanceof HttpError)) throw error; }
  }
  return false;
}
