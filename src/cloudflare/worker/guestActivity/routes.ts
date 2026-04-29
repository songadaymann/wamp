import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';

type GuestActivityMode = 'browse' | 'play' | 'edit';

interface GuestActivityHeartbeatBody {
  sessionId?: unknown;
  guestUserId?: unknown;
  guestDisplayName?: unknown;
  mode?: unknown;
  path?: unknown;
  roomCoordinates?: unknown;
}

interface GuestVisitRow {
  last_seen_at: string | null;
  mode: string | null;
}

const MAX_TRACKED_DELTA_SECONDS = 60;

export async function handleGuestActivityHeartbeat(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await parseJsonBody<GuestActivityHeartbeatBody>(request);
  const sessionId = normalizeSessionId(body.sessionId);
  const guestUserId = normalizeGuestUserId(body.guestUserId);
  const guestDisplayName = normalizeDisplayName(body.guestDisplayName);
  const mode = normalizeGuestActivityMode(body.mode);
  const path = normalizePath(body.path);
  const room = normalizeRoomCoordinates(body.roomCoordinates);
  const now = new Date();
  const nowIso = now.toISOString();

  const existing = await env.DB.prepare(
    `
      SELECT last_seen_at, mode
      FROM guest_visits
      WHERE session_id = ?
      LIMIT 1
    `
  )
    .bind(sessionId)
    .first<GuestVisitRow>();

  const creditedMode = normalizeGuestActivityMode(existing?.mode, false) ?? mode;
  const deltaSeconds = existing
    ? computeTrackedDeltaSeconds(existing.last_seen_at, now.getTime())
    : 0;
  const browseDelta = creditedMode === 'browse' ? deltaSeconds : 0;
  const playDelta = creditedMode === 'play' ? deltaSeconds : 0;
  const editDelta = creditedMode === 'edit' ? deltaSeconds : 0;

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO guest_visits (
          session_id,
          guest_user_id,
          guest_display_name,
          first_seen_at,
          last_seen_at,
          last_path,
          referrer,
          user_agent,
          mode,
          room_id,
          room_x,
          room_y,
          heartbeat_count,
          browse_seconds,
          play_seconds,
          edit_seconds
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0)
        ON CONFLICT(session_id) DO UPDATE SET
          guest_user_id = excluded.guest_user_id,
          guest_display_name = excluded.guest_display_name,
          last_seen_at = excluded.last_seen_at,
          last_path = excluded.last_path,
          referrer = COALESCE(guest_visits.referrer, excluded.referrer),
          user_agent = COALESCE(guest_visits.user_agent, excluded.user_agent),
          mode = excluded.mode,
          room_id = excluded.room_id,
          room_x = excluded.room_x,
          room_y = excluded.room_y,
          heartbeat_count = guest_visits.heartbeat_count + 1,
          browse_seconds = guest_visits.browse_seconds + ?,
          play_seconds = guest_visits.play_seconds + ?,
          edit_seconds = guest_visits.edit_seconds + ?
      `
    ).bind(
      sessionId,
      guestUserId,
      guestDisplayName,
      nowIso,
      nowIso,
      path,
      normalizeHeaderValue(request.headers.get('Referer')),
      normalizeHeaderValue(request.headers.get('User-Agent')),
      mode,
      room?.roomId ?? null,
      room?.x ?? null,
      room?.y ?? null,
      browseDelta,
      playDelta,
      editDelta,
    ),
  ]);

  return jsonResponse(request, { ok: true });
}

function normalizeSessionId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'sessionId is required.');
  }

  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(trimmed)) {
    throw new HttpError(400, 'sessionId is invalid.');
  }

  return trimmed;
}

function normalizeGuestUserId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'guestUserId is required.');
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('guest-') || trimmed.length > 80) {
    throw new HttpError(400, 'guestUserId must be a guest identity.');
  }

  return trimmed;
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Guest';
  }

  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 48) : 'Guest';
}

function normalizeGuestActivityMode(
  value: unknown,
  throwOnInvalid = true
): GuestActivityMode | null {
  if (value === 'browse' || value === 'play' || value === 'edit') {
    return value;
  }

  if (throwOnInvalid) {
    throw new HttpError(400, 'mode must be browse, play, or edit.');
  }

  return null;
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('/')) {
    return null;
  }

  return trimmed.slice(0, 220);
}

function normalizeRoomCoordinates(value: unknown): { roomId: string; x: number; y: number } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const coordinates = value as { x?: unknown; y?: unknown };
  if (!Number.isInteger(coordinates.x) || !Number.isInteger(coordinates.y)) {
    return null;
  }

  const x = Number(coordinates.x);
  const y = Number(coordinates.y);
  return {
    roomId: `${x},${y}`,
    x,
    y,
  };
}

function normalizeHeaderValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.slice(0, 260) : null;
}

function computeTrackedDeltaSeconds(lastSeenAt: string | null, nowMs: number): number {
  const lastSeenMs = Date.parse(lastSeenAt ?? '');
  if (!Number.isFinite(lastSeenMs)) {
    return 0;
  }

  const deltaSeconds = Math.round((nowMs - lastSeenMs) / 1000);
  if (deltaSeconds <= 0) {
    return 0;
  }

  return Math.min(deltaSeconds, MAX_TRACKED_DELTA_SECONDS);
}
