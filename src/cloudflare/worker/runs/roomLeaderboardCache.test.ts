import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, run, NOW } from '../activity/testDatabase';
import { createSession, hashToken } from '../auth/store';
import type { WorkerExecutionContextLike } from '../core/types';
import { LEGACY_GENERATED_USER_LINKS_TABLE } from '../generatedUsers/legacySource';
import { createDefaultRoomGoal, type RoomGoal } from '../../../goals/roomGoals';
import { loadViewerRankedRoomLeaderboardRow, mapRankedRoomLeaderboardEntry } from './leaderboards';
import { loadRoomLeaderboardViewer } from './roomLeaderboardCache';
import { resolveAggregatedRoomLeaderboardSelection } from './roomLeaderboardAggregation';
import { handleRoomLeaderboard } from './routes';

let f: ReturnType<typeof fixture>;
let pending: Promise<unknown>[];
let stored: Map<string, Response>;
let keys: Request[];
let context: WorkerExecutionContextLike;
const request = (token?: string, query = '') => new Request(`https://api.wamp.land/api/leaderboards/rooms/0%2C0?limit=2${query}`, {
  headers: { Origin: 'https://wamp.land', ...(token ? { Cookie: `ep_session=${token}` } : {}) },
});
async function read(token?: string, query = '') {
  const req = request(token, query);
  const response = await handleRoomLeaderboard(req, new URL(req.url), f.env, '0,0', context);
  await Promise.all(pending);
  return { response, body: await response.json() };
}
async function seed() {
  run(f, 'first', 'builder', 1000); run(f, 'second', 'p1', 2000);
  run(f, 'third', 'p2', 3000); run(f, 'fourth', 'p3', 4000);
  return Promise.all(['builder', 'p1', 'p3'].map(id => createSession(f.env, id)));
}
beforeEach(() => {
  f = fixture(); pending = []; stored = new Map(); keys = [];
  context = { waitUntil(promise) { pending.push(promise); } };
  vi.stubGlobal('caches', { default: {
    async match(key: Request) { keys.push(key); return stored.get(key.url)?.clone(); },
    async put(key: Request, response: Response) { stored.set(key.url, response.clone()); },
  } });
});
afterEach(() => { f.sqlite.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('exact private room ranking without window functions', () => {
  it.each(['reach_exit', 'survival', 'npc_quest'] as const)('matches full ranking for %s ties, retries, families and exclusions', async type => {
    const goal: RoomGoal = createDefaultRoomGoal(type);
    const ids = Array.from({ length: 100 }, (_, n) => `rank-${n.toString().padStart(3, '0')}`);
    for (const [n, id] of ids.entries()) {
      f.sqlite.prepare('INSERT INTO users(id,display_name,created_at,updated_at) VALUES (?,?,?,?)').run(id, id, NOW, NOW);
      for (let retry = 0; retry < 3; retry++) {
        const attempt = `${id}-${retry}`;
        run(f, attempt, id, (n * 17 + retry) % 7, 'passed', n % 101 + 1);
        f.sqlite.prepare('UPDATE room_runs SET deaths=?,score=?,result=?,finished_at=? WHERE attempt_id=?')
          .run(n % 3, (n * 13 + retry) % 9, retry === 1 ? 'failed' : 'completed', `2026-10-04T17:00:0${n % 4}.000Z`, attempt);
      }
    }
    run(f, 'rejected', 'p1', 0, 'failed'); run(f, 'generated', 'generated', 0);
    f.sqlite.prepare('UPDATE users SET email=NULL WHERE id=\'generated\'').run();
    f.sqlite.prepare(`INSERT INTO ${LEGACY_GENERATED_USER_LINKS_TABLE}(user_id,ogp_id,created_at,updated_at) VALUES ('generated','test',?,?)`).run(NOW, NOW);
    const selection = resolveAggregatedRoomLeaderboardSelection(f.record, 1);
    selection.snapshot.goal = goal; selection.leaderboardFamilyVersions = Array.from({ length: 101 }, (_, i) => i + 1);
    for (const id of [...ids, 'generated', 'p1', 'p2', 'missing']) {
      const full = await loadViewerRankedRoomLeaderboardRow(f.env, '0,0', selection.leaderboardFamilyVersions, goal, id);
      expect(await loadRoomLeaderboardViewer(f.env, selection, id), id)
        .toEqual(full ? mapRankedRoomLeaderboardEntry(full, selection.snapshot) : null);
    }
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    await loadRoomLeaderboardViewer(f.env, selection, ids[50]);
    expect(prepare).toHaveBeenCalledOnce(); expect(prepare.mock.calls[0][0]).not.toContain('ROW_NUMBER');
    const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${prepare.mock.calls[0][0]}`)
      .all('0,0', JSON.stringify(selection.leaderboardFamilyVersions), ids[50], JSON.stringify(selection.leaderboardFamilyVersions));
    expect(JSON.stringify(plan)).toContain('idx_room_runs');
  });
});

describe('shared room standings, fresh room state and private viewer', () => {
  it('shares only standings across guests and distinct signed-in players', async () => {
    const tokens = await seed(); expect((await read()).response.headers.get('X-WAMP-Cache')).toBe('miss');
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    for (const [index, id, rank] of [[0, 'builder', 1], [1, 'p1', 2], [2, 'p3', 4]] as const) {
      const { response, body } = await read(tokens[index]);
      expect(response.headers.get('X-WAMP-Cache')).toBe('hit');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(body.viewerBest).toMatchObject({ userId: id, rank }); expect(body.viewerRank).toBe(rank);
    }
    expect(prepare.mock.calls.some(([sql]) => sql.includes('ROW_NUMBER'))).toBe(false);
    const cached = await [...stored.values()][0].clone().json();
    expect(Array.isArray(cached)).toBe(true); expect(cached).toHaveLength(2);
    expect(Object.keys(cached[0])).not.toContain('viewerBest');
    for (const key of keys) { expect([...key.headers]).toEqual([]); expect(key.url).not.toContain('ep_session'); }
    expect((await read()).body.viewerBest).toBeNull();
  });
  it('reads new room titles and ratings even while the standings hit stays warm', async () => {
    const [, token] = await seed(); await read();
    f.sqlite.prepare('UPDATE rooms SET published_json=json_set(published_json,\'$.title\',\'New title\')').run();
    f.sqlite.prepare(`INSERT INTO room_ratings(room_id,lineage_key,version_key,user_id,quality_stars,difficulty_choice,auto_difficulty_choice,first_rated_at,updated_at)
      VALUES ('0,0','test',1,'p1',5,'hard','medium',?,?)`).run(NOW, NOW);
    const { response, body } = await read(token);
    expect(response.headers.get('X-WAMP-Cache')).toBe('hit'); expect(body.roomTitle).toBe('New title');
    expect(body.viewerRating).toMatchObject({ qualityStars: 5, difficultyChoice: 'hard' });
    expect((await read()).body.viewerRating).toBeNull();
  });
  it('updates voting eligibility immediately after a first accepted clear, without sharing that state', async () => {
    await seed(); const token = await createSession(f.env, 'generated'); await read();
    const before = await read(token);
    expect(before.body.difficulty).toMatchObject({ viewerCanVote: false, viewerNeedsRun: true });
    run(f, 'first-clear', 'generated', 9000);
    const after = await read(token);
    expect(after.response.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(after.body.difficulty).toMatchObject({ viewerCanVote: true, viewerNeedsRun: false });
    expect(after.body.viewerBest).toMatchObject({ userId: 'generated', rank: 5 });
    expect((await read()).body.difficulty).toMatchObject({ viewerCanVote: false, viewerNeedsRun: false });
  });
  it('refreshes the whole standings when a listed result changes without a timestamp change', async () => {
    const [, token] = await seed(); await read();
    f.sqlite.prepare("UPDATE room_runs SET elapsed_ms=500 WHERE attempt_id='second'").run();
    const { response, body } = await read(token);
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(body.entries[0]).toMatchObject({ userId: 'p1', elapsedMs: 500 }); expect(body.viewerBest).toEqual(body.entries[0]);
  });
  it('refreshes when an off-list player enters the list or another run changes a listed rank', async () => {
    const [first, , offList] = await seed(); await read();
    f.sqlite.prepare("UPDATE room_runs SET elapsed_ms=500 WHERE attempt_id='fourth'").run();
    const changed = await read(offList); expect(changed.response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(changed.body.viewerBest).toEqual(changed.body.entries[0]);
    const displaced = await read(first); expect(displaced.response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(displaced.body.viewerRank).toBe(2);
  });
  it('keeps a fresh off-list personal best and an unranked player private', async () => {
    const [, , token] = await seed(); await read();
    f.sqlite.prepare("UPDATE room_runs SET elapsed_ms=3500 WHERE attempt_id='fourth'").run();
    const changed = await read(token); expect(changed.response.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(changed.body.viewerBest).toMatchObject({ rank: 4, elapsedMs: 3500 });
    const empty = await read(await createSession(f.env, 'generated'));
    expect(empty.body.viewerBest).toBeNull(); expect(empty.body.viewerRank).toBeNull();
  });
  it.each([false, true])('bypasses read/write caching on post-clear fresh requests; signed=%s', async signed => {
    const [token] = await seed(); await read();
    const { response } = await read(signed ? token : undefined, '&fresh=1');
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass'); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(keys).toHaveLength(1); expect(stored.size).toBe(1);
  });
  it('retains the ordinary single top-list query when caching is unavailable', async () => {
    const [token] = await seed(); vi.stubGlobal('caches', undefined);
    const prepare = vi.spyOn(f.env.DB, 'prepare'); const { response } = await read(token);
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('ROW_NUMBER'))).toHaveLength(1);
  });
  it('resolves the room again before a hit and refuses a withdrawn publication', async () => {
    await seed(); await read(); f.sqlite.prepare('UPDATE rooms SET published_json=NULL').run();
    const req = request(); const calls = keys.length;
    await expect(handleRoomLeaderboard(req, new URL(req.url), f.env, '0,0', context)).rejects.toMatchObject({ status: 404 });
    expect(keys).toHaveLength(calls);
  });
  it('checks auth/scope before cache reads and uses per-request CORS on a warmed hit', async () => {
    await seed(); await read();
    const req = new Request(request().url, { headers: { Origin: 'http://localhost:3000' } });
    const response = await handleRoomLeaderboard(req, new URL(req.url), f.env, '0,0', context);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    for (const [token, status] of [['invalid', 401], ['limited', 403]] as const) {
      if (status === 403) f.sqlite.prepare(`INSERT INTO api_tokens(id,user_id,label,token_hash,scopes_json,created_at)
        VALUES ('limited','builder','test',?,'["rooms:read"]',?)`).run(await hashToken(token), NOW);
      const bad = new Request(request().url, { headers: { Authorization: `Bearer ${token}` } }); const calls = keys.length;
      await expect(handleRoomLeaderboard(bad, new URL(bad.url), f.env, '0,0', context)).rejects.toMatchObject({ status });
      expect(keys).toHaveLength(calls);
    }
  });
  it('changes the cache key when the selected leaderboard family changes', async () => {
    await seed(); await read();
    const snapshot = { ...f.record.published!, version: 2, goal: createDefaultRoomGoal('survival') };
    f.sqlite.prepare('INSERT INTO room_versions(room_id,version,snapshot_json,title,created_at) VALUES (\'0,0\',2,?,?,?)')
      .run(JSON.stringify(snapshot), snapshot.title, NOW);
    f.sqlite.prepare('UPDATE rooms SET published_json=?').run(JSON.stringify(snapshot));
    const { response, body } = await read(); expect(response.headers.get('X-WAMP-Cache')).toBe('miss');
    expect(body.goalType).toBe('survival'); expect(body.roomVersion).toBe(2); expect(stored.size).toBe(2);
    expect(body.entries).toEqual([]);
  });
});
