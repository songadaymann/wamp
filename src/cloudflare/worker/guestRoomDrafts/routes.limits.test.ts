import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { handleGuestRoomDraftRequest } from './routes';

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

async function save(x: number, guest: string, ip = '203.0.113.7') {
  const roomId = `${x},0`;
  const snapshot = { ...createDefaultRoomSnapshot(roomId, { x, y: 0 }), title: `Room ${x}` };
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
});
