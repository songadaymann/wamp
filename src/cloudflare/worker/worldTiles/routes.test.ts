import { describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement, Env, WorkerExecutionContextLike } from '../core/types';
import {
  handleWorldTileConfigRequest,
  handleWorldTileManifestRequest,
  parseWorldTileManifestQuery,
  scheduleWorldTileOutboxDispatch,
} from './routes';
import { WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH } from '../../../worldTiles/assetContract';

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
      includeRooms: true,
    });
    expect(parseWorldTileManifestQuery(new URLSearchParams({
      level: '2',
      minTileX: '0',
      maxTileX: '0',
      minTileY: '0',
      maxTileY: '0',
      includeRooms: '0',
    })).includeRooms).toBe(false);
    expect(() => parseWorldTileManifestQuery(new URLSearchParams({
      level: '2',
      minTileX: '0',
      maxTileX: '0',
      minTileY: '0',
      maxTileY: '0',
      includeRooms: 'false',
    }))).toThrow('includeRooms must be 0 or 1');
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
    await expect(publicResponse.clone().json()).resolves.toMatchObject({
      available: true,
      activeRendererAssetContractHash: WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH,
      expectedRendererAssetContractHash: WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH,
    });
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

  it('disables tiled reads when the active renderer predates the authoring registry', async () => {
    const fake = createReadDatabase('authoring-catalog-v1:stale');
    const response = await handleWorldTileConfigRequest(
      new Request('https://api.wamp.land/api/world/tiles/config'),
      createEnv(fake.database),
    );

    await expect(response.json()).resolves.toMatchObject({
      available: false,
      activeRendererAssetContractHash: 'authoring-catalog-v1:stale',
      expectedRendererAssetContractHash: WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH,
    });
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

  it('keeps room summaries on by default and cache-separates coverage-only manifests', async () => {
    const fake = createReadDatabase();
    const env = createEnv(fake.database);
    const baseUrl = 'https://api.wamp.land/api/world/tiles/manifest?level=4&minTileX=0&maxTileX=0&minTileY=0&maxTileY=0';
    const defaultRequest = new Request(baseUrl);
    const defaultResponse = await handleWorldTileManifestRequest(
      defaultRequest,
      new URL(defaultRequest.url),
      env,
    );
    const coverageRequest = new Request(`${baseUrl}&includeRooms=0`);
    const coverageResponse = await handleWorldTileManifestRequest(
      coverageRequest,
      new URL(coverageRequest.url),
      env,
    );

    await expect(defaultResponse.json()).resolves.toMatchObject({
      rooms: [{ id: '0,0' }],
    });
    await expect(coverageResponse.json()).resolves.toMatchObject({ rooms: [] });
    expect(defaultResponse.headers.get('ETag')).not.toBe(coverageResponse.headers.get('ETag'));
    expect(fake.queries.filter((query) => /from\s+world_tile_published_room_summaries/i.test(query)))
      .toHaveLength(1);
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

function createReadDatabase(
  assetContractHash = WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH,
): { database: D1Database; queries: string[] } {
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
          asset_contract_hash: assetContractHash,
          created_at: '2026-07-19T00:00:00.000Z',
          activated_at: '2026-07-19T00:01:00.000Z',
          retired_at: null,
        } as T;
      }
      return null;
    }
    async all<T>(): Promise<{ results: T[] }> {
      if (/^\s*select\s+version,\s+asset_contract_hash\s+from\s+world_tile_renderer_versions/i.test(this.query)) {
        return { results: [{
          version: 'renderer-a',
          asset_contract_hash: WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH,
        }] as T[] };
      }
      if (/from\s+world_tile_published_room_summaries/i.test(this.query)) {
        return { results: [{
          id: '0,0',
          x: 0,
          y: 0,
          published_title: 'Origin',
          goal_type: 'reach_exit',
          version: 1,
          published_at: '2026-07-19T00:00:00.000Z',
          preview_updated_at: '2026-07-19T00:00:00.000Z',
          last_published_by_user_id: 'builder-a',
          last_published_by_display_name: 'Builder A',
        }] as T[] };
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
