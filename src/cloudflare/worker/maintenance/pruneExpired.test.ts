import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1PreparedStatement, Env } from '../core/types';
import { pruneExpiredRecords } from './pruneExpired';
let db: DatabaseSync;
let env: Env;
const now = new Date('2026-10-14T01:00:00.000Z');
function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return { bind: (...next) => statement(sql, next),
    async first<T>() { return db.prepare(sql).get(...values as []) as T; },
    async all<T>() { return { results: db.prepare(sql).all(...values as []) as T[] }; } };
}
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_create_auth.sql', 'utf8'));
  db.exec(`CREATE TABLE world_render_tile_outbox (id INTEGER PRIMARY KEY, state TEXT, dispatched_at TEXT);`);
  db.exec(readFileSync('migrations/0065_processed_outbox_expiry.sql', 'utf8'));
  db.prepare('INSERT INTO users(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run('user', 'Test', now.toISOString(), now.toISOString());
  env = { DB: { prepare: statement, async batch(statements: D1PreparedStatement[]) {
    const results = [];
    db.exec('BEGIN');
    try { for (const s of statements) { await s.all(); results.push({meta: {changes: Number((db.prepare('SELECT changes() AS n').get() as {n:number}).n)}}); } db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    return results;
  } } } as unknown as Env;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { db.close(); vi.restoreAllMocks(); });
function auth(id: string, expiry: string) {
  db.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)')
    .run(id, 'user', id, expiry, now.toISOString(), now.toISOString());
  db.prepare('INSERT INTO magic_link_tokens(id,user_id,email,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, 'user', 'test@example.com', id, expiry, now.toISOString());
}
describe('hourly expired-record cleanup', () => {
  it('deletes only expired auth and dispatched jobs completed at least seven days ago', async () => {
    auth('expired', '2026-10-13T23:59:59.999Z');
    auth('boundary', now.toISOString());
    auth('active', '2026-10-14T01:00:00.001Z');
    const insert = db.prepare('INSERT INTO world_render_tile_outbox VALUES(?,?,?)');
    insert.run(1, 'dispatched', '2026-10-07T01:00:00.000Z');
    insert.run(2, 'dispatched', '2026-10-07T01:00:00.001Z');
    insert.run(3, 'pending', '2000-01-01T00:00:00.000Z');
    insert.run(4, 'dispatching', '2000-01-01T00:00:00.000Z');
    insert.run(5, 'dispatched', null);
    await pruneExpiredRecords(env, now);
    for (const table of ['sessions', 'magic_link_tokens']) expect(db.prepare(`SELECT id FROM ${table}`).all()).toEqual([{id:'active'}]);
    expect(db.prepare('SELECT id FROM world_render_tile_outbox ORDER BY id').all()).toEqual([2,3,4,5].map(id => ({id})));
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({n:1});
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"processedOutbox":1'));
    expect(db.prepare("EXPLAIN QUERY PLAN SELECT id FROM world_render_tile_outbox WHERE state='dispatched' AND dispatched_at <= ? ORDER BY dispatched_at LIMIT 5000").all(now.toISOString()))
      .toEqual(expect.arrayContaining([expect.objectContaining({detail:expect.stringContaining('idx_world_render_tile_outbox_processed_expiry')})]));
  });
  it('bounds each hourly delete and makes progress on a backlog', async () => {
    db.exec(`WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<5002)
      INSERT INTO world_render_tile_outbox SELECT n,'dispatched','2000-01-01T00:00:00.000Z' FROM ids;`);
    await pruneExpiredRecords(env, now);
    expect(db.prepare('SELECT COUNT(*) AS n FROM world_render_tile_outbox').get()).toMatchObject({n:2});
    await pruneExpiredRecords(env, now);
    expect(db.prepare('SELECT COUNT(*) AS n FROM world_render_tile_outbox').get()).toMatchObject({n:0});
  });
  it('rejects an invalid clock before deleting any rows', async () => {
    auth('expired', '2000-01-01T00:00:00.000Z');
    await expect(pruneExpiredRecords(env, new Date('invalid'))).rejects.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({n:1});
  });
});
