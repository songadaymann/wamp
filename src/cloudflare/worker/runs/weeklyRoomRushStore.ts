import { parseRoomId } from '../../../persistence/roomModel';
import { globalLeaderboardWeek } from '../../../runs/globalLeaderboardWindow';
import {
  WEEKLY_ROOM_RUSH_LIMIT_MS,
  type WeeklyRoomRushAdminResponse,
  type WeeklyRoomRushPeriod,
  type WeeklyRoomRushPick,
} from '../../../runs/weeklyRoomRush';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { loadPublishedExpandedRoomMembershipsInBounds } from '../expandedRooms/store';
import { getUtcWeekKey } from '../progression/shared';
import { loadPublishedRoom } from '../rooms/store';

export interface RoomRushWeekRow {
  week_key: string; starts_at: string; ends_at: string;
  start_room_id: string; start_x: number; start_y: number;
  room_version: number; room_title: string; locked_at: string | null;
}

export function weeklyRoomRushPeriod(now = new Date()): WeeklyRoomRushPeriod {
  return { weekKey: getUtcWeekKey(now.toISOString()), ...globalLeaderboardWeek(now) };
}

export async function loadRoomRushWeek(env: Env, weekKey: string): Promise<RoomRushWeekRow | null> {
  return env.DB.prepare('SELECT * FROM room_rush_weeks WHERE week_key = ?').bind(weekKey).first<RoomRushWeekRow>();
}

async function standalonePublishedRoom(env: Env, roomId: string) {
  const coordinates = parseRoomId(roomId);
  if (!coordinates || Math.abs(coordinates.x) > 999999 || Math.abs(coordinates.y) > 999999) {
    throw new HttpError(400, 'Enter room coordinates as x,y.');
  }
  const room = await loadPublishedRoom(env, roomId, coordinates);
  if (!room || room.status !== 'published') throw new HttpError(400, 'Choose a published standalone room.');
  const memberships = await loadPublishedExpandedRoomMembershipsInBounds(env, coordinates.x, coordinates.x, coordinates.y, coordinates.y);
  if (memberships.some(entry => entry.roomId === roomId)) throw new HttpError(400, 'Choose a standalone room outside an Expanded Room.');
  return room;
}

export async function mapRoomRushWeekPick(env: Env, row: RoomRushWeekRow, now = new Date()): Promise<WeeklyRoomRushPick> {
  let unavailableReason: string | null = null;
  try {
    const room = await standalonePublishedRoom(env, row.start_room_id);
    if (room.version !== row.room_version) unavailableReason = 'The weekly start room was updated. This event is paused.';
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    unavailableReason = 'The weekly start room is unavailable. This event is paused.';
  }
  if (!unavailableReason && Date.parse(row.ends_at) - now.getTime() < WEEKLY_ROOM_RUSH_LIMIT_MS) {
    unavailableReason = 'This week is closing. The next Rush opens Monday at 00:00 UTC.';
  }
  return {
    roomId: row.start_room_id, coordinates: { x: row.start_x, y: row.start_y },
    roomVersion: row.room_version, title: row.room_title,
    available: unavailableReason === null, unavailableReason,
  };
}

export async function loadWeeklyRoomRushPick(env: Env, now = new Date()) {
  const period = weeklyRoomRushPeriod(now);
  const row = await loadRoomRushWeek(env, period.weekKey);
  return { period, row, pick: row ? await mapRoomRushWeekPick(env, row, now) : null };
}

function parseOpeningMonday(value: unknown, now: Date): WeeklyRoomRushPeriod {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'Choose an opening Monday.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) {
    throw new HttpError(400, 'The Rush must open on Monday at 00:00 UTC.');
  }
  const period = weeklyRoomRushPeriod(date), current = weeklyRoomRushPeriod(now);
  if (period.startsAt < current.startsAt || date.getTime() > Date.parse(current.startsAt) + 4 * 7 * 86400000) {
    throw new HttpError(400, 'Choose this week or one of the next four weeks.');
  }
  return period;
}

export async function saveWeeklyRoomRushPick(env: Env, body: { openingMonday?: unknown; roomId?: unknown }, now = new Date()): Promise<void> {
  const period = parseOpeningMonday(body.openingMonday, now);
  if (typeof body.roomId !== 'string' || body.roomId.length > 40 || !/^-?\d{1,6},-?\d{1,6}$/.test(body.roomId)) {
    throw new HttpError(400, 'Enter room coordinates as x,y.');
  }
  const room = await standalonePublishedRoom(env, body.roomId);
  const saved = await env.DB.prepare(`INSERT INTO room_rush_weeks
    (week_key,starts_at,ends_at,start_room_id,start_x,start_y,room_version,room_title,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(week_key) DO UPDATE SET
      start_room_id=excluded.start_room_id,start_x=excluded.start_x,start_y=excluded.start_y,
      room_version=excluded.room_version,room_title=excluded.room_title,updated_at=excluded.updated_at
    WHERE room_rush_weeks.locked_at IS NULL
    RETURNING week_key`).bind(period.weekKey, period.startsAt, period.endsAt, room.id, room.coordinates.x,
      room.coordinates.y, room.version, (room.title ?? room.id).slice(0, 100), now.toISOString()).first();
  if (!saved) throw new HttpError(409, 'This week’s room choice is locked because a ranked Rush has started. Choose a future week.');
}

export async function deleteWeeklyRoomRushPick(env: Env, openingMonday: unknown, now = new Date()): Promise<void> {
  const period = parseOpeningMonday(openingMonday, now);
  const locked = await env.DB.prepare('DELETE FROM room_rush_weeks WHERE week_key = ? AND locked_at IS NULL RETURNING week_key')
    .bind(period.weekKey).first();
  if (!locked && await loadRoomRushWeek(env, period.weekKey)) throw new HttpError(409, 'This week’s room choice is locked because a ranked Rush has started.');
}

export async function loadWeeklyRoomRushAdmin(env: Env, now = new Date()): Promise<WeeklyRoomRushAdminResponse> {
  const current = weeklyRoomRushPeriod(now), weeks: WeeklyRoomRushAdminResponse['weeks'] = [];
  for (let index = 0; index <= 4; index += 1) {
    const period = weeklyRoomRushPeriod(new Date(Date.parse(current.startsAt) + index * 7 * 86400000));
    const row = await loadRoomRushWeek(env, period.weekKey);
    weeks.push({ ...period, lockedAt: row?.locked_at ?? null, pick: row ? await mapRoomRushWeekPick(env, row, now) : null });
  }
  return { weeks, serverTime: now.toISOString() };
}
