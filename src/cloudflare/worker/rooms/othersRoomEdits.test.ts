import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomRecord, type RoomRecord } from '../../../persistence/roomModel';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { releaseRateLimitSlots } from '../core/rateLimit';
import { assertOthersRoomEditsOpen, isEditOfOthersRoom, takeOthersRoomEditSlot } from './othersRoomEdits';

vi.mock('../progression/trustCaps', () => ({
  resolveRoomCapabilities: vi.fn(async () => ({ publishLimitPerDay: 2 })),
}));

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
  db.exec(readFileSync('migrations/0049_rate_limit_events.sql', 'utf8'));
  const database = {
    prepare: statement,
    async batch<T>(queries: D1PreparedStatement[]): Promise<T[]> { return Promise.all(queries.map((query) => query.all())) as Promise<T[]>; },
    withSession: () => database,
  } as unknown as D1Database;
  env = { DB: database, JAM_DB: database, ASSETS: { fetch: async () => new Response() } } as unknown as Env;
});
afterEach(() => db.close());

function publishedRoom(claimerUserId: string | null): RoomRecord {
  const record = createDefaultRoomRecord('3,4', { x: 3, y: 4 });
  record.published = { ...record.draft, status: 'published', version: 1 };
  record.claimerUserId = claimerUserId;
  return record;
}

const at = (time: string) => new Date(`2026-10-21T${time}.000Z`);

describe("edits to other builders' rooms", () => {
  it('applies only to published, unminted WAMP 0 rooms claimed by someone else', () => {
    const world = { worldId: 'w1', worldNumber: 1, worldName: null, viewerRole: null, membershipStatus: null, frozen: false };
    expect(isEditOfOthersRoom(publishedRoom('owner'), 'visitor', false)).toBe(true);
    expect(isEditOfOthersRoom(publishedRoom(null), 'visitor', false)).toBe(true);
    expect(isEditOfOthersRoom(publishedRoom('visitor'), 'visitor', false)).toBe(false);
    expect(isEditOfOthersRoom({ ...publishedRoom('owner'), published: null }, 'visitor', false)).toBe(false);
    expect(isEditOfOthersRoom({ ...publishedRoom('owner'), mintedTokenId: '7' }, 'visitor', false)).toBe(false);
    expect(isEditOfOthersRoom({ ...publishedRoom('owner'), world }, 'visitor', false)).toBe(false);
    expect(isEditOfOthersRoom(publishedRoom('owner'), 'visitor', true)).toBe(false);
  });

  it('counts each room once per UTC day against the publish allowance', async () => {
    expect(await takeOthersRoomEditSlot(env, 'visitor', 'a', 'session', at('01:00:00'))).toEqual(expect.any(Number));
    expect(await takeOthersRoomEditSlot(env, 'visitor', 'a', 'session', at('01:05:00'))).toEqual(expect.any(Number));
    expect(await takeOthersRoomEditSlot(env, 'visitor', 'b', 'agent_token', at('02:00:00'))).toEqual(expect.any(Number));
    expect(await takeOthersRoomEditSlot(env, 'visitor', 'a', 'session', at('03:00:00'))).toEqual(expect.any(Number));
    await expect(takeOthersRoomEditSlot(env, 'visitor', 'c', 'session', at('04:00:00')))
      .rejects.toMatchObject({ status: 429 });
    expect(await takeOthersRoomEditSlot(env, 'someone-else', 'c', 'session', at('04:00:00'))).toEqual(expect.any(Number));
    expect(await takeOthersRoomEditSlot(env, 'visitor', 'c', 'session', new Date('2026-10-22T00:00:01.000Z')))
      .toEqual(expect.any(Number));
  });

  it('keeps a room counted when another publish of the same room fails and gives its slot back', async () => {
    const failed = await takeOthersRoomEditSlot(env, 'visitor', 'a', 'session', at('01:00:00'));
    await takeOthersRoomEditSlot(env, 'visitor', 'a', 'session', at('01:00:01'));
    await releaseRateLimitSlots(env, [failed]);
    await takeOthersRoomEditSlot(env, 'visitor', 'b', 'session', at('01:01:00'));
    await expect(takeOthersRoomEditSlot(env, 'visitor', 'c', 'session', at('01:02:00')))
      .rejects.toMatchObject({ status: 429 });
  });

  it('does not let a burst of parallel publishes pass the count together', async () => {
    const results = await Promise.allSettled(['a', 'b', 'c', 'd', 'e'].map((room) =>
      takeOthersRoomEditSlot(env, 'visitor', room, 'session', at('05:00:00'))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(3);
  });

  it('pauses every edit of other builders\' rooms while the raid switch is set', async () => {
    expect(() => assertOthersRoomEditsOpen(env)).not.toThrow();
    env.OTHERS_ROOM_EDITS_PAUSED = '1';
    expect(() => assertOthersRoomEditsOpen(env)).toThrow(expect.objectContaining({ status: 503 }));
    await expect(takeOthersRoomEditSlot(env, 'visitor', 'a', 'session', at('06:00:00')))
      .rejects.toMatchObject({ status: 503 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM rate_limit_events').get()).toEqual({ n: 0 });
  });
});
