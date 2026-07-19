import { describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import {
  invalidateWorldTileAddress,
  loadPublishedWorldTileRoomSummaries,
  loadWorldRenderTiles,
  loadWorldTileManifestReadSet,
} from './store';

describe('world tile read model store', () => {
  it('projects published summaries from the normalized read model without JSON or snapshot bytes', async () => {
    const fake = createFakeDatabase();
    await loadPublishedWorldTileRoomSummaries(
      { DB: fake.database } as Pick<Env, 'DB'>,
      { minRoomX: -2, maxRoomX: 2, minRoomY: -3, maxRoomY: 3 },
    );
    const sql = fake.queries.join('\n').toLowerCase();
    expect(sql).toContain('from world_tile_published_room_summaries');
    expect(sql).not.toContain('json_extract');
    expect(sql).not.toContain('published_json');
    expect(sql).not.toContain('draft_json');
    expect(sql).not.toContain('snapshot_json');
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/);
  });

  it('falls back to the legacy projection only when the additive table is missing', async () => {
    const fake = createFakeDatabase({
      all(query) {
        if (/from\s+world_tile_published_room_summaries/i.test(query)) {
          throw new Error('D1_ERROR: no such table: world_tile_published_room_summaries: SQLITE_ERROR');
        }
        return [{
          id: 'expanded-member',
          x: -4,
          y: 9,
          published_title: 'Member room',
          goal_type: 'reach_exit',
          version: 7,
          published_at: '2026-07-19T10:00:00.000Z',
          preview_updated_at: '2026-07-19T10:01:00.000Z',
          last_published_by_user_id: 'builder-a',
          last_published_by_display_name: 'Builder A',
        }];
      },
    });

    await expect(loadPublishedWorldTileRoomSummaries(
      { DB: fake.database } as Pick<Env, 'DB'>,
      { minRoomX: -4, maxRoomX: -4, minRoomY: 9, maxRoomY: 9 },
    )).resolves.toEqual([{
      id: 'expanded-member',
      coordinates: { x: -4, y: 9 },
      title: 'Member room',
      state: 'published',
      goalType: 'reach_exit',
      version: 7,
      publishedAt: '2026-07-19T10:00:00.000Z',
      previewUpdatedAt: '2026-07-19T10:01:00.000Z',
      creatorUserId: 'builder-a',
      creatorDisplayName: 'Builder A',
    }]);
    expect(fake.queries).toHaveLength(2);
    expect(fake.queries[1]).toContain('FROM rooms');
    expect(fake.queries[1]).toContain('published_json IS NOT NULL');
  });

  it('does not hide non-migration read-model failures behind the legacy query', async () => {
    const fake = createFakeDatabase({
      all() {
        throw new Error('D1_ERROR: database is overloaded');
      },
    });
    await expect(loadPublishedWorldTileRoomSummaries(
      { DB: fake.database } as Pick<Env, 'DB'>,
      { minRoomX: 0, maxRoomX: 0, minRoomY: 0, maxRoomY: 0 },
    )).rejects.toThrow('database is overloaded');
    expect(fake.queries).toHaveLength(1);
  });

  it('keeps manifest tile loading read-only and bounds tuple batches', async () => {
    const fake = createFakeDatabase();
    const coordinates = Array.from({ length: 61 }, (_, index) => ({
      level: 4 as const,
      x: index,
      y: 0,
    }));
    await loadWorldRenderTiles({ DB: fake.database } as Pick<Env, 'DB'>, 'renderer-a', coordinates);
    expect(fake.queries).toHaveLength(3);
    expect(fake.queries.every((sql) => /^\s*select\b/i.test(sql))).toBe(true);
    expect(Math.max(...fake.bindings.map((values) => values.length))).toBeLessThanOrEqual(91);
  });

  it('loads one active-version-consistent manifest read set in one replica-eligible batch', async () => {
    const fake = createFakeDatabase({
      all(query) {
        if (/^\s*select\s+version\s+from\s+world_tile_renderer_versions/i.test(query)) {
          return [{ version: 'renderer-consistent' }];
        }
        if (/from\s+world_render_tiles/i.test(query) && /\(level, tile_x, tile_y\) in/i.test(query)) {
          return [{
            renderer_version: 'renderer-consistent',
            level: 4,
            tile_x: -1,
            tile_y: 2,
            desired_generation: 8,
            desired_empty: 0,
            ready_generation: 8,
            ready_hash: 'content-hash',
            ready_empty: 0,
            r2_key: 'objects/content-hash.png',
            byte_length: 321,
            ready_at: '2026-07-19T10:00:00.000Z',
          }];
        }
        if (/from\s+world_render_tiles/i.test(query) && /desired_empty\s*=\s*1/i.test(query)) {
          return [{
            tile_x: -1,
            tile_y: 2,
            desired_empty: 1,
            desired_at: '2026-07-19T10:01:00.000Z',
          }];
        }
        if (/from\s+world_tile_published_room_summaries/i.test(query)) {
          return [{
            id: '-1,2',
            x: -1,
            y: 2,
            published_title: 'Published room',
            goal_type: 'reach_exit',
            version: 8,
            published_at: '2026-07-19T09:59:00.000Z',
            preview_updated_at: '2026-07-19T10:00:00.000Z',
            last_published_by_user_id: 'builder-a',
            last_published_by_display_name: 'Builder A',
          }];
        }
        return [];
      },
    });

    const result = await loadWorldTileManifestReadSet(
      { DB: fake.database } as Pick<Env, 'DB'>,
      [{ level: 4, x: -1, y: 2 }],
      { minRoomX: -16, maxRoomX: -1, minRoomY: 0, maxRoomY: 15 },
      { minRoomX: -1, maxRoomX: -1, minRoomY: 2, maxRoomY: 2 },
    );

    expect(fake.sessions).toEqual(['first-unconstrained']);
    expect(fake.batchSizes).toEqual([4]);
    expect(fake.queries).toHaveLength(4);
    expect(fake.queries.every((sql) => /^\s*select\b/i.test(sql))).toBe(true);
    expect(fake.queries.every((sql) => !/\b(insert|update|delete)\b/i.test(sql))).toBe(true);
    const tileSql = fake.queries.find((sql) => /\(level, tile_x, tile_y\) in/i.test(sql))!;
    expect(tileSql).toContain("WHERE status = 'active'");
    expect(tileSql).not.toMatch(/desired_hash|r2_etag|lease_owner|last_error/);
    const leafSql = fake.queries.find((sql) => /desired_empty\s*=\s*1/i.test(sql))!;
    expect(leafSql).toContain("WHERE status = 'active'");
    expect(leafSql).not.toMatch(/ready_generation|ready_empty|ready_at/);
    expect(result).toMatchObject({
      rendererVersion: 'renderer-consistent',
      tileRows: [{ renderer_version: 'renderer-consistent', tile_x: -1, tile_y: 2 }],
      leafChanges: [{ tile_x: -1, tile_y: 2, desired_empty: 1 }],
      rooms: [{
        id: '-1,2',
        coordinates: { x: -1, y: 2 },
        state: 'published',
        version: 8,
      }],
    });
  });

  it('omits the room-summary statement entirely for coverage-only manifests', async () => {
    const fake = createFakeDatabase({
      all(query) {
        if (/^\s*select\s+version\s+from\s+world_tile_renderer_versions/i.test(query)) {
          return [{ version: 'renderer-coverage' }];
        }
        return [];
      },
    });

    const result = await loadWorldTileManifestReadSet(
      { DB: fake.database } as Pick<Env, 'DB'>,
      [{ level: 0, x: 0, y: 0 }],
      { minRoomX: 0, maxRoomX: 15, minRoomY: 0, maxRoomY: 15 },
      { minRoomX: 0, maxRoomX: 15, minRoomY: 0, maxRoomY: 15 },
      { includeRooms: false },
    );

    expect(fake.sessions).toEqual(['first-unconstrained']);
    expect(fake.batchSizes).toEqual([3]);
    expect(fake.queries).toHaveLength(3);
    expect(fake.queries.some((query) => /world_tile_published_room_summaries|from\s+rooms/i.test(query)))
      .toBe(false);
    expect(result.rooms).toEqual([]);
  });

  it('keeps every bounded coordinate chunk inside the same manifest batch', async () => {
    const fake = createFakeDatabase({
      all(query) {
        if (/^\s*select\s+version\s+from\s+world_tile_renderer_versions/i.test(query)) {
          return [{ version: 'renderer-a' }];
        }
        return [];
      },
    });
    const coordinates = Array.from({ length: 61 }, (_, index) => ({
      level: 4 as const,
      x: index - 30,
      y: 0,
    }));

    await loadWorldTileManifestReadSet(
      { DB: fake.database } as Pick<Env, 'DB'>,
      coordinates,
      { minRoomX: -30, maxRoomX: 30, minRoomY: 0, maxRoomY: 0 },
      { minRoomX: -30, maxRoomX: 30, minRoomY: 0, maxRoomY: 0 },
    );

    expect(fake.sessions).toEqual(['first-unconstrained']);
    expect(fake.batchSizes).toEqual([6]);
    expect(fake.queries.filter((sql) => /\(level, tile_x, tile_y\) in/i.test(sql)))
      .toHaveLength(3);
    expect(Math.max(...fake.bindings.map((values) => values.length))).toBeLessThanOrEqual(90);
  });

  it('retries the complete manifest read batch with the legacy summary only when the table is missing', async () => {
    const fake = createFakeDatabase({
      all(query) {
        if (/^\s*select\s+version\s+from\s+world_tile_renderer_versions/i.test(query)) {
          return [{ version: 'renderer-a' }];
        }
        if (/from\s+world_tile_published_room_summaries/i.test(query)) {
          throw new Error('D1_ERROR: no such table: world_tile_published_room_summaries: SQLITE_ERROR');
        }
        if (/from\s+rooms/i.test(query)) {
          return [{
            id: 'legacy-room',
            x: 3,
            y: 4,
            published_title: 'Legacy room',
            goal_type: 'reach_exit',
            version: 2,
            published_at: null,
            preview_updated_at: null,
            last_published_by_user_id: null,
            last_published_by_display_name: null,
          }];
        }
        return [];
      },
    });

    const result = await loadWorldTileManifestReadSet(
      { DB: fake.database } as Pick<Env, 'DB'>,
      [{ level: 4, x: 3, y: 4 }],
      { minRoomX: 0, maxRoomX: 15, minRoomY: 0, maxRoomY: 15 },
      { minRoomX: 3, maxRoomX: 3, minRoomY: 4, maxRoomY: 4 },
    );

    expect(fake.sessions).toEqual(['first-unconstrained', 'first-unconstrained']);
    expect(fake.batchSizes).toEqual([4, 4]);
    expect(fake.queries.filter((sql) => /from\s+world_tile_published_room_summaries/i.test(sql)))
      .toHaveLength(1);
    expect(fake.queries.filter((sql) => /from\s+rooms/i.test(sql))).toHaveLength(1);
    expect(result.rendererVersion).toBe('renderer-a');
    expect(result.rooms.map((room) => room.id)).toEqual(['legacy-room']);
  });

  it('does not retry a manifest batch after a non-migration D1 failure', async () => {
    const fake = createFakeDatabase({
      all(query) {
        if (/from\s+world_tile_published_room_summaries/i.test(query)) {
          throw new Error('D1_ERROR: database is overloaded');
        }
        return [];
      },
    });

    await expect(loadWorldTileManifestReadSet(
      { DB: fake.database } as Pick<Env, 'DB'>,
      [{ level: 4, x: 0, y: 0 }],
      { minRoomX: 0, maxRoomX: 15, minRoomY: 0, maxRoomY: 15 },
      { minRoomX: 0, maxRoomX: 0, minRoomY: 0, maxRoomY: 0 },
    )).rejects.toThrow('database is overloaded');
    expect(fake.sessions).toEqual(['first-unconstrained']);
    expect(fake.batchSizes).toEqual([4]);
    expect(fake.queries.some((sql) => /from\s+rooms/i.test(sql))).toBe(false);
  });

  it('invalidates a tile and writes its exact resulting generation to the outbox atomically', async () => {
    const fake = createFakeDatabase();
    await invalidateWorldTileAddress(
      { DB: fake.database } as Pick<Env, 'DB'>,
      { rendererVersion: 'renderer-a', level: 3, x: -1, y: 2 },
      {
        desiredHash: 'children:abcd',
        desiredEmpty: false,
        reason: 'child-ready',
        now: '2026-07-19T10:00:00.000Z',
      },
    );

    expect(fake.batchSizes).toEqual([2]);
    expect(fake.queries[0]).toContain('desired_generation = world_render_tiles.desired_generation + 1');
    expect(fake.queries[1]).toContain('SELECT');
    expect(fake.queries[1]).toContain('desired_generation');
    expect(fake.bindings[0]).toContain('children:abcd');
    expect(fake.bindings[1]).toContain('child-ready');
  });
});

function createFakeDatabase(options: {
  all?: (query: string, bindings: unknown[]) => unknown[];
} = {}): {
  database: D1Database;
  queries: string[];
  bindings: unknown[][];
  batchSizes: number[];
  sessions: string[];
} {
  const queries: string[] = [];
  const bindings: unknown[][] = [];
  const batchSizes: number[] = [];
  const sessions: string[] = [];

  class FakeStatement implements D1PreparedStatement {
    constructor(readonly query: string, readonly values: unknown[] = []) {}

    bind(...values: unknown[]): D1PreparedStatement {
      bindings.push(values);
      return new FakeStatement(this.query, values);
    }

    async first<T>(): Promise<T | null> {
      return null;
    }

    async all<T>(): Promise<{ results: T[] }> {
      return { results: (options.all?.(this.query, this.values) ?? []) as T[] };
    }
  }

  const database: D1Database = {
    prepare(query: string): D1PreparedStatement {
      queries.push(query);
      return new FakeStatement(query);
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
      batchSizes.push(statements.length);
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.all());
      return results as T[];
    },
    withSession(constraint) {
      sessions.push(constraint ?? 'none');
      return database;
    },
  };

  return { database, queries, bindings, batchSizes, sessions };
}
