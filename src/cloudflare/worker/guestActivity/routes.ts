import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';

const SIGNUP_LINK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Called by the browser once it is signed in after playing as a guest (F127): a new account
 * remembers the guest identity it grew out of and where that guest's first visit came from.
 * Accounts older than two days, or already linked, are left alone.
 */
export async function handleGuestActivityLinkAccount(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'link a guest visit');
  const body = await parseJsonBody<{ guestUserId?: unknown }>(request, { maxBytes: 1_024 });
  const guestUserId = normalizeGuestUserId(body.guestUserId);
  const user = await env.DB.prepare('SELECT created_at, signup_guest_user_id FROM users WHERE id = ? LIMIT 1')
    .bind(auth.user.id).first<{ created_at: string; signup_guest_user_id: string | null }>();
  const createdMs = Date.parse(user?.created_at ?? '');
  if (!user || user.signup_guest_user_id || !Number.isFinite(createdMs) || Date.now() - createdMs > SIGNUP_LINK_WINDOW_MS) {
    return jsonResponse(request, { linked: false });
  }
  const first = await env.DB.prepare(`SELECT CASE WHEN first_landing_path IS NULL THEN 'unknown'
      ELSE COALESCE(first_source, first_referrer_host, 'direct') END AS source
    FROM guest_visits WHERE guest_user_id = ? ORDER BY first_seen_at ASC LIMIT 1`)
    .bind(guestUserId).first<{ source: string }>();
  if (!first) return jsonResponse(request, { linked: false });
  const updated = await env.DB.prepare(`UPDATE users SET signup_guest_user_id = ?, signup_source = ?
    WHERE id = ? AND signup_guest_user_id IS NULL RETURNING id`)
    .bind(guestUserId, first.source, auth.user.id).all<{ id: string }>();
  return jsonResponse(request, { linked: updated.results.length > 0 });
}

type GuestActivityMode = 'browse' | 'play' | 'edit';

interface GuestActivityHeartbeatBody {
  sessionId?: unknown;
  guestUserId?: unknown;
  guestDisplayName?: unknown;
  mode?: unknown;
  path?: unknown;
  roomCoordinates?: unknown;
  /** Sent with every heartbeat but stored once: where the visit started and came from (F127). */
  landing?: { path?: unknown; referrerHost?: unknown; source?: unknown };
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
  const body = await parseJsonBody<GuestActivityHeartbeatBody>(request, { maxBytes: 16_384 });
  const sessionId = normalizeSessionId(body.sessionId);
  const guestUserId = normalizeGuestUserId(body.guestUserId);
  const guestDisplayName = normalizeDisplayName(body.guestDisplayName);
  const mode = normalizeGuestActivityMode(body.mode);
  const path = normalizePath(body.path);
  const room = normalizeRoomCoordinates(body.roomCoordinates);
  const landing = normalizeLanding(body.landing);
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
          edit_seconds,
          last_play_at,
          last_edit_at,
          first_landing_path,
          first_referrer_host,
          first_source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          guest_user_id = excluded.guest_user_id,
          guest_display_name = excluded.guest_display_name,
          last_seen_at = excluded.last_seen_at,
          last_path = excluded.last_path,
          referrer = COALESCE(guest_visits.referrer, excluded.referrer),
          first_landing_path = COALESCE(guest_visits.first_landing_path, excluded.first_landing_path),
          first_referrer_host = COALESCE(guest_visits.first_referrer_host, excluded.first_referrer_host),
          first_source = COALESCE(guest_visits.first_source, excluded.first_source),
          user_agent = COALESCE(guest_visits.user_agent, excluded.user_agent),
          mode = excluded.mode,
          room_id = excluded.room_id,
          room_x = excluded.room_x,
          room_y = excluded.room_y,
          heartbeat_count = guest_visits.heartbeat_count + 1,
          browse_seconds = guest_visits.browse_seconds + ?,
          play_seconds = guest_visits.play_seconds + ?,
          edit_seconds = guest_visits.edit_seconds + ?,
          last_play_at = CASE
            WHEN ? IS NOT NULL THEN ?
            ELSE guest_visits.last_play_at
          END,
          last_edit_at = CASE
            WHEN ? IS NOT NULL THEN ?
            ELSE guest_visits.last_edit_at
          END
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
      mode === 'play' ? nowIso : null,
      mode === 'edit' ? nowIso : null,
      landing.path,
      landing.referrerHost,
      landing.source,
      browseDelta,
      playDelta,
      editDelta,
      mode === 'play' || playDelta > 0 ? nowIso : null,
      mode === 'play' || playDelta > 0 ? nowIso : null,
      mode === 'edit' || editDelta > 0 ? nowIso : null,
      mode === 'edit' || editDelta > 0 ? nowIso : null,
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

const HOSTNAME = /^[a-z0-9.-]{1,120}$/;
const SOURCE = /^[a-z0-9_.-]{1,40}$/;

/** The referrer is a bare host and the source a short tag such as share or reddit; nothing else is kept. */
function normalizeLanding(value: unknown): { path: string | null; referrerHost: string | null; source: string | null } {
  const landing = value && typeof value === 'object' ? value as { path?: unknown; referrerHost?: unknown; source?: unknown } : {};
  const host = typeof landing.referrerHost === 'string' ? landing.referrerHost.trim().toLowerCase().replace(/^www\./, '') : '';
  const source = typeof landing.source === 'string' ? landing.source.trim().toLowerCase() : '';
  // Path only: a landing query string can hold a sign-in token or other private values.
  return {
    path: normalizePath(typeof landing.path === 'string' ? landing.path.split(/[?#]/)[0] : null),
    referrerHost: HOSTNAME.test(host) ? host : null,
    source: SOURCE.test(source) ? source : null,
  };
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
