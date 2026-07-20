import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('../../../migrations/0041_world_render_tiles.sql', import.meta.url),
  'utf8',
);

describe('world tile read-model migration', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        draft_json TEXT NOT NULL,
        published_json TEXT,
        claimer_user_id TEXT,
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
        version, status, render_origin, renderer_contract_hash,
        asset_contract_hash, created_at
      ) VALUES (?, 'building', ?, ?, ?, ?)
    `).run(
      'renderer-a',
      'https://0123abcd.wampland.pages.dev',
      'wamp-world-tile-render-v1',
      'assets-a',
      '2026-07-19T00:00:00.000Z',
    );
  });

  afterEach(() => database.close());

  it('invalidates only published bytes and clears the old generation lease', () => {
    database.prepare(
      'INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, NULL)',
    ).run('4,7', 4, 7, JSON.stringify({ privateDraft: 'never-rasterize-me' }));
    expect(tileAt(4, 4, 7)).toBeUndefined();

    database.prepare('UPDATE rooms SET draft_json = ?, claimer_user_id = ? WHERE id = ?').run(
      JSON.stringify({ privateDraft: 'still-private' }),
      'builder-private-id',
      '4,7',
    );
    expect(tileAt(4, 4, 7)).toBeUndefined();

    database.prepare('UPDATE rooms SET published_json = ? WHERE id = ?').run(
      publishedSnapshot('4,7', 4, 7, 1),
      '4,7',
    );
    expect(tileAt(4, 4, 7)).toMatchObject({
      desired_generation: 1,
      desired_empty: 0,
    });

    database.prepare(`
      UPDATE world_render_tiles
      SET lease_owner = 'old-worker', lease_generation = 1,
          lease_expires_at = '2026-07-19T00:05:00.000Z'
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = 4 AND tile_y = 7
    `).run();
    database.prepare('UPDATE rooms SET draft_json = ? WHERE id = ?').run(
      JSON.stringify({ privateDraft: 'draft-save-does-not-invalidate' }),
      '4,7',
    );
    expect(tileAt(4, 4, 7)).toMatchObject({
      desired_generation: 1,
      lease_owner: 'old-worker',
    });

    database.prepare('UPDATE rooms SET published_json = ? WHERE id = ?').run(
      publishedSnapshot('4,7', 4, 7, 2),
      '4,7',
    );
    expect(tileAt(4, 4, 7)).toMatchObject({
      desired_generation: 2,
      desired_empty: 0,
      lease_owner: null,
      lease_generation: null,
      lease_expires_at: null,
    });

    database.prepare('UPDATE rooms SET published_json = NULL WHERE id = ?').run('4,7');
    expect(tileAt(4, 4, 7)).toMatchObject({
      desired_generation: 3,
      desired_empty: 1,
    });
    const events = database.prepare(`
      SELECT generation, reason FROM world_render_tile_outbox
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = 4 AND tile_y = 7
      ORDER BY generation
    `).all();
    expect(events).toEqual([
      { generation: 1, reason: 'room-published-update' },
      { generation: 2, reason: 'room-published-update' },
      { generation: 3, reason: 'room-unpublished' },
    ]);

    const serializedRuntime = JSON.stringify({
      tiles: database.prepare('SELECT * FROM world_render_tiles').all(),
      events: database.prepare('SELECT * FROM world_render_tile_outbox').all(),
    });
    expect(serializedRuntime).not.toContain('never-rasterize-me');
    expect(serializedRuntime).not.toContain('still-private');
    expect(serializedRuntime).not.toContain('builder-private-id');
  });

  it('invalidates only published rooms that reference an approved or revoked custom background', () => {
    database.prepare('INSERT INTO background_image_uploads (id, status) VALUES (?, ?)').run('bg-1', 'pending');
    database.prepare(
      'INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, ?)',
    ).run(
      '1,1',
      1,
      1,
      '{}',
      publishedSnapshot('1,1', 1, 1, 1, 'custom:bg-1?fit=tile'),
    );
    database.prepare(
      'INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, NULL)',
    ).run('2,1', 2, 1, JSON.stringify({ background: 'custom:bg-1' }));

    database.prepare('UPDATE background_image_uploads SET status = ? WHERE id = ?').run('approved', 'bg-1');
    expect(tileAt(4, 1, 1)).toMatchObject({ desired_generation: 2, desired_empty: 0 });
    expect(tileAt(4, 2, 1)).toBeUndefined();

    database.prepare('UPDATE background_image_uploads SET status = ? WHERE id = ?').run('rejected', 'bg-1');
    expect(tileAt(4, 1, 1)).toMatchObject({ desired_generation: 3, desired_empty: 0 });

    database.prepare('UPDATE background_image_uploads SET status = ? WHERE id = ?').run('blocked', 'bg-1');
    expect(tileAt(4, 1, 1)).toMatchObject({ desired_generation: 3 });

    database.prepare('UPDATE background_image_uploads SET status = ? WHERE id = ?').run('approved', 'bg-1');
    expect(tileAt(4, 1, 1)).toMatchObject({ desired_generation: 4 });

    database.prepare(
      'UPDATE background_image_uploads SET cloudflare_deleted_at = ? WHERE id = ?',
    ).run('2026-07-19T00:05:00.000Z', 'bg-1');
    expect(tileAt(4, 1, 1)).toMatchObject({ desired_generation: 5 });

    database.prepare(
      'UPDATE background_image_uploads SET cloudflare_deleted_at = NULL WHERE id = ?',
    ).run('bg-1');
    expect(tileAt(4, 1, 1)).toMatchObject({ desired_generation: 6 });

    database.prepare('DELETE FROM background_image_uploads WHERE id = ?').run('bg-1');
    expect(tileAt(4, 1, 1)).toMatchObject({ desired_generation: 7 });
    expect(outboxAt(4, 1, 1).at(-1)).toEqual({
      generation: 7,
      reason: 'custom-background-deleted',
    });
  });

  it('atomically rolls ready children into signed parent coordinates', () => {
    insertPublishedRoom('-1,-3', -1, -3);
    insertPublishedRoom('-2,-4', -2, -4);

    publishReadyObject(4, -1, -3);
    expect(tileAt(3, -1, -2)).toMatchObject({ desired_generation: 1 });
    expect(outboxAt(3, -1, -2)).toEqual([{ generation: 1, reason: 'child-ready' }]);

    publishReadyObject(4, -2, -4);
    expect(tileAt(3, -1, -2)).toMatchObject({ desired_generation: 2 });
    expect(outboxAt(3, -1, -2)).toEqual([
      { generation: 1, reason: 'child-ready' },
      { generation: 2, reason: 'child-ready' },
    ]);

    publishReadyObject(3, -1, -2);
    expect(tileAt(2, -1, -1)).toMatchObject({ desired_generation: 1 });
  });

  it('rejects incomplete ready-object pointers at the schema boundary', () => {
    insertPublishedRoom('9,9', 9, 9);
    expect(() => database.prepare(`
      UPDATE world_render_tiles
      SET ready_generation = desired_generation, ready_empty = 0
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = 9 AND tile_y = 9
    `).run()).toThrow();
  });

  function insertPublishedRoom(id: string, x: number, y: number): void {
    database.prepare(
      'INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, ?)',
    ).run(id, x, y, '{}', publishedSnapshot(id, x, y, 1));
  }

  function publishReadyObject(level: number, x: number, y: number): void {
    const hash = `${level}${Math.abs(x)}${Math.abs(y)}`.padEnd(64, 'a').slice(0, 64);
    database.prepare(`
      UPDATE world_render_tiles
      SET ready_generation = desired_generation,
          ready_hash = ?, ready_empty = 0, r2_key = ?, r2_etag = ?, byte_length = 100,
          ready_at = '2026-07-19T00:01:00.000Z', updated_at = '2026-07-19T00:01:00.000Z'
      WHERE renderer_version = 'renderer-a' AND level = ? AND tile_x = ? AND tile_y = ?
    `).run(hash, `world-tiles/renderer-a/objects/${hash}.png`, `etag-${hash}`, level, x, y);
  }

  function tileAt(level: number, x: number, y: number): Record<string, unknown> | undefined {
    return database.prepare(`
      SELECT * FROM world_render_tiles
      WHERE renderer_version = 'renderer-a' AND level = ? AND tile_x = ? AND tile_y = ?
    `).get(level, x, y) as Record<string, unknown> | undefined;
  }

  function outboxAt(level: number, x: number, y: number): unknown[] {
    return database.prepare(`
      SELECT generation, reason FROM world_render_tile_outbox
      WHERE renderer_version = 'renderer-a' AND level = ? AND tile_x = ? AND tile_y = ?
      ORDER BY generation
    `).all(level, x, y);
  }
});

function publishedSnapshot(
  id: string,
  x: number,
  y: number,
  version: number,
  background = 'none',
): string {
  return JSON.stringify({
    id,
    coordinates: { x, y },
    status: 'published',
    version,
    updatedAt: `2026-07-19T00:00:0${version}.000Z`,
    background,
    tileData: { background: [], terrain: [], foreground: [] },
    placedObjects: [],
  });
}
