import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BLOCKED_ART_COLOR } from '../../../customSprites/blocklist';
import { listEmbeddedCustomSpriteIds, maskBlockedCustomArt } from '../../../customSprites/blockedArt';
import type { CustomSpriteDefinition } from '../../../customSprites/model';
import type { CustomRoomTileDefinition } from '../../../customTiles/model';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import type { D1Database as RendererDatabase } from '../../worldTileRenderer/runtimeTypes';
import { loadBlockedCustomSpriteIdsAmong } from '../../worldTileRenderer/store';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { loadWorldTileConfig } from '../worldTiles/service';
import { deleteOwnedCustomSprite } from './catalogStore';
import { markBlockedCustomSprites } from '../../../pages/roomImageRenderer';

class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly db: DatabaseSync, readonly sql: string) {}
  bind(...values: unknown[]): this { this.values = values as typeof this.values; return this; }
  async first<T>(): Promise<T | null> { return this.db.prepare(this.sql).get(...this.values) as T ?? null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
  async run(): Promise<unknown> { return this.db.prepare(this.sql).run(...this.values); }
}
class Database implements D1Database {
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(this.db, sql); }
  withSession(): this { return this; }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    return statements.map((statement) => ({ results: this.db.prepare((statement as Statement).sql).all(...(statement as Statement).values) }) as T);
  }
}

const NOW = '2026-10-21T12:00:00.000Z';
const sprite = (id: string): CustomSpriteDefinition => ({
  id, name: id, size: 16, kind: 'decoration', pixels: ['#ff0000', null], status: 'active', createdAt: NOW, updatedAt: NOW,
});
const tile = (id: string, sourceSpriteId: string | null): CustomRoomTileDefinition => ({
  id, name: id, pixels: ['#00ff00', null, '#0000ff'], collision: 'solid', sourceSpriteId, createdAt: NOW, updatedAt: NOW,
});
function roomWith(id: string, x: number, y: number, sprites: string[], tiles: Array<[string, string | null]> = []): RoomSnapshot {
  return {
    ...createDefaultRoomSnapshot(id, { x, y }),
    status: 'published',
    version: 1,
    customSprites: sprites.map(sprite),
    customTiles: tiles.map(([tileId, source]) => tile(tileId, source)),
  };
}

let sqlite: DatabaseSync; let env: Env; let rendererDb: RendererDatabase;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../../../../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  const database = new Database(sqlite);
  env = { DB: database, JAM_DB: database, ASSETS: { fetch: async () => new Response() } };
  rendererDb = database as unknown as RendererDatabase;
  sqlite.prepare(`INSERT INTO world_tile_renderer_versions (version, status, render_origin, renderer_contract_hash, asset_contract_hash, created_at)
    VALUES ('renderer-a', 'active', 'https://0123abcd.wampland.pages.dev', 'contract', 'assets', ?)`).run(NOW);
  for (const id of ['vandal-art', 'nice-art']) {
    sqlite.prepare(`INSERT INTO custom_sprites (id, definition_json, name, normalized_name, kind, size, status, created_at, updated_at)
      VALUES (?, '{}', ?, ?, 'decoration', 16, 'active', ?, ?)`).run(id, id, id, NOW, NOW);
  }
  const insertRoom = sqlite.prepare('INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, ?)');
  for (const room of [roomWith('1,1', 1, 1, ['vandal-art']), roomWith('2,1', 2, 1, [], [['t1', 'vandal-art']]), roomWith('3,1', 3, 1, ['nice-art'])]) {
    insertRoom.run(room.id, room.coordinates.x, room.coordinates.y, '{}', JSON.stringify(room));
  }
  sqlite.exec('DELETE FROM world_render_tile_outbox; DELETE FROM world_render_tiles;');
});
afterEach(() => sqlite.close());

const setStatus = (id: string, status: string) => sqlite.prepare('UPDATE custom_sprites SET status = ? WHERE id = ?').run(status, id);
const tileAt = (x: number, y: number) => sqlite.prepare(
  "SELECT desired_generation FROM world_render_tiles WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = ? AND tile_y = ?",
).get(x, y) as { desired_generation: number } | undefined;
const outboxReasons = () => (sqlite.prepare('SELECT tile_x, reason FROM world_render_tile_outbox ORDER BY tile_x').all() as Array<{ tile_x: number; reason: string }>)
  .map((row) => `${row.tile_x}:${row.reason}`);

describe('blocking a community sprite (F189)', () => {
  it('re-renders the map tiles of every room that embeds it, and again when it is restored', () => {
    setStatus('vandal-art', 'blocked');
    expect(tileAt(1, 1)?.desired_generation).toBe(1);
    expect(tileAt(2, 1)?.desired_generation).toBe(1);
    expect(tileAt(3, 1)).toBeUndefined();
    expect(outboxReasons()).toEqual(['1:custom-sprite-status', '2:custom-sprite-status']);

    setStatus('vandal-art', 'active');
    expect(tileAt(1, 1)?.desired_generation).toBe(2);
    setStatus('vandal-art', 'deleted');
    expect(tileAt(1, 1)?.desired_generation).toBe(2);
  });

  it('lists blocked sprites in the public tile config and to the map renderer', async () => {
    expect((await loadWorldTileConfig(env)).blockedCustomSpriteIds).toEqual([]);
    setStatus('vandal-art', 'blocked');
    expect((await loadWorldTileConfig(env)).blockedCustomSpriteIds).toEqual(['vandal-art']);
    expect([...await loadBlockedCustomSpriteIdsAmong(rendererDb, ['nice-art', 'vandal-art', 'unknown'])]).toEqual(['vandal-art']);
    expect([...await loadBlockedCustomSpriteIdsAmong(rendererDb, [])]).toEqual([]);
  });

  it('cannot be undone by the creator deleting the sprite', async () => {
    sqlite.prepare("INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ('maker','m@example.test','Maker',?,?)").run(NOW, NOW);
    sqlite.prepare("UPDATE custom_sprites SET owner_user_id = 'maker', status = 'blocked' WHERE id = 'vandal-art'").run();
    await expect(deleteOwnedCustomSprite(env, 'maker', 'vandal-art')).rejects.toMatchObject({ status: 403 });
    expect(sqlite.prepare("SELECT status FROM custom_sprites WHERE id = 'vandal-art'").get()).toEqual({ status: 'blocked' });
  });

  it('marks blocked sprites in link-preview images drawn by the site', () => {
    const room = { title: 'Room', customSprites: [sprite('vandal-art'), sprite('nice-art')] };
    expect(markBlockedCustomSprites(room, new Set())).toBe(room);
    expect((markBlockedCustomSprites(room, new Set(['vandal-art'])).customSprites as CustomSpriteDefinition[]).map((entry) => entry.status))
      .toEqual(['blocked', 'active']);
  });

  it('paints blocked art as a placeholder in baked images without touching other art', () => {
    const room = roomWith('4,4', 4, 4, ['vandal-art', 'nice-art'], [['t1', 'vandal-art'], ['t2', 'nice-art'], ['t3', null]]);
    expect(listEmbeddedCustomSpriteIds(room).sort()).toEqual(['nice-art', 'vandal-art']);
    expect(maskBlockedCustomArt(room, new Set(['other']))).toBe(room);

    const masked = maskBlockedCustomArt(room, new Set(['vandal-art']));
    expect(masked.customSprites?.map((entry) => entry.status)).toEqual(['blocked', 'active']);
    expect(masked.customTiles?.[0].pixels).toEqual([BLOCKED_ART_COLOR, BLOCKED_ART_COLOR, BLOCKED_ART_COLOR]);
    expect(masked.customTiles?.[1].pixels).toEqual(room.customTiles?.[1].pixels);
    expect(masked.customTiles?.[2]).toBe(room.customTiles?.[2]);
    expect(room.customSprites?.[0].status).toBe('active');
  });
});
