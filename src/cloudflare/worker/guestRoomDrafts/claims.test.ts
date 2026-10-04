import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import type { D1Database, D1PreparedStatement, Env, RequestAuth } from '../core/types';
import { createSession } from '../auth/store';
import { buildRoomMutationActor } from '../auth/actors';
import { hashGuestRunValue } from '../guestRuns/identity';
import { loadRoomRecord, saveDraft } from '../rooms/store';
import { claimGuestRoomDraft } from './claims';
import { handleGuestRoomDraftRequest } from './routes';
import { listOwnedGuestRoomDrafts, upsertGuestRoomDraft } from './store';

class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly sql: string, readonly db: DatabaseSync) {}
  bind(...values: unknown[]): this {
    this.values = values.map(value => {
      if (value === null || typeof value === 'string' || typeof value === 'number') return value;
      throw new Error('Unexpected SQL parameter');
    });
    return this;
  }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
}
class Database implements D1Database {
  beforeBatch: ((statements: Statement[]) => Promise<void>) | null = null;
  failAt: string | null = null;
  loseReply = false;
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(sql, this.sqlite); }
  withSession(): this { return this; }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    const queries = statements.map(query => { if (!(query instanceof Statement)) throw new Error('Unexpected statement'); return query; });
    await this.beforeBatch?.(queries);
    this.sqlite.exec('BEGIN'); let committed = false;
    try {
      const results = queries.map(query => {
        if (this.failAt && query.sql.includes(this.failAt)) { this.failAt = null; throw new Error('Interrupted write'); }
        return { results: this.sqlite.prepare(query.sql).all(...query.values) } as T;
      });
      this.sqlite.exec('COMMIT'); committed = true;
      if (this.loseReply && queries.some(query => query.sql.includes('UPDATE guest_room_draft_claims SET applied'))) {
        this.loseReply = false; throw new Error('Lost committed reply');
      }
      return results;
    } catch (error) { if (!committed) this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
const NOW = '2026-10-04T12:00:00.000Z';
const token = 'a'.repeat(64);
const identity = { guestUserId: 'guest-builder', recoveryTokenHash: '' };
function auth(userId = 'builder'): RequestAuth {
  return { user: { id: userId, email: null, walletAddress: null, displayName: userId },
    source: 'session', principal: { kind: 'user', id: userId, displayName: userId, ownerUserId: userId, agentId: null },
    agent: null, session: null, school: null, scopes: null, apiToken: null, agentToken: null, isAdmin: false };
}
describe('guest draft account transfer against the real migrated schema', () => {
  let sqlite: DatabaseSync; let db: Database; let env: Env; let draftId: string; let snapshot: RoomSnapshot;
  beforeEach(async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); identity.recoveryTokenHash = await hashGuestRunValue(token);
    sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON');
    const migrations = new URL('../../../../migrations/', import.meta.url);
    for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
    db = new Database(sqlite); env = { DB: db, JAM_DB: db, ASSETS: { fetch: async () => new Response() } };
    for (const id of ['builder', 'other']) sqlite.prepare('INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)').run(id, id, NOW, NOW);
    const published = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }); published.status = 'published'; published.publishedAt = NOW;
    putRoom(published, true);
    snapshot = createDefaultRoomSnapshot('1,0', { x: 1, y: 0 }); snapshot.title = 'My guest room'; snapshot.tileData.terrain[8][4] = 15;
    const draft = await upsertGuestRoomDraft(env, { ...identity, guestDisplayName: 'Guest', snapshot, nowIso: NOW }); draftId = draft.id;
  });
  afterEach(() => { sqlite.close(); vi.useRealTimers(); });
  function read(sql: string, ...args: (string | number | null)[]): Record<string, unknown> | undefined { return sqlite.prepare(sql).get(...args) as Record<string, unknown> | undefined; }
  function putRoom(room: RoomSnapshot, published = false, owner: string | null = null): void {
    sqlite.prepare('INSERT INTO rooms (id, x, y, draft_json, published_json, claimer_user_id, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(room.id, room.coordinates.x, room.coordinates.y, JSON.stringify(room), published ? JSON.stringify(room) : null, owner, owner ? NOW : null);
  }
  const claim = (coordinates?: { x: number; y: number }, userId = 'builder') =>
    claimGuestRoomDraft(env, identity, auth(userId), draftId, { expectedUserId: userId, coordinates });

  it('copies terrain into an owned draft and commits its original retry receipt once', async () => {
    const result = await claim(); expect(result.outcome).toBe('claimed');
    if (result.outcome !== 'claimed') return;
    expect(result.room.claimerUserId).toBe('builder'); expect(result.room.draft.tileData.terrain[8][4]).toBe(15);
    expect(result.room.published).toBeNull(); expect(read('SELECT status, claimed_room_id FROM guest_room_drafts WHERE id = ?', draftId)).toEqual({ status: 'claimed', claimed_room_id: '1,0' });
    expect(await claim({ x: -1, y: 0 })).toEqual(result);
    expect(read('SELECT COUNT(*) AS n FROM guest_room_draft_claims')?.n).toBe(1);
    expect(read('SELECT COUNT(*) AS n FROM room_mutation_checks')?.n).toBe(0);
    await expect(claim(undefined, 'other')).rejects.toMatchObject({ status: 409 });
    const owned = await listOwnedGuestRoomDrafts(env, identity.guestUserId, identity.recoveryTokenHash);
    expect(owned[0]).toMatchObject({ status: 'claimed', claimedByUserId: 'builder', claimedRoomId: '1,0' });
  });
  it('retries a lost committed reply without replacing later account edits', async () => {
    db.loseReply = true; await expect(claim()).rejects.toThrow('Lost committed reply');
    const edited = { ...snapshot, title: 'Later account edit' };
    await saveDraft(env, edited, buildRoomMutationActor(auth()));
    const result = await claim({ x: -1, y: 0 });
    expect(result.outcome === 'claimed' && result.room.draft.title).toBe('Later account edit');
    expect(read("SELECT COUNT(*) AS n FROM rooms WHERE claimer_user_id = 'builder'")?.n).toBe(1);
  });
  it('recognizes a matching draft saved after signing in inside the editor without claiming another room', async () => {
    env.ROOM_DAILY_CLAIM_LIMIT = '1';
    const existing = await saveDraft(env, snapshot, buildRoomMutationActor(auth()));
    sqlite.exec("UPDATE rooms SET published_json = NULL WHERE id = '0,0'");
    expect(await claim()).toMatchObject({ outcome: 'claimed', roomId: '1,0', room: { claimedAt: existing.claimedAt } });
    expect(read("SELECT COUNT(*) AS n FROM rooms WHERE claimer_user_id = 'builder'")?.n).toBe(1);
    expect(read('SELECT COUNT(*) AS n FROM guest_room_draft_claims')?.n).toBe(1);
  });
  it('preserves newer account edits even when the guest originally saved the same owned room', async () => {
    await saveDraft(env, { ...snapshot, title: 'Newer account edit' }, buildRoomMutationActor(auth()));
    expect(await claim()).toMatchObject({ outcome: 'conflict', reason: 'occupied' });
    expect((await loadRoomRecord(env, '1,0', { x: 1, y: 0 })).draft.title).toBe('Newer account edit');
    expect(read('SELECT status FROM guest_room_drafts WHERE id = ?', draftId)?.status).toBe('active');
  });
  it('does not replace a matching owned draft if the account edits it during transfer', async () => {
    await saveDraft(env, snapshot, buildRoomMutationActor(auth()));
    db.beforeBatch = async queries => {
      if (!queries.some(query => query.sql.includes('INSERT INTO guest_room_draft_claims'))) return;
      db.beforeBatch = null; await saveDraft(env, { ...snapshot, title: 'Concurrent account edit' }, buildRoomMutationActor(auth()));
    };
    expect(await claim()).toMatchObject({ outcome: 'conflict', reason: 'occupied' });
    expect((await loadRoomRecord(env, '1,0', { x: 1, y: 0 })).draft.title).toBe('Concurrent account edit');
    expect(read('SELECT COUNT(*) AS n FROM guest_room_draft_claims')?.n).toBe(0);
  });
  it.each(['owner', 'published', 'nonblank', 'minted'])('preserves an occupied %s target and offers real frontier choices', async kind => {
    const target = createDefaultRoomSnapshot('1,0', { x: 1, y: 0 });
    if (kind === 'nonblank') target.title = 'Do not replace me';
    putRoom(target, kind === 'published', kind === 'owner' ? 'other' : null);
    if (kind === 'minted') sqlite.exec("UPDATE rooms SET minted_token_id = '7' WHERE id = '1,0'");
    const before = read("SELECT draft_json FROM rooms WHERE id = '1,0'");
    const result = await claim(); expect(result.outcome).toBe('conflict');
    if (result.outcome !== 'conflict') return;
    expect(result.reason).toBe('occupied'); expect(result.suggestedCoordinates).toContainEqual({ x: -1, y: 0 });
    expect(read("SELECT draft_json FROM rooms WHERE id = '1,0'")).toEqual(before);
    expect(read('SELECT status FROM guest_room_drafts WHERE id = ?', draftId)?.status).toBe('active');
    const relocated = await claim({ x: -1, y: 0 });
    expect(relocated.outcome === 'claimed' && relocated.room.draft.tileData.terrain[8][4]).toBe(15);
    expect(relocated.outcome === 'claimed' && relocated.roomId).toBe('-1,0');
  });
  it('refuses a non-frontier destination and can fill a stored blank frontier placeholder', async () => {
    expect(await claim({ x: 99, y: 99 })).toMatchObject({ outcome: 'conflict', reason: 'not_frontier' });
    putRoom(createDefaultRoomSnapshot('1,0', { x: 1, y: 0 }));
    expect(await claim()).toMatchObject({ outcome: 'claimed', roomId: '1,0' });
  });
  it('rolls back room ownership and guest status when the final receipt write fails', async () => {
    db.failAt = 'UPDATE guest_room_draft_claims SET applied'; await expect(claim()).rejects.toThrow('Interrupted write');
    expect(read("SELECT id FROM rooms WHERE id = '1,0'")).toBeUndefined();
    expect(read('SELECT status FROM guest_room_drafts WHERE id = ?', draftId)?.status).toBe('active');
    expect(read('SELECT COUNT(*) AS n FROM guest_room_draft_claims')?.n).toBe(0);
    expect(await claim()).toMatchObject({ outcome: 'claimed' });
  });
  it('cannot clobber a room claimed between checking the frontier and writing', async () => {
    db.beforeBatch = async queries => {
      if (!queries.some(query => query.sql.includes('INSERT INTO guest_room_draft_claims'))) return;
      db.beforeBatch = null; await saveDraft(env, { ...snapshot, title: 'Other builder' }, buildRoomMutationActor(auth('other')));
    };
    expect(await claim()).toMatchObject({ outcome: 'conflict', reason: 'occupied' });
    expect((await loadRoomRecord(env, '1,0', { x: 1, y: 0 })).draft.title).toBe('Other builder');
    expect(read('SELECT status FROM guest_room_drafts WHERE id = ?', draftId)?.status).toBe('active');
  });
  it('prevents a normal stale save from overwriting a guest transfer which committed first', async () => {
    db.beforeBatch = async queries => {
      if (!queries.some(query => query.sql.includes('INSERT INTO room_mutation_checks'))) return;
      db.beforeBatch = null; await claim();
    };
    await expect(saveDraft(env, { ...snapshot, title: 'Stale other tab' }, buildRoomMutationActor(auth('other')))).rejects.toMatchObject({ status: 409 });
    expect((await loadRoomRecord(env, '1,0', { x: 1, y: 0 })).draft.title).toBe('My guest room');
  });
  it('deduplicates simultaneous transfers to different spots and refuses a second account', async () => {
    db.beforeBatch = async queries => {
      if (!queries.some(query => query.sql.includes('INSERT INTO guest_room_draft_claims'))) return;
      db.beforeBatch = null; await claim({ x: -1, y: 0 });
    };
    expect(await claim()).toMatchObject({ outcome: 'claimed', roomId: '-1,0' });
    await expect(claim(undefined, 'other')).rejects.toMatchObject({ status: 409 });
    expect(read("SELECT id FROM rooms WHERE id = '1,0'")).toBeUndefined();
  });
  it('rejects a guest autosave change or removal of the last published neighbor during transfer', async () => {
    db.beforeBatch = async queries => {
      if (!queries.some(query => query.sql.includes('INSERT INTO guest_room_draft_claims'))) return;
      db.beforeBatch = null; await upsertGuestRoomDraft(env, { ...identity, guestDisplayName: 'Guest', snapshot: { ...snapshot, title: 'Newer guest edit' }, nowIso: NOW });
    };
    await expect(claim()).rejects.toMatchObject({ status: 409 });
    db.beforeBatch = async queries => {
      if (!queries.some(query => query.sql.includes('INSERT INTO guest_room_draft_claims'))) return;
      db.beforeBatch = null; sqlite.exec("UPDATE rooms SET published_json = NULL WHERE id = '0,0'");
    };
    expect(await claim()).toMatchObject({ outcome: 'conflict', reason: 'not_frontier' });
    expect(read('SELECT COUNT(*) AS n FROM guest_room_draft_claims')?.n).toBe(0);
  });
  it('keeps a stale guest autosave from updating a transferred snapshot', async () => {
    db.beforeBatch = async queries => {
      if (!queries.some(query => query.sql.includes('UPDATE guest_room_drafts') && !query.sql.includes("status = 'claimed'"))) return;
      db.beforeBatch = null; await claim();
    };
    await expect(upsertGuestRoomDraft(env, { ...identity, guestDisplayName: 'Guest', snapshot: { ...snapshot, title: 'Stale guest edit' }, nowIso: NOW })).rejects.toMatchObject({ status: 409 });
    expect(JSON.parse(String(read('SELECT snapshot_json FROM guest_room_drafts WHERE id = ?', draftId)?.snapshot_json)).title).toBe('My guest room');
  });
  it('enforces the daily limit inside the transaction, including another tab taking its last slot', async () => {
    env.ROOM_DAILY_CLAIM_LIMIT = '1';
    db.beforeBatch = async queries => {
      if (!queries.some(query => query.sql.includes('INSERT INTO guest_room_draft_claims'))) return;
      db.beforeBatch = null; await saveDraft(env, { ...snapshot, id: '-1,0', coordinates: { x: -1, y: 0 } }, buildRoomMutationActor(auth()));
    };
    await expect(claim()).rejects.toMatchObject({ status: 429 });
    expect(read('SELECT status FROM guest_room_drafts WHERE id = ?', draftId)?.status).toBe('active');
    expect(read("SELECT id FROM rooms WHERE id = '1,0'")).toBeUndefined();
  });
  it('requires the matching recovery token and intended signed-in account', async () => {
    await expect(claimGuestRoomDraft(env, { ...identity, recoveryTokenHash: 'wrong' }, auth(), draftId, { expectedUserId: 'builder' })).rejects.toMatchObject({ status: 404 });
    await expect(claimGuestRoomDraft(env, identity, auth('other'), draftId, { expectedUserId: 'builder' })).rejects.toMatchObject({ status: 409 });
    await expect(claim({ x: Infinity, y: 0 })).rejects.toMatchObject({ status: 400 });
    const path = `https://api.wamp.land/api/guest-room-drafts/${draftId}/claim`;
    const request = (cookie?: string, origin = 'https://wamp.land') => new Request(path, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Guest-User-Id': identity.guestUserId, 'X-Guest-Recovery-Token': token,
      Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ expectedUserId: 'builder' }) });
    await expect(handleGuestRoomDraftRequest(request(), new URL(path), env)).rejects.toMatchObject({ status: 401 });
    const session = await createSession(env, 'builder');
    await expect(handleGuestRoomDraftRequest(request(`ep_session=${session}`, 'https://evil.example'), new URL(path), env)).rejects.toMatchObject({ status: 403 });
    const response = await handleGuestRoomDraftRequest(request(`ep_session=${session}`), new URL(path), env);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ outcome: 'claimed', userId: 'builder' });
  });
});
