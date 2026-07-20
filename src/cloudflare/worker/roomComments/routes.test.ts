import { describe, expect, it } from 'vitest';
import type {
  D1Database,
  D1PreparedStatement,
  Env,
} from '../core/types';
import {
  handleBrowseRoomCommentSummaries,
  parseBrowseRoomCommentIds,
} from './routes';

describe('browse room comment summaries', () => {
  it('validates, deduplicates, and stably orders at most 128 canonical room ids', () => {
    expect(parseBrowseRoomCommentIds(new URLSearchParams([
      ['roomId', '2,-1'],
      ['roomId', '-1,3'],
      ['roomId', '2,-1'],
    ]))).toEqual(['-1,3', '2,-1']);
    expect(() => parseBrowseRoomCommentIds(new URLSearchParams())).toThrow('At least one roomId');
    expect(() => parseBrowseRoomCommentIds(new URLSearchParams({ roomId: '01,0' })))
      .toThrow('canonical signed coordinate pair');
    const tooMany = new URLSearchParams();
    for (let index = 0; index < 129; index += 1) tooMany.append('roomId', `${index},0`);
    expect(() => parseBrowseRoomCommentIds(tooMany)).toThrow('At most 128');
  });

  it('uses two bounded read-only statements while preserving expanded-target comment rows', async () => {
    const fake = createBrowseCommentDatabase();
    const request = new Request(
      'https://api.wamp.land/api/rooms/comments/browse?roomId=1%2C0&roomId=0%2C0&roomId=0%2C0',
    );
    const response = await handleBrowseRoomCommentSummaries(
      request,
      new URL(request.url),
      createEnv(fake.database),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=20');
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(response.headers.get('Server-Timing')).toContain('comments_d1');
    await expect(response.json()).resolves.toEqual({
      rooms: [
        {
          roomId: '0,0',
          roomVersion: 3,
          commentCount: 2,
          comments: [
            expect.objectContaining({
              id: 'comment-new',
              body: 'Expanded room comment',
              authorDisplayName: 'Builder A',
            }),
          ],
        },
        {
          roomId: '1,0',
          roomVersion: 7,
          commentCount: 0,
          comments: [],
        },
      ],
    });
    expect(fake.batchCalls).toBe(1);
    expect(fake.queries).toHaveLength(2);
    expect(fake.queries.every((query) => !/\b(?:insert|update|delete)\b/i.test(query))).toBe(true);
    expect(fake.queries[1]).toContain('playable_content_index_members AS target_member');
    expect(fake.queries[1]).toContain('ROW_NUMBER() OVER');
    expect(fake.queries[0]).toContain('WHERE target_rank = 1');
    expect(fake.queries[1]).toContain('WHERE target_rank = 1');
    expect(fake.bindings[0]).toEqual(['["0,0","1,0"]']);
    expect(fake.bindings[1]).toEqual(['["0,0","1,0"]', 12]);
  });
});

function createEnv(database: D1Database): Env {
  return {
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    DB: database,
    JAM_DB: database,
  };
}

function createBrowseCommentDatabase(): {
  database: D1Database;
  queries: string[];
  bindings: unknown[][];
  batchCalls: number;
} {
  const state = {
    queries: [] as string[],
    bindings: [] as unknown[][],
    batchCalls: 0,
  };
  class Statement implements D1PreparedStatement {
    constructor(readonly query: string, readonly index: number) {}
    bind(...values: unknown[]): D1PreparedStatement {
      state.bindings[this.index] = values;
      return this;
    }
    async first<T>(): Promise<T | null> { return null; }
    async all<T>(): Promise<{ results: T[] }> {
      if (/ranked_comments/i.test(this.query)) {
        return { results: [commentRow()] as T[] };
      }
      return {
        // Deliberately reverse fake storage order; the store must still return
        // stable room-id ordering independent of adapter behavior.
        results: [
          { requested_room_id: '1,0', requested_room_version: 7 },
          { requested_room_id: '0,0', requested_room_version: 3 },
        ] as T[],
      };
    }
  }
  const database: D1Database = {
    prepare(query) {
      const index = state.queries.length;
      state.queries.push(query);
      return new Statement(query, index);
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
      state.batchCalls += 1;
      return Promise.all(statements.map((statement) => statement.all())) as Promise<T[]>;
    },
  };
  return {
    database,
    queries: state.queries,
    bindings: state.bindings,
    get batchCalls() { return state.batchCalls; },
  };
}

function commentRow(): Record<string, unknown> {
  return {
    requested_room_id: '0,0',
    requested_room_version: 3,
    comment_count: 2,
    comment_rank: 1,
    id: 'comment-new',
    body: 'Expanded room comment',
    author_display_name: 'Builder A',
    created_at: '2026-07-19T12:00:00.000Z',
  };
}
