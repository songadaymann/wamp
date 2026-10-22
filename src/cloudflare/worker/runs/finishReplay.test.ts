import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { RunFinishRequestBody, RunStartResponse } from '../../../runs/model';
import { createSession } from '../auth/store';
import { HttpError } from '../core/http';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { replayFinalizedRunFinish } from './finishReplay';
import { handleRunFinish, handleRunStart } from './routes';

class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly owner: Database, readonly sql: string) {}
  bind(...values: unknown[]): this { this.values = values as typeof this.values; return this; }
  async first<T>(): Promise<T | null> { return this.owner.db.prepare(this.sql).get(...this.values) as T ?? null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.owner.db.prepare(this.sql).all(...this.values) as T[] }; }
}
class Database implements D1Database {
  beforeBatch: ((sql: string[]) => Promise<void>) | null = null;
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(this, sql); }
  withSession(): this { return this; }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    await this.beforeBatch?.(statements.map((statement) => (statement as Statement).sql));
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
  const room = { ...createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), title: 'Room', status: 'published' as const, publishedAt: NOW.toISOString(), version: 1, goal };
  const json = JSON.stringify(room);
  sqlite.prepare("INSERT INTO rooms (id,x,y,draft_json,published_json,claimer_user_id) VALUES ('0,0',0,0,?,?,'builder')").run(json, json);
  sqlite.prepare("INSERT INTO room_versions (room_id,version,snapshot_json,created_at,published_by_user_id) VALUES ('0,0',1,?,?,'builder')").run(json, NOW.toISOString());
  session = await createSession(env, 'player');
});
afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

const headers = () => ({ 'Content-Type': 'application/json', Origin: 'https://wamp.land', Cookie: `ep_session=${session}` });
const request = (body: unknown) => new Request('https://api.wamp.land/api/runs/run', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
async function startRun() {
  const start = await (await handleRunStart(request({ roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, roomVersion: 1, goal }), env)).json() as RunStartResponse;
  vi.setSystemTime(NOW.getTime() + 9_000);
  const body: RunFinishRequestBody = { result: 'completed', elapsedMs: 9_000, deaths: 0, collectiblesCollected: 0, enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0,
    verificationTrace: { schemaVersion: 1, verificationNonce: start.verificationNonce, snapshotHash: start.snapshotHash, traceDurationMs: 9_000, inputEvents: [], roomTransitions: [],
      breadcrumbs: Array.from({ length: 37 }, (_, index) => ({ atMs: Math.min(9_000, index * 250), roomX: 0, roomY: 0, x: 64, y: 64, vx: 0, vy: 0, grounded: true })),
      goalEvents: [{ atMs: 9_000, type: 'reach_exit', actor: 'player', roomId: '0,0', roomX: 0, roomY: 0, x: 64, y: 64, instanceId: null, checkpointIndex: null }] } };
  return { attemptId: start.attemptId, body };
}
async function finish(attemptId: string, body: RunFinishRequestBody, deferred: Promise<unknown>[] = []) {
  const context = { waitUntil: (promise: Promise<unknown>) => { deferred.push(promise); } };
  return handleRunFinish(request(body), env, attemptId, context).catch((error: unknown) => error);
}
const count = (sql: string) => Number((sqlite.prepare(sql).get() as { n: number }).n);
const firstClearAwards = () => count(`SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'player' AND event_type = 'room_clear_first'`);

describe('resent ranked finishes (F351)', () => {
  it('answers a resend of a counted clear with 204 and awards nothing twice', async () => {
    const { attemptId, body } = await startRun();
    const deferred: Promise<unknown>[] = [];
    expect(await finish(attemptId, body, deferred)).toMatchObject({ status: 204 });
    await Promise.all(deferred);
    const finishedAt = (sqlite.prepare('SELECT finished_at AS at FROM room_runs WHERE attempt_id = ?').get(attemptId) as { at: string }).at;

    vi.setSystemTime(NOW.getTime() + 40_000); // the client's 15s timeout, then its retries
    const resent: Promise<unknown>[] = [];
    expect(await finish(attemptId, body, resent)).toMatchObject({ status: 204 });
    await Promise.all(resent);
    expect(resent).toHaveLength(0);
    expect(firstClearAwards()).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM room_runs WHERE result = 'completed'`)).toBe(1);
    // The resend did not move the recorded finish onto its later server clock.
    expect((sqlite.prepare('SELECT finished_at AS at FROM room_runs WHERE attempt_id = ?').get(attemptId) as { at: string }).at).toBe(finishedAt);
  });

  it('replays a stored verification failure rather than reporting the resend as saved', async () => {
    const { attemptId, body } = await startRun();
    await finish(attemptId, body);
    sqlite.prepare("UPDATE room_runs SET verification_status = 'failed', verification_reason = 'trace_goal' WHERE attempt_id = ?").run(attemptId);
    expect(await finish(attemptId, body)).toMatchObject({ status: 409, message: 'Ranked run could not be verified.' });
  });

  it('lets only one of two overlapping finishes for the same attempt finalize it', async () => {
    const { attemptId, body } = await startRun();
    const deferred: Promise<unknown>[][] = [[], []];
    // The original is still verifying when the client's timed-out resend arrives: hold the first
    // finalize until the second request has also passed its "still active" check.
    let releaseFirst: (() => void) | null = null;
    database.beforeBatch = async (sql) => {
      if (!sql.some((statement) => statement.includes('UPDATE room_runs'))) return;
      if (!releaseFirst) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      else releaseFirst();
    };
    const [original, resend] = await Promise.all([finish(attemptId, body, deferred[0]), finish(attemptId, body, deferred[1])]);
    await Promise.all(deferred.flat());
    expect(original).toMatchObject({ status: 204 });
    expect(resend).toMatchObject({ status: 204 });
    // Only the request whose guarded UPDATE claimed the row schedules rewards.
    expect(deferred.filter(scheduled => scheduled.length > 0)).toHaveLength(1);
    expect(firstClearAwards()).toBe(1);
  });

  it('keeps a finish with a different result than the stored one a conflict', async () => {
    const { attemptId, body } = await startRun();
    await finish(attemptId, body);
    expect(await finish(attemptId, { ...body, result: 'abandoned' })).toMatchObject({ status: 409, message: 'This run attempt has already been finalized.' });
  });
});

describe('replayFinalizedRunFinish', () => {
  const messages = { missingTrace: 'missing', unverified: 'unverified', timedOut: 'timed out', finalized: 'finalized' };
  const replay = (stored: Parameters<typeof replayFinalizedRunFinish>[1], requested: 'completed' | 'abandoned' = 'completed') => {
    try { return replayFinalizedRunFinish(new Request('https://api.wamp.land/finish'), stored, requested, messages).status; } catch (error) {
      return error instanceof HttpError ? `${error.status} ${error.message}` : error;
    }
  };

  it('maps the stored outcome to the answer the original request gave', () => {
    expect(replay({ result: 'completed', verificationStatus: 'passed' })).toBe(204);
    expect(replay({ result: 'completed', verificationStatus: 'not_required' })).toBe(204);
    expect(replay({ result: 'abandoned', verificationStatus: null }, 'abandoned')).toBe(204);
    expect(replay({ result: 'completed', verificationStatus: 'failed', verificationReason: 'missing_trace' })).toBe('409 missing');
    expect(replay({ result: 'completed', verificationStatus: 'failed', verificationReason: 'trace_client_outdated' }))
      .toBe('409 Client update required for ranked verification.');
    expect(replay({ result: 'completed', verificationStatus: 'failed', verificationReason: 'trace_goal' })).toBe('409 unverified');
    expect(replay({ result: 'completed', verificationStatus: 'timeout' })).toBe('409 timed out');
    expect(replay({ result: 'failed', verificationStatus: 'not_required' })).toBe('409 finalized');
    expect(replay(null)).toBe('409 finalized');
  });
});
