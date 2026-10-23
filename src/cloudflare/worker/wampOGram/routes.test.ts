import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/request', async (original) => ({
  ...await original<typeof import('../auth/request')>(),
  requireAuthenticatedRequestAuth: vi.fn(),
}));

import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { normalizeRoomVideo, type RoomVideo } from '../../../roomVideo/model';
import { fixture } from '../activity/testDatabase';
import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError } from '../core/http';
import { hashRateLimitKey } from '../core/rateLimit';
import type { Env, RequestAuth } from '../core/types';
import { loadOrBackfillUserProgress } from '../progression/progressRows';
import { handleAdminWampOGramRequest, handleWampOGramRequest } from './routes';

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
  const IMMUTABLE = 'public, max-age=31536000, immutable';
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

  async function preview(slug: string, path = 'preview.png?v=1', method = 'GET'): Promise<Response> {
    const url = new URL(`https://api.wamp.land/api/wamp-o-grams/${slug}/${path}`);
    const response = await handleWampOGramRequest(new Request(url, { method }), url, f.env, context);
    await Promise.all(waits.splice(0));
    return response;
  }
  const bytesOf = async (response: Response) => Buffer.from(await response.arrayBuffer());

  it('draws a preview once and keeps it for good under its slug and version', async () => {
    const { slug } = await create(room());

    const first = await preview(slug!);
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('image/png');
    expect(first.headers.get('Cache-Control')).toBe(IMMUTABLE);
    expect(first.headers.get('X-WAMP-Cache')).toBe('miss');
    expect([...stored.keys()]).toEqual([`https://api.wamp.land/api/wamp-o-grams/${slug}/preview.png?v=1`]);
    const drawn = await bytesOf(first);

    const second = await preview(slug!);
    expect(second.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(second.headers.get('Cache-Control')).toBe(IMMUTABLE);
    expect((await bytesOf(second)).equals(drawn)).toBe(true);

    // Old links without the version share the stored image, but a later version may redraw it.
    for (const path of ['preview.png', 'preview?v=0']) {
      const old = await preview(slug!, path);
      expect(old.headers.get('X-WAMP-Cache')).toBe('hit');
      expect(old.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=3600');
    }
    expect(stored.size).toBe(1);
  });

  it('answers HEAD without drawing or storing anything', async () => {
    const { slug } = await create(room());
    const head = await preview(slug!, 'preview.png?v=1', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers.get('Cache-Control')).toBe(IMMUTABLE);
    expect(head.body).toBeNull();
    expect(stored.size).toBe(0);
  });

  it('stops serving a deleted gram\'s preview even though the cache still holds it', async () => {
    const { slug } = await create(room());
    expect((await preview(slug!)).status).toBe(200);
    expect((await remove(slug!)).status).toBe(200);

    expect(stored.size).toBe(1);
    await expect(preview(slug!)).rejects.toMatchObject({ status: 404 });
    await expect(preview(slug!, 'preview.png?v=1', 'HEAD')).rejects.toMatchObject({ status: 404 });
  });
});
