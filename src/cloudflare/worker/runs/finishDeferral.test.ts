import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { RunFinishRequestBody, RunStartResponse } from '../../../runs/model';
import { createSession } from '../auth/store';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { handleRunFinish, handleRunStart } from './routes';

class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly owner: Database, readonly sql: string) {}
  bind(...values: unknown[]): this { this.values = values as typeof this.values; return this; }
  async first<T>(): Promise<T | null> { this.owner.roundTrips += 1; return this.owner.db.prepare(this.sql).get(...this.values) as T ?? null; }
  async all<T>(): Promise<{ results: T[] }> { this.owner.roundTrips += 1; return { results: this.owner.db.prepare(this.sql).all(...this.values) as T[] }; }
}
class Database implements D1Database {
  roundTrips = 0;
  failAt: string | null = null;
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(this, sql); }
  withSession(): this { return this; }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    this.roundTrips += 1;
    if (this.failAt && statements.some((statement) => (statement as Statement).sql.includes(this.failAt!))) throw new Error('D1 unavailable');
    this.db.exec('BEGIN');
    try {
      const results = statements.map((statement) => ({ results: this.db.prepare((statement as Statement).sql).all(...(statement as Statement).values) }) as T);
      this.db.exec('COMMIT'); return results;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

const NOW = new Date('2026-10-09T16:00:00Z');
const goal = { type: 'reach_exit' as const, exit: { x: 64, y: 64 }, timeLimitMs: null };
let sqlite: DatabaseSync; let database: Database; let env: Env; let session: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../../../../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  database = new Database(sqlite);
  env = { DB: database, JAM_DB: database, ASSETS: { fetch: async () => new Response() } };
  for (const user of ['player', 'builder']) sqlite.prepare('INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(user, `${user}@example.test`, user, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
  const room = { ...createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), title: 'Daily', status: 'published' as const, publishedAt: NOW.toISOString(), version: 1, goal };
  const json = JSON.stringify(room);
  sqlite.prepare("INSERT INTO rooms (id,x,y,draft_json,published_json,claimer_user_id) VALUES ('0,0',0,0,?,?,'builder')").run(json, json);
  sqlite.prepare("INSERT INTO room_versions (room_id,version,snapshot_json,created_at,published_by_user_id) VALUES ('0,0',1,?,?,'builder')").run(json, NOW.toISOString());
  sqlite.prepare(`INSERT INTO daily_rooms (date,target_key,target_type,content_id,version,room_id,room_version,room_x,room_y,title,builder_user_id,builder_display_name,goal_json,cell_count,picked_by,picked_at)
    VALUES ('2026-10-09','room:0,0','room','0,0',1,'0,0',1,0,0,'Daily','builder','builder',?,1,'automatic',?)`).run(JSON.stringify(goal), NOW.toISOString());
  session = await createSession(env, 'player');
});
afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function finishClear() {
  const headers = { 'Content-Type': 'application/json', Origin: 'https://wamp.land', Cookie: `ep_session=${session}` };
  const request = (body: unknown) => new Request('https://api.wamp.land/api/runs/run', { method: 'POST', headers, body: JSON.stringify(body) });
  const start = await (await handleRunStart(request({ roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, roomVersion: 1, goal }), env)).json() as RunStartResponse;
  vi.setSystemTime(NOW.getTime() + 9_000);
  const body: RunFinishRequestBody = { result: 'completed', elapsedMs: 9_000, deaths: 0, collectiblesCollected: 0, enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0,
    verificationTrace: { schemaVersion: 1, verificationNonce: start.verificationNonce, snapshotHash: start.snapshotHash, traceDurationMs: 9_000, inputEvents: [], roomTransitions: [],
      breadcrumbs: Array.from({ length: 37 }, (_, index) => ({ atMs: Math.min(9_000, index * 250), roomX: 0, roomY: 0, x: 64, y: 64, vx: 0, vy: 0, grounded: true })),
      goalEvents: [{ atMs: 9_000, type: 'reach_exit', actor: 'player', roomId: '0,0', roomX: 0, roomY: 0, x: 64, y: 64, instanceId: null, checkpointIndex: null }] } };
  const deferred: Promise<unknown>[] = [];
  const context = { waitUntil: (promise: Promise<unknown>) => { deferred.push(promise); } };
  database.roundTrips = 0;
  const response = await handleRunFinish(request(body), env, start.attemptId, context);
  return { response, roundTripsBeforeResponse: database.roundTrips, deferred };
}
const count = (sql: string) => Number((sqlite.prepare(sql).get() as { n: number }).n);

describe('run finish responds before rewards (F029)', () => {
  it('records and ranks the run, awards the daily clear, and leaves the rest to waitUntil', async () => {
    const { response, roundTripsBeforeResponse, deferred } = await finishClear();
    let rewardsDone = false;
    const settled = Promise.all(deferred).then(() => { rewardsDone = true; });
    expect(response.status).toBe(204);
    expect(rewardsDone).toBe(false);
    // Was 138 sequential round trips for this clear (a first clear that takes #1 in someone else's daily room).
    expect(roundTripsBeforeResponse).toBeLessThanOrEqual(45);
    expect(count(`SELECT COUNT(*) AS n FROM room_runs WHERE user_id = 'player' AND result = 'completed'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'player' AND event_type = 'daily_clear'`)).toBe(1);

    await settled;
    expect(count(`SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'player' AND event_type = 'room_clear_first'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'player' AND event_type = 'daily_clear'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM bxp_events WHERE user_id = 'builder' AND event_type = 'unique_completion_room'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM user_stats WHERE user_id IN ('player', 'builder')`)).toBe(2);
    const pxp = sqlite.prepare(`SELECT total_pxp AS total, (SELECT SUM(amount) FROM pxp_events WHERE user_id = 'player') AS events FROM user_progress WHERE user_id = 'player'`).get() as { total: number; events: number };
    expect(pxp.total).toBe(pxp.events);
  });

  it('keeps the finish when deferred rewards fail, and logs the attempt', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    database.failAt = 'INSERT INTO user_stats';
    const { response, deferred } = await finishClear();
    await Promise.all(deferred);
    expect(response.status).toBe(204);
    expect(count(`SELECT COUNT(*) AS n FROM room_runs WHERE result = 'completed'`)).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"event":"run-rewards-failed"'));
  });
});
