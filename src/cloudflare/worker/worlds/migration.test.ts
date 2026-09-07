import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('../../../../migrations/0045_worlds_pilot.sql', import.meta.url),
  'utf8',
);

describe('Worlds pilot migration', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createBaseDatabase();
    database.exec(migrationSql);
  });

  afterEach(() => database.close());

  it('creates Prime and backfills every claimed or published room', () => {
    expect(database.prepare('SELECT id, number, origin_x, origin_y FROM worlds').get()).toEqual({
      id: 'wamp-prime', number: 0, origin_x: 0, origin_y: 0,
    });
    expect(database.prepare('SELECT room_id, world_id FROM world_room_claims ORDER BY room_id').all()).toEqual([
      { room_id: 'claimed-at-only', world_id: 'wamp-prime' },
      { room_id: 'claimed-by-user', world_id: 'wamp-prime' },
      { room_id: 'published', world_id: 'wamp-prime' },
    ]);
  });

  it('enforces unique activation, World identity, and room provenance', () => {
    insertEntitlement(database, 'entitlement-1', 'owner@example.test');
    insertEntitlement(database, 'entitlement-2', 'other@example.test');
    insertWorld(database, 'world-1', 1, 129, 0, 'owner', 'entitlement-1');

    expect(() => insertWorld(database, 'duplicate-number', 1, 0, 129, 'other', 'entitlement-2')).toThrow();
    expect(() => insertWorld(database, 'duplicate-origin', 2, 129, 0, 'other', 'entitlement-2')).toThrow();
    expect(() => database.prepare('UPDATE worlds SET number = 4 WHERE id = ?').run('world-1')).toThrow(
      /immutable/,
    );
    expect(() => database.prepare('DELETE FROM worlds WHERE id = ?').run('world-1')).toThrow(/permanent/);
  });

  it('rolls back a batch-shaped transaction when a daily limit would be exceeded', () => {
    insertEntitlement(database, 'entitlement-1', 'owner@example.test');
    insertWorld(database, 'world-1', 1, 129, 0, 'owner', 'entitlement-1');
    database.prepare(`
      INSERT INTO world_daily_usage (
        world_id, user_id, utc_day, claim_count, publish_count,
        claim_limit, publish_limit, updated_at
      ) VALUES ('world-1', 'owner', '2026-09-04', 1, 0, 1, 10, '2026-09-04T12:00:00.000Z')
    `).run();

    expect(() => {
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare('UPDATE worlds SET approved_name = ? WHERE id = ?').run('Should roll back', 'world-1');
        database.prepare(`
          INSERT INTO world_daily_usage (
            world_id, user_id, utc_day, claim_count, publish_count,
            claim_limit, publish_limit, updated_at
          ) VALUES ('world-1', 'owner', '2026-09-04', 1, 0, 1, 10, '2026-09-04T13:00:00.000Z')
          ON CONFLICT(world_id, user_id, utc_day) DO UPDATE SET
            claim_count = world_daily_usage.claim_count + excluded.claim_count
        `).run();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }).toThrow();
    expect(database.prepare('SELECT approved_name FROM worlds WHERE id = ?').get('world-1')).toEqual({
      approved_name: null,
    });
  });

  it('keeps ownership history and room provenance append-only', () => {
    insertEntitlement(database, 'entitlement-1', 'owner@example.test');
    insertWorld(database, 'world-1', 1, 129, 0, 'owner', 'entitlement-1');
    database.prepare(`
      INSERT INTO world_ownership_events (
        id, world_id, owner_user_id, event_type, source, external_ref, occurred_at
      ) VALUES ('event-1', 'world-1', 'owner', 'activated', 'complimentary', NULL, '2026-09-04T12:00:00.000Z')
    `).run();
    database.prepare(`
      INSERT INTO rooms (id, x, y, draft_json, published_json, claimer_user_id, claimed_at)
      VALUES ('129,0', 129, 0, '{}', '{}', 'owner', '2026-09-04T12:00:00.000Z')
    `).run();
    database.prepare(`
      INSERT INTO world_room_claims (room_id, x, y, world_id, first_builder_user_id, claimed_at)
      VALUES ('129,0', 129, 0, 'world-1', 'owner', '2026-09-04T12:00:00.000Z')
    `).run();

    expect(() => database.prepare('DELETE FROM world_ownership_events WHERE id = ?').run('event-1')).toThrow(
      /append-only/,
    );
    expect(() => database.prepare('UPDATE world_room_claims SET world_id = ? WHERE room_id = ?').run(
      'wamp-prime', '129,0',
    )).toThrow(/immutable/);
  });

  it('atomically rejects stale or concurrently resolved publication approvals', () => {
    insertEntitlement(database, 'entitlement-1', 'owner@example.test');
    insertWorld(database, 'world-1', 1, 129, 0, 'owner', 'entitlement-1');
    database.prepare(`
      INSERT INTO rooms (id, x, y, draft_json, published_json, claimer_user_id, claimed_at)
      VALUES ('129,0', 129, 0, ?, NULL, 'owner', ?)
    `).run(JSON.stringify({ updatedAt: NOW }), NOW);
    insertPublicationRequest(database, 'request-exact', NOW);
    database.prepare(`UPDATE world_publication_requests SET status = 'approved' WHERE id = 'request-exact'`).run();
    expect(() => database.prepare(
      `UPDATE world_publication_requests SET status = 'rejected' WHERE id = 'request-exact'`,
    ).run()).toThrow(/no longer pending/);

    insertPublicationRequest(database, 'request-stale', NOW);
    database.prepare(`UPDATE rooms SET draft_json = ? WHERE id = '129,0'`).run(
      JSON.stringify({ updatedAt: '2026-09-04T13:00:00.000Z' }),
    );
    expect(() => database.prepare(
      `UPDATE world_publication_requests SET status = 'approved' WHERE id = 'request-stale'`,
    ).run()).toThrow(/draft is stale/);
  });
});

function createBaseDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT);
    INSERT INTO users (id, email, display_name) VALUES
      ('owner', 'owner@example.test', 'Owner'),
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
    INSERT INTO rooms (id, x, y, draft_json, published_json, claimer_user_id, claimed_at) VALUES
      ('empty', 10, 10, '{}', NULL, NULL, NULL),
      ('claimed-at-only', 11, 10, '{}', NULL, NULL, '2026-09-01T00:00:00.000Z'),
      ('claimed-by-user', 12, 10, '{}', NULL, 'owner', '2026-09-01T00:00:00.000Z'),
      ('published', 13, 10, '{}', '{}', NULL, NULL);
  `);
  return database;
}

function insertEntitlement(database: DatabaseSync, id: string, email: string): void {
  database.prepare(`
    INSERT INTO world_entitlements (
      id, owner_user_id, owner_email, source, provider, status,
      claim_limit_ceiling, publish_limit_ceiling, created_at, updated_at
    ) VALUES (?, ?, ?, 'complimentary', NULL, 'active', 10, 25, ?, ?)
  `).run(id, email.startsWith('owner') ? 'owner' : 'other', email, NOW, NOW);
}

function insertWorld(
  database: DatabaseSync,
  id: string,
  number: number,
  x: number,
  y: number,
  ownerId: string,
  entitlementId: string,
): void {
  database.prepare(`
    INSERT INTO worlds (
      id, number, origin_x, origin_y, owner_user_id, entitlement_id, approved_name,
      build_policy, publish_policy, claim_limit_per_day, publish_limit_per_day,
      activated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'request_to_join', 'approval_required', 5, 10, ?, ?, ?)
  `).run(id, number, x, y, ownerId, entitlementId, NOW, NOW, NOW);
}

function insertPublicationRequest(database: DatabaseSync, id: string, submittedDraftUpdatedAt: string): void {
  database.prepare(`
    INSERT INTO world_publication_requests (
      id, world_id, room_id, submitted_by_user_id, submitted_draft_updated_at,
      status, rejection_reason, resolved_by_user_id, submitted_at, resolved_at
    ) VALUES (?, 'world-1', '129,0', 'owner', ?, 'pending', NULL, NULL, ?, NULL)
  `).run(id, submittedDraftUpdatedAt, NOW);
}

const NOW = '2026-09-04T12:00:00.000Z';
