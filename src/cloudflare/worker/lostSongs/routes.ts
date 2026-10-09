import { loadOptionalRequestAuth, requireAuthenticatedRequestAuth, requireOptionalScope, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import { getClientIp, hashRateLimitKey, networkKeyForIp, takeRateLimitSlots } from '../core/rateLimit';
import type { Env } from '../core/types';
import { guestRunIdentity, hashGuestRunValue } from '../guestRuns/identity';
import { assertWampLeaderboardWriteAllowed } from '../generatedUsers/leaderboardIsolation';
import { assertLostSongPickupProof, parseLostSongFind, parseLostSongTarget } from './validation';
import { loadLostSongTarget, userOwnsSongRoom } from './targets';
import { loadLostSongProgress, saveUserLostSong } from './progress';
import { loadExpandedRoomTarget } from '../expandedRooms/store';

const DAY = 86_400_000;
const reply = (request: Request, value: unknown) => jsonResponse(request, value, { headers: { 'Cache-Control': 'no-store' } });
interface Identity { type: 'user' | 'guest'; id: string; recoveryHash: string }
interface SongSession {
  id: string; identity_type: Identity['type']; identity_id: string; recovery_hash: string; token_hash: string;
  room_id: string; room_version: number; owner_user_id: string | null; song_x: number; song_y: number;
  started_at: string; expires_at: string; found_at: string | null;
  expanded_room_id: string | null;
}
interface GuestSong { room_id: string; room_version: number; session_id: string; owner_user_id: string | null; found_at: string; expanded_room_id: string | null }

export async function purgeLostSongSessions(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM lost_song_play_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM guest_lost_songs WHERE expires_at <= ?').bind(now),
  ]);
}
async function limit(env: Env, request: Request, identity: Identity, action: string): Promise<void> {
  const checks = [{ rule: { bucket: `lost_song_${action}`, limit: action === 'claim' ? 10 : 40, windowMs: 60_000 },
    keyHash: await hashRateLimitKey(env, `${identity.type}:${identity.id}:${identity.recoveryHash}`) }];
  const ip = getClientIp(request);
  if (ip) checks.push({ rule: { bucket: `lost_song_${action}_network`, limit: 120, windowMs: 60_000 },
    keyHash: await hashRateLimitKey(env, networkKeyForIp(ip)) });
  if ((await takeRateLimitSlots(env, checks)).limitedBy) throw new HttpError(429, 'Please wait before saving more Lost Song progress.');
}
function secret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function handleLostSongs(request: Request, url: URL, env: Env): Promise<Response> {
  requireTrustedOriginForMutation(request);
  if (url.pathname === '/api/lost-songs/progress' && request.method === 'GET') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'read Lost Song progress', 'rooms:read');
    const cursor = url.searchParams.get('cursor') ?? '';
    if (cursor.length > 40) throw new HttpError(400, 'Invalid progress cursor.');
    return reply(request, await loadLostSongProgress(env, auth.user.id, cursor));
  }
  if (url.pathname === '/api/lost-songs/claim' && request.method === 'POST') {
    const auth = await requireAuthenticatedRequestAuth(env, request, 'claim Lost Song progress', 'runs:write');
    await assertWampLeaderboardWriteAllowed(env, auth, 'play');
    const guest = await guestRunIdentity(request);
    const identity: Identity = { type: 'guest', id: guest.guestUserId, recoveryHash: guest.recoveryTokenHash };
    await limit(env, request, identity, 'claim');
    const body = await parseJsonBody<{ roomIds?: unknown; expectedUserId?: unknown }>(request, { maxBytes: 8000 });
    assertExpectedUser(body, auth.user.id);
    if (!Array.isArray(body?.roomIds) || body.roomIds.length > 50
      || body.roomIds.some(id => typeof id !== 'string' || !/^-?\d{1,6},-?\d{1,6}$/.test(id))) throw new HttpError(400, 'Up to 50 found rooms can be claimed together.');
    const claimed: string[] = [], skipped: string[] = []; let xp = 0;
    for (const roomId of new Set(body.roomIds as string[])) {
      const reserved = await env.DB.prepare(`UPDATE guest_lost_songs SET claimed_user_id = ?
        WHERE guest_id = ? AND recovery_hash = ? AND room_id = ? AND expires_at > ?
          AND (claimed_user_id IS NULL OR claimed_user_id = ?)
        RETURNING room_id,room_version,session_id,owner_user_id,found_at,expanded_room_id`)
        .bind(auth.user.id, identity.id, identity.recoveryHash, roomId, new Date().toISOString(), auth.user.id).first<GuestSong>();
      if (!reserved) { skipped.push(roomId); continue; }
      if (reserved.owner_user_id === auth.user.id || await userOwnsSongRoom(env, auth.user.id, roomId)
        || await userOwnsExpandedSong(env, auth.user.id, reserved.expanded_room_id)) { skipped.push(roomId); continue; }
      const receipt = await saveUserLostSong(env, auth.user.id, { roomId, roomVersion: reserved.room_version,
        sessionId: reserved.session_id, foundAt: reserved.found_at });
      claimed.push(roomId); xp += receipt.xp;
    }
    return reply(request, { claimed, skipped, xp });
  }
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'runs:write', 'save Lost Song progress');
  if (auth) await assertWampLeaderboardWriteAllowed(env, auth, 'play');
  const guest = auth ? null : await guestRunIdentity(request);
  const identity: Identity = auth ? { type: 'user', id: auth.user.id, recoveryHash: '' }
    : { type: 'guest', id: guest!.guestUserId, recoveryHash: guest!.recoveryTokenHash };
  if (request.method !== 'POST') throw new HttpError(404, 'Route not found.');
  if (url.pathname === '/api/lost-songs/play') {
    await limit(env, request, identity, 'play');
    const body = await parseJsonBody<unknown>(request, { maxBytes: 4000 });
    assertExpectedUser(body, auth?.user.id ?? null);
    const target = parseLostSongTarget(body);
    const { song, ownerUserId } = await loadLostSongTarget(env, target, auth?.user ?? null);
    const id = crypto.randomUUID(), token = secret(), now = new Date().toISOString();
    const expiresAt = new Date(Date.parse(now) + 30 * 60_000).toISOString();
    await env.DB.batch([env.DB.prepare(`INSERT INTO lost_song_play_sessions
      (id,identity_type,identity_id,recovery_hash,token_hash,room_id,room_version,expanded_room_id,owner_user_id,song_x,song_y,started_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM lost_song_play_sessions
        WHERE identity_type = ? AND identity_id = ? AND recovery_hash = ? AND expires_at > ? AND found_at IS NULL) < 32
        AND (SELECT COUNT(*) FROM lost_song_play_sessions WHERE expires_at > ?) < 5000`)
      .bind(id, identity.type, identity.id, identity.recoveryHash, await hashGuestRunValue(token), target.roomId, target.roomVersion,
        target.expandedRoomId ?? null, ownerUserId, song.x, song.y, now, expiresAt, identity.type, identity.id, identity.recoveryHash, now, now)]);
    if (!await env.DB.prepare('SELECT id FROM lost_song_play_sessions WHERE id = ?').bind(id).first()) throw new HttpError(429, 'Too many active Lost Song play sessions.');
    return reply(request, { id, token, expiresAt });
  }
  if (url.pathname !== '/api/lost-songs/find') throw new HttpError(404, 'Route not found.');
  await limit(env, request, identity, 'find');
  const rawBody = await parseJsonBody<unknown>(request, { maxBytes: 24_000 });
  assertExpectedUser(rawBody, auth?.user.id ?? null);
  const body = parseLostSongFind(rawBody);
  const session = await env.DB.prepare(`SELECT * FROM lost_song_play_sessions
    WHERE id = ? AND identity_type = ? AND identity_id = ? AND recovery_hash = ? AND token_hash = ?`)
    .bind(body.sessionId, identity.type, identity.id, identity.recoveryHash, await hashGuestRunValue(body.token)).first<SongSession>();
  if (!session || Date.parse(session.expires_at) <= Date.now()) throw new HttpError(409, 'This Lost Song play proof has expired. Play the published room again.');
  if (auth && (session.owner_user_id === auth.user.id || await userOwnsSongRoom(env, auth.user.id, session.room_id)
    || await userOwnsExpandedSong(env, auth.user.id, session.expanded_room_id))) {
    throw new HttpError(409, 'Your own rooms do not count toward Lost Song progress.');
  }
  assertLostSongPickupProof(body, session, Date.now());
  const foundAt = session.found_at ?? new Date().toISOString();
  await env.DB.batch([env.DB.prepare('UPDATE lost_song_play_sessions SET found_at = COALESCE(found_at,?) WHERE id = ?').bind(foundAt, session.id)]);
  if (auth) return reply(request, await saveUserLostSong(env, auth.user.id, { roomId: session.room_id,
    roomVersion: session.room_version, sessionId: session.id, foundAt }));
  await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO guest_lost_songs
    (guest_id,recovery_hash,room_id,room_version,owner_user_id,session_id,found_at,expires_at,expanded_room_id)
    SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM guest_lost_songs WHERE guest_id = ? AND recovery_hash = ?) < 5000
      AND (SELECT COUNT(*) FROM guest_lost_songs) < 100000`).bind(identity.id, identity.recoveryHash, session.room_id, session.room_version,
      session.owner_user_id, session.id, foundAt, new Date(Date.parse(foundAt) + 30 * DAY).toISOString(), session.expanded_room_id, identity.id, identity.recoveryHash)]);
  const saved = await env.DB.prepare('SELECT found_at FROM guest_lost_songs WHERE guest_id = ? AND recovery_hash = ? AND room_id = ?')
    .bind(identity.id, identity.recoveryHash, session.room_id).first<{ found_at: string }>();
  if (!saved) throw new HttpError(429, 'Guest song storage is full. Sign in to keep collecting.');
  return reply(request, { roomId: session.room_id, foundAt: saved.found_at, xp: 0 });
}

function assertExpectedUser(body: unknown, userId: string | null): void {
  if (body && typeof body === 'object' && 'expectedUserId' in body && body.expectedUserId !== userId) {
    throw new HttpError(409, 'Your account changed. Touch the song again to save it.');
  }
}

async function userOwnsExpandedSong(env: Env, userId: string, expandedRoomId: string | null): Promise<boolean> {
  return Boolean(expandedRoomId && (await loadExpandedRoomTarget(env, expandedRoomId))?.ownerUserId === userId);
}
