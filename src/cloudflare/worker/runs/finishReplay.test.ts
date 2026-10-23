import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { RunFinishRequestBody, RunStartResponse } from '../../../runs/model';
import { createSession } from '../auth/store';
import { HttpError } from '../core/http';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { syncUserBadges } from '../progression/badgesTrophies';
import { assertReplayableRunFinish, finalizeStatementWon, runPastDisconnect } from './finishReplay';
import { handleRunFinish, handleRunStart } from './routes';

class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly owner: Database, readonly sql: string) {}
  bind(...values: unknown[]): this { this.values = values as typeof this.values; return this; }
  async first<T>(): Promise<T | null> { this.owner.read(); return this.owner.db.prepare(this.sql).get(...this.values) as T ?? null; }
  async all<T>(): Promise<{ results: T[] }> { this.owner.read(); return { results: this.owner.db.prepare(this.sql).all(...this.values) as T[] }; }
}
/** node:sqlite behind D1's batch shape: RETURNING rows in `results`, the change count in `meta` (as Miniflare's D1 does). */
class Database implements D1Database {
  beforeBatch: ((sql: string[]) => Promise<void>) | null = null;
  /** Throws instead of running a batch it picks, as a D1 blip partway through the settle step would. */
  failBatch: ((sql: string[]) => boolean) | null = null;
  /** Fail the first read after the finalize commit, as a D1 blip in the post-commit steps would. */
  failAfterFinalize = false;
  private failNextRead = false;
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(this, sql); }
  withSession(): this { return this; }
  read(): void {
    if (!this.failNextRead) return;
    this.failNextRead = false;
    throw new Error('D1 unavailable');
  }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    const sql = statements.map((statement) => (statement as Statement).sql);
    await this.beforeBatch?.(sql);
    if (this.failBatch?.(sql)) throw new Error('D1 unavailable');
    this.read();
    this.db.exec('BEGIN');
    try {
      const results = statements.map((statement) => {
        const rows = this.db.prepare((statement as Statement).sql).all(...(statement as Statement).values);
        const { n } = this.db.prepare('SELECT changes() AS n').get() as { n: number };
        return { results: rows, meta: { changes: n } } as T;
      });
      this.db.exec('COMMIT');
      if (this.failAfterFinalize && sql.some((statement) => statement.includes('UPDATE room_runs'))) {
        this.failAfterFinalize = false;
        this.failNextRead = true;
      }
      return results;
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
  sqlite.prepare(`INSERT INTO daily_rooms (date,target_key,target_type,content_id,version,room_id,room_version,room_x,room_y,title,builder_user_id,builder_display_name,goal_json,cell_count,picked_by,picked_at)
    VALUES ('2026-10-09','room:0,0','room','0,0',1,'0,0',1,0,0,'Room','builder','builder',?,1,'automatic',?)`).run(JSON.stringify(goal), NOW.toISOString());
  session = await createSession(env, 'player');
});
afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

const headers = () => ({ 'Content-Type': 'application/json', Origin: 'https://wamp.land', Cookie: `ep_session=${session}` });
const request = (body: unknown) => new Request('https://api.wamp.land/api/runs/run', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
async function startRun(startAtMs = 0) {
  vi.setSystemTime(NOW.getTime() + startAtMs);
  const start = await (await handleRunStart(request({ roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, roomVersion: 1, goal }), env)).json() as RunStartResponse;
  vi.setSystemTime(NOW.getTime() + startAtMs + 9_000);
  const body: RunFinishRequestBody = { result: 'completed', elapsedMs: 9_000, deaths: 0, collectiblesCollected: 0, enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0,
    verificationTrace: { schemaVersion: 1, verificationNonce: start.verificationNonce, snapshotHash: start.snapshotHash, traceDurationMs: 9_000, inputEvents: [], roomTransitions: [],
      breadcrumbs: Array.from({ length: 37 }, (_, index) => ({ atMs: Math.min(9_000, index * 250), roomX: 0, roomY: 0, x: 64, y: 64, vx: 0, vy: 0, grounded: true })),
      goalEvents: [{ atMs: 9_000, type: 'reach_exit', actor: 'player', roomId: '0,0', roomX: 0, roomY: 0, x: 64, y: 64, instanceId: null, checkpointIndex: null }] } };
  return { attemptId: start.attemptId, body };
}
async function finish(attemptId: string, body: RunFinishRequestBody, deferred: Promise<unknown>[] = []) {
  const context = { waitUntil: (promise: Promise<unknown>) => { deferred.push(promise); } };
  const response = await handleRunFinish(request(body), env, attemptId, context).catch((error: unknown) => error);
  await Promise.all(deferred);
  return response;
}
const count = (sql: string) => Number((sqlite.prepare(sql).get() as { n: number }).n);
const awards = () => ({
  firstClear: count(`SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'player' AND event_type = 'room_clear_first'`),
  dailyClear: count(`SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'player' AND event_type = 'daily_clear'`),
  builder: count(`SELECT COUNT(*) AS n FROM bxp_events WHERE user_id = 'builder' AND event_type = 'unique_completion_room'`),
  finalized: count(`SELECT COUNT(*) AS n FROM point_events WHERE user_id = 'player' AND event_type = 'run_finalized'`),
});
const once = { firstClear: 1, dailyClear: 1, builder: 1, finalized: 1 };
const settledMarkers = () => count(`SELECT COUNT(*) AS n FROM point_events WHERE event_type = 'run_settled'`);
const stored = (attemptId: string, column: string) => (sqlite.prepare(`SELECT ${column} AS v FROM room_runs WHERE attempt_id = ?`).get(attemptId) as { v: string }).v;
const finalizePoints = (attemptId: string) => sqlite.prepare(`SELECT points, created_at, json_extract(breakdown_json, '$.awardMode') AS mode
  FROM point_events WHERE event_type = 'run_finalized' AND source_key = ?`).get(attemptId) as { points: number; created_at: string; mode: string };
/** Fails the nth batch that records a player XP event. */
const failNthXpEvent = (n: number) => {
  let seen = 0;
  return (sql: string[]) => sql.some((statement) => statement.includes('INTO pxp_events')) && (seen += 1) === n;
};
const progressMatchesEvents = () => {
  const pxp = sqlite.prepare(`SELECT total_pxp AS total, (SELECT SUM(amount) FROM pxp_events WHERE user_id = 'player') AS events
    FROM user_progress WHERE user_id = 'player'`).get() as { total: number; events: number };
  return pxp.total === pxp.events;
};

describe('resent ranked finishes (F351)', () => {
  it('answers a resend of a counted clear with 204 and awards nothing twice', async () => {
    const { attemptId, body } = await startRun();
    expect(await finish(attemptId, body)).toMatchObject({ status: 204 });
    expect(awards()).toEqual(once);
    const finishedAt = (sqlite.prepare('SELECT finished_at AS at FROM room_runs WHERE attempt_id = ?').get(attemptId) as { at: string }).at;

    vi.setSystemTime(NOW.getTime() + 40_000); // the client's timeout, then its retries
    const resent: Promise<unknown>[] = [];
    expect(await finish(attemptId, body, resent)).toMatchObject({ status: 204 });
    expect(resent).toHaveLength(0);
    expect(awards()).toEqual(once);
    expect(count(`SELECT COUNT(*) AS n FROM room_runs WHERE result = 'completed'`)).toBe(1);
    // The resend did not move the recorded finish onto its later server clock.
    expect((sqlite.prepare('SELECT finished_at AS at FROM room_runs WHERE attempt_id = ?').get(attemptId) as { at: string }).at).toBe(finishedAt);
  });

  it('awards a clear exactly once when a step after the commit threw and the client resent', async () => {
    const { attemptId, body } = await startRun();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    database.failAfterFinalize = true;
    expect(await finish(attemptId, body)).toMatchObject({ message: 'D1 unavailable' });
    expect(count(`SELECT COUNT(*) AS n FROM room_runs WHERE result = 'completed'`)).toBe(1);
    expect(awards()).toEqual({ firstClear: 0, dailyClear: 0, builder: 0, finalized: 0 });

    vi.setSystemTime(NOW.getTime() + 10_000); // the client's 1s retry
    expect(await finish(attemptId, body)).toMatchObject({ status: 204 });
    expect(awards()).toEqual(once);
    // Keyed to the original clear's day, not the resend's clock.
    expect(count(`SELECT COUNT(*) AS n FROM pxp_events WHERE event_type = 'daily_clear' AND source_id = '2026-10-09'`)).toBe(1);
    expect(progressMatchesEvents()).toBe(true);

    const again: Promise<unknown>[] = [];
    expect(await finish(attemptId, body, again)).toMatchObject({ status: 204 });
    expect(again).toHaveLength(0);
    expect(awards()).toEqual(once);
  });

  it('keeps the points and each recorded award\'s total when a deferred award fails, and a resend fills in the rest', async () => {
    const { attemptId, body } = await startRun();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // 1st XP event: the daily clear before the reply. 2nd: first clear. 3rd (fails): weekly play.
    database.failBatch = failNthXpEvent(3);
    expect(await finish(attemptId, body)).toMatchObject({ status: 204 });
    // The run's points went first and stay; the "rewards finished" marker never got written.
    expect(awards()).toMatchObject({ finalized: 1, dailyClear: 1, firstClear: 1 });
    expect(settledMarkers()).toBe(0);
    // Each recorded XP event already carries its total; none is stranded for the re-run to skip.
    expect(progressMatchesEvents()).toBe(true);

    database.failBatch = null;
    vi.setSystemTime(NOW.getTime() + 60_000);
    expect(await finish(attemptId, body)).toMatchObject({ status: 204 });
    expect(awards()).toEqual(once);
    expect(settledMarkers()).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'player' AND event_type = 'weekly_play'`)).toBe(1);
    expect(progressMatchesEvents()).toBe(true);
    // Re-settled events keep the clear's own time (day and week keys, daily caps, weekly boards).
    expect(finalizePoints(attemptId).created_at).toBe(stored(attemptId, 'finished_at'));
  });

  it('lets two settles award the same badge at once without either throwing', async () => {
    const { attemptId, body } = await startRun();
    await finish(attemptId, body);
    sqlite.prepare("DELETE FROM badge_awards WHERE user_id = 'player'").run();
    await expect(Promise.all([syncUserBadges(env, 'player'), syncUserBadges(env, 'player')])).resolves.toBeDefined();
    expect(count(`SELECT COUNT(*) AS n FROM badge_awards WHERE user_id = 'player' AND badge_id = 'player_first_clear'`)).toBe(1);
    expect(count(`SELECT badge_count AS n FROM user_progress WHERE user_id = 'player'`))
      .toBe(count(`SELECT COUNT(*) AS n FROM badge_awards WHERE user_id = 'player'`));
  });

  it('gives the first clear to the earlier stored finish when its resend lands after a later clear', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const earlier = await startRun();
    database.failAfterFinalize = true;
    expect(await finish(earlier.attemptId, earlier.body)).toMatchObject({ message: 'D1 unavailable' });
    // The player restarted while that clear waited to resend, and cleared again.
    const later = await startRun(30_000);
    expect(await finish(later.attemptId, later.body)).toMatchObject({ status: 204 });
    expect(finalizePoints(later.attemptId).mode).not.toBe('first_completion');

    vi.setSystemTime(NOW.getTime() + 120_000);
    expect(await finish(earlier.attemptId, earlier.body)).toMatchObject({ status: 204 });
    expect(finalizePoints(earlier.attemptId).mode).toBe('first_completion');
    expect(awards().firstClear).toBe(1);
  });

  it('replays a stored verification failure rather than reporting the resend as saved', async () => {
    const { attemptId, body } = await startRun();
    await finish(attemptId, body);
    sqlite.prepare("UPDATE room_runs SET verification_status = 'failed', verification_reason = 'trace_goal' WHERE attempt_id = ?").run(attemptId);
    expect(await finish(attemptId, body)).toMatchObject({ status: 409, message: 'Ranked run could not be verified.' });
  });

  it('lets only one of two overlapping finishes for the same attempt finalize it', async () => {
    const { attemptId, body } = await startRun();
    // The original is still verifying when the client's timed-out resend arrives: hold the first
    // finalize until the second request has also passed its "still active" check.
    let releaseFirst: (() => void) | null = null;
    database.beforeBatch = async (sql) => {
      if (!sql.some((statement) => statement.includes('UPDATE room_runs'))) return;
      if (!releaseFirst) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      else releaseFirst();
    };
    const [original, resend] = await Promise.all([finish(attemptId, body), finish(attemptId, body)]);
    expect(original).toMatchObject({ status: 204 });
    expect(resend).toMatchObject({ status: 204 });
    // The loser neither rewrote the row nor recorded a second verification audit.
    expect(count(`SELECT COUNT(*) AS n FROM run_verification_audit WHERE attempt_id = '${attemptId}'`)).toBe(1);
    expect(awards()).toEqual(once);
    expect(progressMatchesEvents()).toBe(true);
  });

  it('keeps a finish with a different result than the stored one a conflict', async () => {
    const { attemptId, body } = await startRun();
    await finish(attemptId, body);
    expect(await finish(attemptId, { ...body, result: 'abandoned' })).toMatchObject({ status: 409, message: 'This run attempt has already been finalized.' });
  });
});

describe('finish replay helpers', () => {
  const messages = { missingTrace: 'missing', unverified: 'unverified', timedOut: 'timed out', finalized: 'finalized' };
  const replay = (stored: Parameters<typeof assertReplayableRunFinish>[0], requested: 'completed' | 'abandoned' = 'completed') => {
    try { assertReplayableRunFinish(stored, requested, messages); return 'counted'; } catch (error) {
      return error instanceof HttpError ? `${error.status} ${error.message}` : error;
    }
  };

  it('maps the stored outcome to the answer the original request gave', () => {
    expect(replay({ result: 'completed', verificationStatus: 'passed' })).toBe('counted');
    expect(replay({ result: 'completed', verificationStatus: 'not_required' })).toBe('counted');
    expect(replay({ result: 'abandoned', verificationStatus: null }, 'abandoned')).toBe('counted');
    expect(replay({ result: 'completed', verificationStatus: 'failed', verificationReason: 'missing_trace' })).toBe('409 missing');
    expect(replay({ result: 'completed', verificationStatus: 'failed', verificationReason: 'trace_client_outdated' }))
      .toBe('409 Client update required for ranked verification.');
    expect(replay({ result: 'completed', verificationStatus: 'failed', verificationReason: 'trace_goal' })).toBe('409 unverified');
    expect(replay({ result: 'completed', verificationStatus: 'timeout' })).toBe('409 timed out');
    expect(replay({ result: 'failed', verificationStatus: 'not_required' })).toBe('409 finalized');
    expect(replay({ result: 'active' }, 'completed')).toBe('409 finalized');
    expect(replay(null)).toBe('409 finalized');
  });

  it('reads a won finalize from its RETURNING rows, and D1\'s change count only without them', () => {
    expect(finalizeStatementWon({ results: [{ attempt_id: 'a' }], meta: { changes: 1 } })).toBe(true);
    expect(finalizeStatementWon({ results: [{ attempt_id: 'a' }] })).toBe(true);
    // A RETURNING statement that returned nothing lost, whatever the change count says.
    expect(finalizeStatementWon({ results: [], meta: { changes: 1 } })).toBe(false);
    expect(finalizeStatementWon({ results: [], meta: { changes: 0 } })).toBe(false);
    expect(finalizeStatementWon({ meta: { changes: 1 } })).toBe(true);
    expect(finalizeStatementWon(undefined)).toBe(false);
  });

  it('keeps post-commit work alive past a disconnect while the reply still waits for it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const kept: Promise<unknown>[] = [];
    const context = { waitUntil: (promise: Promise<unknown>) => { kept.push(promise); } };
    await runPastDisconnect(context, 'attempt', Promise.resolve());
    expect(kept).toHaveLength(1);
    await expect(runPastDisconnect(context, 'attempt', Promise.reject(new Error('D1 unavailable')))).rejects.toThrow('D1 unavailable');
    await Promise.all(kept);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"event":"run-finish-settle-failed"'));
  });
});
