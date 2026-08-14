import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../auth/model';
import { buildCustomSpriteObjectId, type CustomSpriteDefinition } from '../../../customSprites/model';
import { HttpError } from '../core/http';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import {
  deleteOwnedCustomSprite,
  listPublicCustomSprites,
  moderateCustomSprite,
  saveCustomSpriteCatalogEntry,
} from './catalogStore';

const migrationSql = readFileSync(
  new URL('../../../../migrations/0044_custom_sprite_catalog.sql', import.meta.url),
  'utf8',
);

describe('custom sprite catalog store', () => {
  let sqlite: DatabaseSync;
  let env: Env;

  beforeEach(() => {
    sqlite = createDatabase();
    env = { DB: new SqliteD1Database(sqlite) } as unknown as Env;
  });

  afterEach(() => sqlite.close());

  it('saves, searches, paginates, and updates an owned sprite with revision checks', async () => {
    const first = await saveCustomSpriteCatalogEntry(env, USER, {
      spriteId: 'first',
      definition: sprite('first', 'Blue Friend'),
    });
    await saveCustomSpriteCatalogEntry(env, USER, {
      spriteId: 'second',
      definition: sprite('second', 'Red Friend'),
    });
    expect(first).toMatchObject({
      revision: 1,
      creator: { userId: USER.id, displayName: USER.displayName },
    });

    const search = await listPublicCustomSprites(env, { query: 'blue', limit: 1 });
    expect(search.sprites.map((entry) => entry.sprite.id)).toEqual(['first']);
    expect((await listPublicCustomSprites(env, { query: '%' })).sprites).toEqual([]);
    const firstPage = await listPublicCustomSprites(env, { limit: 1 });
    expect(firstPage.sprites).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await listPublicCustomSprites(env, {
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.sprites).toHaveLength(1);
    expect(secondPage.sprites[0]?.sprite.id).not.toBe(firstPage.sprites[0]?.sprite.id);

    await expect(saveCustomSpriteCatalogEntry(env, USER, {
      spriteId: 'first',
      definition: sprite('first', 'Stale edit'),
      expectedRevision: 99,
    })).rejects.toMatchObject({ status: 409 });
    const updated = await saveCustomSpriteCatalogEntry(env, USER, {
      spriteId: 'first',
      definition: sprite('first', 'Fresh edit'),
      expectedRevision: 1,
    });
    expect(updated.revision).toBe(2);
    expect(updated.sprite.name).toBe('Fresh edit');
  });

  it('blocks cross-owner edits and deletes only when current room state is unused', async () => {
    await saveCustomSpriteCatalogEntry(env, USER, {
      spriteId: 'used',
      definition: sprite('used', 'Used'),
    });
    await expect(saveCustomSpriteCatalogEntry(env, OTHER_USER, {
      spriteId: 'used',
      definition: sprite('used', 'Stolen'),
      expectedRevision: 1,
    })).rejects.toMatchObject({ status: 403 });

    sqlite.prepare(`
      INSERT INTO rooms (id, draft_json, published_json, claimer_user_id, last_published_by_user_id)
      VALUES ('room', ?, NULL, ?, NULL)
    `).run(
      JSON.stringify({ placedObjects: [{ id: buildCustomSpriteObjectId('used') }] }),
      USER.id,
    );
    await expect(deleteOwnedCustomSprite(env, USER.id, 'used')).rejects.toMatchObject({ status: 409 });
    sqlite.prepare(`UPDATE rooms SET draft_json = '{}' WHERE id = 'room'`).run();
    await deleteOwnedCustomSprite(env, USER.id, 'used');
    expect((await listPublicCustomSprites(env, {})).sprites).toEqual([]);
  });

  it('enforces the 128 active-sprite account limit', async () => {
    for (let index = 0; index < 128; index += 1) {
      const definition = sprite(`existing-${index}`, `Existing ${index}`);
      sqlite.prepare(`
        INSERT INTO custom_sprites (
          id, owner_user_id, definition_json, name, normalized_name, kind, size,
          status, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'decoration', 16, 'active', 1, ?, ?)
      `).run(
        definition.id,
        USER.id,
        JSON.stringify(definition),
        definition.name,
        definition.name.toLowerCase(),
        definition.createdAt,
        definition.updatedAt,
      );
    }
    const promise = saveCustomSpriteCatalogEntry(env, USER, {
      spriteId: 'one-too-many',
      definition: sprite('one-too-many', 'One Too Many'),
    });
    await expect(promise).rejects.toBeInstanceOf(HttpError);
    await expect(promise).rejects.toMatchObject({ status: 409 });
  });

  it('removes blocked sprites from discovery without deleting their definition', async () => {
    await saveCustomSpriteCatalogEntry(env, USER, {
      spriteId: 'moderated',
      definition: sprite('moderated', 'Moderated'),
    });
    const blocked = await moderateCustomSprite(env, 'moderated', 'blocked');
    expect(blocked.status).toBe('blocked');
    expect(blocked.sprite.id).toBe('moderated');
    expect((await listPublicCustomSprites(env, {})).sprites).toEqual([]);
    const restored = await moderateCustomSprite(env, 'moderated', 'active');
    expect(restored.status).toBe('active');
    expect((await listPublicCustomSprites(env, {})).sprites).toHaveLength(1);
  });
});

const USER: AuthUser = {
  id: 'user-a',
  email: 'a@example.test',
  walletAddress: null,
  displayName: 'Builder A',
  username: 'builder-a',
};
const OTHER_USER: AuthUser = {
  id: 'user-b',
  email: 'b@example.test',
  walletAddress: null,
  displayName: 'Builder B',
  username: 'builder-b',
};

function sprite(id: string, name: string): CustomSpriteDefinition {
  return {
    id,
    name,
    size: 16,
    kind: 'decoration',
    pixels: ['#ffffff', ...Array.from({ length: 255 }, () => null)],
    status: 'active',
    createdAt: '2026-08-14T12:00:00.000Z',
    updatedAt: '2026-08-14T12:00:00.000Z',
  };
}

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      username TEXT
    );
    INSERT INTO users (id, display_name, username) VALUES
      ('user-a', 'Builder A', 'builder-a'),
      ('user-b', 'Builder B', 'builder-b');
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      draft_json TEXT NOT NULL,
      published_json TEXT,
      claimer_user_id TEXT,
      last_published_by_user_id TEXT
    );
    CREATE TABLE room_versions (
      room_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      published_by_user_id TEXT,
      PRIMARY KEY (room_id, version)
    );
    CREATE TABLE guest_room_drafts (
      id TEXT PRIMARY KEY,
      guest_user_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  database.exec(migrationSql);
  return database;
}

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
}

class SqliteD1Database implements D1Database {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string): D1PreparedStatement {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch<T>(): Promise<T[]> {
    throw new Error('Batch is not used by custom sprite catalog tests.');
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
  ) return value;
  throw new TypeError(`Unsupported SQLite binding: ${typeof value}.`);
}
