import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import {
  activateWorldTileRendererVersion,
  backfillWorldTileRendererLeaves,
  loadWorldTileLeafParityCounts,
} from './store';

const migrationSql = readFileSync(
  new URL('../../../../migrations/0041_world_render_tiles.sql', import.meta.url),
  'utf8',
);
const NOW = '2026-07-19T12:00:00.000Z';

describe('retired world tile renderer reconciliation', () => {
  let sqlite: DatabaseSync;
  let database: SqliteD1Database;
  let env: Pick<Env, 'DB'>;

  beforeEach(() => {
    sqlite = createDatabase();
    database = new SqliteD1Database(sqlite);
    env = { DB: database };
  });

  afterEach(() => sqlite.close());

  it('requires a full re-backfill for replaced, added, and deleted rooms', async () => {
    insertPublishedRoom(sqlite, 'room-a', 1, 1, 1);
    insertPublishedRoom(sqlite, 'room-c', 3, 3, 1);
    publishReadyContent(sqlite, 1, 1, 'a');
    publishReadyContent(sqlite, 3, 3, 'c');
    sqlite.prepare('DELETE FROM world_render_tile_outbox').run();
    sqlite.prepare(`
      UPDATE world_tile_renderer_versions
      SET status = 'retired', retired_at = ?
      WHERE version = 'renderer-a'
    `).run(NOW);
    sqlite.prepare(`
      INSERT INTO world_tile_renderer_versions (
        version, status, render_origin, renderer_contract_hash, asset_contract_hash, created_at, activated_at
      ) VALUES (?, 'active', ?, ?, ?, ?, ?)
    `).run(
      'renderer-b',
      'https://89abcdef.wampland.pages.dev',
      'wamp-world-tile-render-v1',
      'assets-b',
      NOW,
      NOW,
    );

    expect(await activateWorldTileRendererVersion(env, 'renderer-a', NOW)).toBe(false);
    expect(rendererStatus(sqlite)).toBe('retired');
    expect(rendererStatus(sqlite, 'renderer-b')).toBe('active');

    sqlite.prepare('UPDATE rooms SET published_json = ? WHERE id = ?').run(
      publishedSnapshot('room-a', 1, 1, 2),
      'room-a',
    );
    insertPublishedRoom(sqlite, 'room-b', 2, 2, 1);
    sqlite.prepare('DELETE FROM rooms WHERE id = ?').run('room-c');

    expect(tileAt(sqlite, 1, 1)).toMatchObject({
      desired_generation: 1,
      ready_generation: 1,
    });
    expect(tileAt(sqlite, 2, 2)).toBeUndefined();
    expect(tileAt(sqlite, 3, 3)).toMatchObject({
      desired_empty: 0,
      ready_empty: 0,
    });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
       FROM world_render_tile_outbox
       WHERE renderer_version = 'renderer-a'`,
    ).get()).toEqual({
      count: 0,
    });

    await backfillWorldTileRendererLeaves(env, 'renderer-a', 'retired-reconciliation');

    expect(rendererStatus(sqlite)).toBe('building');
    expect(tileAt(sqlite, 1, 1)).toMatchObject({
      desired_generation: 2,
      desired_empty: 0,
      ready_generation: 1,
    });
    expect(String(tileAt(sqlite, 1, 1)?.desired_hash)).toContain('room:room-a:version:2');
    expect(tileAt(sqlite, 2, 2)).toMatchObject({
      desired_generation: 1,
      desired_empty: 0,
      ready_generation: null,
    });
    expect(tileAt(sqlite, 3, 3)).toMatchObject({
      desired_generation: 2,
      desired_empty: 1,
      ready_generation: 1,
      ready_empty: 0,
    });
    expect(sqlite.prepare(`
      SELECT tile_x, tile_y, generation, reason, state
      FROM world_render_tile_outbox
      WHERE renderer_version = 'renderer-a' AND level = 4
      ORDER BY tile_y, tile_x
    `).all()).toEqual([
      { tile_x: 1, tile_y: 1, generation: 2, reason: 'retired-reconciliation', state: 'pending' },
      { tile_x: 2, tile_y: 2, generation: 1, reason: 'retired-reconciliation', state: 'pending' },
      { tile_x: 3, tile_y: 3, generation: 2, reason: 'retired-reconciliation', state: 'pending' },
    ]);

    expect(await loadWorldTileLeafParityCounts(env, 'renderer-a')).toEqual({
      publishedRooms: 2,
      matchingLeaves: 0,
      missingLeaves: 0,
      staleLeaves: 2,
      extraContentLeaves: 1,
    });

    publishReadyContent(sqlite, 1, 1, 'd');
    publishReadyContent(sqlite, 2, 2, 'e');
    publishReadyEmpty(sqlite, 3, 3);
    expect(await loadWorldTileLeafParityCounts(env, 'renderer-a')).toEqual({
      publishedRooms: 2,
      matchingLeaves: 2,
      missingLeaves: 0,
      staleLeaves: 0,
      extraContentLeaves: 0,
    });
  });
});

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

  execute<T>(): { results: T[] } {
    return { results: this.database.prepare(this.sql).all(...this.bindings) as T[] };
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
        if (!(statement instanceof SqliteD1Statement)) {
          throw new Error('Unexpected D1 statement implementation.');
        }
        return statement.execute();
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
  ) {
    return value;
  }
  throw new TypeError(`Unsupported SQLite test binding: ${typeof value}.`);
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
      UNIQUE (x, y)
    );
    CREATE TABLE background_image_uploads (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      cloudflare_deleted_at TEXT
    );
  `);
  database.exec(migrationSql);
  database.prepare(`
    INSERT INTO world_tile_renderer_versions (
      version, status, render_origin, renderer_contract_hash, asset_contract_hash, created_at
    ) VALUES (?, 'building', ?, ?, ?, ?)
  `).run(
    'renderer-a',
    'https://0123abcd.wampland.pages.dev',
    'wamp-world-tile-render-v1',
    'assets-a',
    NOW,
  );
  return database;
}

function insertPublishedRoom(
  database: DatabaseSync,
  id: string,
  x: number,
  y: number,
  version: number,
): void {
  database.prepare(
    'INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, ?)',
  ).run(id, x, y, '{}', publishedSnapshot(id, x, y, version));
}

function publishedSnapshot(id: string, x: number, y: number, version: number): string {
  return JSON.stringify({
    id,
    coordinates: { x, y },
    status: 'published',
    version,
    updatedAt: `2026-07-19T12:00:0${version}.000Z`,
    background: 'none',
    tileData: { background: [], terrain: [], foreground: [] },
    placedObjects: [],
  });
}

function publishReadyContent(database: DatabaseSync, x: number, y: number, fill: string): void {
  const hash = fill.repeat(64);
  database.prepare(`
    UPDATE world_render_tiles
    SET ready_generation = desired_generation, ready_empty = 0, ready_hash = ?,
        r2_key = ?, r2_etag = ?, byte_length = 100, ready_at = ?, updated_at = ?
    WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = ? AND tile_y = ?
  `).run(hash, `world-tiles/renderer-a/objects/${hash}.png`, `etag-${fill}`, NOW, NOW, x, y);
}

function publishReadyEmpty(database: DatabaseSync, x: number, y: number): void {
  database.prepare(`
    UPDATE world_render_tiles
    SET ready_generation = desired_generation, ready_empty = 1, ready_hash = NULL,
        r2_key = NULL, r2_etag = NULL, byte_length = NULL, ready_at = ?, updated_at = ?
    WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = ? AND tile_y = ?
  `).run(NOW, NOW, x, y);
}

function rendererStatus(database: DatabaseSync, version = 'renderer-a'): string | undefined {
  return (database.prepare(
    `SELECT status FROM world_tile_renderer_versions WHERE version = ?`,
  ).get(version) as { status?: string } | undefined)?.status;
}

function tileAt(database: DatabaseSync, x: number, y: number): Record<string, unknown> | undefined {
  return database.prepare(`
    SELECT * FROM world_render_tiles
    WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = ? AND tile_y = ?
  `).get(x, y) as Record<string, unknown> | undefined;
}
