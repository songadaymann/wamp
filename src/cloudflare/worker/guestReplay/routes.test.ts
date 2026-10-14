import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGuestReplay, purgeGuestReplays, validateReplaySample } from './routes';
import type { D1PreparedStatement, Env } from '../core/types';
let db: DatabaseSync;
let env: Env;
let objects: Map<string, Uint8Array>;
const image = 'data:image/jpeg;base64,/9j/AAAA';
const bucket = () => ({
  put: vi.fn(async (key: string, value: Uint8Array) => { objects.set(key, value); return { key }; }),
  get: vi.fn(async (key: string) => objects.has(key) ? { arrayBuffer: async () => objects.get(key)!.slice().buffer } : null),
  list: vi.fn(async (options: { prefix: string; limit: number }) => {
    const keys = [...objects.keys()].filter(key => key.startsWith(options.prefix));
    return { objects: keys.slice(0, options.limit).map(key => ({ key })), truncated: keys.length > options.limit };
  }),
  delete: vi.fn(async (keys: string[]) => { keys.forEach(key => objects.delete(key)); }),
});
const visitor = '00000000-0000-4000-8000-000000000000';
function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...next) => statement(sql,next),
    async first<T>() { return (db.prepare(sql).get(...values as []) ?? null) as T | null; },
    async all<T>() { return {results:db.prepare(sql).all(...values as []) as T[]}; },
    // Batch adapter executes SQL through all(), which also steps mutations.
  };
}
beforeEach(() => {
  objects = new Map();
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync('migrations/0046_guest_replays.sql','utf8'));
  db.exec(readFileSync('migrations/0047_guest_replay_visit_link.sql','utf8'));
  let queued: Promise<unknown> = Promise.resolve();
  env = {ADMIN_API_KEY:'test-key', DB:{prepare:statement, batch(statements: D1PreparedStatement[]) {
    // D1 serializes transactions, including simultaneous upload requests.
    const pending = queued.then(async () => {
      db.exec('BEGIN');
      try { const results = []; for (const s of statements) results.push(await s.all()); db.exec('COMMIT'); return results; }
      catch(error) { db.exec('ROLLBACK'); throw error; }
    });
    queued = pending.catch(() => undefined);
    return pending;
  }}} as unknown as Env;
});
afterEach(() => db.close());
function call(path: string, body?: unknown, admin = false, method = body ? 'POST' : 'GET') {
  const url = new URL(`https://api.wamp.land${path}`);
  const request = new Request(url,{method, headers:{Origin:'https://wamp.land', ...(admin ? {'x-admin-key':'test-key'}:{} )},body:body ? JSON.stringify(body):undefined});
  return handleGuestReplay(request,url,env);
}
const sample = (sequence = 0) => ({sequence,time:1000+sequence*1000,mode:'play',screen:'game',room:'1,2',player:{x:sequence,y:3},actions:['welcome_play'],image:null});
async function start(visitSessionId?: string) { return (await call('/api/guest-replays/start',{visitor,visitSessionId,path:'/r/1/2',referrer:'example.com',viewport:'1440x900'})).json() as Promise<{id:string;token:string}>; }
describe('guest replay storage', () => {
  it('ingests, deduplicates retries, derives activity, and protects reads', async () => {
    const credentials = await start();
    const batch = {...credentials,samples:[sample(),{...sample(1),mode:'edit',actions:['tiles_changed','undo','redo','publish_attempt','signup_open','signed_in']}]};
    await call('/api/guest-replays/samples',batch);
    await call('/api/guest-replays/samples',batch);
    await expect(call('/api/admin/guest-replays')).rejects.toMatchObject({status:403});
    const list = await (await call('/api/admin/guest-replays',undefined,true)).json() as {sessions:Record<string,unknown>[]};
    expect(list.sessions[0]).toMatchObject({samples:2,built:1,played:1,moved:1,signup:1,signed_in:1,visits:1});
    expect(list.sessions[0]).not.toHaveProperty('write_token');
    const detail = await (await call(`/api/admin/guest-replays/${credentials.id}`,undefined,true)).json();
    expect(detail.samples).toHaveLength(2);
  });

  it('keeps new JPEGs in R2 and hydrates protected reads alongside legacy frames', async () => {
    const storage = bucket();
    env.GUEST_REPLAY_BUCKET = storage as unknown as NonNullable<Env['GUEST_REPLAY_BUCKET']>;
    const credentials = await start();
    const batch = { ...credentials, samples: [{ ...sample(), image }] };
    await call('/api/guest-replays/samples', batch);
    await call('/api/guest-replays/samples', { ...batch, samples: [{ ...sample(), image: image + 'AAAA' }] });
    expect(storage.put).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((db.prepare('SELECT payload FROM guest_replay_samples').get() as {payload: string}).payload);
    expect(payload.image).toBeNull();
    expect(payload.frameKey).toMatch(new RegExp(`^guest-replays/${credentials.id}/000-`));
    expect(storage.put.mock.calls[0][1]).toEqual(Uint8Array.from(atob(image.split(',')[1]), char => char.charCodeAt(0)));
    db.prepare('INSERT INTO guest_replay_samples VALUES (?,?,?)').run(credentials.id, 1, JSON.stringify({ ...sample(1), image }));
    await expect(call(`/api/admin/guest-replays/${credentials.id}`)).rejects.toMatchObject({ status: 403 });
    expect(storage.get).not.toHaveBeenCalled();
    const detail = await (await call(`/api/admin/guest-replays/${credentials.id}`, undefined, true)).json();
    expect(detail.samples.map((frame: {image: string}) => frame.image)).toEqual([image, image]);
    expect(detail.samples[0]).not.toHaveProperty('frameKey');
    expect(storage.get).toHaveBeenCalledTimes(1);
    await call('/api/guest-replays/discard', credentials);
    expect(objects.size).toBe(0);
  });
  it('leaves D1 untouched when image storage is missing or fails', async () => {
    const credentials = await start();
    const batch = { ...credentials, samples: [{ ...sample(), image }] };
    await expect(call('/api/guest-replays/samples', batch)).rejects.toMatchObject({ status: 503 });
    const storage = bucket();
    storage.put.mockRejectedValueOnce(new Error('R2 unavailable'));
    env.GUEST_REPLAY_BUCKET = storage as unknown as NonNullable<Env['GUEST_REPLAY_BUCKET']>;
    await expect(call('/api/guest-replays/samples', batch)).rejects.toThrow('R2 unavailable');
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_replay_samples').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT played FROM guest_replay_sessions').get()).toMatchObject({ played: 0 });
  });
  it('cleans up an upload that races with opt-out', async () => {
    const storage = bucket();
    env.GUEST_REPLAY_BUCKET = storage as unknown as NonNullable<Env['GUEST_REPLAY_BUCKET']>;
    const credentials = await start();
    storage.put.mockImplementationOnce(async (key, bytes) => {
      await call('/api/guest-replays/discard', credentials);
      objects.set(key, bytes);
      return { key };
    });
    await expect(call('/api/guest-replays/samples', { ...credentials, samples: [{ ...sample(), image }] })).rejects.toThrow();
    expect(objects.size).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_replay_samples').get()).toMatchObject({ n: 0 });
  });
  it('hides expired sessions without page-load deletes, then prunes only their R2 frames', async () => {
    const storage = bucket();
    env.GUEST_REPLAY_BUCKET = storage as unknown as NonNullable<Env['GUEST_REPLAY_BUCKET']>;
    const expired = await start();
    const active = await start();
    for (const credentials of [expired, active]) await call('/api/guest-replays/samples', { ...credentials, samples: [{ ...sample(), image }] });
    db.prepare("UPDATE guest_replay_sessions SET expires_at='2000-01-01' WHERE id=?").run(expired.id);
    const list = await (await call('/api/admin/guest-replays', undefined, true)).json();
    expect(list.sessions.map((session: {id: string}) => session.id)).toEqual([active.id]);
    expect((await (await call(`/api/admin/guest-replays/${expired.id}`, undefined, true)).json()).samples).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_replay_sessions').get()).toMatchObject({ n: 2 });
    await purgeGuestReplays(env);
    expect([...objects.keys()]).toHaveLength(1);
    expect([...objects.keys()][0]).toContain(active.id);
    await call(`/api/admin/guest-replays/${active.id}`, undefined, true, 'DELETE');
    expect(objects.size).toBe(0);
  });
  it('retains the session when R2 deletion fails, allowing deletion to be retried', async () => {
    const storage = bucket();
    env.GUEST_REPLAY_BUCKET = storage as unknown as NonNullable<Env['GUEST_REPLAY_BUCKET']>;
    const credentials = await start();
    await call('/api/guest-replays/samples', { ...credentials, samples: [{ ...sample(), image }] });
    storage.delete.mockRejectedValueOnce(new Error('R2 unavailable'));
    await expect(call('/api/guest-replays/discard', credentials)).rejects.toThrow('R2 unavailable');
    expect(db.prepare('SELECT id FROM guest_replay_sessions').get()).toMatchObject({id:credentials.id});
    expect(objects.size).toBe(1);
    const binding = env.GUEST_REPLAY_BUCKET;
    env.GUEST_REPLAY_BUCKET = undefined;
    await expect(call('/api/guest-replays/discard', credentials)).rejects.toMatchObject({status:503});
    expect(db.prepare('SELECT id FROM guest_replay_sessions').get()).toMatchObject({id:credentials.id});
    env.GUEST_REPLAY_BUCKET = binding;
    await call('/api/guest-replays/discard', credentials);
    expect(objects.size).toBe(0);
  });
  it('discards the losing objects from concurrent conflicting retries', async () => {
    const storage = bucket();
    env.GUEST_REPLAY_BUCKET = storage as unknown as NonNullable<Env['GUEST_REPLAY_BUCKET']>;
    const credentials = await start();
    // Both writes reach R2 before either is allowed to insert its D1 metadata.
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    storage.put.mockImplementation(async (key, bytes) => {
      objects.set(key, bytes);
      if (objects.size === 2) release();
      await gate;
      return {key};
    });
    await Promise.all([image, image + 'AAAA'].map(frame => call('/api/guest-replays/samples', {
      ...credentials, samples:[{...sample(), image:frame}],
    })));
    expect(objects.size).toBe(1);
    const payload = JSON.parse((db.prepare('SELECT payload FROM guest_replay_samples').get() as {payload:string}).payload);
    expect(objects.has(payload.frameKey)).toBe(true);
  });
  it('links a visit and opens only the requested recording', async () => {
    const first = await start('dashboard-visit-123');
    await start('other-visit-456');
    expect(db.prepare('SELECT visit_session_id FROM guest_replay_sessions WHERE id=?').get(first.id))
      .toMatchObject({visit_session_id:'dashboard-visit-123'});
    const response = await call(`/api/admin/guest-replays?session=${first.id}`,undefined,true);
    const list = await response.json() as {sessions:{id:string}[]};
    expect(list.sessions.map(s => s.id)).toEqual([first.id]);
    await expect(call('/api/admin/guest-replays?session=invalid',undefined,true)).rejects.toMatchObject({status:400});
  });

  it('accepts the Welcome Explore action with the rest of the recorded session', async () => {
    const credentials = await start();
    const response = await call('/api/guest-replays/samples', { ...credentials, samples: [{ ...sample(), actions: ['welcome_explore'] }] });
    expect(response.status).toBe(200);
    const saved = db.prepare('SELECT payload FROM guest_replay_samples WHERE session_id=?').get(credentials.id) as { payload: string };
    expect(JSON.parse(saved.payload).actions).toEqual(['welcome_explore']);
  });
  it('rejects wrong write tokens and foreign origins', async () => {
    const credentials = await start();
    await expect(call('/api/guest-replays/samples',{...credentials,token:visitor,samples:[sample()]})).rejects.toMatchObject({status:403});
    const request = new Request('https://api.wamp.land/api/guest-replays/start',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'});
    await expect(handleGuestReplay(request,new URL(request.url),env)).rejects.toMatchObject({status:403});
  });
  it('opt-out deletes frames and rejects late writes', async () => {
    const credentials = await start();
    await call('/api/guest-replays/samples',{...credentials,samples:[sample()]});
    await call('/api/guest-replays/discard',credentials);
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_replay_samples').get()).toMatchObject({n:0});
    await expect(call('/api/guest-replays/samples',{...credentials,samples:[sample()]})).rejects.toMatchObject({status:403});
  });
  it('expires stored images and restricts visitor volume', async () => {
    const credentials = await start();
    await call('/api/guest-replays/samples',{...credentials,samples:[sample()]});
    db.prepare("UPDATE guest_replay_sessions SET expires_at='2000-01-01'").run();
    await purgeGuestReplays(env);
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_replay_samples').get()).toMatchObject({n:0});
    for(let i=0;i<10;i++) await start();
    await expect(start()).rejects.toMatchObject({status:429});
  });
  it('strips unknown fields and rejects out-of-bounds or non-image content', () => {
    expect(validateReplaySample({...sample(),email:'secret',player:{x:1,y:2,email:'secret'}})).not.toHaveProperty('email');
    expect(validateReplaySample({...sample(),player:{x:1,y:2,email:'secret'}}).player).toEqual({x:1,y:2});
    for (const change of [{sequence:300},{time:9999999},{image:'data:text/html,hello'},{actions:['private text']},{room:'<script>'}]) {
      expect(() => validateReplaySample({...sample(),...change})).toThrow();
    }
  });
});

describe('guest replay activity flags (F038)', () => {
  // The previous ingest recomputed every flag from all of the session's stored samples.
  const recomputed = (id: string) => db.prepare(`SELECT
    EXISTS(SELECT 1 FROM guest_replay_samples WHERE session_id = ? AND json_extract(payload,'$.mode') = 'play') AS played,
    (SELECT COUNT(DISTINCT json_extract(payload,'$.player.x')) > 1 FROM guest_replay_samples WHERE session_id = ?) AS moved,
    EXISTS(SELECT 1 FROM guest_replay_samples, json_each(payload,'$.actions') WHERE session_id = ? AND value IN ('signup_open','email_submit','wallet_open')) AS signup,
    EXISTS(SELECT 1 FROM guest_replay_samples, json_each(payload,'$.actions') WHERE session_id = ? AND value = 'signed_in') AS signed_in`).get(id, id, id, id);

  it('match a full recomputation without re-reading earlier samples', async () => {
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let session = 0; session < 150; session += 1) {
      db.exec('DELETE FROM guest_replay_sessions');
      const credentials = await start();
      const length = 1 + Math.floor(random() * 12);
      const samples = Array.from({ length }, (_, sequence) => {
        const mode = random() < 0.4 ? 'browse' : random() < 0.7 ? 'play' : 'edit';
        const actions = random() < 0.15 ? ['signup_open'] : random() < 0.1 ? ['signed_in'] : [];
        return { sequence, time: sequence * 1000, mode, screen: 'game', room: '1,2',
          player: mode === 'play' && random() < 0.85 ? { x: Math.floor(random() * 3), y: 3 } : null, actions, image: null };
      });
      for (let index = 0; index < samples.length;) {
        const size = 1 + Math.floor(random() * 3);
        await call('/api/guest-replays/samples', { ...credentials, samples: samples.slice(index, index + size) });
        index += size;
      }
      const stored = db.prepare('SELECT played, moved, signup, signed_in FROM guest_replay_sessions WHERE id = ?').get(credentials.id);
      expect({ ...(stored as object) }, `session ${session}`).toEqual({ ...(recomputed(credentials.id) as object) });
    }
  });
});
