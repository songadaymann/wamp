import { describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import {
  invalidateWorldTileAddress,
  loadPublishedWorldTileRoomSummaries,
  loadWorldRenderTiles,
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
} {
  const queries: string[] = [];
  const bindings: unknown[][] = [];
  const batchSizes: number[] = [];

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
      return statements.map(() => ({ results: [] })) as T[];
    },
  };

  return { database, queries, bindings, batchSizes };
}
