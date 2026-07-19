import { describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement, Env, WorkerExecutionContextLike } from '../core/types';
import {
  handleWorldTileConfigRequest,
  handleWorldTileManifestRequest,
  parseWorldTileManifestQuery,
  scheduleWorldTileOutboxDispatch,
} from './routes';

describe('world tile HTTP routes', () => {
  it('accepts signed safe coordinates and enforces the 16 by 16 target limit', () => {
    expect(parseWorldTileManifestQuery(new URLSearchParams({
      level: '2',
      minTileX: '-8',
      maxTileX: '7',
      minTileY: '-4',
      maxTileY: '11',
    }))).toEqual({
      level: 2,
      bounds: { minTileX: -8, maxTileX: 7, minTileY: -4, maxTileY: 11 },
    });
    expect(() => parseWorldTileManifestQuery(new URLSearchParams({
      level: '2',
      minTileX: '0',
      maxTileX: '16',
      minTileY: '0',
      maxTileY: '0',
    }))).toThrow('16 by 16');
    expect(() => parseWorldTileManifestQuery(new URLSearchParams({
      level: '4',
      minTileX: '9007199254740992',
      maxTileX: '9007199254740992',
      minTileY: '0',
      maxTileY: '0',
    }))).toThrow('safe integer');
  });

  it('keeps public and authenticated config cache policies separated with stable ETags', async () => {
    const fake = createReadDatabase();
    const env = createEnv(fake.database);
    const request = new Request('https://api.wamp.land/api/world/tiles/config');
    const publicResponse = await handleWorldTileConfigRequest(request, env);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('Cache-Control')).toBe(
      'public, max-age=20, stale-while-revalidate=40'
    );
    expect(publicResponse.headers.get('X-WAMP-Cache')).toBe('bypass');
    const etag = publicResponse.headers.get('ETag');
    expect(etag).toBeTruthy();

    const conditionalResponse = await handleWorldTileConfigRequest(new Request(request, {
      headers: { 'If-None-Match': etag! },
    }), env);
    expect(conditionalResponse.status).toBe(304);

    const privateResponse = await handleWorldTileConfigRequest(request, env, undefined, true);
    expect(privateResponse.headers.get('Cache-Control')).toBe('private, no-store');
    expect(privateResponse.headers.get('X-WAMP-Cache')).toBe('bypass');
  });

  it('assembles a stable manifest using only read statements', async () => {
    const fake = createReadDatabase();
    const env = createEnv(fake.database);
    const request = new Request(
      'https://api.wamp.land/api/world/tiles/manifest?level=4&minTileX=-1&maxTileX=0&minTileY=2&maxTileY=2'
    );
    const response = await handleWorldTileManifestRequest(request, new URL(request.url), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toMatch(/^W\/"world-tiles-/);
    const body = await response.json() as { level: number; entries: unknown[] };
    expect(body.level).toBe(4);
    expect(body.entries.length).toBeGreaterThan(0);

    const sql = fake.queries.join('\n');
    expect(sql).not.toMatch(/\b(?:insert|update|delete)\b/i);
    expect(fake.queries.every((query) => /^\s*select\b/i.test(query))).toBe(true);
  });

  it('returns a controlled no-store response while tiled reads are disabled', async () => {
    const fake = createReadDatabase();
    const env = {
      ...createEnv(fake.database),
      TILED_OVERWORLD_READS: '0',
    };
    const request = new Request(
      'https://api.wamp.land/api/world/tiles/manifest?level=4&minTileX=0&maxTileX=0&minTileY=0&maxTileY=0'
    );
    const response = await handleWorldTileManifestRequest(request, new URL(request.url), env);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    await expect(response.json()).resolves.toEqual({
      error: 'Tiled overworld reads are unavailable.',
    });
    expect(fake.queries).toEqual([]);
  });

  it('schedules outbox dispatch only when generation and the Queue binding are enabled', async () => {
    const waits: Promise<unknown>[] = [];
    const context: WorkerExecutionContextLike = {
      waitUntil(promise) {
        waits.push(promise);
      },
    };
    const disabled = scheduleWorldTileOutboxDispatch(createEnv(createReadDatabase().database), context);
    expect(disabled).toEqual({ scheduled: false, reason: 'generation-disabled' });

    const fake = createReadDatabase();
    const enabled = scheduleWorldTileOutboxDispatch({
      ...createEnv(fake.database),
      WORLD_TILE_GENERATION_ENABLED: '1',
      WORLD_TILE_QUEUE: {
        async send() {},
        async sendBatch() {},
      },
    }, context);
    expect(enabled).toEqual({ scheduled: true, reason: null });
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
    expect(fake.queries.every((query) => /^\s*select\b/i.test(query))).toBe(true);
  });
});

function createEnv(database: D1Database): Env {
  return {
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    DB: database,
    JAM_DB: database,
    TILED_OVERWORLD_READS: '1',
    TILED_OVERWORLD_ROLLOUT_PERCENT: '100',
    WORLD_TILE_PUBLIC_BASE_URL: 'https://tiles.wamp.land',
  };
}

function createReadDatabase(): { database: D1Database; queries: string[] } {
  const queries: string[] = [];
  class Statement implements D1PreparedStatement {
    constructor(readonly query: string) {}
    bind(): D1PreparedStatement {
      return this;
    }
    async first<T>(): Promise<T | null> {
      if (/from\s+world_tile_renderer_versions/i.test(this.query)) {
        return {
          version: 'renderer-a',
          status: 'active',
          render_origin: 'https://abc123.wampland.pages.dev',
          renderer_contract_hash: 'contract-a',
          asset_contract_hash: 'assets-a',
          created_at: '2026-07-19T00:00:00.000Z',
          activated_at: '2026-07-19T00:01:00.000Z',
          retired_at: null,
        } as T;
      }
      return null;
    }
    async all<T>(): Promise<{ results: T[] }> {
      if (/^\s*select\s+version\s+from\s+world_tile_renderer_versions/i.test(this.query)) {
        return { results: [{ version: 'renderer-a' }] as T[] };
      }
      return { results: [] };
    }
  }
  const database: D1Database = {
    prepare(query) {
      queries.push(query);
      return new Statement(query);
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
      return Promise.all(statements.map((statement) => statement.all())) as Promise<T[]>;
    },
  };
  return { database, queries };
}
