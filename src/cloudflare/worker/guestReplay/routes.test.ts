import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleGuestReplay, purgeGuestReplays, validateReplaySample } from './routes';
import type { D1PreparedStatement, Env } from '../core/types';
let db: DatabaseSync;
let env: Env;
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
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync('migrations/0046_guest_replays.sql','utf8'));
  env = {ADMIN_API_KEY:'test-key', DB:{prepare:statement, async batch(statements: D1PreparedStatement[]) {
    db.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.all()); db.exec('COMMIT'); return results; }
    catch(error) { db.exec('ROLLBACK'); throw error; }
  }}} as unknown as Env;
});
afterEach(() => db.close());
function call(path: string, body?: unknown, admin = false, method = body ? 'POST' : 'GET') {
  const url = new URL(`https://api.wamp.land${path}`);
  const request = new Request(url,{method, headers:{Origin:'https://wamp.land', ...(admin ? {'x-admin-key':'test-key'}:{} )},body:body ? JSON.stringify(body):undefined});
  return handleGuestReplay(request,url,env);
}
const sample = (sequence = 0) => ({sequence,time:1000+sequence*1000,mode:'play',screen:'game',room:'1,2',player:{x:sequence,y:3},actions:['welcome_play'],image:null});
async function start() { return (await call('/api/guest-replays/start',{visitor,path:'/r/1/2',referrer:'example.com',viewport:'1440x900'})).json() as Promise<{id:string;token:string}>; }
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
