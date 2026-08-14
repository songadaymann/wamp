import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('../../../../migrations/0044_custom_sprite_catalog.sql', import.meta.url),
  'utf8',
);

describe('custom sprite catalog migration', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase();
  });

  afterEach(() => database.close());

  it('backfills every distinct sprite and only attributes unambiguous signed-in ownership', () => {
    insertRoom(database, 'room-a', 'user-a', 'user-a',
      snapshot(sprite('owned', 'Owned old', '2026-08-01T00:00:00.000Z')),
      snapshot(sprite('owned', 'Owned newest', '2026-08-03T00:00:00.000Z')),
    );
    insertRoom(database, 'room-b', 'user-a', null,
      snapshot(sprite('ambiguous', 'Ambiguous A', '2026-08-02T00:00:00.000Z')),
      null,
    );
    insertRoom(database, 'room-c', 'user-b', null,
      snapshot(sprite('ambiguous', 'Ambiguous B', '2026-08-04T00:00:00.000Z')),
      null,
    );
    database.prepare(`
      INSERT INTO room_versions (
        room_id, version, snapshot_json, created_at, published_by_user_id
      ) VALUES (?, 1, ?, ?, ?)
    `).run(
      'room-a',
      snapshot(sprite('historical', 'Historical', '2026-07-01T00:00:00.000Z')),
      '2026-07-01T00:00:00.000Z',
      'user-a',
    );
    insertGuestDraft(database, 'active-guest', 'active', sprite('guest', 'Guest', '2026-08-05T00:00:00.000Z'));
    insertGuestDraft(database, 'closed-guest', 'claimed', sprite('excluded', 'Excluded', '2026-08-06T00:00:00.000Z'));
    insertRoom(database, 'orphan-room', 'missing-user', null,
      snapshot(sprite('orphan', 'Orphan', '2026-08-07T00:00:00.000Z')),
      null,
    );

    database.exec(migrationSql);

    const rows = database.prepare(`
      SELECT id, owner_user_id, legacy_creator_label, name, status, revision
      FROM custom_sprites
      ORDER BY id
    `).all() as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        id: 'ambiguous',
        owner_user_id: null,
        legacy_creator_label: 'Legacy creator',
        name: 'Ambiguous B',
        status: 'active',
        revision: 1,
      },
      {
        id: 'guest',
        owner_user_id: null,
        legacy_creator_label: 'Legacy creator',
        name: 'Guest',
        status: 'active',
        revision: 1,
      },
      {
        id: 'historical',
        owner_user_id: 'user-a',
        legacy_creator_label: null,
        name: 'Historical',
        status: 'active',
        revision: 1,
      },
      {
        id: 'orphan',
        owner_user_id: null,
        legacy_creator_label: 'Legacy creator',
        name: 'Orphan',
        status: 'active',
        revision: 1,
      },
      {
        id: 'owned',
        owner_user_id: 'user-a',
        legacy_creator_label: null,
        name: 'Owned newest',
        status: 'active',
        revision: 1,
      },
    ]);
  });

  it('is safe to re-run without replacing catalog edits', () => {
    insertRoom(database, 'room-a', 'user-a', null,
      snapshot(sprite('owned', 'Original', '2026-08-01T00:00:00.000Z')),
      null,
    );
    database.exec(migrationSql);
    database.prepare(`
      UPDATE custom_sprites
      SET name = 'Edited', normalized_name = 'edited', revision = 2
      WHERE id = 'owned'
    `).run();
    database.exec(migrationSql);
    expect(database.prepare(
      `SELECT name, revision FROM custom_sprites WHERE id = 'owned'`,
    ).get()).toEqual({ name: 'Edited', revision: 2 });
  });

  it('skips malformed historical snapshots instead of blocking the migration', () => {
    insertRoom(database, 'bad-room', null, null, '{not-json', '{also-bad');
    database.prepare(`
      INSERT INTO room_versions (
        room_id, version, snapshot_json, created_at, published_by_user_id
      ) VALUES ('bad-room', 1, 'broken', '2026-08-01T00:00:00.000Z', NULL)
    `).run();
    insertGuestDraft(database, 'valid-guest', 'active', sprite('valid', 'Valid', '2026-08-05T00:00:00.000Z'));
    database.exec(migrationSql);
    expect(database.prepare(`SELECT id FROM custom_sprites`).all()).toEqual([{ id: 'valid' }]);
  });
});

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      username TEXT
    );
    INSERT INTO users (id, display_name, username) VALUES
      ('user-a', 'Builder A', 'builder-a'),
      ('user-b', 'Builder B', 'builder-b');
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      draft_json TEXT NOT NULL,
      published_json TEXT,
      claimer_user_id TEXT,
      last_published_by_user_id TEXT
    );
    CREATE TABLE room_versions (
      room_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      published_by_user_id TEXT,
      PRIMARY KEY (room_id, version)
    );
    CREATE TABLE guest_room_drafts (
      id TEXT PRIMARY KEY,
      guest_user_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

function insertRoom(
  database: DatabaseSync,
  id: string,
  claimerUserId: string | null,
  publisherUserId: string | null,
  draftJson: string,
  publishedJson: string | null,
): void {
  database.prepare(`
    INSERT INTO rooms (
      id, draft_json, published_json, claimer_user_id, last_published_by_user_id
    ) VALUES (?, ?, ?, ?, ?)
  `).run(id, draftJson, publishedJson, claimerUserId, publisherUserId);
}

function insertGuestDraft(
  database: DatabaseSync,
  id: string,
  status: string,
  definition: Record<string, unknown>,
): void {
  database.prepare(`
    INSERT INTO guest_room_drafts (
      id, guest_user_id, snapshot_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    `guest-${id}`,
    snapshot(definition),
    status,
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T00:00:00.000Z',
  );
}

function snapshot(...sprites: Array<Record<string, unknown>>): string {
  return JSON.stringify({ customSprites: sprites });
}

function sprite(id: string, name: string, updatedAt: string): Record<string, unknown> {
  return {
    id,
    name,
    size: 16,
    kind: 'decoration',
    pixels: ['#ffffff'],
    status: 'active',
    createdAt: updatedAt,
    updatedAt,
  };
}
