import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
const auth = vi.hoisted(() => ({ id: null as string | null }));
const expanded = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../auth/request', async actual => ({ ...await actual<object>(),
  loadOptionalRequestAuth: async () => auth.id ? { user: { id: auth.id }, source: 'session' } : null,
  requireAuthenticatedRequestAuth: async () => { if (!auth.id) throw new Error('Sign in'); return { user: { id: auth.id }, source: 'session' }; },
}));
vi.mock('../generatedUsers/leaderboardIsolation', async actual => ({ ...await actual<object>(), assertWampLeaderboardWriteAllowed: async () => {} }));
vi.mock('../expandedRooms/store', async actual => ({ ...await actual<object>(), loadExpandedRoomTarget: async () => expanded.value }));
vi.mock('../progression/progressRows', async actual => ({ ...await actual<object>(),
  loadOrBackfillUserProgress: async (env: Env, id: string) => {
    await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO user_progress(user_id,total_pxp,updated_at) VALUES (?,0,?)').bind(id, new Date().toISOString())]);
  },
}));
vi.mock('../progression/laneEvents', async actual => ({ ...await actual<object>(), refreshProgressLevels: async () => {} }));
import { handleLostSongs, purgeLostSongSessions } from './routes';
import { loadLostSongProgress, saveUserLostSong } from './progress';

let db: DatabaseSync, env: Env, failIncrement = false;
function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return { bind: (...next) => statement(sql, next),
    async first<T>() { return (db.prepare(sql).get(...values as []) ?? null) as T | null; },
    async all<T>() {
      if (failIncrement && sql.startsWith('UPDATE user_progress')) { failIncrement = false; throw new Error('Simulated transaction failure'); }
      return { results: db.prepare(sql).all(...values as []) as T[] };
    } };
}
beforeEach(() => {
  auth.id = null; expanded.value = null; failIncrement = false; db = new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,wallet_address TEXT);
    INSERT INTO users VALUES ('owner',NULL),('player',NULL),('other',NULL);
    CREATE TABLE rooms(id TEXT PRIMARY KEY,published_json TEXT,claimer_user_id TEXT,minted_owner_wallet_address TEXT);
    CREATE TABLE user_progress(user_id TEXT PRIMARY KEY,total_pxp INTEGER NOT NULL,updated_at TEXT);
    CREATE TABLE pxp_events(id TEXT PRIMARY KEY,user_id TEXT,event_type TEXT,source_type TEXT,source_id TEXT,
      dedupe_key TEXT UNIQUE,amount INTEGER,breakdown_json TEXT,created_at TEXT);
    CREATE TABLE badge_awards(user_id TEXT,badge_id TEXT,source_type TEXT,source_id TEXT,metadata_json TEXT,awarded_at TEXT,PRIMARY KEY(user_id,badge_id));`);
  db.exec(readFileSync('migrations/0049_rate_limit_events.sql','utf8'));db.exec(readFileSync('migrations/0061_lost_songs.sql','utf8'));
  const database: D1Database = { prepare: statement, async batch<T>(queries: D1PreparedStatement[]): Promise<T[]> {
    db.exec('BEGIN');try { const results = [];for(const query of queries) results.push(await query.all());db.exec('COMMIT');return results as T[]; }
    catch(e) { db.exec('ROLLBACK');throw e; }
  }, withSession: () => database };
  env = { DB: database, JAM_DB: database, ASSETS: { fetch: async () => new Response() } };
  const room = { ...createDefaultRoomSnapshot('0,0',{ x: 0,y: 0 }), status: 'published', version: 1,
    placedObjects: [{ id: 'lost_song', instanceId: 'song', x: 100, y: 100, layer: 'terrain' }] };
  db.prepare('INSERT INTO rooms VALUES (?,?,?,NULL)').run('0,0',JSON.stringify(room),'owner');
});
afterEach(() => db.close());
const headers = { Origin: 'https://wamp.land', 'CF-Connecting-IP': '203.0.113.1',
  'X-Guest-User-Id': 'guest-lost-song', 'X-Guest-Recovery-Token': 'g'.repeat(64) };
async function call(path: string, body?: unknown, overrides: Record<string,string> = {}) {
  const url = new URL('https://api.wamp.land'+path);
  return handleLostSongs(new Request(url,{ method: body ? 'POST' : 'GET', headers: { ...headers,...overrides },
    body: body ? JSON.stringify(body) : undefined }),url,env);
}
async function play(extra: object = {}) {
  return (await (await call('/api/lost-songs/play',{ roomId: '0,0',roomVersion: 1,...extra })).json()) as { id: string; token: string };
}
const findBody = (session: { id: string; token: string }) => ({ sessionId: session.id,token: session.token,samples: [{ atMs: 0,x: 100,y: 100 }] });

it('stores a guest receipt once, keeps it private and claims it into one account with one XP event', async () => {
  const session = await play();await call('/api/lost-songs/find',findBody(session));await call('/api/lost-songs/find',findBody(session));
  expect(db.prepare('SELECT COUNT(*) n FROM guest_lost_songs').get()).toMatchObject({ n: 1 });
  await expect(call('/api/lost-songs/find',findBody(session),{ 'X-Guest-Recovery-Token': 'h'.repeat(64) })).rejects.toMatchObject({ status: 409 });
  auth.id = 'player';const claim = await (await call('/api/lost-songs/claim',{ roomIds: ['0,0'] })).json();
  expect(claim).toMatchObject({ claimed: ['0,0'],xp: 5 });
  expect(await (await call('/api/lost-songs/claim',{ roomIds: ['0,0'] })).json()).toMatchObject({ claimed: ['0,0'],xp: 0 });
  expect(await loadLostSongProgress(env,'player')).toMatchObject({ total: 1,roomIds: ['0,0'] });
  expect(db.prepare('SELECT total_pxp FROM user_progress WHERE user_id=?').get('player')).toMatchObject({ total_pxp: 5 });
  expect(db.prepare('SELECT badge_id FROM badge_awards').get()).toMatchObject({ badge_id: 'player_first_lost_song' });
  auth.id = 'other';expect(await (await call('/api/lost-songs/claim',{ roomIds: ['0,0'] })).json()).toMatchObject({ claimed: [],xp: 0 });
});
it('requires a published version, matching identity/token, plausible pickup and a live session; own finds never become account rewards', async () => {
  await expect(play({ roomVersion: 2 })).rejects.toMatchObject({ status: 409 });
  const session = await play();await expect(call('/api/lost-songs/find',{ ...findBody(session),samples: [{ atMs: 0,x: 500,y: 100 }] })).rejects.toMatchObject({ status: 409 });
  await expect(call('/api/lost-songs/find',{ ...findBody(session),token: 'a'.repeat(64) })).rejects.toMatchObject({ status: 409 });
  await call('/api/lost-songs/find',findBody(session));auth.id = 'owner';
  await expect(play()).rejects.toMatchObject({ status: 409 });
  expect(await (await call('/api/lost-songs/claim',{ roomIds: ['0,0'] })).json()).toMatchObject({ claimed: [],skipped: ['0,0'],xp: 0 });
  expect(db.prepare('SELECT COUNT(*) n FROM user_lost_songs').get()).toMatchObject({ n: 0 });
  auth.id = null;db.prepare("UPDATE lost_song_play_sessions SET expires_at='2000-01-01'").run();
  await expect(call('/api/lost-songs/find',findBody(session))).rejects.toMatchObject({ status: 409 });
  await expect(call('/api/lost-songs/play',{ roomId: '0,0',roomVersion: 1 },{ Origin: 'https://evil.example' })).rejects.toMatchObject({ status: 403 });
});
it('binds the exact published Expanded Room cell version and preserves per-cell accounting', async () => {
  expanded.value = { version: 2,ownerUserId: 'owner',cells: [{ roomId: '0,0',roomVersion: 1 }] };
  auth.id = 'player';const session = await play({ expandedRoomId: 'course:demo',expandedRoomVersion: 2 });
  await call('/api/lost-songs/find',findBody(session));expect((await loadLostSongProgress(env,'player')).total).toBe(1);
  await expect(play({ expandedRoomId: 'course:demo',expandedRoomVersion: 1 })).rejects.toMatchObject({ status: 409 });
  expanded.value = { version: 2,ownerUserId: 'owner',cells: [{ roomId: '1,0',roomVersion: 1 }] };
  await expect(play({ expandedRoomId: 'course:demo',expandedRoomVersion: 2 })).rejects.toMatchObject({ status: 409 });
});
it('atomically caps XP at ten daily finds while retaining every find and prevents increments on retries or rollback', async () => {
  const find = (n: number) => ({ roomId: `${n},0`,roomVersion: 1,sessionId: `session-${n}`,foundAt: new Date().toISOString() });
  for (let n=0;n<12;n++) await saveUserLostSong(env,'player',find(n));
  await saveUserLostSong(env,'player',find(0));
  expect(db.prepare('SELECT total_pxp FROM user_progress WHERE user_id=?').get('player')).toMatchObject({ total_pxp: 50 });
  expect((await loadLostSongProgress(env,'player')).total).toBe(12);
  expect(db.prepare('SELECT COUNT(*) n FROM pxp_events').get()).toMatchObject({ n: 10 });
  expect(db.prepare("SELECT badge_id FROM badge_awards WHERE badge_id='player_10_lost_songs'").get()).toBeDefined();
  failIncrement = true;await expect(saveUserLostSong(env,'other',find(1))).rejects.toThrow(/transaction failure/);
  expect((await loadLostSongProgress(env,'other')).total).toBe(0);
  expect((await saveUserLostSong(env,'other',find(1))).xp).toBe(5);
});
it('bounds active proof storage and expires guest receipts without erasing account finds', async () => {
  for (let i=0;i<32;i++) await play();await expect(play()).rejects.toMatchObject({ status: 429 });
  await saveUserLostSong(env,'player',{ roomId: '0,0',roomVersion: 1,sessionId: 'saved',foundAt: new Date().toISOString() });
  db.exec("UPDATE lost_song_play_sessions SET expires_at='2000-01-01'");await purgeLostSongSessions(env);
  expect(db.prepare('SELECT COUNT(*) n FROM lost_song_play_sessions').get()).toMatchObject({ n: 0 });
  expect((await loadLostSongProgress(env,'player')).total).toBe(1);
});

it('rejects a switched account and new ownership of an Expanded Room, including guest claiming', async () => {
  auth.id = 'player';
  await expect(call('/api/lost-songs/play',{ roomId: '0,0',roomVersion: 1,expectedUserId: 'other' })).rejects.toMatchObject({ status: 409 });
  expanded.value = { version: 1,ownerUserId: 'owner',cells: [{ roomId: '0,0',roomVersion: 1 }] };
  const signed = await play({ expandedRoomId: 'course:demo', expandedRoomVersion: 1 });
  expanded.value = { version: 1,ownerUserId: 'player',cells: [{ roomId: '0,0',roomVersion: 1 }] };
  await expect(call('/api/lost-songs/find',findBody(signed))).rejects.toMatchObject({ status: 409 });
  auth.id = null; expanded.value = { version: 1,ownerUserId: 'owner',cells: [{ roomId: '0,0',roomVersion: 1 }] };
  const guest = await play({ expandedRoomId: 'course:demo',expandedRoomVersion: 1 });
  await call('/api/lost-songs/find',findBody(guest));
  auth.id = 'player';expanded.value = { version: 1,ownerUserId: 'player',cells: [{ roomId: '0,0',roomVersion: 1 }] };
  expect(await (await call('/api/lost-songs/claim',{ roomIds: ['0,0'],expectedUserId: 'player' })).json()).toMatchObject({ claimed: [],skipped: ['0,0'],xp: 0 });
  auth.id = null; db.exec("UPDATE guest_lost_songs SET expires_at='2000-01-01'");await purgeLostSongSessions(env);
  expect(db.prepare('SELECT COUNT(*) n FROM guest_lost_songs').get()).toMatchObject({ n: 0 });
});
