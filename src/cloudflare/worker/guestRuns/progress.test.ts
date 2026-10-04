import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot, type CourseSnapshot } from '../../../courses/model';
import type { GuestRunStartBody, GuestRunStartResponse } from '../../../guestRooms/runModel';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import type { RunFinishRequestBody } from '../../../runs/model';
import { createSession } from '../auth/store';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { hashRateLimitKey, networkKeyForIp } from '../core/rateLimit';
import { persistProgressIncrement } from '../progression/laneEvents';
import { loadOrBackfillUserProgress } from '../progression/progressRows';
import { ensureFounderIdentityQualification } from '../progression/awards';
import { syncUserBadges } from '../progression/badgesTrophies';
import { updateAdminBuilderCapOverride } from '../progression/admin';
import { finishGuestRun, parseGuestRunStart, pruneGuestRuns, startGuestRun } from './attempts';
import { claimGuestRuns } from './claims';
import { guestRunIdentity, hashGuestRunValue, type GuestRunIdentity } from './identity';
import { handleClaimGuestRequest, handleGuestRunRequest } from './routes';
import { listClaimedGuestClears, listPendingGuestClears } from './history';

class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly database: DatabaseSync, readonly sql: string, readonly beforeFirst: () => Promise<void>) {}
  bind(...values: unknown[]): this {
    this.values = values.map(value => {
      if (value === null || typeof value === 'string' || typeof value === 'number') return value;
      throw new Error('Unexpected SQL parameter');
    });
    return this;
  }
  async first<T>(): Promise<T | null> {
    await this.beforeFirst();
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.database.prepare(this.sql).all(...this.values) as T[] }; }
}
class Database implements D1Database {
  failOnceAt: string | null = null;
  loseClaimReplyOnce = false;
  beforeBatch: ((statements: D1PreparedStatement[]) => Promise<void>) | null = null;
  beforeFirst: ((sql: string) => Promise<void>) | null = null;
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(this.sqlite, sql, async () => { await this.beforeFirst?.(sql); }); }
  withSession(): this { return this; }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    await this.beforeBatch?.(statements);
    this.sqlite.exec('BEGIN');
    let committed = false;
    try {
      const results = statements.map(statement => {
        if (!(statement instanceof Statement)) throw new Error('Unexpected statement');
        if (this.failOnceAt && statement.sql.includes(this.failOnceAt)) {
          this.failOnceAt = null; throw new Error('Injected database interruption');
        }
        return { results: this.sqlite.prepare(statement.sql).all(...statement.values) } as T;
      });
      this.sqlite.exec('COMMIT'); committed = true;
      if (this.loseClaimReplyOnce && statements.some(statement => statement instanceof Statement
        && statement.sql.includes('UPDATE guest_run_claims SET applied'))) {
        this.loseClaimReplyOnce = false; throw new Error('Reply lost after commit');
      }
      return results;
    } catch (error) { if (!committed) this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
const NOW = '2026-10-04T12:00:00.000Z';
const SECRET = 'a'.repeat(64);
const HEADERS = { 'X-Guest-User-Id': 'guest-player', 'X-Guest-Recovery-Token': SECRET, 'Content-Type': 'application/json',
  Origin: 'https://wamp.land', 'CF-Connecting-IP': '198.51.100.2' };
const at = (ms: number) => vi.setSystemTime(new Date(Date.parse(NOW) + ms));
const request = (body: unknown, headers: Record<string, string> = HEADERS) => new Request('https://api.wamp.land/api/guest-runs/start', {
  method: 'POST', headers, body: JSON.stringify(body),
});
const startBody = (contentType: GuestRunStartBody['contentType'] = 'room', contentId = '0,0'): GuestRunStartBody =>
  ({ contentType, contentId, version: 1, clientRunId: crypto.randomUUID() });
const resultBody = (started: GuestRunStartResponse): RunFinishRequestBody => ({ result: 'completed', elapsedMs: 1000, deaths: 0,
  collectiblesCollected: 900, enemyCollectiblesCollected: 900, enemiesDefeated: 900, checkpointsReached: 900,
  score: null, finishedAt: null, verificationTrace: { schemaVersion: 1, verificationNonce: started.verificationNonce,
    snapshotHash: started.snapshotHash, traceDurationMs: 1000, inputEvents: [], roomTransitions: [],
    breadcrumbs: [0, 1000].map(atMs => ({ atMs, roomX: 0, roomY: 0, x: 64, y: 64, vx: 0, vy: 0, grounded: true })),
    goalEvents: [{ atMs: 1000, type: 'reach_exit', actor: 'player', roomId: '0,0', roomX: 0, roomY: 0,
      x: 64, y: 64, instanceId: null, checkpointIndex: null }] } });

describe('verified guest progress and account claims on the real schema', () => {
  let sqlite: DatabaseSync; let database: Database; let env: Env; let identity: GuestRunIdentity;
  let room: RoomSnapshot; let course: CourseSnapshot;
  beforeEach(async () => {
    vi.useFakeTimers(); at(0);
    sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON');
    const migrations = new URL('../../../../migrations/', import.meta.url);
    for (const file of readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
    }
    database = new Database(sqlite); env = { DB: database, JAM_DB: database, ASSETS: { fetch: async () => new Response() } };
    identity = await guestRunIdentity(request({}));
    for (const id of ['user', 'other']) sqlite.prepare(`INSERT INTO users (id, email, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run(id, `${id}@example.test`, id, NOW, NOW);
    room = { ...createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), title: 'Guest test', status: 'published',
      publishedAt: NOW, goal: { type: 'reach_exit', exit: { x: 64, y: 64 }, timeLimitMs: null } };
    putRoom(room);
    course = { ...createDefaultCourseSnapshot('test-course'), title: 'Guest course', status: 'published', publishedAt: NOW,
      roomRefs: [{ roomId: room.id, roomTitle: room.title, coordinates: room.coordinates, roomVersion: 1 }],
      goal: { type: 'reach_exit', exit: { roomId: room.id, x: 64, y: 64 }, timeLimitMs: null } };
    putCourse(course);
  });
  afterEach(() => { sqlite.close(); vi.useRealTimers(); });
  function read(sql: string, ...values: (string | number | null)[]): Record<string, unknown> | undefined {
    return sqlite.prepare(sql).get(...values) as Record<string, unknown> | undefined;
  }
  function putRoom(snapshot: RoomSnapshot): void {
    const json = JSON.stringify(snapshot);
    sqlite.prepare(`INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET published_json = excluded.published_json`).run(snapshot.id, snapshot.coordinates.x, snapshot.coordinates.y, json, json);
    sqlite.prepare(`INSERT OR REPLACE INTO room_versions (room_id, version, snapshot_json, created_at) VALUES (?, ?, ?, ?)`)
      .run(snapshot.id, snapshot.version, json, NOW);
  }
  function putCourse(snapshot: CourseSnapshot): void {
    const json = JSON.stringify(snapshot);
    sqlite.prepare(`INSERT INTO courses (id, owner_user_id, owner_display_name, draft_json, published_json,
      published_version, created_at, updated_at, published_at) VALUES (?, 'user', 'User', ?, ?, ?, ?, ?, ?)`)
      .run(snapshot.id, json, json, snapshot.version, NOW, NOW, NOW);
    sqlite.prepare(`INSERT INTO course_versions (course_id, version, snapshot_json, created_at) VALUES (?, ?, ?, ?)`)
      .run(snapshot.id, snapshot.version, json, NOW);
  }
  function putExpanded(id: string, snapshot: CourseSnapshot, legacyId: string | null): void {
    const json = JSON.stringify(snapshot);
    sqlite.prepare(`INSERT INTO expanded_rooms (id, owner_user_id, owner_display_name, source_type, legacy_course_id,
      anchor_room_id, anchor_x, anchor_y, draft_json, published_json, published_version, created_at, updated_at, published_at)
      VALUES (?, 'user', 'User', 'native_expanded_room', ?, '0,0', 0, 0, ?, ?, 1, ?, ?, ?)`)
      .run(id, legacyId, json, json, NOW, NOW, NOW);
    sqlite.prepare(`INSERT INTO expanded_room_versions (expanded_room_id, version, snapshot_json, created_at)
      VALUES (?, 1, ?, ?)`).run(id, json, NOW);
    sqlite.prepare(`INSERT INTO expanded_room_cells (expanded_room_id, expanded_room_version, cell_order, room_id,
      room_x, room_y, room_version) VALUES (?, 1, 0, '0,0', 0, 0, 1)`).run(id);
  }
  async function complete(body = startBody(), finishPatch: Partial<RunFinishRequestBody> = {}) {
    at(0); const start = await startGuestRun(env, identity, body); at(1000);
    const finish = { ...resultBody(start), ...finishPatch };
    return { start, finish, response: await finishGuestRun(env, identity, start.attemptId, request(finish)) };
  }
  function seedClear(index: number, options: { status?: string; daysAgo?: number; source?: string } = {}) {
    const finish = new Date(Date.parse(NOW) - (options.daysAgo ?? 0) * 86400000 + index).toISOString();
    sqlite.prepare(`INSERT INTO guest_run_attempts (attempt_id, guest_user_id, recovery_token_hash, client_run_id,
      content_type, content_id, content_version, progress_source_type, progress_source_id, verification_nonce,
      snapshot_hash, started_at, expires_at, result, verification_status, finished_at)
      VALUES (?, ?, ?, ?, 'room', ?, 1, 'room', ?, 'nonce', 'hash', ?, ?, 'completed', ?, ?)`)
      .run(`seed-${index}`, identity.guestUserId, identity.recoveryTokenHash, `client-${index}`,
        options.source ?? `seed-room-${index}`, options.source ?? `seed-room-${index}`, finish,
        new Date(Date.parse(finish) + 14 * 86400000).toISOString(), options.status ?? 'passed', finish);
  }
  const claim = () => claimGuestRuns(env, identity, 'user', crypto.randomUUID());

  it('hashes recovery secrets and rejects missing or malformed identities', async () => {
    expect(identity.recoveryTokenHash).toBe(await hashGuestRunValue(SECRET));
    expect(identity.recoveryTokenHash).not.toBe(SECRET);
    await expect(guestRunIdentity(request({}, { ...HEADERS, 'X-Guest-Recovery-Token': 'short' }))).rejects.toMatchObject({ status: 400 });
    await expect(guestRunIdentity(request({}, { ...HEADERS, 'X-Guest-User-Id': 'account' }))).rejects.toMatchObject({ status: 400 });
  });
  it('rejects private draft goals and missing content without creating guest attempts', async () => {
    room.status = 'draft'; putRoom(room);
    await expect(startGuestRun(env, identity, startBody())).rejects.toMatchObject({ status: 404 });
    await expect(startGuestRun(env, identity, startBody('room', 'missing'))).rejects.toMatchObject({ status: 404 });
    expect(read('SELECT COUNT(*) AS count FROM guest_run_attempts')?.count).toBe(0);
  });
  it('binds a retried start to one attempt and immutable published snapshot', async () => {
    const body = startBody(); const starts = await Promise.all([startGuestRun(env, identity, body), startGuestRun(env, identity, body)]);
    expect(starts[0]).toEqual(starts[1]);
    expect(read('SELECT COUNT(*) AS count FROM guest_run_attempts')?.count).toBe(1);
    await expect(startGuestRun(env, identity, { ...body, version: 2 })).rejects.toMatchObject({ status: 409 });
    room.goal = { type: 'collect_target', requiredCount: 10, timeLimitMs: null }; putRoom(room);
    at(1000); expect((await finishGuestRun(env, identity, starts[0].attemptId, request(resultBody(starts[0])))).saved).toBe(true);
  });
  it('recovers only an existing original start by client id, protected by the recovery identity', async () => {
    const body = startBody(); const started = await startGuestRun(env, identity, body);
    const path = `/api/guest-runs/by-client/${body.clientRunId}`;
    const lookup = (headers = HEADERS, lookupPath = path) => handleGuestRunRequest(
      new Request(`https://api.wamp.land${lookupPath}`, { headers }), new URL(`https://api.wamp.land${lookupPath}`), env);
    expect(await (await lookup()).json()).toEqual(started);
    await expect(lookup({ ...HEADERS, 'X-Guest-Recovery-Token': 'b'.repeat(64) })).rejects.toMatchObject({ status: 404 });
    await expect(lookup(HEADERS, `/api/guest-runs/by-client/${crypto.randomUUID()}`)).rejects.toMatchObject({ status: 404 });
    expect(read('SELECT COUNT(*) AS count FROM guest_run_attempts')?.count).toBe(1);
    at(1000); const completed = await finishGuestRun(env, identity, started.attemptId, request(resultBody(started)));
    expect(completed.saved).toBe(true); expect(await (await lookup()).json()).toEqual(started);
  });
  it('uses the real verifier and derived metrics, leaving all ranked tables empty', async () => {
    const completed = await complete(); expect(completed.response.saved).toBe(true);
    const stored = read('SELECT metrics_json, snapshot_json, recovery_token_hash FROM guest_run_attempts');
    expect(JSON.parse(String(stored?.metrics_json))).toMatchObject({ collectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0 });
    expect(stored?.snapshot_json).toBeNull(); expect(stored?.recovery_token_hash).not.toBe(SECRET);
    for (const table of ['room_runs', 'course_runs', 'expanded_room_runs', 'pxp_events']) {
      expect(read(`SELECT COUNT(*) AS count FROM ${table}`)?.count).toBe(0);
    }
  });
  it.each(['missing', 'nonce', 'snapshot', 'goal', 'path'] as const)('does not save a clear with a %s trace defect', async defect => {
    const start = await startGuestRun(env, identity, startBody()); const finish = resultBody(start); const trace = finish.verificationTrace!;
    if (defect === 'missing') finish.verificationTrace = null;
    if (defect === 'nonce') trace.verificationNonce = 'wrong-nonce';
    if (defect === 'snapshot') trace.snapshotHash = 'wrong-hash';
    if (defect === 'goal') trace.goalEvents = [];
    if (defect === 'path') trace.breadcrumbs[1].x = 10000;
    at(1000); expect((await finishGuestRun(env, identity, start.attemptId, request(finish))).saved).toBe(false);
    expect((await claim()).pxpAwarded).toBe(0);
  });
  it.each(['room', 'course'] as const)('verifies %s play time when the first finish is delayed offline', async kind => {
    const start = await startGuestRun(env, identity, startBody(kind, kind === 'room' ? room.id : course.id));
    const finish = resultBody(start); finish.finishedAt = new Date(Date.parse(NOW) + 1000).toISOString();
    at(2 * 86400000); await pruneGuestRuns(env);
    expect((await finishGuestRun(env, identity, start.attemptId, request(finish))).saved).toBe(true);
    expect(JSON.parse(String(read('SELECT metrics_json FROM guest_run_attempts')?.metrics_json)).elapsedMs).toBe(1000);
    expect(await finishGuestRun(env, identity, start.attemptId, request(finish))).toMatchObject({ saved: true });
    expect((await claim()).pxpAwarded).toBe(kind === 'room' ? 20 : 40);
  });
  it.each(['future', 'ceiling', 'mismatch'] as const)('rejects a %s simulated duration without weakening the trace verifier', async defect => {
    const start = await startGuestRun(env, identity, startBody()); const finish = resultBody(start);
    if (defect === 'future') at(0);
    if (defect === 'ceiling') { at(31 * 60000); finish.elapsedMs = 31 * 60000; }
    if (defect === 'mismatch') { at(10000); finish.elapsedMs = 5000; }
    expect(await finishGuestRun(env, identity, start.attemptId, request(finish))).toMatchObject({ saved: false, verificationReason: 'trace_duration' });
    expect((await claim()).pxpAwarded).toBe(0);
  });
  it('does not use delivery delay to satisfy a survival goal', async () => {
    room.goal = { type: 'survival', durationMs: 10000 }; putRoom(room);
    const start = await startGuestRun(env, identity, startBody()); const finish = resultBody(start);
    finish.verificationTrace!.goalEvents[0].type = 'complete'; at(60000);
    expect((await finishGuestRun(env, identity, start.attemptId, request(finish))).saved).toBe(false);
  });
  it('bounds retained offline starts as well as recent starts', async () => {
    for (let index = 0; index < 100; index += 1) await startGuestRun(env, identity, startBody());
    at(2 * 86400000); await pruneGuestRuns(env);
    await expect(startGuestRun(env, identity, startBody())).rejects.toMatchObject({ status: 429 });
    at(15 * 86400000); await pruneGuestRuns(env);
    await expect(startGuestRun(env, identity, startBody())).resolves.toMatchObject({ contentId: room.id });
  });
  it('requires the recovery secret, handles identical finish retries, and rejects rewritten finishes', async () => {
    const { start, finish, response } = await complete();
    expect(await finishGuestRun(env, identity, start.attemptId, request(finish))).toEqual(response);
    await expect(finishGuestRun(env, { ...identity, recoveryTokenHash: 'wrong' }, start.attemptId, request(finish))).rejects.toMatchObject({ status: 404 });
    await expect(finishGuestRun(env, identity, start.attemptId, request({ ...finish, deaths: 2 }))).rejects.toMatchObject({ status: 409 });
  });
  it('verifies course cells captured at start, and discards them after finalization', async () => {
    const body = startBody('course', course.id); const start = await startGuestRun(env, identity, body);
    expect(read('SELECT COUNT(*) AS count FROM guest_run_snapshot_rooms')?.count).toBe(1);
    room.goal = null; putRoom(room); at(1000);
    expect((await finishGuestRun(env, identity, start.attemptId, request(resultBody(start)))).saved).toBe(true);
    expect(read('SELECT COUNT(*) AS count FROM guest_run_snapshot_rooms')?.count).toBe(0);
    expect((await claim()).pxpAwarded).toBe(40);
  });
  it('captures every cell in a full-size expanded footprint and rejects missing published versions', async () => {
    const full = { ...course, id: 'full-course', roomRefs: [course.roomRefs[0]] };
    for (let x = 1; x < 16; x += 1) {
      const cell = { ...createDefaultRoomSnapshot(`${x},0`, { x, y: 0 }), status: 'published' as const, publishedAt: NOW };
      putRoom(cell); full.roomRefs.push({ roomId: cell.id, roomTitle: null, coordinates: cell.coordinates, roomVersion: 1 });
    }
    putCourse(full); await startGuestRun(env, identity, startBody('course', full.id));
    expect(read('SELECT COUNT(*) AS count FROM guest_run_snapshot_rooms')?.count).toBe(16);
    sqlite.prepare('DELETE FROM room_versions WHERE room_id = ?').run('15,0');
    await expect(startGuestRun(env, identity, startBody('course', full.id))).rejects.toMatchObject({ status: 409 });
  });
  it.each(['standalone', 'course_alias', 'native'] as const)('supports %s expanded-room progress', async kind => {
    let id = 'room:0,0';
    if (kind === 'course_alias') { id = 'expanded-alias'; putExpanded(id, course, course.id); }
    if (kind === 'native') { id = 'native-room'; putExpanded(id, { ...course, id }, null); }
    expect((await complete(startBody('expanded_room', id))).response.saved).toBe(true);
    const receipt = await claim(); expect(receipt.pxpAwarded).toBe(kind === 'standalone' ? 20 : 40);
  });
  it('deduplicates course and expanded aliases against one canonical clear', async () => {
    putExpanded('expanded-alias', course, course.id);
    await complete(startBody('course', course.id)); await complete(startBody('expanded_room', 'expanded-alias'));
    expect(await claim()).toMatchObject({ clearsSaved: 2, pxpAwarded: 40 });
  });
  it('deduplicates retries, concurrent tabs, and competing claim ids', async () => {
    await complete(); const id = crypto.randomUUID();
    const receipts = await Promise.all([claimGuestRuns(env, identity, 'user', id), claimGuestRuns(env, identity, 'user', id), claim()]);
    expect(receipts[0]).toMatchObject({ clearsSaved: 1, pxpAwarded: 20 }); expect(receipts[1]).toEqual(receipts[0]);
    expect(read('SELECT total_pxp FROM user_progress WHERE user_id = ?', 'user')?.total_pxp).toBe(20);
    expect(read('SELECT COUNT(*) AS count FROM pxp_events')?.count).toBe(1);
    expect(await claimGuestRuns(env, identity, 'user', id)).toEqual(receipts[0]);
    await expect(claimGuestRuns(env, identity, 'other', id)).rejects.toMatchObject({ status: 409 });
    await expect(claimGuestRuns(env, { ...identity, recoveryTokenHash: 'wrong' }, 'user', id)).rejects.toMatchObject({ status: 409 });
  });
  it('rolls ownership and ledger back if balance persistence fails; retry saves everything once', async () => {
    await complete(); const id = crypto.randomUUID(); database.failOnceAt = 'total_pxp = total_pxp +';
    await expect(claimGuestRuns(env, identity, 'user', id)).rejects.toThrow('Injected database interruption');
    expect(read('SELECT claim_id FROM guest_run_attempts')?.claim_id).toBeNull();
    expect(read('SELECT COUNT(*) AS count FROM pxp_events')?.count).toBe(0);
    expect(await claimGuestRuns(env, identity, 'user', id)).toMatchObject({ clearsSaved: 1, pxpAwarded: 20 });
  });
  it('returns the saved receipt after a committed claim response is lost', async () => {
    await complete(); const id = crypto.randomUUID(); database.loseClaimReplyOnce = true;
    await expect(claimGuestRuns(env, identity, 'user', id)).rejects.toThrow('Reply lost after commit');
    expect(await claimGuestRuns(env, identity, 'user', id)).toMatchObject({ clearsSaved: 1, pxpAwarded: 20 });
    expect(read('SELECT total_pxp FROM user_progress')?.total_pxp).toBe(20);
    expect(read('SELECT COUNT(*) AS count FROM pxp_events')?.count).toBe(1);
  });
  it('attributes one guest clear to only one account when two accounts claim concurrently', async () => {
    await complete();
    const receipts = await Promise.all([claim(), claimGuestRuns(env, identity, 'other', crypto.randomUUID())]);
    expect(receipts.reduce((total, receipt) => total + receipt.clearsSaved, 0)).toBe(1);
    expect(receipts.reduce((total, receipt) => total + receipt.pxpAwarded, 0)).toBe(20);
    expect(read('SELECT SUM(total_pxp) AS total FROM user_progress')?.total).toBe(20);
  });
  it('caps each claim at 50 in completion order and excludes expired or failed verification', async () => {
    for (let index = 0; index < 53; index += 1) seedClear(index);
    seedClear(100, { daysAgo: 15 }); seedClear(101, { status: 'failed' });
    at(2000); expect(await claim()).toMatchObject({ clearsSaved: 50, pxpAwarded: 1000, remainingClears: 3 });
    expect(read('SELECT claim_id FROM guest_run_attempts WHERE attempt_id = ?', 'seed-0')?.claim_id).not.toBeNull();
    expect(read('SELECT claim_id FROM guest_run_attempts WHERE attempt_id = ?', 'seed-52')?.claim_id).toBeNull();
    expect(await claim()).toMatchObject({ clearsSaved: 3, pxpAwarded: 60, remainingClears: 0 });
    expect(read('SELECT player_level FROM user_progress')?.player_level).toBeGreaterThan(1);
  });
  it('retains the full 14-day window from completion, rather than expiring at the earlier start time', async () => {
    await complete(); at(14 * 86400000 + 500);
    expect(await claim()).toMatchObject({ clearsSaved: 1, pxpAwarded: 20 });
  });
  it('saves repeated clears while awarding the existing clear XP only once', async () => {
    seedClear(0, { source: 'same-room' }); seedClear(1, { source: 'same-room' }); at(1000);
    expect(await claim()).toMatchObject({ clearsSaved: 2, pxpAwarded: 20 });
    expect(read('SELECT event_type, source_id FROM pxp_events')).toMatchObject({ event_type: 'room_clear_first', source_id: 'same-room:1' });
  });
  it('preserves historical signed clears whose XP was backfilled before the ledger existed', async () => {
    await complete();
    sqlite.prepare(`INSERT INTO room_runs (attempt_id, room_id, room_x, room_y, room_version, goal_type,
      goal_json, user_id, user_display_name, started_at, finished_at, result)
      VALUES ('historical-run', '0,0', 0, 0, 1, 'reach_exit', ?, 'user', 'User', ?, ?, 'completed')`)
      .run(JSON.stringify(room.goal), NOW, NOW);
    expect(await claim()).toMatchObject({ clearsSaved: 1, pxpAwarded: 0 });
    expect(read('SELECT total_pxp FROM user_progress')?.total_pxp).toBe(20);
  });
  it('does not overwrite a balance created while initial progress was being backfilled', async () => {
    let interleaved = false;
    database.beforeBatch = async statements => {
      if (interleaved || !statements.some(statement => statement instanceof Statement && statement.sql.includes('INSERT INTO user_progress'))) return;
      interleaved = true;
      sqlite.prepare(`INSERT INTO user_progress (user_id, total_pxp, created_at, updated_at)
        VALUES ('user', 75, ?, ?)`).run(NOW, NOW);
    };
    expect((await loadOrBackfillUserProgress(env, 'user')).total_pxp).toBe(75);
  });
  it('limits starts per recovery identity and IP network, including retried starts', async () => {
    const body = startBody(); const url = new URL('https://api.wamp.land/api/guest-runs/start');
    for (let index = 0; index < 30; index += 1) expect((await handleGuestRunRequest(request(body), url, env)).status).toBe(200);
    await expect(handleGuestRunRequest(request(body), url, env)).rejects.toMatchObject({ status: 429 });
    expect(read('SELECT COUNT(*) AS count FROM guest_run_attempts')?.count).toBe(1);
    const hashes = sqlite.prepare('SELECT key_hash FROM rate_limit_events').all();
    expect(JSON.stringify(hashes)).not.toContain(SECRET);
    expect(JSON.stringify(hashes)).not.toContain(HEADERS['CF-Connecting-IP']);
  });
  it('limits an IP network even if the caller changes the guest identity and recovery secret', async () => {
    const key = await hashRateLimitKey(env, networkKeyForIp(HEADERS['CF-Connecting-IP']));
    for (let index = 0; index < 120; index += 1) sqlite.prepare(`INSERT INTO rate_limit_events
      (bucket, key_hash, created_at) VALUES ('guest_run_start_network', ?, ?)`).run(key, NOW);
    await expect(handleGuestRunRequest(request(startBody(), { ...HEADERS, 'X-Guest-User-Id': 'guest-rotated',
      'X-Guest-Recovery-Token': 'b'.repeat(64) }), new URL('https://api.wamp.land/api/guest-runs/start'), env)).rejects.toMatchObject({ status: 429 });
    expect(read("SELECT COUNT(*) AS count FROM rate_limit_events WHERE bucket = 'guest_run_start_identity'")?.count).toBe(0);
  });
  it('caps pending guest storage transactionally, and permits starts after an account claim', async () => {
    for (let index = 0; index < 100; index += 1) seedClear(index);
    await expect(startGuestRun(env, identity, startBody())).rejects.toMatchObject({ status: 429 });
    at(1000); await claim();
    expect((await startGuestRun(env, identity, startBody())).attemptId).toBeTruthy();
  });
  it('applies time-limited goal conditions after the trace verifier passes', async () => {
    room.goal = { type: 'reach_exit', exit: { x: 64, y: 64 }, timeLimitMs: 500 }; putRoom(room);
    expect((await complete()).response).toMatchObject({ saved: false, verificationReason: 'trace_goal' });
  });
  it('does not reclaim attempts after deleting the original account', async () => {
    await complete(); const id = crypto.randomUUID(); await claimGuestRuns(env, identity, 'user', id);
    sqlite.prepare('DELETE FROM users WHERE id = ?').run('user');
    expect(await claimGuestRuns(env, identity, 'other', id)).toMatchObject({ clearsSaved: 0, pxpAwarded: 0 });
  });
  it('keeps existing signed awards when they occur during a guest claim', async () => {
    await complete(); await loadOrBackfillUserProgress(env, 'user');
    await Promise.all([claim(), persistProgressIncrement(env, 'user', { pxp: 15, bxp: 7, cxp: 5, trust: 2 }, NOW)]);
    expect(read('SELECT total_pxp, total_bxp, total_cxp FROM user_progress WHERE user_id = ?', 'user'))
      .toMatchObject({ total_pxp: 35, total_bxp: 7, total_cxp: 5 });
  });
  it.each(['founder', 'badges', 'builder_override'] as const)('preserves concurrent XP while updating %s metadata', async kind => {
    await complete(); await claim(); let interleaved = false;
    function inject(sql: string): void {
      if (interleaved || !sql.includes('user_progress') || !sql.includes(kind === 'founder'
        ? 'SET founder_number' : kind === 'badges' ? 'SET badge_count' : 'SET builder_claim_limit_override')) return;
      interleaved = true;
      sqlite.prepare('UPDATE user_progress SET total_pxp = total_pxp + 15 WHERE user_id = ?').run('user');
    }
    database.beforeBatch = async statements => { for (const statement of statements) if (statement instanceof Statement) inject(statement.sql); };
    database.beforeFirst = async sql => { inject(sql); };
    if (kind === 'founder') expect(await ensureFounderIdentityQualification(env, 'user')).toBe(1);
    if (kind === 'badges') await syncUserBadges(env, 'user');
    if (kind === 'builder_override') await updateAdminBuilderCapOverride(env, { userId: 'user', claimLimitPerDay: 5,
      publishLimitPerDay: null, objectLimit: null, collectibleLimit: null, reason: 'Fixture', operatorLabel: 'Test' });
    expect(interleaved).toBe(true); expect(read('SELECT total_pxp FROM user_progress WHERE user_id = ?', 'user')?.total_pxp).toBe(35);
  });
  it('bounds request bodies, requires sign-in to claim, and rejects foreign browser origins', async () => {
    await expect(parseGuestRunStart(request({ ...startBody(), padding: 'x'.repeat(9000) }))).rejects.toMatchObject({ status: 413 });
    await expect(parseGuestRunStart(request(null))).rejects.toMatchObject({ status: 400 });
    await expect(handleClaimGuestRequest(request({ claimId: crypto.randomUUID() }), env)).rejects.toMatchObject({ status: 401 });
    await expect(handleGuestRunRequest(request(startBody(), { ...HEADERS, Origin: 'https://foreign.example' }),
      new URL('https://api.wamp.land/api/guest-runs/start'), env)).rejects.toMatchObject({ status: 403 });
  });
  it('claims through the actual cookie-authenticated route and never exposes recovery secrets', async () => {
    await complete();
    const session = await createSession(env, 'user');
    const response = await handleClaimGuestRequest(request({ claimId: crypto.randomUUID() }, { ...HEADERS, Cookie: `ep_session=${session}` }), env);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ clearsSaved: 1, pxpAwarded: 20 });
  });
  it('recovers pending and claimed history with the correct guest secret or account only', async () => {
    const { start } = await complete();
    const pending = await listPendingGuestClears(env, identity);
    expect(pending).toMatchObject({ totalClears: 1, clears: [{ attemptId: start.attemptId, elapsedMs: 1000 }] });
    expect(JSON.stringify(pending)).not.toContain(identity.recoveryTokenHash);
    expect((await listPendingGuestClears(env, { ...identity, recoveryTokenHash: 'wrong' })).clears).toEqual([]);
    await claim(); expect((await listPendingGuestClears(env, identity)).clears).toEqual([]);
    expect((await listClaimedGuestClears(env, 'user')).totalClears).toBe(1);
    expect((await listClaimedGuestClears(env, 'other')).clears).toEqual([]);
    at(15 * 86400000); await pruneGuestRuns(env);
    expect((await listClaimedGuestClears(env, 'user')).clears[0].contentId).toBe('0,0');
  });
  it('expires active attempts and removes their captured cells, retaining claimed clear history', async () => {
    await complete(); await claim(); at(0); await startGuestRun(env, identity, startBody('course', course.id));
    at(15 * 86400000); await pruneGuestRuns(env);
    expect(read('SELECT COUNT(*) AS count FROM guest_run_snapshot_rooms')?.count).toBe(0);
    expect(read('SELECT COUNT(*) AS count FROM guest_run_attempts')?.count).toBe(1);
  });
});
