import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { createSession, hashToken } from '../auth/store';
import type { WorkerExecutionContextLike } from '../core/types';
import { LEGACY_GENERATED_DISPLAY_NAME_PREFIX, LEGACY_GENERATED_USER_LINKS_TABLE } from '../generatedUsers/legacySource';
import { buildGlobalLeaderboardResponse } from './globalLeaderboards';
import { loadGlobalLeaderboardViewer } from './globalLeaderboardViewer';
import { handleGlobalLeaderboard } from './routes';

const NOW = '2026-10-17T18:00:00.000Z';
let f: ReturnType<typeof fixture>;
let pending: Promise<unknown>[];
let stored: Map<string, Response>;
let keys: Request[];
let context: WorkerExecutionContextLike;
function stats(id: string, points = 100, name = id, clears = 5, rooms = 2) {
  f.sqlite.prepare('INSERT OR IGNORE INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, `${id}@example.test`, name, NOW, NOW);
  f.sqlite.prepare('UPDATE users SET display_name=? WHERE id=?').run(name, id);
  f.sqlite.prepare(`INSERT INTO user_stats(user_id,user_display_name,total_points,total_score,completed_runs,total_rooms_published,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(id, name, points, points * 2, clears, rooms, NOW);
}
function request(token?: string, query = '') {
  return new Request(`https://api.wamp.land/api/leaderboards/global?window=all&limit=2${query}`, {
    headers: { Origin: 'https://wamp.land', ...(token ? { Cookie: `ep_session=${token}` } : {}) },
  });
}
async function read(token?: string, query = '') {
  const req = request(token, query);
  const response = await handleGlobalLeaderboard(req, new URL(req.url), f.env, context);
  await Promise.all(pending);
  return { response, body: await response.json() };
}
beforeEach(() => {
  f = fixture(); vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
  pending = []; stored = new Map(); keys = [];
  context = { waitUntil(promise) { pending.push(promise); } };
  vi.stubGlobal('caches', { default: {
    async match(key: Request) { keys.push(key); return stored.get(key.url)?.clone(); },
    async put(key: Request, response: Response) { stored.set(key.url, response.clone()); },
  } });
});
afterEach(() => { f.sqlite.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('private lifetime rank lookup', () => {
  it('matches the original full ranking for every tie-breaker, off-list rank, neighbor and exclusion', async () => {
    const ids = [];
    for (let n = 0; n < 120; n++) {
      const id = `rank-${n.toString().padStart(3, '0')}`; ids.push(id);
      stats(id, (n * 17) % 9 - 2, ['Same', 'éclair', 'Alpha', '🦊'][n % 4], n % 3, n % 2);
    }
    stats('generated', 999); stats('prefix', 999, `${LEGACY_GENERATED_DISPLAY_NAME_PREFIX}123`);
    f.sqlite.prepare('UPDATE users SET email=NULL WHERE id=\'generated\'').run();
    f.sqlite.prepare(`INSERT INTO ${LEGACY_GENERATED_USER_LINKS_TABLE}(user_id,ogp_id,created_at,updated_at) VALUES ('generated','test',?,?)`).run(NOW, NOW);
    for (const id of [...ids, 'generated', 'prefix', 'p1', 'missing']) {
      const full = await buildGlobalLeaderboardResponse(f.env, 2, id, 'all');
      expect(await loadGlobalLeaderboardViewer(f.env, id), id).toEqual({ viewerEntry: full.viewerEntry, viewerNext: full.viewerNext });
    }
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    await loadGlobalLeaderboardViewer(f.env, 'rank-060');
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0][0]).not.toContain('ROW_NUMBER');
    const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${prepare.mock.calls[0][0]}`).all('rank-060');
    expect(JSON.stringify(plan)).toContain('idx_user_stats_total_points');
  });
});

describe('shared public base with private lifetime viewer', () => {
  async function seed() {
    stats('builder', 1000); stats('p1', 500); stats('p2', 300); stats('p3', 100);
    return Promise.all(['builder', 'p1', 'p3'].map(id => createSession(f.env, id)));
  }
  it('shares a public result across guests and distinct authenticated users without caching viewer fields', async () => {
    const [first, second, offList] = await seed();
    expect((await read()).response.headers.get('X-WAMP-Cache')).toBe('miss');
    for (const [token, id, rank] of [[first, 'builder', 1], [second, 'p1', 2], [offList, 'p3', 4]] as const) {
      const { response, body } = await read(token);
      expect(response.headers.get('X-WAMP-Cache')).toBe('hit');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(body.viewerEntry).toMatchObject({ userId: id, rank });
      expect(body.entries).toHaveLength(2);
    }
    const publicBody = await [...stored.values()][0].clone().json();
    expect(publicBody.viewerEntry).toBeNull(); expect(publicBody.viewerNext).toBeNull();
    expect(keys.every(key => [...key.headers].length === 0)).toBe(true);
    expect((await read()).body.viewerEntry).toBeNull();
  });
  it('does not query or sort the public ranking again on an unchanged signed-in cache hit', async () => {
    const [token] = await seed(); await read();
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    expect((await read(token)).response.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(prepare.mock.calls.some(([sql]) => sql.includes('ROW_NUMBER'))).toBe(false);
  });
  it('shows a changed personal score immediately even with an unchanged timestamp', async () => {
    const [, token] = await seed(); await read();
    f.sqlite.prepare('UPDATE user_stats SET total_points=2000 WHERE user_id=\'p1\'').run();
    const { response, body } = await read(token);
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(body.entries[0]).toMatchObject({ userId: 'p1', rank: 1, totalPoints: 2000 });
    expect(body.viewerEntry).toEqual(body.entries[0]);
  });
  it('refreshes the top list when an off-list viewer enters it or sits immediately below it', async () => {
    const [, , token] = await seed(); await read();
    f.sqlite.prepare('UPDATE user_stats SET total_points=700 WHERE user_id=\'p3\'').run();
    const { response, body } = await read(token);
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(body.entries[1]).toMatchObject({ userId: 'p3', rank: 2 });
    expect(body.viewerEntry).toEqual(body.entries[1]);
    f.sqlite.prepare('UPDATE user_stats SET total_points=400 WHERE user_id=\'p3\'').run();
    const below = await read(token);
    expect(below.response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(below.body.viewerEntry.rank).toBe(3);
    expect(below.body.viewerNext.userId).toBe(below.body.entries[1].userId);
  });
  it('refreshes a listed viewer when another player changes their rank or the immediate points gap', async () => {
    const [, token] = await seed(); await read();
    f.sqlite.prepare('UPDATE user_stats SET total_points=1100 WHERE user_id=\'builder\'').run();
    const { response, body } = await read(token);
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(body.viewerNext.pointsToPass).toBe(601);
    f.sqlite.prepare('UPDATE user_stats SET total_points=900 WHERE user_id=\'p2\'').run();
    const moved = await read(token);
    expect(moved.response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(moved.body.viewerEntry.rank).toBe(3);
  });
  it('keeps an unranked user private without inventing a rank or doing a full-ranking query', async () => {
    await seed(); await read(); const token = await createSession(f.env, 'generated');
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    const { body } = await read(token);
    expect(body.viewerEntry).toBeNull(); expect(body.viewerNext).toBeNull();
    expect(prepare.mock.calls.some(([sql]) => sql.includes('ROW_NUMBER'))).toBe(false);
  });
  it.each([false, true])('bypasses both read and write caching on explicit refresh; authenticated=%s', async signed => {
    const [token] = await seed(); await read();
    const { response } = await read(signed ? token : undefined, '&fresh=1');
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(keys).toHaveLength(1); expect(stored.size).toBe(1);
  });
  it('retains a single fresh ranking query if the edge cache is unavailable', async () => {
    const [token] = await seed(); vi.stubGlobal('caches', undefined);
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    const { response } = await read(token);
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('ROW_NUMBER'))).toHaveLength(1);
    expect(prepare.mock.calls.some(([sql]) => sql.includes('WITH viewer AS'))).toBe(false);
  });
  it('reapplies CORS and checks invalid tokens and token scopes before warmed cache access', async () => {
    await seed(); await read();
    const local = new Request(request().url, { headers: { Origin: 'http://localhost:3000' } });
    const response = await handleGlobalLeaderboard(local, new URL(local.url), f.env, context);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    for (const [token, status] of [['invalid', 401], ['limited', 403]] as const) {
      if (status === 403) f.sqlite.prepare(`INSERT INTO api_tokens(id,user_id,label,token_hash,scopes_json,created_at)
        VALUES ('limited','builder','test',?,'["rooms:read"]',?)`).run(await hashToken(token), NOW);
      const req = new Request(request().url, { headers: { Authorization: `Bearer ${token}` } });
      const calls = keys.length;
      await expect(handleGlobalLeaderboard(req, new URL(req.url), f.env, context)).rejects.toMatchObject({ status });
      expect(keys).toHaveLength(calls);
    }
  });
});
