import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../../config';
import type { LostSongFindBody, LostSongTarget } from '../../../lostSongs/model';
import { HttpError } from '../core/http';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function parseLostSongTarget(value: unknown): LostSongTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'A published room target is required.');
  const body = value as Record<string, unknown>;
  if (typeof body.roomId !== 'string' || !/^-?\d{1,6},-?\d{1,6}$/.test(body.roomId)
    || !Number.isInteger(body.roomVersion) || Number(body.roomVersion) < 1) throw new HttpError(400, 'A published room version is required.');
  const expandedRoomId = body.expandedRoomId ?? null;
  if (expandedRoomId !== null && (typeof expandedRoomId !== 'string' || expandedRoomId.length > 128
    || !Number.isInteger(body.expandedRoomVersion) || Number(body.expandedRoomVersion) < 1)) {
    throw new HttpError(400, 'A published Expanded Room version is required.');
  }
  return { roomId: body.roomId, roomVersion: Number(body.roomVersion), expandedRoomId: expandedRoomId as string | null,
    expandedRoomVersion: expandedRoomId ? Number(body.expandedRoomVersion) : null };
}

export function parseLostSongFind(value: unknown): LostSongFindBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'A play proof is required.');
  const body = value as Record<string, unknown>;
  if (typeof body.sessionId !== 'string' || !uuid.test(body.sessionId)
    || typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)
    || !Array.isArray(body.samples) || body.samples.length < 1 || body.samples.length > 128) {
    throw new HttpError(400, 'A bounded server-issued play proof is required.');
  }
  const samples = body.samples.map(value => {
    const sample = value as Record<string, unknown> | null;
    if (!sample || typeof sample !== 'object' || ![sample.atMs, sample.x, sample.y].every(v => typeof v === 'number' && Number.isFinite(v))
      || Number(sample.atMs) < 0 || Number(sample.atMs) > 30 * 60_000
      || Number(sample.x) < -24 || Number(sample.x) > ROOM_PX_WIDTH + 24
      || Number(sample.y) < -24 || Number(sample.y) > ROOM_PX_HEIGHT + 24) throw new HttpError(400, 'Invalid play position sample.');
    return { atMs: Number(sample.atMs), x: Number(sample.x), y: Number(sample.y) };
  });
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], seconds = (b.atMs - a.atMs) / 1000;
    if (seconds < 0 || Math.abs(b.x - a.x) > 64 + seconds * 1000 || Math.abs(b.y - a.y) > 64 + seconds * 2000) {
      throw new HttpError(400, 'Play position samples do not describe a plausible path.');
    }
  }
  return { sessionId: body.sessionId, token: body.token, samples };
}

/** Bounded event plausibility, not a complete simulation or an anti-cheat certificate. */
export function assertLostSongPickupProof(body: LostSongFindBody, session: { song_x: number; song_y: number; started_at: string }, nowMs: number): void {
  const last = body.samples.at(-1)!;
  if (last.atMs > nowMs - Date.parse(session.started_at) + 2000
    || Math.abs(last.x - session.song_x) > 24 || Math.abs(last.y - session.song_y) > 28) {
    throw new HttpError(409, 'The play proof does not reach this Lost Song.');
  }
}
