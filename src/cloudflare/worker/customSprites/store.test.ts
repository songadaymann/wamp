import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { isCustomSpriteUsedInStoredRooms } from './store';

describe('isCustomSpriteUsedInStoredRooms', () => {
  it('finds usage in current room drafts', async () => {
    const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 });
    room.placedObjects = [{ instanceId: 'used-1', id: 'custom_sprite:used', x: 16, y: 16 }];
    const env = createEnv({
      rooms: [{ draft_json: JSON.stringify(room), published_json: null }],
    });

    await expect(isCustomSpriteUsedInStoredRooms(env, 'used')).resolves.toBe(true);
  });

  it('ignores stale definitions that are not placed or painted', async () => {
    const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 });
    room.customSprites = [{
      id: 'unused',
      name: 'Unused',
      size: 16,
      kind: 'decoration',
      pixels: Array.from({ length: 256 }, () => null),
      status: 'active',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    }];
    const env = createEnv({
      rooms: [{ draft_json: JSON.stringify(room), published_json: null }],
    });

    await expect(isCustomSpriteUsedInStoredRooms(env, 'unused')).resolves.toBe(false);
  });

  it('checks active guest drafts', async () => {
    const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 });
    room.placedObjects = [{
      instanceId: 'guest-used-1',
      id: 'custom_sprite:guest-used',
      x: 16,
      y: 16,
    }];
    const env = createEnv({
      guests: [{ snapshot_json: JSON.stringify(room) }],
    });

    await expect(isCustomSpriteUsedInStoredRooms(env, 'guest-used')).resolves.toBe(true);
  });
});

function createEnv(options: {
  rooms?: Array<{ draft_json: string; published_json: string | null }>;
  guests?: Array<{ snapshot_json: string }>;
}): Env {
  const database: D1Database = {
    prepare: (query) => createStatement(
      query.includes('FROM guest_room_drafts') ? options.guests ?? [] : options.rooms ?? [],
    ),
    batch: async <T>() => [] as T[],
  };
  return {
    DB: database,
    JAM_DB: database,
    ASSETS: { fetch: async () => new Response() },
  };
}

function createStatement(rows: unknown[]): D1PreparedStatement {
  const statement: D1PreparedStatement = {
    bind: () => statement,
    first: async <T>() => (rows[0] as T | undefined) ?? null,
    all: async <T>() => ({ results: rows as T[] }),
  };
  return statement;
}

describe('sprite usage checks on the real schema (F411)', () => {
  it('matches only exact uses of the id, not ids or text that contain it', async () => {
    const { fixture } = await import('../activity/testDatabase');
    const f = fixture();
    const insert = (id: string, x: number, snapshot: ReturnType<typeof createDefaultRoomSnapshot>) => f.sqlite
      .prepare('INSERT INTO rooms (id, x, y, draft_json) VALUES (?, ?, 0, ?)').run(id, x, JSON.stringify(snapshot));
    const longer = createDefaultRoomSnapshot('40,0', { x: 40, y: 0 });
    longer.title = 'ab ab ab';
    longer.placedObjects = [{ instanceId: 'p1', id: 'custom_sprite:abc', x: 16, y: 16 }];
    insert('40,0', 40, longer);
    await expect(isCustomSpriteUsedInStoredRooms(f.env, 'ab')).resolves.toBe(false);
    const exact = createDefaultRoomSnapshot('41,0', { x: 41, y: 0 });
    exact.placedObjects = [{ instanceId: 'p2', id: 'custom_sprite:ab', x: 16, y: 16 }];
    insert('41,0', 41, exact);
    await expect(isCustomSpriteUsedInStoredRooms(f.env, 'ab')).resolves.toBe(true);
    f.sqlite.close();
  });

  it('gives one network a limited number of public checks an hour', async () => {
    const { fixture } = await import('../activity/testDatabase');
    const { handleCustomSpriteRequest } = await import('./routes');
    const f = fixture();
    const check = () => {
      const request = new Request('https://api.wamp.land/api/custom-sprites/abcd/usage', { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
      return handleCustomSpriteRequest(request, new URL(request.url), f.env);
    };
    for (let index = 0; index < 60; index += 1) expect((await check()).status).toBe(200);
    await expect(check()).rejects.toMatchObject({ status: 429 });
    f.sqlite.close();
  });
});
