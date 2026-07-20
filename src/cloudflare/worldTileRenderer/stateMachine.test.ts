import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveParentReadiness, type WorldTileRenderJob } from './contracts';
import type {
  D1Database,
  D1PreparedStatement,
  D1RunResult,
  QueueMessage,
  R2Bucket,
  WorldTileRendererEnv,
} from './runtimeTypes';
import {
  acquireRenderLease,
  loadChildRenderTiles,
  loadRenderTile,
  publishReadyEmpty,
  publishReadyObject,
  recoverExpiredLeases,
  releaseRenderLease,
} from './store';

const browserMock = vi.hoisted(() => ({
  close: vi.fn(),
  launch: vi.fn(),
  renderLeaf: vi.fn(),
  renderParent: vi.fn(),
}));
vi.mock('./browser', () => ({
  WorldTileBrowserSession: { launch: browserMock.launch },
}));

import { worldTileRendererWorker } from './worker';

const migrationSql = readFileSync(
  new URL('../../../migrations/0041_world_render_tiles.sql', import.meta.url),
  'utf8',
);
const NOW = '2026-07-19T12:00:00.000Z';

describe('world tile renderer state machine', () => {
  let sqlite: DatabaseSync;
  let database: SqliteD1Database;

  beforeEach(() => {
    sqlite = createDatabase();
    database = new SqliteD1Database(sqlite);
    browserMock.launch.mockReset();
    browserMock.close.mockReset().mockResolvedValue(undefined);
    browserMock.renderLeaf.mockReset().mockResolvedValue({ pngDataUrl: minimalPngDataUrl() });
    browserMock.renderParent.mockReset().mockResolvedValue({ pngDataUrl: minimalPngDataUrl() });
    browserMock.launch.mockResolvedValue({
      close: browserMock.close,
      renderLeaf: browserMock.renderLeaf,
      renderParent: browserMock.renderParent,
    });
  });

  it('serializes duplicate jobs and refuses to lease an already complete generation', async () => {
    insertPublishedRoom(sqlite, 2, 3, 1);
    const address = { rendererVersion: 'renderer-a', level: 4 as const, x: 2, y: 3 };
    const first = await acquireRenderLease(database, {
      address,
      generation: 1,
      leaseExpiresAt: '2026-07-19T12:02:00.000Z',
      leaseOwner: 'worker-a',
      now: NOW,
    });
    const duplicate = await acquireRenderLease(database, {
      address,
      generation: 1,
      leaseExpiresAt: '2026-07-19T12:02:00.000Z',
      leaseOwner: 'worker-b',
      now: NOW,
    });
    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();

    expect(await publishReadyObject(database, {
      address,
      generation: 1,
      leaseOwner: 'worker-a',
      now: NOW,
      byteLength: 100,
      contentHash: 'a'.repeat(64),
      r2Etag: 'etag-a',
      r2Key: `world-tiles/renderer-a/objects/${'a'.repeat(64)}.png`,
    })).toBe(true);
    expect(await acquireRenderLease(database, {
      address,
      generation: 1,
      leaseExpiresAt: '2026-07-19T12:02:00.000Z',
      leaseOwner: 'worker-c',
      now: NOW,
    })).toBeNull();

    const parent = sqlite.prepare(`
      SELECT desired_generation FROM world_render_tiles
      WHERE renderer_version = 'renderer-a' AND level = 3 AND tile_x = 1 AND tile_y = 1
    `).get();
    expect(parent).toEqual({ desired_generation: 1 });
  });

  it('lets a mutation supersede an in-flight generation without waiting for its lease', async () => {
    insertPublishedRoom(sqlite, 5, -3, 1);
    const address = { rendererVersion: 'renderer-a', level: 4 as const, x: 5, y: -3 };
    expect(await acquireRenderLease(database, {
      address,
      generation: 1,
      leaseExpiresAt: '2026-07-19T12:02:00.000Z',
      leaseOwner: 'old-worker',
      now: NOW,
    })).not.toBeNull();

    sqlite.prepare('UPDATE rooms SET published_json = ? WHERE id = ?').run(
      publishedSnapshot(5, -3, 2),
      '5,-3',
    );
    expect(await acquireRenderLease(database, {
      address,
      generation: 2,
      leaseExpiresAt: '2026-07-19T12:02:00.000Z',
      leaseOwner: 'new-worker',
      now: NOW,
    })).not.toBeNull();
    expect(await publishReadyObject(database, {
      address,
      generation: 1,
      leaseOwner: 'old-worker',
      now: NOW,
      byteLength: 100,
      contentHash: 'b'.repeat(64),
      r2Etag: 'etag-old',
      r2Key: `world-tiles/renderer-a/objects/${'b'.repeat(64)}.png`,
    })).toBe(false);
    await releaseRenderLease(database, {
      address,
      error: 'old CAS lost',
      generation: 1,
      leaseOwner: 'old-worker',
      now: NOW,
    });
    expect(await loadRenderTile(database, address)).toMatchObject({
      desired_generation: 2,
      lease_owner: 'new-worker',
      lease_generation: 2,
      ready_generation: null,
    });
  });

  it('resurrects a dispatched outbox event when recovering an expired lease', async () => {
    insertPublishedRoom(sqlite, -7, 8, 1);
    sqlite.prepare(`
      UPDATE world_render_tiles
      SET lease_owner = 'dead-worker', lease_generation = 1,
          lease_expires_at = '2026-07-19T11:59:00.000Z'
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = -7 AND tile_y = 8
    `).run();
    sqlite.prepare(`
      UPDATE world_render_tile_outbox
      SET state = 'dispatched', dispatched_at = '2026-07-19T11:58:00.000Z'
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = -7 AND tile_y = 8
    `).run();

    expect(await recoverExpiredLeases(database, NOW)).toBe(1);
    expect(sqlite.prepare(`
      SELECT lease_owner, lease_generation, lease_expires_at, last_error
      FROM world_render_tiles
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = -7 AND tile_y = 8
    `).get()).toEqual({
      lease_owner: null,
      lease_generation: null,
      lease_expires_at: null,
      last_error: 'expired lease recovered',
    });
    expect(sqlite.prepare(`
      SELECT state, reason, dispatched_at FROM world_render_tile_outbox
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = -7 AND tile_y = 8
    `).get()).toEqual({
      state: 'pending',
      reason: 'expired-lease-repair',
      dispatched_at: null,
    });
  });

  it('parks generation-disabled delivery in the outbox instead of retrying into the DLQ', async () => {
    insertPublishedRoom(sqlite, 1, 4, 1);
    sqlite.prepare(`
      UPDATE world_render_tile_outbox SET state = 'dispatched', dispatched_at = ?
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = 1 AND tile_y = 4
    `).run(NOW);
    const message = createQueueMessage(job(1, 4, 1));

    await worldTileRendererWorker.queue(
      { queue: 'world-tile-renders', messages: [message] },
      createEnvironment(database, { generationEnabled: false }),
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(browserMock.launch).not.toHaveBeenCalled();
    expect(sqlite.prepare(`
      SELECT state, reason, dispatched_at FROM world_render_tile_outbox
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = 1 AND tile_y = 4
    `).get()).toEqual({ state: 'pending', reason: 'generation-paused', dispatched_at: null });
  });

  it('acks duplicate and out-of-order jobs without launching Browser Run', async () => {
    insertPublishedRoom(sqlite, 6, 6, 1);
    sqlite.prepare('UPDATE rooms SET published_json = ? WHERE id = ?').run(
      publishedSnapshot(6, 6, 2),
      '6,6',
    );
    const oldMessage = createQueueMessage(job(6, 6, 1));
    await worldTileRendererWorker.queue(
      { queue: 'world-tile-renders', messages: [oldMessage] },
      createEnvironment(database),
    );
    expect(oldMessage.ack).toHaveBeenCalledOnce();

    sqlite.prepare(`
      UPDATE world_render_tiles
      SET ready_generation = 2, ready_empty = 0, ready_hash = ?, r2_key = ?,
          r2_etag = 'etag-current', byte_length = 100, ready_at = ?, updated_at = ?
      WHERE renderer_version = 'renderer-a' AND level = 4 AND tile_x = 6 AND tile_y = 6
    `).run('c'.repeat(64), `world-tiles/renderer-a/objects/${'c'.repeat(64)}.png`, NOW, NOW);
    const duplicate = createQueueMessage(job(6, 6, 2));
    await worldTileRendererWorker.queue(
      { queue: 'world-tile-renders', messages: [duplicate] },
      createEnvironment(database),
    );
    expect(duplicate.ack).toHaveBeenCalledOnce();
    expect(duplicate.retry).not.toHaveBeenCalled();
    expect(browserMock.launch).not.toHaveBeenCalled();
  });

  it('acks a parent that is waiting for children instead of exhausting Queue retries', async () => {
    insertPublishedRoom(sqlite, 0, 0, 1);
    insertPublishedRoom(sqlite, 1, 0, 1);
    const readyLeaf = {
      rendererVersion: 'renderer-a',
      level: 4 as const,
      x: 0,
      y: 0,
    };
    expect(await acquireRenderLease(database, {
      address: readyLeaf,
      generation: 1,
      leaseExpiresAt: '2026-07-19T12:02:00.000Z',
      leaseOwner: 'ready-child-worker',
      now: NOW,
    })).not.toBeNull();
    expect(await publishReadyObject(database, {
      address: readyLeaf,
      generation: 1,
      leaseOwner: 'ready-child-worker',
      now: NOW,
      byteLength: 100,
      contentHash: 'e'.repeat(64),
      r2Etag: 'etag-ready-child',
      r2Key: `world-tiles/renderer-a/objects/${'e'.repeat(64)}.png`,
    })).toBe(true);
    const message = createQueueMessage({
      ...job(0, 0, 1),
      level: 3,
    });

    await worldTileRendererWorker.queue(
      { queue: 'world-tile-renders', messages: [message] },
      createEnvironment(database),
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(browserMock.launch).not.toHaveBeenCalled();
    expect(await loadRenderTile(database, {
      rendererVersion: 'renderer-a',
      level: 3,
      x: 0,
      y: 0,
    })).toMatchObject({
      desired_generation: 1,
      ready_generation: null,
      lease_owner: null,
      last_error: 'Parent l3/0/0 is waiting for 1 current children.',
    });
  });

  it('retains the previous pointer and releases the lease when R2 upload fails', async () => {
    insertPublishedRoom(sqlite, 10, 11, 1);
    const address = { rendererVersion: 'renderer-a', level: 4 as const, x: 10, y: 11 };
    expect(await acquireRenderLease(database, {
      address,
      generation: 1,
      leaseExpiresAt: '2026-07-19T12:02:00.000Z',
      leaseOwner: 'initial-worker',
      now: NOW,
    })).not.toBeNull();
    expect(await publishReadyObject(database, {
      address,
      generation: 1,
      leaseOwner: 'initial-worker',
      now: NOW,
      byteLength: 100,
      contentHash: 'd'.repeat(64),
      r2Etag: 'etag-previous',
      r2Key: `world-tiles/renderer-a/objects/${'d'.repeat(64)}.png`,
    })).toBe(true);
    sqlite.prepare('UPDATE rooms SET published_json = ? WHERE id = ?').run(
      publishedSnapshot(10, 11, 2),
      '10,11',
    );
    const message = createQueueMessage(job(10, 11, 2));
    const environment = createEnvironment(database, {
      bucket: createBucket({ putError: new Error('R2 upload unavailable') }),
    });

    await worldTileRendererWorker.queue(
      { queue: 'world-tile-renders', messages: [message] },
      environment,
    );

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledOnce();
    expect(await loadRenderTile(database, address)).toMatchObject({
      desired_generation: 2,
      ready_generation: 1,
      ready_hash: 'd'.repeat(64),
      r2_etag: 'etag-previous',
      lease_owner: null,
      lease_generation: null,
      last_error: 'R2 upload unavailable',
    });
  });

  it('propagates content-to-empty transitions through a new parent generation', async () => {
    insertPublishedRoom(sqlite, -1, 0, 1);
    const leaf = { rendererVersion: 'renderer-a', level: 4 as const, x: -1, y: 0 };
    expect(await acquireRenderLease(database, {
      address: leaf,
      generation: 1,
      leaseExpiresAt: '2026-07-19T12:02:00.000Z',
      leaseOwner: 'content-worker',
      now: NOW,
    })).not.toBeNull();
    expect(await publishReadyObject(database, {
      address: leaf,
      generation: 1,
      leaseOwner: 'content-worker',
      now: NOW,
      byteLength: 100,
      contentHash: 'e'.repeat(64),
      r2Etag: 'etag-content',
      r2Key: `world-tiles/renderer-a/objects/${'e'.repeat(64)}.png`,
    })).toBe(true);
    sqlite.prepare('UPDATE rooms SET published_json = NULL WHERE id = ?').run('-1,0');
    expect(await acquireRenderLease(database, {
      address: leaf,
      generation: 2,
      leaseExpiresAt: '2026-07-19T12:02:00.000Z',
      leaseOwner: 'empty-worker',
      now: NOW,
    })).not.toBeNull();
    expect(await publishReadyEmpty(database, {
      address: leaf,
      generation: 2,
      leaseOwner: 'empty-worker',
      now: NOW,
    })).toBe(true);

    const parent = { rendererVersion: 'renderer-a', level: 3 as const, x: -1, y: 0 };
    expect(await loadRenderTile(database, parent)).toMatchObject({ desired_generation: 2 });
    expect(resolveParentReadiness(parent, await loadChildRenderTiles(database, parent))).toEqual({ kind: 'empty' });
  });

  it('converges a revoked custom background to the canonical unavailable fallback', async () => {
    sqlite.prepare(
      'INSERT INTO background_image_uploads (id, status, cloudflare_deleted_at) VALUES (?, ?, NULL)',
    ).run('bg-00001', 'approved');
    sqlite.prepare(
      'INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, ?)',
    ).run('12,13', 12, 13, '{}', publishedSnapshot(12, 13, 1, 'custom:bg-00001'));

    const firstMessage = createQueueMessage(job(12, 13, 1));
    await worldTileRendererWorker.queue(
      { queue: 'world-tile-renders', messages: [firstMessage] },
      createEnvironment(database),
    );
    expect(firstMessage.ack).toHaveBeenCalledOnce();
    expect(browserMock.renderLeaf.mock.calls[0]?.[1]).toMatchObject({
      background: 'custom:bg-00001',
    });

    sqlite.prepare('UPDATE background_image_uploads SET status = ? WHERE id = ?').run(
      'rejected',
      'bg-00001',
    );
    const revokedMessage = createQueueMessage(job(12, 13, 2));
    await worldTileRendererWorker.queue(
      { queue: 'world-tile-renders', messages: [revokedMessage] },
      createEnvironment(database),
    );

    expect(revokedMessage.ack).toHaveBeenCalledOnce();
    expect(revokedMessage.retry).not.toHaveBeenCalled();
    expect(browserMock.renderLeaf.mock.calls[1]?.[1]).toMatchObject({
      background: 'solid:#050505',
    });
    expect(await loadRenderTile(database, {
      rendererVersion: 'renderer-a',
      level: 4,
      x: 12,
      y: 13,
    })).toMatchObject({
      desired_generation: 2,
      ready_generation: 2,
      ready_empty: 0,
    });
  });

  it('uses the unavailable fallback when a custom background row is missing', async () => {
    sqlite.prepare(
      'INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, ?)',
    ).run('14,15', 14, 15, '{}', publishedSnapshot(14, 15, 1, 'custom:missing1'));
    const message = createQueueMessage(job(14, 15, 1));

    await worldTileRendererWorker.queue(
      { queue: 'world-tile-renders', messages: [message] },
      createEnvironment(database),
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(browserMock.renderLeaf.mock.calls[0]?.[1]).toMatchObject({
      background: 'solid:#050505',
    });
  });

  it('keeps approved custom backgrounds strict when their asset load fails', async () => {
    sqlite.prepare(
      'INSERT INTO background_image_uploads (id, status, cloudflare_deleted_at) VALUES (?, ?, NULL)',
    ).run('bg-00002', 'approved');
    sqlite.prepare(
      'INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, ?)',
    ).run('16,17', 16, 17, '{}', publishedSnapshot(16, 17, 1, 'custom:bg-00002'));
    browserMock.renderLeaf.mockRejectedValueOnce(new Error('approved asset unavailable'));
    const message = createQueueMessage(job(16, 17, 1));

    await worldTileRendererWorker.queue(
      { queue: 'world-tile-renders', messages: [message] },
      createEnvironment(database),
    );

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledOnce();
    expect(browserMock.renderLeaf.mock.calls[0]?.[1]).toMatchObject({
      background: 'custom:bg-00002',
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

  async run<T>(): Promise<D1RunResult<T>> {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) }, results: [], success: true };
  }

  executeBatch<T>(): D1RunResult<T> {
    const results = this.database.prepare(this.sql).all(...this.bindings) as T[];
    const changes = this.database.prepare('SELECT changes() AS count').get() as { count: number };
    return { meta: { changes: Number(changes.count) }, results, success: true };
  }
}

class SqliteD1Database implements D1Database {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string): D1PreparedStatement {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<Array<D1RunResult<T>>> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SqliteD1Statement)) {
          throw new Error('Unexpected D1 statement implementation.');
        }
        return statement.executeBatch<T>();
      });
      this.database.exec('COMMIT');
      return results;
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

function insertPublishedRoom(database: DatabaseSync, x: number, y: number, version: number): void {
  database.prepare(
    'INSERT INTO rooms (id, x, y, draft_json, published_json) VALUES (?, ?, ?, ?, ?)',
  ).run(`${x},${y}`, x, y, '{}', publishedSnapshot(x, y, version));
}

function publishedSnapshot(
  x: number,
  y: number,
  version: number,
  background = 'none',
): string {
  return JSON.stringify({
    id: `${x},${y}`,
    coordinates: { x, y },
    status: 'published',
    version,
    updatedAt: `2026-07-19T12:00:0${version}.000Z`,
    background,
    tileData: { background: [], terrain: [], foreground: [] },
    placedObjects: [],
  });
}

function job(x: number, y: number, generation: number): WorldTileRenderJob {
  return {
    schemaVersion: 1,
    rendererVersion: 'renderer-a',
    level: 4,
    x,
    y,
    generation,
    reason: 'test',
    enqueuedAt: NOW,
  };
}

function createQueueMessage(body: WorldTileRenderJob): QueueMessage<unknown> {
  return {
    attempts: 1,
    body,
    id: crypto.randomUUID(),
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function createEnvironment(
  database: D1Database,
  options: { generationEnabled?: boolean; bucket?: R2Bucket } = {},
): WorldTileRendererEnv {
  return {
    DB: database,
    WORLD_TILE_BROWSER: { fetch },
    WORLD_TILE_RENDER_QUEUE: { send: vi.fn(async () => undefined) },
    WORLD_TILES: options.bucket ?? createBucket(),
    WORLD_TILE_ENVIRONMENT: 'safety',
    WORLD_TILE_GENERATION_ENABLED: options.generationEnabled === false ? '0' : '1',
  };
}

function createBucket(options: { putError?: Error } = {}): R2Bucket {
  return {
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    list: vi.fn(async () => ({
      delimitedPrefixes: [],
      objects: [],
      truncated: false,
    })),
    put: vi.fn(async (key) => {
      if (options.putError) throw options.putError;
      return { key, etag: 'etag-new', httpEtag: '"etag-new"' };
    }),
  };
}

function minimalPngDataUrl(): string {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 642);
  view.setUint32(20, 354);
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}
