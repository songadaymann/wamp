import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('../../../../migrations/0042_world_tile_published_room_summaries.sql', import.meta.url),
  'utf8',
);

describe('world tile published-room summary migration', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase();
  });

  afterEach(() => database.close());

  it('backfills only published metadata while retaining expanded-room member cells', () => {
    insertRoom(database, {
      id: 'standalone',
      x: 1,
      y: 2,
      draftJson: JSON.stringify({ privateNote: 'standalone draft secret' }),
      publishedJson: publishedSnapshot('standalone', 1, 2, 3, 'reach_exit'),
      title: 'Standalone',
      creatorUserId: 'builder-a',
      creatorDisplayName: 'Builder A',
    });
    insertRoom(database, {
      id: 'expanded-member',
      x: -4,
      y: 9,
      draftJson: JSON.stringify({ privateNote: 'expanded draft secret' }),
      publishedJson: publishedSnapshot('expanded-member', -4, 9, 8, 'collect_target'),
      title: 'Expanded member',
      creatorUserId: 'builder-b',
      creatorDisplayName: 'Builder B',
    });
    database.prepare(
      'INSERT INTO expanded_room_cells (expanded_room_id, room_id) VALUES (?, ?)',
    ).run('expanded-a', 'expanded-member');
    insertRoom(database, {
      id: 'claimed-private',
      x: 20,
      y: 21,
      draftJson: JSON.stringify({ privateNote: 'claimed unpublished secret' }),
      publishedJson: null,
      title: null,
      creatorUserId: null,
      creatorDisplayName: null,
    });

    database.exec(migrationSql);

    expect(loadSummaries(database)).toEqual([
      {
        room_id: 'standalone',
        room_x: 1,
        room_y: 2,
        published_title: 'Standalone',
        goal_type: 'reach_exit',
        published_version: 3,
        creator_user_id: 'builder-a',
        creator_display_name: 'Builder A',
      },
      {
        room_id: 'expanded-member',
        room_x: -4,
        room_y: 9,
        published_title: 'Expanded member',
        goal_type: 'collect_target',
        published_version: 8,
        creator_user_id: 'builder-b',
        creator_display_name: 'Builder B',
      },
    ]);
    expect(loadSummary(database, 'claimed-private')).toBeUndefined();
    const summaryColumnNames = (
      database.prepare(
        'SELECT name FROM pragma_table_info(?) ORDER BY cid',
      ).all('world_tile_published_room_summaries') as Array<{ name: string }>
    ).map((row) => row.name);
    expect(summaryColumnNames).not.toEqual(
      expect.arrayContaining(['draft_json', 'published_json', 'snapshot_json']),
    );
    expect(JSON.stringify(loadSummaries(database))).not.toContain('secret');
  });

  it('converges publish, metadata, coordinate, unpublish, and delete mutations', () => {
    insertRoom(database, {
      id: 'published',
      x: 0,
      y: 0,
      draftJson: '{"private":true}',
      publishedJson: publishedSnapshot('published', 0, 0, 1, 'reach_exit'),
      title: 'First title',
      creatorUserId: 'builder-a',
      creatorDisplayName: 'Builder A',
    });
    insertRoom(database, {
      id: 'claimed',
      x: 5,
      y: 6,
      draftJson: '{"private":true}',
      publishedJson: null,
      title: null,
      creatorUserId: null,
      creatorDisplayName: null,
    });
    database.exec(migrationSql);

    const refreshedAt = loadSummary(database, 'published')?.refreshed_at;
    database.prepare('UPDATE rooms SET draft_json = ? WHERE id = ?')
      .run('{"private":"changed"}', 'published');
    expect(loadSummary(database, 'published')?.refreshed_at).toBe(refreshedAt);

    database.prepare(`
      UPDATE rooms
      SET x = ?, y = ?, published_title = ?, published_json = ?,
          last_published_by_user_id = ?, last_published_by_display_name = ?
      WHERE id = ?
    `).run(
      -2,
      -3,
      'Updated title',
      publishedSnapshot('published', -2, -3, 2, 'survival'),
      'builder-c',
      'Builder C',
      'published',
    );
    expect(loadSummary(database, 'published')).toMatchObject({
      room_x: -2,
      room_y: -3,
      published_title: 'Updated title',
      goal_type: 'survival',
      published_version: 2,
      creator_user_id: 'builder-c',
      creator_display_name: 'Builder C',
    });

    database.prepare(`
      UPDATE rooms
      SET published_json = ?, published_title = ?,
          last_published_by_user_id = ?, last_published_by_display_name = ?
      WHERE id = ?
    `).run(
      publishedSnapshot('claimed', 5, 6, 1, 'checkpoint_sprint'),
      'Now public',
      'builder-d',
      'Builder D',
      'claimed',
    );
    expect(loadSummary(database, 'claimed')).toMatchObject({
      published_title: 'Now public',
      goal_type: 'checkpoint_sprint',
      published_version: 1,
    });

    database.prepare('UPDATE rooms SET published_json = NULL WHERE id = ?').run('published');
    expect(loadSummary(database, 'published')).toBeUndefined();

    database.prepare('DELETE FROM rooms WHERE id = ?').run('claimed');
    expect(loadSummary(database, 'claimed')).toBeUndefined();
  });
});

interface RoomFixture {
  id: string;
  x: number;
  y: number;
  draftJson: string;
  publishedJson: string | null;
  title: string | null;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
}

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      draft_json TEXT NOT NULL,
      published_json TEXT,
      published_title TEXT,
      last_published_by_user_id TEXT,
      last_published_by_display_name TEXT,
      UNIQUE (x, y)
    );
    CREATE TABLE expanded_room_cells (
      expanded_room_id TEXT NOT NULL,
      room_id TEXT NOT NULL
    );
  `);
  return database;
}

function insertRoom(database: DatabaseSync, fixture: RoomFixture): void {
  database.prepare(`
    INSERT INTO rooms (
      id, x, y, draft_json, published_json, published_title,
      last_published_by_user_id, last_published_by_display_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fixture.id,
    fixture.x,
    fixture.y,
    fixture.draftJson,
    fixture.publishedJson,
    fixture.title,
    fixture.creatorUserId,
    fixture.creatorDisplayName,
  );
}

function publishedSnapshot(
  id: string,
  x: number,
  y: number,
  version: number,
  goalType: string,
): string {
  return JSON.stringify({
    id,
    coordinates: { x, y },
    status: 'published',
    version,
    title: `Snapshot ${id}`,
    goal: { type: goalType },
    publishedAt: `2026-07-19T10:00:0${version}.000Z`,
    updatedAt: `2026-07-19T10:01:0${version}.000Z`,
  });
}

function loadSummaries(database: DatabaseSync): Record<string, unknown>[] {
  return database.prepare(`
    SELECT
      room_id, room_x, room_y, published_title, goal_type, published_version,
      creator_user_id, creator_display_name
    FROM world_tile_published_room_summaries
    ORDER BY room_y ASC, room_x ASC, room_id ASC
  `).all() as Record<string, unknown>[];
}

function loadSummary(database: DatabaseSync, roomId: string): Record<string, unknown> | undefined {
  return database.prepare(
    'SELECT * FROM world_tile_published_room_summaries WHERE room_id = ?',
  ).get(roomId) as Record<string, unknown> | undefined;
}
