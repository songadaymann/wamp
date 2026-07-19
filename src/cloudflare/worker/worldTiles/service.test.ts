import { describe, expect, it } from 'vitest';
import type { WorldTileCoordinate } from '../../../worldTiles/model';
import type { D1Database, D1PreparedStatement } from '../core/types';
import {
  buildWorldTileGenerationJob,
  buildWorldTileManifest,
  buildWorldTileManifestEntry,
  createWorldTileManifestEtag,
  loadWorldTileManifest,
  normalizeWorldTilePublicBaseUrl,
  parseWorldTileRolloutPercentage,
  worldTileGenerationEnabled,
  worldTileReadsEnabled,
} from './service';
import type {
  WorldRenderTileLeafChangeRow,
  WorldRenderTileOutboxRow,
  WorldRenderTileRow,
} from './store';

describe('world tile manifest service', () => {
  it('serves the previous ready tile while a newer desired generation renders', () => {
    const coordinate: WorldTileCoordinate = { level: 4, x: -1, y: 2 };
    const entry = buildWorldTileManifestEntry(
      'renderer-a',
      coordinate,
      createTileRow({
        level: 4,
        tile_x: -1,
        tile_y: 2,
        desired_generation: 8,
        desired_empty: 1,
        ready_generation: 7,
        ready_empty: 0,
        ready_hash: 'old-content',
        r2_key: 'v/4/-1/2/old-content.png',
        byte_length: 1234,
        ready_at: '2026-07-19T10:00:00.000Z',
      }),
      [createLeafChange({
        tile_x: -1,
        tile_y: 2,
        desired_generation: 8,
        desired_empty: 1,
        ready_generation: 7,
        ready_empty: 0,
        desired_at: '2026-07-19T10:01:00.000Z',
      })],
      'https://tiles.wamp.land',
    );

    expect(entry.desiredEmpty).toBe(true);
    expect(entry.readyEmptyGeneration).toBeNull();
    expect(entry.ready).toMatchObject({
      generation: 7,
      contentHash: 'old-content',
      url: 'https://tiles.wamp.land/v/4/-1/2/old-content.png',
      width: 642,
      height: 354,
      overlap: 1,
      byteLength: 1234,
    });
    expect(entry.staleRoomIds).toEqual(['-1,2']);
  });

  it('masks an immediately unpublished room through still-current ancestors', () => {
    const entry = buildWorldTileManifestEntry(
      'renderer-a',
      { level: 2, x: -1, y: 0 },
      createTileRow({
        level: 2,
        tile_x: -1,
        tile_y: 0,
        desired_generation: 4,
        ready_generation: 4,
        desired_empty: 0,
        ready_empty: 0,
        ready_hash: 'parent-content',
        r2_key: 'world-tiles/renderer-a/objects/parent-content.png',
        byte_length: 1_234,
        ready_at: '2026-07-19T10:00:00.000Z',
      }),
      [createLeafChange({
        tile_x: -4,
        tile_y: 1,
        desired_generation: 9,
        desired_empty: 1,
        ready_generation: 8,
        ready_empty: 0,
        desired_at: '2026-07-19T10:01:00.000Z',
      })],
      'https://tiles.wamp.land',
    );

    expect(entry.staleRoomIds).toEqual(['-4,1']);
  });

  it('keeps previous imagery visible for nonempty replacements', () => {
    const entry = buildWorldTileManifestEntry(
      'renderer-a',
      { level: 3, x: 0, y: 0 },
      createTileRow({
        level: 3,
        ready_generation: 2,
        desired_generation: 2,
        ready_empty: 0,
        desired_empty: 0,
        ready_hash: 'parent-content',
        r2_key: 'world-tiles/renderer-a/objects/parent-content.png',
        byte_length: 1_234,
        ready_at: '2026-07-19T10:00:00.000Z',
      }),
      [createLeafChange({
        tile_x: 0,
        tile_y: 0,
        desired_generation: 5,
        desired_empty: 0,
        ready_generation: 4,
        ready_empty: 0,
        desired_at: '2026-07-19T10:01:00.000Z',
      })],
      'https://tiles.wamp.land',
    );

    expect(entry.staleRoomIds).toEqual([]);
  });

  it('represents uploaded-free ready empty coverage explicitly', () => {
    const storedEmpty = buildWorldTileManifestEntry(
      'renderer-a',
      { level: 4, x: 9, y: -3 },
      createTileRow({
        tile_x: 9,
        tile_y: -3,
        desired_generation: 4,
        desired_empty: 1,
        ready_generation: 4,
        ready_empty: 1,
      }),
      [],
      'https://tiles.wamp.land',
    );
    const implicitEmpty = buildWorldTileManifestEntry(
      'renderer-a',
      { level: 4, x: 10, y: -3 },
      null,
      [],
      'https://tiles.wamp.land',
    );

    expect(storedEmpty.ready).toBeNull();
    expect(storedEmpty.readyEmptyGeneration).toBe(4);
    expect(implicitEmpty.readyEmptyGeneration).toBe(0);
  });

  it('never advertises a ready URL before every uploaded-pointer field is present', () => {
    const entry = buildWorldTileManifestEntry(
      'renderer-a',
      { level: 4, x: 1, y: 1 },
      createTileRow({ ready_generation: 1, ready_empty: 0, ready_hash: 'hash', r2_key: null }),
      [],
      'https://tiles.wamp.land',
    );
    expect(entry.ready).toBeNull();
  });

  it('orders entries and published summaries deterministically', () => {
    const manifest = buildWorldTileManifest({
      rendererVersion: 'renderer-a',
      level: 4,
      targetBounds: { minTileX: 0, maxTileX: 1, minTileY: 0, maxTileY: 0 },
      coordinates: [
        { level: 4, x: 1, y: 0 },
        { level: 0, x: 0, y: 0 },
        { level: 4, x: 0, y: 0 },
      ],
      tileRows: [],
      leafChanges: [],
      rooms: [
        createRoomSummary('1,0', 1, 0),
        createRoomSummary('0,0', 0, 0),
      ],
      publicBaseUrl: 'https://tiles.wamp.land',
    });
    expect(manifest.entries.map((entry) => (
      `${entry.address.level}:${entry.address.x}:${entry.address.y}`
    ))).toEqual(['0:0:0', '4:0:0', '4:1:0']);
    expect(manifest.rooms.map((room) => room.id)).toEqual(['0,0', '1,0']);
    expect(createWorldTileManifestEtag(manifest)).toBe(createWorldTileManifestEtag(structuredClone(manifest)));
  });

  it('preserves manifest shape and ordering while loading through one read batch', async () => {
    const fake = createManifestDatabase();
    const result = await loadWorldTileManifest({
      DB: fake.database,
      TILED_OVERWORLD_READS: '1',
      WORLD_TILE_PUBLIC_BASE_URL: 'https://tiles.wamp.land',
    }, 4, {
      minTileX: 0,
      maxTileX: 1,
      minTileY: 0,
      maxTileY: 0,
    });

    expect(result).not.toBeNull();
    expect(fake.sessions).toEqual(['first-unconstrained']);
    expect(fake.batchSizes).toEqual([4]);
    expect(fake.queries.every((query) => /^\s*select\b/i.test(query))).toBe(true);
    expect(result!.manifest.rendererVersion).toBe('renderer-batched');
    expect(result!.manifest.entries.map((entry) => (
      `${entry.address.level}:${entry.address.x}:${entry.address.y}`
    ))).toEqual([...result!.manifest.entries]
      .sort((left, right) => (
        left.address.level - right.address.level
        || left.address.y - right.address.y
        || left.address.x - right.address.x
      ))
      .map((entry) => `${entry.address.level}:${entry.address.x}:${entry.address.y}`));
    expect(result!.manifest.entries.find((entry) => (
      entry.address.level === 4 && entry.address.x === 0 && entry.address.y === 0
    ))?.ready).toMatchObject({
      generation: 3,
      contentHash: 'batched-content',
      url: 'https://tiles.wamp.land/world-tiles/renderer-batched/objects/batched-content.png',
      byteLength: 456,
    });
    expect(result!.manifest.rooms.map((room) => room.id)).toEqual(['0,0', '1,0']);
    expect(result!.etag).toBe(createWorldTileManifestEtag(result!.manifest));
  });

  it('returns the same tile contract without loading room summaries when excluded', async () => {
    const fake = createManifestDatabase();
    const result = await loadWorldTileManifest({
      DB: fake.database,
      TILED_OVERWORLD_READS: '1',
      WORLD_TILE_PUBLIC_BASE_URL: 'https://tiles.wamp.land',
    }, 4, {
      minTileX: 0,
      maxTileX: 0,
      minTileY: 0,
      maxTileY: 0,
    }, { includeRooms: false });

    expect(result).not.toBeNull();
    expect(result!.manifest.rooms).toEqual([]);
    expect(result!.manifest.entries.length).toBeGreaterThan(0);
    expect(fake.sessions).toEqual(['first-unconstrained']);
    expect(fake.batchSizes).toEqual([3]);
    expect(fake.queries.some((query) => /world_tile_published_room_summaries|from\s+rooms/i.test(query)))
      .toBe(false);
  });

  it('creates Queue messages containing identity only and no room bytes', () => {
    const job = buildWorldTileGenerationJob(createOutboxRow(), '2026-07-19T10:00:00.000Z');
    expect(job).toEqual({
      schemaVersion: 1,
      rendererVersion: 'renderer-a',
      level: 4,
      x: 3,
      y: -2,
      generation: 9,
      reason: 'room-published-update',
      enqueuedAt: '2026-07-19T10:00:00.000Z',
    });
    expect(JSON.stringify(job)).not.toMatch(/snapshot|draft|published_json/);
  });

  it('normalizes flags, rollout percentages, and public URL roots safely', () => {
    expect(worldTileReadsEnabled({ TILED_OVERWORLD_READS: 'ON' })).toBe(true);
    expect(worldTileReadsEnabled({ TILED_OVERWORLD_READS: '0' })).toBe(false);
    expect(worldTileGenerationEnabled({ WORLD_TILE_GENERATION_ENABLED: 'true' })).toBe(true);
    expect(worldTileGenerationEnabled({ WORLD_TILE_GENERATION_ENABLED: '0' })).toBe(false);
    expect(parseWorldTileRolloutPercentage('101')).toBe(100);
    expect(parseWorldTileRolloutPercentage('-1')).toBe(0);
    expect(parseWorldTileRolloutPercentage('12.345')).toBe(12.35);
    expect(normalizeWorldTilePublicBaseUrl('https://tiles.wamp.land/?ignored=yes#hash')).toBe(
      'https://tiles.wamp.land',
    );
    expect(normalizeWorldTilePublicBaseUrl('javascript:alert(1)')).toBeNull();
  });
});

function createTileRow(overrides: Partial<WorldRenderTileRow> = {}): WorldRenderTileRow {
  return {
    renderer_version: 'renderer-a',
    level: 4,
    tile_x: 1,
    tile_y: 1,
    desired_generation: 1,
    desired_hash: 'desired',
    desired_empty: 0,
    ready_generation: null,
    ready_hash: null,
    ready_empty: null,
    r2_key: null,
    r2_etag: null,
    byte_length: null,
    lease_owner: null,
    lease_generation: null,
    lease_expires_at: null,
    attempts: 0,
    last_error: null,
    desired_at: '2026-07-19T10:00:00.000Z',
    ready_at: null,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-19T10:00:00.000Z',
    ...overrides,
  };
}

function createLeafChange(
  overrides: Partial<WorldRenderTileLeafChangeRow> = {},
): WorldRenderTileLeafChangeRow {
  return {
    tile_x: 1,
    tile_y: 1,
    desired_generation: 1,
    desired_empty: 0,
    ready_generation: null,
    ready_empty: null,
    desired_at: '2026-07-19T10:00:00.000Z',
    ready_at: null,
    ...overrides,
  };
}

function createRoomSummary(id: string, x: number, y: number) {
  return {
    id,
    coordinates: { x, y },
    title: null,
    state: 'published' as const,
    goalType: null,
    version: 1,
    publishedAt: '2026-07-19T10:00:00.000Z',
    previewUpdatedAt: '2026-07-19T10:00:00.000Z',
    creatorUserId: null,
    creatorDisplayName: null,
  };
}

function createOutboxRow(): WorldRenderTileOutboxRow {
  return {
    id: 1,
    renderer_version: 'renderer-a',
    level: 4,
    tile_x: 3,
    tile_y: -2,
    generation: 9,
    reason: 'room-published-update',
    state: 'pending',
    dispatch_attempts: 0,
    last_dispatch_error: null,
    created_at: '2026-07-19T09:59:00.000Z',
    updated_at: '2026-07-19T09:59:00.000Z',
    dispatched_at: null,
  };
}

function createManifestDatabase(): {
  database: D1Database;
  queries: string[];
  batchSizes: number[];
  sessions: string[];
} {
  const queries: string[] = [];
  const batchSizes: number[] = [];
  const sessions: string[] = [];

  class Statement implements D1PreparedStatement {
    constructor(readonly query: string) {}

    bind(): D1PreparedStatement {
      return this;
    }

    async first<T>(): Promise<T | null> {
      throw new Error('Manifest loading must not issue a separate active-renderer read.');
    }

    async all<T>(): Promise<{ results: T[] }> {
      if (/^\s*select\s+version\s+from\s+world_tile_renderer_versions/i.test(this.query)) {
        return { results: [{ version: 'renderer-batched' }] as T[] };
      }
      if (/from\s+world_render_tiles/i.test(this.query) && /\(level, tile_x, tile_y\) in/i.test(this.query)) {
        return { results: [createTileRow({
          renderer_version: 'renderer-batched',
          level: 4,
          tile_x: 0,
          tile_y: 0,
          desired_generation: 3,
          ready_generation: 3,
          desired_empty: 0,
          ready_empty: 0,
          ready_hash: 'batched-content',
          r2_key: 'world-tiles/renderer-batched/objects/batched-content.png',
          byte_length: 456,
          ready_at: '2026-07-19T10:00:00.000Z',
        })] as T[] };
      }
      if (/from\s+world_tile_published_room_summaries/i.test(this.query)) {
        return { results: [
          publishedSummaryRow('1,0', 1, 0),
          publishedSummaryRow('0,0', 0, 0),
        ] as T[] };
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
  return { database, queries, batchSizes, sessions };
}

function publishedSummaryRow(id: string, x: number, y: number) {
  return {
    id,
    x,
    y,
    published_title: `Room ${id}`,
    goal_type: 'reach_exit',
    version: 1,
    published_at: '2026-07-19T09:59:00.000Z',
    preview_updated_at: '2026-07-19T10:00:00.000Z',
    last_published_by_user_id: 'builder-a',
    last_published_by_display_name: 'Builder A',
  };
}
