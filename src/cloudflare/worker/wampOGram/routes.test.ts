import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/request', async (original) => ({
  ...await original<typeof import('../auth/request')>(),
  requireAuthenticatedRequestAuth: vi.fn(),
}));

import { maskBlockedCustomArt } from '../../../customSprites/blockedArt';
import { CUSTOM_ROOM_TILE_FIRST_GID } from '../../../customTiles/model';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { normalizeRoomVideo, type RoomVideo } from '../../../roomVideo/model';
import { fixture } from '../activity/testDatabase';
import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError } from '../core/http';
import { hashRateLimitKey } from '../core/rateLimit';
import type { Env, RequestAuth } from '../core/types';
import { loadOrBackfillUserProgress } from '../progression/progressRows';
import { HIDDEN_VERSION_TITLE, hiddenVersionSnapshot } from '../rooms/versionRedaction';
import { renderRoomSharePreviewPng } from '../share/roomPreviewImage';
import { handleAdminWampOGramRequest, handleWampOGramRequest } from './routes';
import { loadWampOGramBySlug } from './store';

const VIDEO = normalizeRoomVideo({ youtubeId: 'dQw4w9WgXcQ', x: 0, y: 0, width: 320 }) as RoomVideo;
let f: ReturnType<typeof fixture>;
const authFor = (id: string): RequestAuth => ({
  source: 'session', user: { id, displayName: id, email: `${id}@example.test`, walletAddress: null },
  principal: { kind: 'user', id, displayName: id, ownerUserId: id, agentId: null },
  agent: null, session: null, school: null, scopes: null, apiToken: null, agentToken: null, isAdmin: false,
});

beforeEach(async () => {
  vi.clearAllMocks();
  f = fixture();
  await loadOrBackfillUserProgress(f.env, 'p1');
  vi.mocked(requireAuthenticatedRequestAuth).mockResolvedValue(authFor('p1'));
});
afterEach(() => f.sqlite.close());

function room(id = '1,0', extra: Partial<RoomSnapshot> = {}): RoomSnapshot {
  const [x, y] = id.split(',').map(Number);
  return { ...createDefaultRoomSnapshot(id, { x, y }), title: 'Postcard', ...extra };
}
async function create(roomSnapshot: unknown, ip = '203.0.113.7'): Promise<{ status: number; slug?: string }> {
  const url = new URL('https://api.wamp.land/api/wamp-o-grams');
  const request = new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof roomSnapshot === 'string' ? roomSnapshot : JSON.stringify({ postcard: { title: 'Hi' }, roomSnapshot }),
  });
  try {
    const response = await handleWampOGramRequest(request, url, f.env);
    return { status: response.status, slug: (await response.json() as { slug: string }).slug };
  } catch (error) {
    return { status: (error as { status?: number }).status ?? 500 };
  }
}
const gramCount = () => (f.sqlite.prepare('SELECT COUNT(*) AS n FROM wamp_o_grams').get() as { n: number }).n;
const storedGram = (slug: string) => f.sqlite.prepare('SELECT title, room_status, room_version, snapshot_json FROM wamp_o_grams WHERE slug = ?')
  .get(slug) as { title: string; room_status: string; room_version: number; snapshot_json: string };

describe('Wamp-O-Gram creation (F417)', () => {
  it('checks sign-in before reading the body', async () => {
    vi.mocked(requireAuthenticatedRequestAuth).mockRejectedValue(new HttpError(401, 'Sign in.'));
    expect((await create('not json')).status).toBe(401);
  });

  it('refuses a room whose id does not match its coordinates', async () => {
    expect((await create({ ...room('1,0'), id: '0,0' })).status).toBe(400);
    expect((await create(room('1,0', { coordinates: { x: 1.5, y: 0 } }))).status).toBe(400);
    expect((await create(room('1,0'))).status).toBe(200);
    expect(gramCount()).toBe(1);
  });

  it('needs builder trust level 1 to add a video to an unpublished room, but keeps a published room\'s video', async () => {
    expect((await create(room('1,0', { video: VIDEO }))).status).toBe(403);
    f.sqlite.prepare("UPDATE rooms SET published_json = json_set(published_json, '$.video', json(?)) WHERE id = '0,0'")
      .run(JSON.stringify(VIDEO));
    expect((await create(room('0,0', { video: VIDEO }))).status).toBe(200);
    f.sqlite.prepare('UPDATE user_progress SET hidden_trust_score = 40 WHERE user_id = ?').run('p1');
    expect((await create(room('1,0', { video: VIDEO }))).status).toBe(200);
    expect(gramCount()).toBe(2);
  });

  it('shows a published room as it was published, whatever content was sent', async () => {
    f.sqlite.prepare("UPDATE rooms SET published_json = json_set(published_json, '$.video', json(?)) WHERE id = '0,0'")
      .run(JSON.stringify(VIDEO));
    const { status, slug } = await create(room('0,0', { title: 'Not this room', video: { ...VIDEO, youtubeId: 'aaaaaaaaaaa' } }));
    expect(status).toBe(200);
    const gram = storedGram(slug!);
    expect(gram).toMatchObject({ title: 'Hi', room_status: 'published', room_version: 1 });
    expect(JSON.parse(gram.snapshot_json)).toMatchObject({ title: 'Lava Gauntlet', status: 'published', video: { youtubeId: VIDEO.youtubeId } });
  });

  it('refuses an unpublished room claimed by someone else, and lets its claimer send it', async () => {
    f.sqlite.prepare("INSERT INTO rooms (id,x,y,draft_json,claimer_user_id) VALUES ('2,0',2,0,?,'builder')")
      .run(JSON.stringify(room('2,0', { title: 'Work in progress' })));
    expect((await create(room('2,0', { title: 'Copied' }))).status).toBe(403);
    expect(gramCount()).toBe(0);
    vi.mocked(requireAuthenticatedRequestAuth).mockResolvedValue(authFor('builder'));
    const { status, slug } = await create(room('2,0', { title: 'Builder draft', status: 'published' }));
    expect(status).toBe(200);
    expect(JSON.parse(storedGram(slug!).snapshot_json)).toMatchObject({ title: 'Builder draft', status: 'draft' });
  });

  it('limits each account to 20 grams an hour', async () => {
    for (let i = 0; i < 20; i += 1) expect((await create(room(`${i},1`), `198.51.100.${i}`)).status).toBe(200);
    expect((await create(room('20,1'), '192.0.2.1')).status).toBe(429);
    expect(gramCount()).toBe(20);
  });

  it('limits each network to 60 grams a day', async () => {
    const insert = f.sqlite.prepare('INSERT INTO rate_limit_events (bucket, key_hash, created_at) VALUES (?, ?, ?)');
    const network = await hashRateLimitKey(f.env, 'ip:203.0.113.7');
    for (let i = 0; i < 60; i += 1) insert.run('wamp-o-gram:network', network, new Date().toISOString());
    expect((await create(room())).status).toBe(429);
    expect((await create(room(), '198.51.100.9')).status).toBe(200);
  });
});

const remove = (slug: string, key = 'test-admin-key') => {
  const url = new URL(`https://api.wamp.land/api/admin/wamp-o-grams/${slug}`);
  const request = new Request(url, { method: 'DELETE', headers: { Origin: 'https://wamp.land', 'x-admin-key': key } });
  return handleAdminWampOGramRequest(request, url, { ...f.env, ADMIN_API_KEY: 'test-admin-key' } as Env);
};

describe('Wamp-O-Gram admin delete (F417)', () => {
  it('deletes a gram by its slug so the link stops working', async () => {
    const { slug } = await create(room());
    await expect(remove(slug!, 'wrong-key')).rejects.toMatchObject({ status: 403 });
    expect((await remove(slug!)).status).toBe(200);
    expect(gramCount()).toBe(0);
    const url = new URL(`https://api.wamp.land/api/wamp-o-grams/${slug}`);
    await expect(handleWampOGramRequest(new Request(url), url, f.env)).rejects.toMatchObject({ status: 404 });
    await expect(remove(slug!)).rejects.toMatchObject({ status: 404 });
  });
});

describe('Wamp-O-Gram preview cache (F348)', () => {
  const CLIENT_HOUR = 'public, max-age=3600';
  let stored: Map<string, Response>;
  const waits: Promise<unknown>[] = [];
  const context = { waitUntil: (promise: Promise<unknown>) => { waits.push(promise); } };
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal('caches', {
      default: {
        match: async (request: Request) => stored.get(request.url)?.clone(),
        put: async (request: Request, response: Response) => { stored.set(request.url, response.clone()); },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function preview(slug: string, path = 'preview.png?renderer=1', init: RequestInit = {}): Promise<Response> {
    const url = new URL(`https://api.wamp.land/api/wamp-o-grams/${slug}/${path}`);
    const response = await handleWampOGramRequest(new Request(url, init), url, f.env, context);
    await Promise.all(waits.splice(0));
    return response;
  }
  const keyFor = (slug: string, suffix = '') => `https://api.wamp.land/api/wamp-o-grams/${slug}/preview.png?renderer=1${suffix}`;
  const bytesOf = async (response: Response) => Buffer.from(await response.arrayBuffer());
  const pngOf = async (snapshot: RoomSnapshot) => Buffer.from(await renderRoomSharePreviewPng(snapshot));
  const storedRoom = async (slug: string) => (await loadWampOGramBySlug(f.env, slug))!.roomSnapshot;

  it('draws a preview once, keeps this Worker\'s copy for a year, and lets clients keep it for an hour', async () => {
    const { slug } = await create(room());

    const first = await preview(slug!);
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('image/png');
    expect(first.headers.get('Cache-Control')).toBe(CLIENT_HOUR);
    expect(first.headers.get('ETag')).toBe(`"${slug}-v1"`);
    expect(first.headers.get('X-WAMP-Cache')).toBe('miss');
    const drawn = await bytesOf(first);
    expect(first.headers.get('Content-Length')).toBe(String(drawn.length));
    expect([...stored.keys()]).toEqual([keyFor(slug!)]);
    expect(stored.get(keyFor(slug!))?.headers.get('Cache-Control')).toBe('public, max-age=31536000');

    const second = await preview(slug!);
    expect(second.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(second.headers.get('Cache-Control')).toBe(CLIENT_HOUR);
    expect(second.headers.get('ETag')).toBe(`"${slug}-v1"`);
    expect((await bytesOf(second)).equals(drawn)).toBe(true);

    // Links without the current renderer version share the stored image, but a later version may redraw it.
    for (const path of ['preview.png', 'preview?renderer=0', 'preview.png?v=1']) {
      const old = await preview(slug!, path);
      expect(old.headers.get('X-WAMP-Cache')).toBe('hit');
      expect(old.headers.get('Cache-Control')).toBe('public, max-age=300');
    }
    expect(stored.size).toBe(1);
  });

  it('answers a matching If-None-Match with 304 and no body, after checking the gram exists', async () => {
    const { slug } = await create(room());
    for (const tag of [`"${slug}-v1"`, `W/"${slug}-v1"`, `"other", "${slug}-v1"`]) {
      const revalidated = await preview(slug!, undefined, { headers: { 'If-None-Match': tag } });
      expect(revalidated.status).toBe(304);
      expect(revalidated.body).toBeNull();
      expect(revalidated.headers.get('ETag')).toBe(`"${slug}-v1"`);
      expect(revalidated.headers.get('Cache-Control')).toBe(CLIENT_HOUR);
    }
    expect(stored.size).toBe(0);
    expect((await preview(slug!, undefined, { headers: { 'If-None-Match': `"${slug}-v0"` } })).status).toBe(200);

    expect((await remove(slug!)).status).toBe(200);
    await expect(preview(slug!, undefined, { headers: { 'If-None-Match': `"${slug}-v1"` } })).rejects.toMatchObject({ status: 404 });
  });

  it('answers HEAD without drawing, with the stored length and tag once drawn', async () => {
    const { slug } = await create(room());
    const before = await preview(slug!, undefined, { method: 'HEAD' });
    expect(before.status).toBe(200);
    expect(before.body).toBeNull();
    expect(before.headers.get('Cache-Control')).toBe(CLIENT_HOUR);
    expect(before.headers.get('Content-Length')).toBeNull();
    expect(stored.size).toBe(0);

    const length = (await bytesOf(await preview(slug!))).length;
    const after = await preview(slug!, undefined, { method: 'HEAD' });
    expect(after.body).toBeNull();
    expect(after.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(after.headers.get('Content-Length')).toBe(String(length));
    expect(after.headers.get('ETag')).toBe(`"${slug}-v1"`);
    expect(after.headers.get('Cache-Control')).toBe(CLIENT_HOUR);
  });

  it('stops serving a deleted gram\'s preview even though the cache still holds it', async () => {
    const { slug } = await create(room());
    expect((await preview(slug!)).status).toBe(200);
    expect((await remove(slug!)).status).toBe(200);

    expect(stored.size).toBe(1);
    await expect(preview(slug!)).rejects.toMatchObject({ status: 404 });
    await expect(preview(slug!, undefined, { method: 'HEAD' })).rejects.toMatchObject({ status: 404 });
  });

  it('never draws community art an admin blocked, and keeps such a preview for an hour (F189)', async () => {
    const { slug } = await create(room());
    const snapshot = await storedRoom(slug!);
    const tiles = createDefaultRoomSnapshot('1,0', { x: 1, y: 0 }).tileData.terrain.map((row) => [...row]);
    tiles[5][5] = CUSTOM_ROOM_TILE_FIRST_GID;
    const withArt: RoomSnapshot = {
      ...snapshot,
      tileData: { ...snapshot.tileData, terrain: tiles },
      customTiles: [{
        id: 'tile_vandal', name: 'Vandal', pixels: Array.from({ length: 256 }, () => '#00ff00'), collision: 'solid',
        sourceSpriteId: 'vandal-art', createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z',
      }],
    };
    f.sqlite.prepare('UPDATE wamp_o_grams SET snapshot_json = ? WHERE slug = ?').run(JSON.stringify(withArt), slug!);
    f.sqlite.prepare(`INSERT INTO custom_sprites (id, definition_json, name, normalized_name, kind, size, status, created_at, updated_at)
      VALUES ('vandal-art', '{}', 'vandal-art', 'vandal-art', 'decoration', 16, 'blocked', ?, ?)`).run(withArt.createdAt, withArt.createdAt);
    const art = await storedRoom(slug!);

    const response = await preview(slug!);
    const drawn = await bytesOf(response);
    expect(drawn.equals(await pngOf(maskBlockedCustomArt(art, new Set(['vandal-art']))))).toBe(true);
    expect(drawn.equals(await pngOf(art))).toBe(false);
    // The block could be lifted, or another sprite blocked, so no tag and only an hour in this Worker too.
    expect(response.headers.get('ETag')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe(CLIENT_HOUR);
    expect(stored.get(keyFor(slug!))?.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  it('shows the hidden-version placeholder once the gram\'s room version is hidden, even if cached before', async () => {
    f.sqlite.prepare("UPDATE rooms SET published_json = json_set(published_json, '$.background', 'cave') WHERE id = '0,0'").run();
    const { slug } = await create(room('0,0'));
    const shownRoom = await storedRoom(slug!);
    expect(shownRoom.background).toBe('cave');
    const shown = await preview(slug!);
    const shownBytes = await bytesOf(shown);
    expect(shown.headers.get('ETag')).toBe(`"${slug}-v1"`);

    const hide = f.sqlite.prepare("UPDATE room_versions SET redacted_at = ? WHERE room_id = '0,0' AND version = 1");
    hide.run('2026-10-22T12:00:00.000Z');
    const hidden = await preview(slug!, undefined, { headers: { 'If-None-Match': `"${slug}-v1"` } });
    expect(hidden.status).toBe(200);
    expect(hidden.headers.get('X-WAMP-Cache')).toBe('miss');
    expect(hidden.headers.get('ETag')).toBe(`"${slug}-v1-hidden"`);
    const hiddenBytes = await bytesOf(hidden);
    expect(hiddenBytes.equals(await pngOf(hiddenVersionSnapshot(shownRoom)))).toBe(true);
    expect(hiddenBytes.equals(shownBytes)).toBe(false);
    expect([...stored.keys()].sort()).toEqual([keyFor(slug!), keyFor(slug!, '&room=hidden')]);
    expect((await preview(slug!, undefined, { method: 'HEAD' })).headers.get('ETag')).toBe(`"${slug}-v1-hidden"`);

    const url = new URL(`https://api.wamp.land/api/wamp-o-grams/${slug}`);
    const record = await (await handleWampOGramRequest(new Request(url), url, f.env)).json() as { title: string; roomSnapshot: RoomSnapshot };
    expect(record.title).toBe('Hi');
    expect(record.roomSnapshot).toMatchObject({
      id: '0,0', title: HIDDEN_VERSION_TITLE, background: createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }).background,
    });

    hide.run(null);
    const again = await preview(slug!);
    expect(again.headers.get('X-WAMP-Cache')).toBe('hit');
    expect((await bytesOf(again)).equals(shownBytes)).toBe(true);
  });
});
