import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_DISCOVERY_SORTS } from '../../../runs/model';
import { discoveryFixture } from './discoveryTestDatabase';
import { DiscoveryPublicCache } from './discoveryPublicCache';
import { loadRoomDiscoveryResponse, encodeRoomDiscoveryCursor } from './difficulty';
import { handleRoomDiscovery } from './routes';
import { createSession, hashToken } from '../auth/store';
import { NOW } from '../activity/testDatabase';
import type { WorkerExecutionContextLike } from '../core/types';

let f: ReturnType<typeof discoveryFixture>;
let stored: Map<string, { response: Response; expires: number }>;
let keys: Request[];
let pending: Promise<unknown>[];
let context: WorkerExecutionContextLike;
function req(sort = 'unrated', token?: string, query = '') {
  const params = new URLSearchParams(query);
  params.set('sort', sort); if (!params.has('limit')) params.set('limit', '2');
  return new Request(`https://api.wamp.land/api/leaderboards/rooms/discover?${params}`, {
    headers: { Origin: 'https://wamp.land', ...(token ? { Cookie: `ep_session=${token}` } : {}) },
  });
}
async function read(sort = 'unrated', token?: string, query = '') {
  const request = req(sort, token, query);
  const response = await handleRoomDiscovery(request, new URL(request.url), f.env, context);
  await Promise.all(pending);
  return { response, body: await response.json() };
}
beforeEach(() => {
  f = discoveryFixture(); stored = new Map(); keys = []; pending = [];
  context = { waitUntil(promise) { pending.push(promise); } };
  vi.stubGlobal('caches', { default: {
    async match(key: Request) { keys.push(key); const value = stored.get(key.url); return value && value.expires > Date.now() ? value.response.clone() : undefined; },
    async put(key: Request, response: Response) { stored.set(key.url, { response: response.clone(), expires: Date.now() + 20_000 }); },
  } });
});
afterEach(() => { f.sqlite.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('cached public discovery inputs and fresh private filtering', () => {
  it.each([false, true])('matches uncached pages for every sort, viewer and difficulty; index=%s', async index => {
    f.env.PLAYABLE_CONTENT_INDEX_READS = index ? '1' : '0';
    for (const sort of ROOM_DISCOVERY_SORTS) for (const viewer of ['p1', 'p2', null]) {
      if (viewer === null && ['unrated', 'unvisited', 'unbeaten'].includes(sort)) continue;
      for (const difficulty of [null, 'easy'] as const) for (const offset of [0, 2, 8]) {
        const ordinary = await loadRoomDiscoveryResponse(f.env, difficulty, 2, sort, sort === 'newest', viewer, null, offset);
        const cache = new DiscoveryPublicCache(req(sort), f.env, context);
        const cached = await loadRoomDiscoveryResponse(f.env, difficulty, 2, sort, sort === 'newest', viewer, null, offset, cache);
        await Promise.all(pending); expect(cached, `${sort}/${viewer}/${difficulty}/${offset}`).toEqual(ordinary);
      }
    }
  });
  it.each([false, true])('shares protection metadata with a 20-second lifetime and refreshes without leaking private state; index=%s', async index => {
    vi.useFakeTimers(); f.env.PLAYABLE_CONTENT_INDEX_READS = index ? '1' : '0';
    const a = await createSession(f.env, 'p1'), b = await createSession(f.env, 'p2');
    await read('newest', a, '&limit=200');
    f.sqlite.prepare("UPDATE rooms SET minted_token_id='42' WHERE id='1,0'").run();
    const warm = await read('newest', b, '&limit=200');
    expect(warm.response.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(warm.body.results.find((r: { roomId: string }) => r.roomId === '1,0')).not.toHaveProperty('protectedCellCount');
    const fresh = await read('newest', b, '&limit=200&fresh=1');
    expect(fresh.response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(fresh.body.results.find((r: { roomId: string }) => r.roomId === '1,0').protectedCellCount).toBe(1);
    vi.advanceTimersByTime(20_001);
    const expired = await read('newest', undefined, '&limit=200');
    expect(expired.response.headers.get('X-WAMP-Cache')).toBe('miss');
    expect(expired.body.results.find((r: { roomId: string }) => r.roomId === '1,0')).toMatchObject({ protectedCellCount: 1, viewerState: null });
    expect(expired.response.headers.get('Cache-Control')).toBe('public, max-age=20');
  });
  it('shares the candidate pool between users and personal sorts, without caching their history', async () => {
    const a = await createSession(f.env, 'p1'), b = await createSession(f.env, 'p2');
    expect((await read('unrated', a)).response.headers.get('X-WAMP-Cache')).toBe('miss');
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    const other = await read('unvisited', b);
    expect(other.response.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(other.response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prepare.mock.calls.some(([sql]) => sql.includes('MAX(version)'))).toBe(false);
    expect(prepare.mock.calls.some(([sql]) => sql.includes('FROM room_runs') && sql.includes('WHERE user_id = ?'))).toBe(true);
    for (const key of keys) { expect([...key.headers]).toEqual([]); expect(key.url).not.toContain('ep_session'); }
    for (const value of stored.values()) {
      const json = await value.response.clone().text();
      expect(json).not.toContain('viewerState'); expect(json).not.toContain('completed_count'); expect(json).not.toContain('token_hash');
      expect(value.response.headers.get('Cache-Control')).toBe('public, max-age=20');
    }
  });
  it('filters before pagination, counts unrated results before slicing, and excludes the builder', async () => {
    const token = await createSession(f.env, 'p1'); const seen: string[] = []; let cursor: string | undefined;
    do {
      const { body } = await read('unrated', token, cursor ? '&cursor=' + cursor : '');
      expect(body.totalCount).toBe(3); expect(body.results.length).toBeGreaterThan(0);
      for (const entry of body.results) { expect(entry.viewerState).toMatchObject({ completed: true, rated: false }); seen.push(entry.roomId); }
      cursor = body.nextCursor;
    } while (cursor);
    expect(new Set(seen)).toEqual(new Set(['1,0', '7,0', '9,0'])); expect(seen).toHaveLength(3);
  });
  it('updates run/rating history on a warm hit and keeps other users isolated', async () => {
    const a = await createSession(f.env, 'p1'), b = await createSession(f.env, 'p2');
    const before = await read('unrated', a); expect(before.body.totalCount).toBe(3);
    f.rate('p1', 1);
    const rated = await read('unrated', a); expect(rated.response.headers.get('X-WAMP-Cache')).toBe('hit'); expect(rated.body.totalCount).toBe(2);
    f.history('new-clear', 'p1', 11);
    expect((await read('unrated', a)).body.totalCount).toBe(3);
    expect((await read('unrated', b)).body.totalCount).toBe(1);
  });
  it('keeps the current room/Expanded Room version history separate from old versions and cell runs', async () => {
    f.history('cell-run', 'p2', 7); const token = await createSession(f.env, 'p2');
    const { body } = await read('unbeaten', token, '&limit=200');
    expect(body.results.find((entry: { roomId: string }) => entry.roomId === '7,0').viewerState.completed).toBe(false);
    const a = await createSession(f.env, 'p1');
    const p1 = (await read('unvisited', a, '&limit=200')).body;
    expect(p1.results.some((entry: { roomId: string }) => entry.roomId === '6,0')).toBe(true);
    expect(p1.results.some((entry: { roomId: string }) => entry.roomId === '5,0')).toBe(false);
  });
  it.each([false, true])('shares public indexed/legacy pages with neutral guest state; index=%s', async index => {
    f.env.PLAYABLE_CONTENT_INDEX_READS = index ? '1' : '0';
    await read('newest'); const token = await createSession(f.env, 'p1');
    const signed = await read('newest', token);
    expect(signed.response.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(signed.body.results.every((entry: { viewerState: unknown }) => entry.viewerState !== null)).toBe(true);
    expect((await read('newest')).body.results.every((entry: { viewerState: unknown }) => entry.viewerState === null)).toBe(true);
  });
  it('bypasses both cache reads and writes on fresh requests and expires entries after 20 seconds', async () => {
    vi.useFakeTimers(); const token = await createSession(f.env, 'p1'); await read('unrated', token);
    const calls = keys.length, count = stored.size;
    const fresh = await read('unrated', token, '&fresh=1');
    expect(fresh.response.headers.get('X-WAMP-Cache')).toBe('bypass'); expect(keys).toHaveLength(calls); expect(stored.size).toBe(count);
    vi.advanceTimersByTime(20_001); expect((await read('unrated', token)).response.headers.get('X-WAMP-Cache')).toBe('miss');
  });
  it('partitions public data by feature flags and by indexed filters/pages', async () => {
    f.env.PLAYABLE_CONTENT_INDEX_READS = '1'; await read('newest');
    expect((await read('newest', undefined, '&cursor=' + encodeRoomDiscoveryCursor('newest', 2))).response.headers.get('X-WAMP-Cache')).toBe('miss');
    expect((await read('newest', undefined, '&difficulty=easy')).response.headers.get('X-WAMP-Cache')).toBe('miss');
    f.env.EXPANDED_ROOMS_ENABLED = '0'; expect((await read('unvisited', await createSession(f.env, 'p1'))).response.headers.get('X-WAMP-Cache')).toBe('miss');
  });
  it('rejects guests, invalid/limited tokens and malformed cursors before shared reads; CORS remains request-specific', async () => {
    const token = await createSession(f.env, 'p1'); await read('unrated', token); const calls = keys.length;
    for (const sort of ['unrated', 'unvisited', 'unbeaten']) {
      const request = req(sort); await expect(handleRoomDiscovery(request, new URL(request.url), f.env, context)).rejects.toMatchObject({ status: 401 });
    }
    for (const [bearer, status] of [['invalid', 401], ['limited', 403]] as const) {
      if (status === 403) f.sqlite.prepare(`INSERT INTO api_tokens(id,user_id,label,token_hash,scopes_json,created_at)
        VALUES ('limited','p1','test',?,'["rooms:read"]',?)`).run(await hashToken(bearer), NOW);
      const request = new Request(req().url, { headers: { Authorization: `Bearer ${bearer}` } });
      await expect(handleRoomDiscovery(request, new URL(request.url), f.env, context)).rejects.toMatchObject({ status });
    }
    const bad = req('unrated', token, '&cursor=invalid'); await expect(handleRoomDiscovery(bad, new URL(bad.url), f.env, context)).rejects.toMatchObject({ status: 400 });
    expect(keys).toHaveLength(calls);
    const request = new Request(req('unrated', token).url, { headers: { Cookie: `ep_session=${token}`, Origin: 'http://localhost:3000' } });
    const response = await handleRoomDiscovery(request, new URL(request.url), f.env, context);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
  it('retains the legacy fallback when indexed metrics are missing, and works without a cache', async () => {
    f.env.PLAYABLE_CONTENT_INDEX_READS = '1'; f.sqlite.exec('DROP TABLE discovery_run_players');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const token = await createSession(f.env, 'p1'); expect((await read('newest', token)).body.results.length).toBe(2); expect(warn).toHaveBeenCalled();
    vi.stubGlobal('caches', undefined); expect((await read('unrated', token)).response.headers.get('X-WAMP-Cache')).toBe('bypass');
  });
  it('bypasses oversized public packages without writing them', async () => {
    const cache = new DiscoveryPublicCache(req(), f.env, context);
    const value = '界'.repeat(2 * 1024 * 1024);
    expect(await cache.load('legacy', [], async () => value)).toBe(value); await Promise.all(pending);
    expect(cache.status).toBe('bypass'); expect(stored.size).toBe(0);
  });
});
