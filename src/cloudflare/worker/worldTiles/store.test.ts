import { describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import {
  invalidateWorldTileAddress,
  loadPublishedWorldTileRoomSummaries,
  loadWorldRenderTiles,
} from './store';

describe('world tile read model store', () => {
  it('projects published summaries without selecting draft or snapshot bytes', async () => {
    const fake = createFakeDatabase();
    await loadPublishedWorldTileRoomSummaries(
      { DB: fake.database } as Pick<Env, 'DB'>,
      { minRoomX: -2, maxRoomX: 2, minRoomY: -3, maxRoomY: 3 },
    );
    const sql = fake.queries.join('\n').toLowerCase();
    expect(sql).toContain('published_json is not null');
    expect(sql).not.toContain('draft_json');
    expect(sql).not.toContain('snapshot_json');
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/);
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

function createFakeDatabase(): {
  database: D1Database;
  queries: string[];
  bindings: unknown[][];
  batchSizes: number[];
} {
  const queries: string[] = [];
  const bindings: unknown[][] = [];
  const batchSizes: number[] = [];

  class FakeStatement implements D1PreparedStatement {
    constructor(readonly query: string) {}

    bind(...values: unknown[]): D1PreparedStatement {
      bindings.push(values);
      return this;
    }

    async first<T>(): Promise<T | null> {
      return null;
    }

    async all<T>(): Promise<{ results: T[] }> {
      return { results: [] };
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
