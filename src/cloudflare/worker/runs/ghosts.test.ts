import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import type { RoomRunRecord, RunFinishRequestBody } from '../../../runs/model';
import type { RunGhost } from '../../../runs/ghostRace';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), scope: vi.fn(), room: vi.fn(), selection: vi.fn(),
  top: vi.fn(), personal: vi.fn(), verify: vi.fn() }));
vi.mock('../auth/request', () => ({ loadOptionalRequestAuth: mocks.auth, requireOptionalScope: mocks.scope }));
vi.mock('../rooms/store', () => ({ loadRoomRecord: mocks.room }));
vi.mock('./roomLeaderboardAggregation', () => ({ resolveAggregatedRoomLeaderboardSelection: mocks.selection }));
vi.mock('./leaderboards', () => ({ loadRankedRoomLeaderboardRows: mocks.top, loadViewerRankedRoomLeaderboardRow: mocks.personal }));
vi.mock('./verification', () => ({ verifyRoomRunTrace: mocks.verify }));
import { handleRoomGhosts, loadGhostOption, savePersonalBestGhost } from './ghosts';
const ghost: RunGhost = { schemaVersion: 1, attemptId: 'best', roomId: '1,2', roomVersion: 1,
  displayName: 'Player', avatarId: 'default-player', elapsedMs: 1000, points: [
    { atMs: 0, roomX: 1, roomY: 2, x: 0, y: 100, vx: 100, vy: 0, grounded: true, snap: false },
    { atMs: 1000, roomX: 1, roomY: 2, x: 100, y: 100, vx: 100, vy: 0, grounded: true, snap: false },
  ] };
const entry = { attempt_id: 'best', room_version: 1, user_display_name: 'Player', elapsed_ms: 1000 };
function database(stored: unknown = null, audit: unknown = null) {
  const writes: { sql: string; values: unknown[] }[] = [];
  const prepare = vi.fn((sql: string) => {
    const statement = { bind: (...values: unknown[]) => {
      writes.push({ sql, values }); return statement;
    }, first: vi.fn(async () => sql.includes('run_verification_audit') ? audit : stored) };
    return statement;
  });
  const batch = vi.fn(async () => []);
  return { env: { DB: { prepare, batch } } as unknown as Env, prepare, writes, batch };
}
const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 });
room.goal = { type: 'reach_exit', exit: { x: 100, y: 100 }, timeLimitMs: null };
const trace = { schemaVersion: 1, verificationNonce: 'secret', snapshotHash: 'secret-hash',
  traceDurationMs: 1000, inputEvents: [], breadcrumbs: ghost.points, goalEvents: [], roomTransitions: [] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue(null); mocks.room.mockResolvedValue({});
  mocks.selection.mockReturnValue({ roomVersion: 1, snapshot: room, equivalentRoomVersions: [1, 2], leaderboardFamilyVersions: [1, 2, 3] });
  mocks.top.mockResolvedValue([entry]); mocks.personal.mockResolvedValue(entry);
  mocks.verify.mockResolvedValue({ status: 'passed' });
});
describe('ghost lookup boundaries', () => {
  it('uses the selected leaderboard attempt and refuses a changed layout before reading any trace', async () => {
    const db = database({ payload_json: JSON.stringify(ghost) });
    expect(await loadGhostOption(db.env, '1,2', [1, 2], entry)).toEqual({ ghost, reason: null });
    expect(await loadGhostOption(db.env, '1,2', [1, 2], { ...entry, room_version: 3 }))
      .toEqual({ ghost: null, reason: 'layout_changed' });
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(db.writes[0].values[0]).toBe('best');
  });
  it('strips private audit data and requires a passed room audit for historical fallback', async () => {
    const db = database(null, { trace_json: JSON.stringify(trace) });
    const result = await loadGhostOption(db.env, '1,2', [1], entry);
    expect(result.ghost?.points).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/secret|nonce|snapshot|inputEvents/);
    expect(db.writes[1].sql).toContain("status = 'passed'");
    expect(db.writes[1].sql).toContain("run_kind = 'room'");
    expect(db.writes[1].sql).not.toContain('guest_replay');
  });
  it('returns clear unavailable reasons for missing and malformed records', async () => {
    const db = database({ payload_json: '{broken' }, { trace_json: '{broken' });
    expect(await loadGhostOption(db.env, '1,2', [1], entry)).toEqual({ ghost: null, reason: 'no_recording' });
    expect(await loadGhostOption(db.env, '1,2', [1], null)).toEqual({ ghost: null, reason: 'no_run' });
  });
  it('keeps the personal response private and obtains identity only from the authenticated session', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'viewer', walletAddress: null } });
    const db = database({ payload_json: JSON.stringify(ghost) });
    const request = new Request('https://wamp.land/api/rooms/1%2C2/ghosts?version=1&userId=other');
    const response = await handleRoomGhosts(request, new URL(request.url), db.env, '1,2');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    expect(mocks.personal.mock.calls[0].at(-1)).toBe('viewer');
    expect((await response.json()).personal.ghost.attemptId).toBe('best');
    expect(mocks.top.mock.calls[0][2]).toEqual([1, 2, 3]);
  });
  it('allows anonymous top races, with no server-side personal read, and rejects score races', async () => {
    const db = database({ payload_json: JSON.stringify(ghost) });
    const request = new Request('https://wamp.land/api/rooms/1%2C2/ghosts?version=1');
    const response = await handleRoomGhosts(request, new URL(request.url), db.env, '1,2');
    expect((await response.json()).personal).toEqual({ ghost: null, reason: 'sign_in' });
    expect(mocks.personal).not.toHaveBeenCalled();
    mocks.selection.mockReturnValue({ roomVersion: 1, snapshot: { goal: { type: 'survival', durationMs: 1000 } } });
    expect((await (await handleRoomGhosts(request, new URL(request.url), db.env, '1,2')).json()).top.reason).toBe('unsupported');
  });
});
describe('personal best persistence', () => {
  const run = { attemptId: 'best', roomId: '1,2', roomVersion: 1, userId: 'viewer', userDisplayName: 'Player',
    elapsedMs: 1000, deaths: 0, finishedAt: '2026-10-06T13:00:00Z', verificationNonce: 'secret',
    verificationSnapshotHash: 'secret-hash' } as RoomRunRecord;
  const body = { verificationTrace: trace } as unknown as RunFinishRequestBody;
  it('stores a bounded whitelist and uses a conditional upsert so slower concurrent finishes cannot replace it', async () => {
    const db = database();
    await savePersonalBestGhost(db.env, run, room, body, 'default-player', true);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.writes[0].sql).toContain('excluded.elapsed_ms < run_ghosts.elapsed_ms');
    expect(db.writes[0].sql).toContain('excluded.deaths < run_ghosts.deaths');
    expect(db.writes[0].values[6]).not.toMatch(/secret|inputEvents/);
  });
  it('verifies trust-exempt runs before recording and leaves failed ghosts unavailable', async () => {
    const db = database();
    mocks.verify.mockResolvedValue({ status: 'failed' });
    await savePersonalBestGhost(db.env, run, room, body, 'default-player', false);
    expect(mocks.verify.mock.calls[0][0].binding).toEqual({ verificationNonce: 'secret', verificationSnapshotHash: 'secret-hash' });
    expect(db.batch).not.toHaveBeenCalled();
  });
});
