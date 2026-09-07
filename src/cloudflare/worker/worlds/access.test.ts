import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultRoomRecord } from '../../../persistence/roomModel';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import {
  applyWorldRoomPermissions,
  assertWorldFrontierClaim,
  loadWorldAccessByRoomId,
  prepareWorldDailyUsageStatement,
} from './access';

const migrationSql = readFileSync(
  new URL('../../../../migrations/0045_worlds_pilot.sql', import.meta.url),
  'utf8',
);

describe('World access and quota contracts', () => {
  let sqlite: DatabaseSync;
  let database: SqliteD1Database;
  let env: Env;

  beforeEach(() => {
    sqlite = createDatabase();
    database = new SqliteD1Database(sqlite);
    env = { DB: database, WORLDS_ENABLED: '1' } as unknown as Env;
  });

  afterEach(() => sqlite.close());

  it('replaces room permissions for an active numbered-World builder', async () => {
    const access = await loadWorldAccessByRoomId(env, '129,0', 'builder', false);
    expect(access).toMatchObject({
      number: 1,
      viewerRole: 'builder',
      membershipStatus: 'active',
      entitlementStatus: 'active',
    });
    expect(access?.policy).toMatchObject({
      canEditRooms: true,
      canClaimRooms: true,
      canPublishDirectly: false,
      canSubmitForApproval: true,
    });

    const record = createDefaultRoomRecord('129,0', { x: 129, y: 0 });
    const permissioned = await applyWorldRoomPermissions(env, '129,0', record, 'builder', false);
    expect(permissioned.permissions).toEqual({
      canSaveDraft: true,
      canPublish: true,
      canRevert: false,
      canMint: false,
    });
    expect(permissioned.world).toMatchObject({ worldId: 'world-1', worldNumber: 1, frozen: false });
  });

  it('keeps frozen Worlds playable while denying every mutation', async () => {
    sqlite.prepare(`UPDATE world_entitlements SET status = 'frozen' WHERE id = 'entitlement-1'`).run();
    const access = await loadWorldAccessByRoomId(env, '129,0', 'owner', false);
    expect(access?.policy.canPlay).toBe(true);
    expect(Object.entries(access?.policy ?? {}).filter(([key]) => key !== 'canPlay').every(([, value]) => !value)).toBe(true);
  });

  it('requires frontier adjacency to a published room in the same World', async () => {
    await expect(assertWorldFrontierClaim(env, 'world-1', { x: 130, y: 0 })).resolves.toBeUndefined();
    await expect(assertWorldFrontierClaim(env, 'world-1', { x: 129, y: 128 })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('rolls back all daily usage changes when a batch exceeds the configured ceiling', async () => {
    const world = { id: 'world-1', claimLimitPerDay: 1, publishLimitPerDay: 1 };
    const now = '2026-09-04T12:00:00.000Z';
    await expect(database.batch([
      prepareWorldDailyUsageStatement(env, { world, userId: 'builder', now, claimDelta: 1, publishDelta: 0 }),
      prepareWorldDailyUsageStatement(env, { world, userId: 'builder', now, claimDelta: 1, publishDelta: 0 }),
    ])).rejects.toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM world_daily_usage').get()).toEqual({ count: 0 });
  });
});

function createDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT);
    INSERT INTO users (id, email, display_name) VALUES
      ('owner', 'owner@example.test', 'Owner'),
      ('builder', 'builder@example.test', 'Builder'),
      ('other', 'other@example.test', 'Other');
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      draft_json TEXT NOT NULL,
      published_json TEXT,
      claimer_user_id TEXT,
      claimed_at TEXT
    );
  `);
  sqlite.exec(migrationSql);
  sqlite.exec(`
    INSERT INTO world_entitlements (
      id, owner_user_id, owner_email, source, status,
      claim_limit_ceiling, publish_limit_ceiling, created_at, updated_at
    ) VALUES
      ('entitlement-1', 'owner', 'owner@example.test', 'complimentary', 'active', 10, 25, '${NOW}', '${NOW}'),
      ('entitlement-2', 'other', 'other@example.test', 'complimentary', 'active', 10, 25, '${NOW}', '${NOW}');
    INSERT INTO worlds (
      id, number, origin_x, origin_y, owner_user_id, entitlement_id, approved_name,
      build_policy, publish_policy, claim_limit_per_day, publish_limit_per_day,
      activated_at, created_at, updated_at
    ) VALUES
      ('world-1', 1, 129, 0, 'owner', 'entitlement-1', NULL,
       'request_to_join', 'approval_required', 5, 10, '${NOW}', '${NOW}', '${NOW}'),
      ('world-2', 2, 129, 129, 'other', 'entitlement-2', NULL,
       'invite_only', 'members_publish', 5, 10, '${NOW}', '${NOW}', '${NOW}');
    INSERT INTO world_memberships (
      id, world_id, user_id, email, display_name, role, status,
      invited_by_user_id, created_at, updated_at
    ) VALUES
      ('owner-membership', 'world-1', 'owner', 'owner@example.test', 'Owner', 'owner', 'active', NULL, '${NOW}', '${NOW}'),
      ('builder-membership', 'world-1', 'builder', 'builder@example.test', 'Builder', 'builder', 'active', 'owner', '${NOW}', '${NOW}');
    INSERT INTO rooms (id, x, y, draft_json, published_json, claimer_user_id, claimed_at) VALUES
      ('129,0', 129, 0, '{}', '{}', 'owner', '${NOW}'),
      ('129,129', 129, 129, '{}', '{}', 'other', '${NOW}');
    INSERT INTO world_room_claims (room_id, x, y, world_id, first_builder_user_id, claimed_at) VALUES
      ('129,0', 129, 0, 'world-1', 'owner', '${NOW}'),
      ('129,129', 129, 129, 'world-2', 'other', '${NOW}');
  `);
  return sqlite;
}

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly bindings: SqliteValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.database, this.sql, values.map(toSqliteValue));
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.bindings) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.bindings) as T[] };
  }

  execute<T>(): { results: T[]; success: true; meta: { changes: number } } {
    const statement = this.database.prepare(this.sql);
    const results = statement.all(...this.bindings) as T[];
    const changes = this.database.prepare('SELECT changes() AS count').get() as { count: number };
    return { results, success: true, meta: { changes: Number(changes.count) } };
  }
}

class SqliteD1Database implements D1Database {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string): D1PreparedStatement {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SqliteD1Statement)) throw new Error('Unexpected statement implementation.');
        return statement.execute<unknown>();
      });
      this.database.exec('COMMIT');
      return results as T[];
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

type SqliteValue = null | number | bigint | string | Uint8Array;

function toSqliteValue(value: unknown): SqliteValue {
  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'bigint'
    || typeof value === 'string'
    || value instanceof Uint8Array
  ) return value;
  throw new TypeError(`Unsupported SQLite test binding: ${typeof value}.`);
}

const NOW = '2026-09-04T12:00:00.000Z';
