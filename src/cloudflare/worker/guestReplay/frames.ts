import type { ReplaySample } from '../../../analytics/replay/model';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';

type StoredSample = ReplaySample & { frameKey?: string };
const prefix = (id: string) => `guest-replays/${id}/`;

export async function deleteReplayFrames(env: Env, id: string): Promise<void> {
  if (!env.GUEST_REPLAY_BUCKET) return;
  // Start at the prefix again after deleting a page, so pagination never skips keys.
  for (;;) {
    const page = await env.GUEST_REPLAY_BUCKET.list({ prefix: prefix(id), limit: 1000 });
    if (page.objects.length) await env.GUEST_REPLAY_BUCKET.delete(page.objects.map(object => object.key));
    if (!page.truncated) return;
  }
}

export async function deleteReplaySession(env: Env, id: string): Promise<void> {
  if (!env.GUEST_REPLAY_BUCKET && await env.DB.prepare(
    "SELECT 1 FROM guest_replay_samples WHERE session_id = ? AND json_extract(payload,'$.frameKey') IS NOT NULL LIMIT 1",
  ).bind(id).first()) throw new HttpError(503, 'Recording storage unavailable.');
  await deleteReplayFrames(env, id);
  await env.DB.batch([env.DB.prepare('DELETE FROM guest_replay_sessions WHERE id = ?').bind(id)]);
  // A concurrent upload may have completed between the first sweep and deletion.
  // Its subsequent insert fails the FK; this sweep catches inserts committed earlier.
  await deleteReplayFrames(env, id);
}

export async function purgeGuestReplays(env: Env, now = new Date().toISOString()): Promise<void> {
  const expired = await env.DB.prepare('SELECT id FROM guest_replay_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 100')
    .bind(now).all<{ id: string }>();
  for (const { id } of expired.results) await deleteReplaySession(env, id);
}

async function deleteUnreferencedFrames(env: Env, keys: string[]): Promise<void> {
  if (!env.GUEST_REPLAY_BUCKET || !keys.length) return;
  // Also safe after an ambiguous D1 failure: keep anything that actually committed.
  const referenced = await env.DB.prepare(`SELECT json_extract(payload,'$.frameKey') AS frameKey
    FROM guest_replay_samples WHERE session_id = ? AND json_extract(payload,'$.frameKey') IN (${keys.map(() => '?').join(',')})`)
    .bind(keys[0].split('/')[1], ...keys).all<{ frameKey: string }>();
  const used = new Set(referenced.results.map(row => row.frameKey));
  const unused = keys.filter(key => !used.has(key));
  if (unused.length) await env.GUEST_REPLAY_BUCKET.delete(unused);
}

export async function saveReplaySamples(env: Env, id: string, expiresAt: string, samples: ReplaySample[]): Promise<void> {
  if (samples.some(sample => sample.image) && !env.GUEST_REPLAY_BUCKET) throw new HttpError(503, 'Recording storage unavailable.');
  const existing = await env.DB.prepare(`SELECT sequence FROM guest_replay_samples WHERE session_id = ? AND sequence IN (${samples.map(() => '?').join(',')})`)
    .bind(id, ...samples.map(sample => sample.sequence)).all<{ sequence: number }>();
  const seen = new Set(existing.results.map(row => row.sequence));
  const stored: StoredSample[] = [];
  const keys: string[] = [];
  try {
    for (const sample of samples) {
      if (seen.has(sample.sequence)) continue;
      seen.add(sample.sequence);
      if (!sample.image) { stored.push(sample); continue; }
      let decoded: string;
      try { decoded = atob(sample.image.split(',')[1]); }
      catch { throw new HttpError(400, 'Invalid frame.'); }
      const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
      // Each request owns its keys. A conflicting retry cannot overwrite the first frame
      // or remove an object owned by another upload when its insert is ignored.
      const frameKey = `${prefix(id)}${String(sample.sequence).padStart(3, '0')}-${crypto.randomUUID()}.jpg`;
      await env.GUEST_REPLAY_BUCKET!.put(frameKey, bytes, {
        httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { expiresAt },
      });
      keys.push(frameKey);
      stored.push({ ...sample, image: null, frameKey });
    }
    if (stored.length) await env.DB.batch(stored.map(sample => env.DB.prepare(
      'INSERT OR IGNORE INTO guest_replay_samples (session_id,sequence,payload) VALUES (?,?,?)',
    ).bind(id, sample.sequence, JSON.stringify(sample))));
    await deleteUnreferencedFrames(env, keys);
  } catch (error) {
    // Keep the original error. If cleanup cannot confirm a missing reference, lifecycle
    // expiry removes the orphan instead of risking deletion of a committed frame.
    try { await deleteUnreferencedFrames(env, keys); }
    catch { console.error(JSON.stringify({ event: 'guest-replay-frame-cleanup-failed' })); }
    throw error;
  }
}

export async function loadReplaySamples(env: Env, id: string, now = new Date().toISOString()): Promise<ReplaySample[]> {
  const rows = await env.DB.prepare(`SELECT payload FROM guest_replay_samples WHERE session_id = ?
    AND EXISTS(SELECT 1 FROM guest_replay_sessions WHERE id = ? AND expires_at > ?) ORDER BY sequence`)
    .bind(id, id, now).all<{ payload: string }>();
  const samples: ReplaySample[] = [];
  // Preserve the admin response contract, including old inline frames, with bounded R2 reads.
  for (let offset = 0; offset < rows.results.length; offset += 8) {
    samples.push(...await Promise.all(rows.results.slice(offset, offset + 8).map(async row => {
      const { frameKey, ...sample } = JSON.parse(row.payload) as StoredSample;
      if (!frameKey) return sample;
      if (!frameKey.startsWith(prefix(id))) throw new Error('Invalid stored replay frame key.');
      if (!env.GUEST_REPLAY_BUCKET) throw new HttpError(503, 'Recording storage unavailable.');
      const object = await env.GUEST_REPLAY_BUCKET.get(frameKey);
      if (!object) return { ...sample, image: null };
      const bytes = new Uint8Array(await object.arrayBuffer());
      return { ...sample, image: `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}` };
    })));
  }
  return samples;
}
