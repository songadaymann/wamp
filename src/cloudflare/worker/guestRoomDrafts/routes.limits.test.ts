import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { handleGuestRoomDraftRequest } from './routes';
import { handleAdminGuestRoomDrafts } from './adminRoutes';

let db: DatabaseSync;
let env: Env;

function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...next) => statement(sql, next),
    async first<T>() { return (db.prepare(sql).get(...values as []) ?? null) as T | null; },
    async all<T>() { return { results: db.prepare(sql).all(...values as []) as T[] }; },
  } as D1PreparedStatement;
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users(id TEXT PRIMARY KEY)');
  for (const migration of ['0037_guest_room_drafts', '0049_rate_limit_events', '0053_guest_draft_claims']) {
    db.exec(readFileSync(`migrations/${migration}.sql`, 'utf8'));
  }
  const database: D1Database = {
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
  } as D1Database;
  env = { DB: database, JAM_DB: database, ASSETS: { fetch: async () => new Response() } } as unknown as Env;
});
afterEach(() => db.close());

async function save(x: number, guest: string, ip = '203.0.113.7', extra: Record<string, unknown> = {}) {
  const roomId = `${x},0`;
  const snapshot = { ...createDefaultRoomSnapshot(roomId, { x, y: 0 }), title: `Room ${x}`, ...extra };
  const url = new URL(`https://api.wamp.land/api/guest-room-drafts/${encodeURIComponent(roomId)}`);
  const request = new Request(url, {
    method: 'PUT',
    headers: { Origin: 'https://wamp.land', 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestUserId: `guest-${guest}`, guestDisplayName: 'Guest', recoveryToken: guest.padEnd(64, 'r'), snapshot }),
  });
  try {
    return (await handleGuestRoomDraftRequest(request, url, env)).status;
  } catch (error) {
    return (error as { status?: number }).status ?? 500;
  }
}
const draftCount = () => (db.prepare('SELECT COUNT(*) AS n FROM guest_room_drafts').get() as { n: number }).n;

describe('guest draft limits (F188)', () => {
  it('caps new drafts at 20 a day per network, but never an existing draft being saved again', async () => {
    for (let i = 0; i < 20; i += 1) expect(await save(i, `a${i}`)).toBe(200);
    expect(await save(20, 'a20')).toBe(429);
    expect(draftCount()).toBe(20);
    // Autosaving a draft that already exists is not a new draft.
    expect(await save(3, 'a3')).toBe(200);
    expect(await save(3, 'a3')).toBe(200);
    // Another network can still start one.
    expect(await save(21, 'b21', '198.51.100.9')).toBe(200);
    expect(draftCount()).toBe(21);
  });

  it('stops new guest drafts everywhere once 2,000 were started today', async () => {
    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO rate_limit_events (bucket, key_hash, created_at) VALUES (?, ?, ?)');
    for (let i = 0; i < 2000; i += 1) insert.run('guest-draft-create:all', 'all', now);
    expect(await save(0, 'late', '192.0.2.1')).toBe(429);
    expect(draftCount()).toBe(0);
  });

  it('caps guest rooms shared to Explore at five a day per network, counting only real submissions', async () => {
    const submit = async (x: number, guest: string, ip = '203.0.113.7') => {
      const id = (db.prepare('SELECT id FROM guest_room_drafts WHERE room_id = ?').get(`${x},0`) as { id: string }).id;
      const url = new URL(`https://api.wamp.land/api/guest-room-drafts/${encodeURIComponent(id)}/submit`);
      const request = new Request(url, { method: 'POST', headers: {
        Origin: 'https://wamp.land', 'CF-Connecting-IP': ip, 'X-Guest-User-Id': `guest-${guest}`, 'X-Guest-Recovery-Token': guest.padEnd(64, 'r'),
      } });
      try { return (await handleGuestRoomDraftRequest(request, url, env)).status; } catch (error) { return (error as { status?: number }).status ?? 500; }
    };
    for (let i = 0; i < 7; i += 1) expect(await save(i, `s${i}`, `198.51.100.${i + 10}`)).toBe(200);
    for (let i = 0; i < 5; i += 1) expect(await submit(i, `s${i}`)).toBe(200);
    expect(await submit(0, 's0')).toBe(200);
    expect(await submit(5, 's5')).toBe(429);
    expect(await submit(6, 's6', '192.0.2.44')).toBe(200);
    expect(await submit(5, 'wrong-guest')).toBe(404);
  });
});

describe('guest room moderation (F049)', () => {
  const admin = (path: string, method = 'GET') => {
    const url = new URL(`https://api.wamp.land${path}`);
    const request = new Request(url, { method, headers: { Origin: 'https://wamp.land', 'x-admin-key': 'test-admin-key' } });
    return handleAdminGuestRoomDrafts(request, url, { ...env, ADMIN_API_KEY: 'test-admin-key' } as Env);
  };
  it('hides a shared guest room from public lists without taking it from its guest', async () => {
    expect(await save(1, 'h1')).toBe(200);
    const id = (db.prepare('SELECT id FROM guest_room_drafts').get() as { id: string }).id;
    db.prepare("UPDATE guest_room_drafts SET status = 'submitted', moderation_status = 'public', submitted_at = updated_at").run();
    const before = db.prepare('SELECT updated_at FROM guest_room_drafts').get();
    expect((await (await admin('/api/admin/guest-room-drafts')).json() as { drafts: Array<{ hidden: boolean }> }).drafts)
      .toEqual([expect.objectContaining({ id, hidden: false })]);
    expect((await admin(`/api/admin/guest-room-drafts/${id}/hide`, 'POST')).status).toBe(200);
    await expect(admin(`/api/admin/guest-room-drafts/${id}/hide`, 'POST')).rejects.toMatchObject({ status: 404 });
    const listUrl = new URL('https://api.wamp.land/api/guest-room-drafts/submitted');
    const publicList = await (await handleGuestRoomDraftRequest(new Request(listUrl), listUrl, env)).json() as { drafts: unknown[] };
    expect(publicList.drafts).toEqual([]);
    expect(db.prepare('SELECT updated_at FROM guest_room_drafts').get()).toEqual(before);
    expect((await admin(`/api/admin/guest-room-drafts/${id}/show`, 'POST')).status).toBe(200);
    const shown = await (await handleGuestRoomDraftRequest(new Request(listUrl), listUrl, env)).json() as { drafts: unknown[] };
    expect(shown.drafts).toHaveLength(1);
    await expect(handleAdminGuestRoomDrafts(new Request(listUrl.href.replace('/api/', '/api/admin/')), new URL('https://api.wamp.land/api/admin/guest-room-drafts'), env))
      .rejects.toMatchObject({ status: 403 });
  });

  it('keeps a guest whose shared room was hidden from sharing straight back into Explore', async () => {
    expect(await save(1, 'h2')).toBe(200);
    db.prepare("UPDATE guest_room_drafts SET status = 'submitted', moderation_status = 'hidden', submitted_at = updated_at").run();
    expect(await save(2, 'h2')).toBe(200);
    const second = (db.prepare("SELECT id FROM guest_room_drafts WHERE room_id = '2,0'").get() as { id: string }).id;
    const url = new URL(`https://api.wamp.land/api/guest-room-drafts/${encodeURIComponent(second)}/submit`);
    const submitted = await handleGuestRoomDraftRequest(new Request(url, { method: 'POST', headers: {
      Origin: 'https://wamp.land', 'CF-Connecting-IP': '203.0.113.7', 'X-Guest-User-Id': 'guest-h2', 'X-Guest-Recovery-Token': 'h2'.padEnd(64, 'r'),
    } }), url, env);
    expect(submitted.status).toBe(200);
    expect(db.prepare("SELECT moderation_status FROM guest_room_drafts WHERE room_id = '2,0'").get()).toEqual({ moderation_status: 'hidden' });
  });
});

describe('guest room video (F410)', () => {
  const video = { youtubeId: 'dQw4w9WgXcQ', x: 0, y: 0, width: 320, autoplay: true };
  const stored = () => JSON.parse((db.prepare('SELECT snapshot_json FROM guest_room_drafts').get() as { snapshot_json: string }).snapshot_json) as Record<string, unknown>;

  it('saves a guest draft without its room video and keeps the rest', async () => {
    expect(await save(1, 'v1', '203.0.113.7', { video, goalIntroText: 'Reach the flag' })).toBe(200);
    expect(stored()).not.toHaveProperty('video');
    expect(stored()).toMatchObject({ title: 'Room 1', goalIntroText: 'Reach the flag' });
  });

  it('leaves a video out of the public guest room list for drafts saved with one', async () => {
    expect(await save(1, 'v2')).toBe(200);
    db.prepare(`UPDATE guest_room_drafts SET snapshot_json = json_set(snapshot_json, '$.video', json(?)),
      status = 'submitted', moderation_status = 'public', submitted_at = updated_at`).run(JSON.stringify(video));
    expect(stored()).toHaveProperty('video');
    const listUrl = new URL('https://api.wamp.land/api/guest-room-drafts/submitted');
    const list = await (await handleGuestRoomDraftRequest(new Request(listUrl), listUrl, env)).json() as {
      drafts: Array<{ title: string; snapshot: Record<string, unknown> }>;
    };
    expect(list.drafts).toHaveLength(1);
    expect(list.drafts[0].snapshot).not.toHaveProperty('video');
    expect(list.drafts[0].snapshot).toMatchObject({ title: 'Room 1' });
  });
});
