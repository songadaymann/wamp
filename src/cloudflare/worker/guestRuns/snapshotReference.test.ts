import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestRunStartBody, GuestRunStartResponse } from '../../../guestRooms/runModel';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { RunFinishRequestBody } from '../../../runs/model';
import { NOW, fixture } from '../activity/testDatabase';
import { finishGuestRun, startGuestRun } from './attempts';
import type { GuestRunIdentity } from './identity';

const identity: GuestRunIdentity = { guestUserId: 'guest-player', recoveryTokenHash: 'recovery-hash' };
const at = (ms: number) => vi.setSystemTime(new Date(Date.parse(NOW) + ms));
const startBody = (): GuestRunStartBody => ({ contentType: 'room', contentId: '0,0', version: 1, clientRunId: crypto.randomUUID() });
const finishBody = (started: GuestRunStartResponse): RunFinishRequestBody => ({ result: 'completed', elapsedMs: 1000, deaths: 0,
  collectiblesCollected: 0, enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0, score: null, finishedAt: null,
  verificationTrace: { schemaVersion: 1, verificationNonce: started.verificationNonce, snapshotHash: started.snapshotHash,
    traceDurationMs: 1000, inputEvents: [], roomTransitions: [],
    breadcrumbs: [0, 1000].map(atMs => ({ atMs, roomX: 0, roomY: 0, x: 64, y: 64, vx: 0, vy: 0, grounded: true })),
    goalEvents: [{ atMs: 1000, type: 'reach_exit', actor: 'player', roomId: '0,0', roomX: 0, roomY: 0,
      x: 64, y: 64, instanceId: null, checkpointIndex: null }] } });
const finishRequest = (body: RunFinishRequestBody) => new Request('https://api.wamp.land/api/guest-runs/finish', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://wamp.land' }, body: JSON.stringify(body) });

let f: ReturnType<typeof fixture>;
let room: RoomSnapshot;
let statements: string[];
beforeEach(() => {
  vi.useFakeTimers(); at(0); f = fixture();
  room = { ...f.record.published!, goal: { type: 'reach_exit', exit: { x: 64, y: 64 }, timeLimitMs: null } };
  f.sqlite.prepare("UPDATE rooms SET published_json = ? WHERE id = '0,0'").run(JSON.stringify(room));
  f.sqlite.prepare("UPDATE room_versions SET snapshot_json = ? WHERE room_id = '0,0' AND version = 1").run(JSON.stringify(room));
  statements = [];
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => { statements.push(sql.replace(/\s+/g, ' ').trim()); return prepare(sql); };
});
afterEach(() => { f.sqlite.close(); vi.useRealTimers(); });

async function measured<T>(action: () => Promise<T>): Promise<{ value: T; ran: string[] }> {
  statements.length = 0; const value = await action(); return { value, ran: [...statements] };
}
const stored = (attemptId: string) => f.sqlite.prepare(`SELECT result, verification_status, verification_reason, metrics_json,
  insight_deaths_json, snapshot_json FROM guest_run_attempts WHERE attempt_id = ?`).get(attemptId) as Record<string, unknown>;

describe('guest attempts reference their published version (F330)', () => {
  it('starts with one fewer read and no room copy, and finishes with one version read', async () => {
    const start = await measured(() => startGuestRun(f.env, identity, startBody()));
    // The existing-start check, the version read and the insert that returns the new row.
    expect(start.ran.map(sql => sql.slice(0, 40))).toEqual([
      'SELECT * FROM guest_run_attempts WHERE g', 'SELECT version, snapshot_json, title, cr',
      'INSERT OR IGNORE INTO guest_run_attempts',
    ]);
    expect(start.ran.some(sql => sql.includes('guest_run_snapshot_rooms'))).toBe(false);
    expect(stored(start.value.attemptId).snapshot_json).toBeNull();
    expect(JSON.stringify(room).length).toBeGreaterThan(1000);

    at(1000); const finish = await measured(() => finishGuestRun(f.env, identity, start.value.attemptId, finishRequest(finishBody(start.value))));
    expect(finish.value).toMatchObject({ result: 'completed', verificationStatus: 'passed', saved: true });
    expect(finish.ran.filter(sql => sql.includes('FROM room_versions'))).toHaveLength(1);
    expect(finish.ran.some(sql => sql.includes('guest_run_snapshot_rooms'))).toBe(false);
  });

  it('records the same verified result as an attempt that stored its own copy', async () => {
    const reference = await startGuestRun(f.env, identity, startBody());
    const copy = await startGuestRun(f.env, identity, startBody());
    f.sqlite.prepare('UPDATE guest_run_attempts SET snapshot_json = ? WHERE attempt_id = ?')
      .run(JSON.stringify({ kind: 'room', room }), copy.attemptId);
    at(1000);
    const results = await Promise.all([reference, copy].map(async started =>
      ({ ...await finishGuestRun(f.env, identity, started.attemptId, finishRequest(finishBody(started))), attemptId: null })));
    expect(results[0]).toEqual(results[1]);
    expect(results[0].saved).toBe(true);
    expect(stored(reference.attemptId)).toEqual(stored(copy.attemptId));
  });

  it('returns the original start to a retry without reading the published version again', async () => {
    const body = startBody(); const first = await startGuestRun(f.env, identity, body);
    const retry = await measured(() => startGuestRun(f.env, identity, body));
    expect(retry.value).toEqual(first);
    expect(retry.ran).toHaveLength(1);
  });
});
