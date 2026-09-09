import { REPLAY_ACTIONS, REPLAY_IMAGE_LIMIT, REPLAY_SECONDS, replayPosition, type ReplaySample } from '../../../analytics/replay/model';
import { requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';

const DAY = 86400000;
const ID = /^[a-f0-9-]{36}$/;
export async function purgeGuestReplays(env: Env): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM guest_replay_sessions WHERE expires_at <= ?').bind(new Date().toISOString())]);
}
const reply = (request: Request, body: unknown) => jsonResponse(request, body, { headers: { 'Cache-Control': 'no-store' } });

export function validateReplaySample(input: unknown): ReplaySample {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Invalid sample.');
  const s = input as Record<string, unknown>;
  if (!Number.isInteger(s.sequence) || Number(s.sequence) < 0 || Number(s.sequence) >= REPLAY_SECONDS
    || !Number.isInteger(s.time) || Number(s.time) < 0 || Number(s.time) > REPLAY_SECONDS * 1000 + 10000
    || !['browse', 'play', 'edit'].includes(String(s.mode))) throw new HttpError(400, 'Invalid sample bounds.');
  if (!['loading','welcome','room_instructions','menu','game'].includes(String(s.screen))) throw new HttpError(400, 'Invalid screen.');
  if (s.image !== null && (typeof s.image !== 'string' || s.image.length > REPLAY_IMAGE_LIMIT
    || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(s.image))) throw new HttpError(400, 'Invalid frame.');
  if (!Array.isArray(s.actions) || s.actions.length > 12 || s.actions.some(a => !REPLAY_ACTIONS.includes(a))) throw new HttpError(400, 'Invalid actions.');
  if (s.room !== null && (typeof s.room !== 'string' || !/^-?\d{1,7},-?\d{1,7}$/.test(s.room))) throw new HttpError(400, 'Invalid room.');
  return { sequence: Number(s.sequence), time: Number(s.time), mode: s.mode as ReplaySample['mode'],
    screen: s.screen as ReplaySample['screen'], room: s.room as string | null, player: replayPosition(s.player), actions: s.actions, image: s.image as string | null };
}

export async function handleGuestReplay(request: Request, url: URL, env: Env): Promise<Response> {
  requireTrustedOriginForMutation(request);
  if (url.pathname.startsWith('/api/admin/guest-replays')) {
    requireAdminRequest(env, request, 'watch guest replays');
    await purgeGuestReplays(env);
    const id = url.pathname.split('/')[4];
    if (id) {
      if (!ID.test(id)) throw new HttpError(400, 'Invalid session.');
      if (request.method === 'DELETE') {
        await env.DB.batch([env.DB.prepare('DELETE FROM guest_replay_sessions WHERE id = ?').bind(id)]);
        return reply(request, { ok: true });
      }
      const result = await env.DB.prepare('SELECT payload FROM guest_replay_samples WHERE session_id = ? ORDER BY sequence').bind(id).all<{payload: string}>();
      return reply(request, { samples: result.results.map(r => JSON.parse(r.payload)) });
    }
    const result = await env.DB.prepare(`SELECT s.id, s.visitor_id, s.started_at, s.entry_path, s.referrer_host, s.viewport,
      s.played, s.moved, s.signup, s.signed_in,
      EXISTS(SELECT 1 FROM guest_replay_samples b WHERE b.session_id = s.id AND json_extract(b.payload,'$.mode') = 'edit') AS built,
      (SELECT COUNT(*) FROM guest_replay_samples f WHERE f.session_id = s.id) AS samples,
      (SELECT COUNT(*) FROM guest_replay_sessions v WHERE v.visitor_id = s.visitor_id) AS visits
      FROM guest_replay_sessions s ORDER BY started_at DESC LIMIT 100`).all();
    return reply(request, { sessions: result.results });
  }
  const body = await parseJsonBody<Record<string, unknown>>(request, { maxBytes: 60_000 });
  if (url.pathname === '/api/guest-replays/start') {
    await purgeGuestReplays(env);
    if (typeof body.visitor !== 'string' || !ID.test(body.visitor)) throw new HttpError(400, 'Invalid visitor.');
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const now = new Date();
    const since = new Date(now.getTime() - DAY).toISOString();
    // Atomic budget gate: bound anonymous ingestion even under concurrent requests.
    await env.DB.batch([env.DB.prepare(`INSERT INTO guest_replay_sessions
      (id,write_token,visitor_id,started_at,expires_at,entry_path,referrer_host,viewport)
      SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM guest_replay_sessions WHERE started_at > ?) < 100
      AND (SELECT COUNT(*) FROM guest_replay_sessions WHERE visitor_id = ? AND started_at > ?) < 10`).bind(
      id, token, body.visitor, now.toISOString(), new Date(now.getTime() + 7 * DAY).toISOString(),
      typeof body.path === 'string' && /^\/[A-Za-z0-9/_,-]*$/.test(body.path) ? body.path.slice(0,120) : '/',
      typeof body.referrer === 'string' && /^[a-zA-Z0-9.-]{0,120}$/.test(body.referrer) ? body.referrer : '',
      typeof body.viewport === 'string' && /^\d{1,5}x\d{1,5}$/.test(body.viewport) ? body.viewport : '',
      since, body.visitor, since,
    )]);
    const accepted = await env.DB.prepare('SELECT id FROM guest_replay_sessions WHERE id = ?').bind(id).first();
    if (!accepted) throw new HttpError(429, 'Recording budget reached.');
    return reply(request, { id, token });
  }
  if (typeof body.id !== 'string' || typeof body.token !== 'string' || !ID.test(body.id) || !ID.test(body.token)) throw new HttpError(403, 'Invalid recording token.');
  const session = await env.DB.prepare('SELECT started_at FROM guest_replay_sessions WHERE id = ? AND write_token = ? AND expires_at > ?')
    .bind(body.id, body.token, new Date().toISOString()).first<{started_at: string}>();
  if (!session) throw new HttpError(403, 'Invalid recording token.');
  if (url.pathname === '/api/guest-replays/discard') {
    await env.DB.batch([env.DB.prepare('DELETE FROM guest_replay_sessions WHERE id = ?').bind(body.id)]);
    return reply(request, { ok: true });
  }
  if (url.pathname !== '/api/guest-replays/samples') throw new HttpError(404, 'Route not found.');
  if (Date.now() - Date.parse(session.started_at) > 360000) throw new HttpError(410, 'Recording ended.');
  if (!Array.isArray(body.samples) || body.samples.length < 1 || body.samples.length > 3) throw new HttpError(400, 'Invalid batch.');
  const samples = body.samples.map(validateReplaySample);
  await env.DB.batch(samples.map(s => env.DB.prepare('INSERT OR IGNORE INTO guest_replay_samples (session_id,sequence,payload) VALUES (?,?,?)').bind(body.id, s.sequence, JSON.stringify(s))));
  await env.DB.batch([env.DB.prepare(`UPDATE guest_replay_sessions SET
    played = EXISTS(SELECT 1 FROM guest_replay_samples WHERE session_id = ? AND json_extract(payload,'$.mode') = 'play'),
    moved = (SELECT COUNT(DISTINCT json_extract(payload,'$.player.x')) > 1 FROM guest_replay_samples WHERE session_id = ?),
    signup = EXISTS(SELECT 1 FROM guest_replay_samples, json_each(payload,'$.actions') WHERE session_id = ? AND value IN ('signup_open','email_submit','wallet_open')),
    signed_in = EXISTS(SELECT 1 FROM guest_replay_samples, json_each(payload,'$.actions') WHERE session_id = ? AND value = 'signed_in')
    WHERE id = ?`).bind(body.id,body.id,body.id,body.id,body.id)]);
  return reply(request, { ok: true });
}
