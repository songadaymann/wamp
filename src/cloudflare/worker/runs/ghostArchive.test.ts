import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import type { RunFinishRequestBody, RunStartResponse } from '../../../runs/model';
import type { RunGhost } from '../../../runs/ghostRace';
import { createSession } from '../auth/store';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { finishGuestRun, pruneGuestRuns, startGuestRun } from '../guestRuns/attempts';
import { guestRunIdentity } from '../guestRuns/identity';
import { flushRunGhostArchive, loadArchivedRunGhost, prepareRunGhostArchive } from './ghostArchive';
import { checkGhostArchiveCost, estimateGhostArchiveCost, ghostArchiveBillingPeriod } from './ghostArchiveCosts';
import { handleRunFinish, handleRunStart } from './routes';
import { handleAdminRequest } from '../admin/routes';

class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly db: DatabaseSync, readonly sql: string) {}
  bind(...values: unknown[]): this { this.values = values as typeof this.values; return this; }
  async first<T>(): Promise<T | null> { return this.db.prepare(this.sql).get(...this.values) as T ?? null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
}
class Database implements D1Database {
  failAt: string | null = null;
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(this.db, sql); }
  withSession(): this { return this; }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    this.db.exec('BEGIN');
    try {
      const results = statements.map(statement => {
        const s = statement as Statement;
        if (this.failAt && s.sql.includes(this.failAt)) { this.failAt = null; throw new Error('Interrupted write'); }
        return { results: this.db.prepare(s.sql).all(...s.values) } as T;
      });
      this.db.exec('COMMIT'); return results;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
const NOW = new Date('2026-10-09T16:00:00Z');
const guestHeaders = { 'X-Guest-User-Id': 'guest-player', 'X-Guest-Recovery-Token': 'a'.repeat(64),
  'Content-Type': 'application/json', Origin: 'https://wamp.land' };
const makeRequest = (body: unknown, headers = guestHeaders) => new Request('https://api.wamp.land/api/runs/start',
  { method: 'POST', headers, body: JSON.stringify(body) });
function finishBody(start: Pick<RunStartResponse, 'verificationNonce' | 'snapshotHash'>, elapsedMs: number): RunFinishRequestBody {
  return { result: 'completed', elapsedMs, deaths: 0, collectiblesCollected: 0, enemyCollectiblesCollected: 0,
    enemiesDefeated: 0, checkpointsReached: 0,
    verificationTrace: { schemaVersion: 1, verificationNonce: start.verificationNonce,
      snapshotHash: start.snapshotHash, traceDurationMs: elapsedMs, inputEvents: [], roomTransitions: [],
      breadcrumbs: [0, elapsedMs].map(atMs => ({ atMs, roomX: 0, roomY: 0, x: 64, y: 64, vx: 0, vy: 0, grounded: true })),
      goalEvents: [{ atMs: elapsedMs, type: 'reach_exit', actor: 'player', roomId: '0,0', roomX: 0, roomY: 0,
        x: 64, y: 64, instanceId: null, checkpointIndex: null }] } };
}
describe('completed ghost archive on the real schema', () => {
  let sqlite: DatabaseSync; let database: Database; let env: Env; let room: RoomSnapshot;
  let objects: Map<string, string>; let put: ReturnType<typeof vi.fn>; let session: string;
  beforeEach(async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON');
    const migrations = new URL('../../../../migrations/', import.meta.url);
    for (const file of readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
    }
    database = new Database(sqlite); objects = new Map();
    put = vi.fn(async (key: string, payload: string) => { objects.set(key, payload); return {}; });
    env = { DB: database, JAM_DB: database, ASSETS: { fetch: async () => new Response() },
      RUN_GHOST_BILLING_CYCLE_DAY: '5',
      RUN_GHOST_BUCKET: { put, get: vi.fn(async (key: string) => {
        const payload = objects.get(key);
        return payload === undefined ? null : { size: new TextEncoder().encode(payload).byteLength, text: async () => payload };
      }) } as unknown as Env['RUN_GHOST_BUCKET'] };
    sqlite.prepare("INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES ('user', 'user@example.test', 'Player', ?, ?)")
      .run(NOW.toISOString(), NOW.toISOString());
    room = { ...createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), title: 'Ghost archive test',
      status: 'published', publishedAt: NOW.toISOString(),
      goal: { type: 'reach_exit', exit: { x: 64, y: 64 }, timeLimitMs: null } };
    const json = JSON.stringify(room);
    sqlite.prepare('INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, 0, 0, ?, ?)').run(room.id, json, json);
    sqlite.prepare('INSERT INTO room_versions (room_id, version, snapshot_json, created_at) VALUES (?, 1, ?, ?)')
      .run(room.id, json, NOW.toISOString());
    session = await createSession(env, 'user');
  });
  afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const read = (db: DatabaseSync, sql: string) => db.prepare(sql).get() as Record<string, unknown>;
  async function accountRun(elapsedMs: number, patch: Partial<RunFinishRequestBody> = {}) {
    const headers = { ...guestHeaders, Cookie: `ep_session=${session}` };
    const response = await handleRunStart(makeRequest({ roomId: room.id, roomCoordinates: room.coordinates,
      roomVersion: 1, goal: room.goal }, headers), env);
    const start = await response.json() as RunStartResponse;
    vi.setSystemTime(Date.now() + elapsedMs);
    const body = { ...finishBody(start, elapsedMs), ...patch };
    await handleRunFinish(makeRequest(body, headers), env, start.attemptId);
    return start.attemptId;
  }
  it('retains slower and faster account completions while racing still selects the personal best', async () => {
    const first = await accountRun(1000);
    const slower = await accountRun(2000);
    const faster = await accountRun(500);
    expect(read(sqlite, 'SELECT COUNT(*) AS count FROM run_ghost_archive').count).toBe(3);
    expect(read(sqlite, 'SELECT attempt_id FROM run_ghosts').attempt_id).toBe(faster);
    expect(objects.size).toBe(3);
    for (const id of [first, slower, faster]) expect((await loadArchivedRunGhost(env, id))?.attemptId).toBe(id);
    expect(read(sqlite, 'SELECT COUNT(*) AS count FROM run_ghost_archive WHERE pending_payload_json IS NOT NULL').count).toBe(0);
    expect([...objects.values()].join('')).not.toMatch(/verificationNonce|snapshotHash|inputEvents|recovery|token/);
  });
  it('keeps guest completions after pending guest-progress records expire, without adding ranked entries', async () => {
    const identity = await guestRunIdentity(makeRequest({}));
    const start = await startGuestRun(env, identity, { contentType: 'room', contentId: room.id, version: 1, clientRunId: crypto.randomUUID() });
    vi.setSystemTime(Date.now() + 1000);
    const body = finishBody(start, 1000);
    expect((await finishGuestRun(env, identity, start.attemptId, makeRequest(body))).saved).toBe(true);
    await finishGuestRun(env, identity, start.attemptId, makeRequest(body));
    expect(objects.size).toBe(1); expect(put).toHaveBeenCalledTimes(1);
    expect(read(sqlite, 'SELECT source_kind, user_id FROM run_ghost_archive')).toMatchObject({ source_kind: 'guest_room', user_id: null });
    vi.setSystemTime(Date.now() + 15 * 86400000); await pruneGuestRuns(env);
    expect(read(sqlite, 'SELECT COUNT(*) AS count FROM guest_run_attempts').count).toBe(0);
    expect((await loadArchivedRunGhost(env, start.attemptId))?.displayName).toBe('Guest');
    expect(read(sqlite, 'SELECT COUNT(*) AS count FROM room_runs').count).toBe(0);
  });
  it('keeps a durable payload during an R2 outage, then retries once and releases the database payload', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    put.mockRejectedValueOnce(new Error('R2 outage'));
    const id = await accountRun(1000);
    expect(read(sqlite, 'SELECT pending_payload_json FROM run_ghost_archive').pending_payload_json).toBeTypeOf('string');
    expect((await loadArchivedRunGhost(env, id))?.attemptId).toBe(id);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('run-ghost-archive-upload-failed'));
    expect(await flushRunGhostArchive(env)).toEqual({ archived: 1, failed: 0 });
    expect(await flushRunGhostArchive(env)).toEqual({ archived: 0, failed: 0 });
    expect(objects.size).toBe(1);
    expect(read(sqlite, 'SELECT pending_payload_json FROM run_ghost_archive').pending_payload_json).toBeNull();
    expect(read(sqlite, 'SELECT uploads FROM run_ghost_archive_usage').uploads).toBe(2);
  });
  it('does not finalize a run if its durable recording cannot be queued', async () => {
    database.failAt = 'INSERT OR IGNORE INTO run_ghost_archive';
    await expect(accountRun(1000)).rejects.toThrow('Interrupted write');
    expect(read(sqlite, 'SELECT result FROM room_runs').result).toBe('active');
    expect(objects.size).toBe(0);
  });
  it('does not archive failed, abandoned, missing-trace or invalid-trace finishes', async () => {
    await accountRun(1000, { result: 'failed', verificationTrace: null });
    await accountRun(1000, { result: 'abandoned', verificationTrace: null });
    await expect(accountRun(1000, { verificationTrace: null })).rejects.toMatchObject({ status: 409 });
    await expect(accountRun(1000, { verificationTrace: finishBody({
      verificationNonce: 'wrong', snapshotHash: 'wrong',
    }, 1000).verificationTrace })).rejects.toMatchObject({ status: 409 });
    expect(objects.size).toBe(0);
    expect(read(sqlite, 'SELECT COUNT(*) AS count FROM run_ghost_archive').count).toBe(0);
  });
  it('backfills existing bests without changing them or retaining private verification fields', async () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      const migrations = new URL('../../../../migrations/', import.meta.url);
      for (const file of readdirSync(migrations).filter(file => file.endsWith('.sql') && !file.startsWith('0063')).sort()) {
        legacy.exec(readFileSync(new URL(file, migrations), 'utf8'));
      }
      const id = await accountRun(1000);
      const ghost = await loadArchivedRunGhost(env, id) as RunGhost;
      const payload = JSON.stringify(ghost);
      legacy.prepare('INSERT INTO run_ghosts VALUES (?, 1, ?, ?, 1000, 0, ?, ?)')
        .run(room.id, 'user', id, payload, NOW.toISOString());
      legacy.exec(readFileSync(new URL('0063_run_ghost_archive.sql', migrations), 'utf8'));
      expect(read(legacy, 'SELECT COUNT(*) AS count FROM run_ghosts').count).toBe(1);
      expect(read(legacy, 'SELECT pending_payload_json, archived_at FROM run_ghost_archive'))
        .toEqual({ pending_payload_json: payload, archived_at: null });
      expect(read(legacy, 'SELECT payload_bytes, runs FROM run_ghost_archive_totals'))
        .toEqual({ payload_bytes: new TextEncoder().encode(payload).byteLength, runs: 1 });
    } finally { legacy.close(); }
  });
  it('retries a lost R2 acknowledgement under the same object key without duplicating recordings or totals', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    put.mockImplementationOnce(async (key: string, payload: string) => {
      objects.set(key, payload); throw new Error('R2 reply lost');
    });
    const id = await accountRun(1000);
    const ghost = await loadArchivedRunGhost(env, id) as RunGhost;
    const before = read(sqlite, 'SELECT payload_bytes, runs FROM run_ghost_archive_totals');
    const createdAt = (read(sqlite, 'SELECT created_at FROM run_ghost_archive').created_at) as string;
    await env.DB.batch([prepareRunGhostArchive(env, ghost, { source: 'room', userId: 'user', deaths: 0, createdAt })]);
    await flushRunGhostArchive(env);
    expect(objects.size).toBe(1); expect(put.mock.calls[0][0]).toBe(put.mock.calls[1][0]);
    expect(read(sqlite, 'SELECT payload_bytes, runs FROM run_ghost_archive_totals')).toEqual(before);
  });
  it('warns above $10 once per actual billing cycle, retries failed email delivery and never changes saving', async () => {
    env.RUN_GHOST_COST_ALERTS_ENABLED = '1'; env.RUN_GHOST_ALERT_EMAIL = 'owner@example.test'; env.RESEND_API_KEY = 'test-only';
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 'email-test' })));
    expect((await checkGhostArchiveCost(env, NOW, fetcher)).status).toBe('below_threshold');
    sqlite.exec('UPDATE run_ghost_archive_totals SET payload_bytes = 700000000000, runs = 14000000');
    fetcher.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    await expect(checkGhostArchiveCost(env, NOW, fetcher)).rejects.toThrow();
    expect((await checkGhostArchiveCost(env, NOW, fetcher)).status).toBe('sent');
    expect((await checkGhostArchiveCost(env, NOW, fetcher)).status).toBe('already_sent');
    expect((await checkGhostArchiveCost(env, new Date('2026-11-05T00:00:00Z'), fetcher)).status).toBe('sent');
    expect(fetcher).toHaveBeenCalledTimes(3);
    const message = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(message.to).toBe('owner@example.test'); expect(message.text).toContain('conservative estimate');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'Idempotency-Key': 'wamp-ghost-archive-budget-2026-10-05' });
    expect(fetcher.mock.calls[1][1]?.headers).toEqual(fetcher.mock.calls[0][1]?.headers);
    expect(env.RUN_GHOST_COST_ALERTS_ENABLED).toBe('1');
  });
  it('protects archive status, flushes and cost checks with admin authorization and trusted mutation origins', async () => {
    env.ADMIN_API_KEY = 'local-admin-only';
    for (const route of ['status', 'flush', 'check-cost']) {
      const url = new URL(`https://api.wamp.land/api/admin/run-ghost-archive/${route}`);
      const method = route === 'status' ? 'GET' : 'POST';
      await expect(handleAdminRequest(new Request(url, { method }), url, env)).rejects.toMatchObject({ status: 403 });
      if (method === 'POST') await expect(handleAdminRequest(new Request(url, {
        method, headers: { 'X-Admin-Key': env.ADMIN_API_KEY, Origin: 'https://foreign.example' },
      }), url, env)).rejects.toMatchObject({ status: 403 });
    }
    env.RUN_GHOST_COST_ALERTS_ENABLED = '1'; env.RESEND_API_KEY = 'test-only';
    const url = new URL('https://api.wamp.land/api/admin/run-ghost-archive/status');
    const response = await handleAdminRequest(new Request(url, { headers: { 'X-Admin-Key': env.ADMIN_API_KEY } }), url, env);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ archiveConfigured: true, alertsConfigured: true, alertThresholdUsd: 10 });
  });
});
describe('ghost archive billing estimate boundaries', () => {
  it('counts writes, reads and storage with R2 billing unit rounding before shared allowances', () => {
    expect(estimateGhostArchiveCost(0, 0, 0).total).toBe(0);
    expect(estimateGhostArchiveCost(50e9, 1e6, 1e6)).toEqual({ storage: 0.75, writes: 4.5, reads: 0.36, total: 5.61 });
    expect(estimateGhostArchiveCost(1, 1000001, 1000001)).toEqual({ storage: 0.015, writes: 9, reads: 0.72, total: 9.735 });
  });
  it('resets on the configured renewal date including year boundaries', () => {
    expect(ghostArchiveBillingPeriod(new Date('2026-10-04T23:59:59Z'), 5)).toBe('2026-09-05');
    expect(ghostArchiveBillingPeriod(new Date('2026-10-05T00:00:00Z'), 5)).toBe('2026-10-05');
    expect(ghostArchiveBillingPeriod(new Date('2027-01-01T00:00:00Z'), 5)).toBe('2026-12-05');
    expect(ghostArchiveBillingPeriod(NOW, NaN)).toBe('2026-10-01');
  });
});
