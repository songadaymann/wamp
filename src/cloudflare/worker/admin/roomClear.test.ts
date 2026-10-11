import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';

vi.mock('../auth/request', async (actual) => ({ ...await actual<object>(), requireAdminRequest: () => undefined }));
vi.mock('../runs/points', async (actual) => ({ ...await actual<object>(), upsertUserStats: vi.fn(async () => undefined) }));
vi.mock('../playableContentIndex/store', async (actual) => ({
  ...await actual<object>(),
  refreshPlayableContentIndexForRoom: vi.fn(async () => undefined),
  schedulePlayableContentIndexRefresh: vi.fn(),
}));

import { handleAdminRequest } from './routes';

/** D1 refuses a statement with more than 100 bound parameters; node:sqlite would allow it. */
const D1_MAX_BOUND_PARAMETERS = 100;
let db: DatabaseSync;
let env: Env;

function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...next: unknown[]) => {
      if (next.length > D1_MAX_BOUND_PARAMETERS) throw new Error('D1_ERROR: too many SQL variables');
      return statement(sql, next);
    },
    async first<T>() { return (db.prepare(sql).get(...values as []) ?? null) as T | null; },
    async all<T>() { return { results: db.prepare(sql).all(...values as []) as T[] }; },
  } as D1PreparedStatement;
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE rooms (id TEXT PRIMARY KEY, claimer_user_id TEXT);
    CREATE TABLE room_runs (attempt_id TEXT PRIMARY KEY, room_id TEXT, user_id TEXT);
    CREATE TABLE room_versions (room_id TEXT, version INTEGER, published_by_user_id TEXT);
    CREATE TABLE room_difficulty_votes (room_id TEXT, user_id TEXT);
    CREATE TABLE point_events (id INTEGER PRIMARY KEY, event_type TEXT, source_key TEXT);
  `);
  const database = {
    prepare: statement,
    async batch<T>(queries: D1PreparedStatement[]): Promise<T[]> {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const query of queries) results.push(await query.all());
        db.exec('COMMIT');
        return results as T[];
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    withSession: () => database,
  } as unknown as D1Database;
  env = { DB: database } as unknown as Env;
});
afterEach(() => db.close());

describe('admin room clear (F205)', () => {
  it('clears a room with more runs than D1 allows bound parameters', async () => {
    db.prepare('INSERT INTO rooms VALUES (?, ?)').run('4,2', 'builder');
    const addRun = db.prepare('INSERT INTO room_runs VALUES (?, ?, ?)');
    const addPoints = db.prepare('INSERT INTO point_events (event_type, source_key) VALUES (?, ?)');
    for (let i = 0; i < 150; i += 1) {
      addRun.run(`attempt-${i}`, '4,2', `player-${i % 7}`);
      addPoints.run('run_finalized', `attempt-${i}`);
    }
    addPoints.run('run_finalized', 'attempt-in-another-room');

    const url = new URL('https://api.wamp.land/api/admin/rooms/4%2C2/clear');
    const response = await handleAdminRequest(new Request(url, { method: 'POST', headers: { Origin: 'https://wamp.land' } }), url, env);
    expect(response.status).toBe(200);
    expect((await response.json() as { deleted: { runs: number } }).deleted.runs).toBe(150);
    const left = db.prepare("SELECT source_key FROM point_events WHERE event_type = 'run_finalized'").all() as { source_key: string }[];
    expect(left.map((row) => row.source_key)).toEqual(['attempt-in-another-room']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM room_runs').get()).toEqual({ n: 0 });
  });
});
