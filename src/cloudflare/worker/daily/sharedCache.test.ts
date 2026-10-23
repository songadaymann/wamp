import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, run, NOW } from '../activity/testDatabase';
import { refreshPlayableContentIndexForRoom } from '../playableContentIndex/store';
import { createSession } from '../auth/store';
import type { WorkerExecutionContextLike } from '../core/types';
import type { DailyResponse } from '../../../daily/model';
import { ensureDailyPick, loadDailyResponse } from './store';
import { handleAdminDaily, handleDaily } from './routes';

let f: ReturnType<typeof fixture>;
let stored: Map<string, { response: Response; expires: number }>;
let pending: Promise<unknown>[];
let context: WorkerExecutionContextLike;
let statements: string[];
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); f = fixture();
  f.sqlite.exec("UPDATE rooms SET last_published_by_user_id='builder',last_published_by_display_name='builder' WHERE id='0,0'");
  await refreshPlayableContentIndexForRoom(f.env, '0,0');
  run(f, 'seed'); await ensureDailyPick(f.env, NOW);
  stored = new Map(); pending = []; context = { waitUntil(promise) { pending.push(promise); } };
  vi.stubGlobal('caches', { default: {
    async match(key: Request) { const value = stored.get(key.url); return value && value.expires > Date.now() ? value.response.clone() : undefined; },
    async put(key: Request, response: Response) {
      const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')?.[1] ?? 0);
      stored.set(key.url, { response: response.clone(), expires: Date.now() + maxAge * 1000 });
    },
    async delete(key: Request) { return stored.delete(key.url); },
  } });
  statements = [];
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => { statements.push(sql.replace(/\s+/g, ' ').trim()); return prepare(sql); };
});
afterEach(() => { f.sqlite.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** One /api/daily request through the edge cache, with the D1 statements it ran. */
async function daily(token?: string) {
  const request = new Request('https://api.wamp.land/api/daily', { headers: token ? { Cookie: `ep_session=${token}` } : {} });
  statements.length = 0;
  const response = await handleDaily(request, f.env, context);
  const ran = [...statements];
  await Promise.all(pending);
  return { cache: response.headers.get('X-WAMP-Cache'), body: await response.json() as DailyResponse, statements: ran };
}
const kind = (sql: string) => sql.includes('FROM sessions') ? 'session' : sql.includes('FROM pxp_events') ? 'completions'
  : sql.startsWith('WITH accepted') ? 'board' : sql;

describe('Room of the Day shared cache (F331)', () => {
  it('answers repeat guest reads from the cache with no database trips and the same body', async () => {
    const first = await daily();
    expect(first.cache).toBe('miss'); expect(first.statements).toHaveLength(4);
    expect(first.body).toEqual(await loadDailyResponse(f.env, null, NOW));
    const second = await daily();
    expect(second.cache).toBe('hit'); expect(second.statements).toEqual([]); expect(second.body).toEqual(first.body);
    // Thirty seconds on, or on a new UTC day, the shared part is read again.
    vi.setSystemTime(new Date(Date.parse(NOW) + 31_000)); expect((await daily()).cache).toBe('miss');
    vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z')); const tomorrow = await daily();
    expect(tomorrow.cache).toBe('miss'); expect(tomorrow.body.date).toBe('2026-10-05');
  });

  it('reads only a signed-in viewer\'s own completion and rank on a hit, matching an uncached read', async () => {
    run(f, 'p2-run', 'p2', 12000); const token = await createSession(f.env, 'p2');
    await daily();
    const signed = await daily(token);
    expect(signed.cache).toBe('hit');
    // The session lookup, then the viewer's completions and board row: no pick, history or availability reads.
    expect(signed.statements.map(kind)).toEqual(['session', 'completions', 'board']);
    expect(signed.body).toEqual(await loadDailyResponse(f.env, 'p2', NOW));
    expect(signed.body.viewer).toMatchObject({ rank: 2 });
  });

  it('reads the board fresh when the viewer\'s own newer clear is missing from the cached one', async () => {
    const token = await createSession(f.env, 'p2');
    expect((await daily()).body.leaderboard.map(entry => entry.userId)).toEqual(['p1']);
    run(f, 'p2-fast', 'p2', 5000);
    const signed = await daily(token);
    expect(signed.body.leaderboard.map(entry => [entry.rank, entry.userId])).toEqual([[1, 'p2'], [2, 'p1']]);
    expect(signed.body.viewer?.rank).toBe(1);
    expect(signed.body).toEqual(await loadDailyResponse(f.env, 'p2', NOW));
    // Everyone else sees the new clear within the 30-second lifetime.
    expect((await daily()).body.leaderboard).toHaveLength(1);
    vi.setSystemTime(new Date(Date.parse(NOW) + 31_000));
    expect((await daily()).body.leaderboard).toHaveLength(2);
  });

  it('drops this location\'s cached day when an admin repicks it', async () => {
    const yesterday = '2026-10-03T12:00:00.000Z';
    const json = JSON.stringify({ ...f.record.published, id: '1,0', coordinates: { x: 1, y: 0 }, title: 'Second Level' });
    f.sqlite.prepare(`INSERT INTO rooms (id,x,y,draft_json,published_json,published_title,claimer_user_id,last_published_by_user_id,last_published_by_display_name)
      VALUES ('1,0',1,0,?,?,'Second Level','builder','builder','builder')`).run(json, json);
    f.sqlite.prepare("INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at,published_by_user_id) VALUES ('1,0',1,?,'Second Level',?,'builder')").run(json, NOW);
    f.sqlite.prepare(`INSERT INTO room_runs (attempt_id,room_id,room_x,room_y,room_version,goal_type,goal_json,user_id,user_display_name,started_at,finished_at,result,elapsed_ms,verification_status)
      VALUES ('second-clear','1,0',1,0,1,'reach_exit','{"type":"reach_exit"}','p1','p1',?,?,'completed',9000,'passed')`).run(yesterday, yesterday);
    await refreshPlayableContentIndexForRoom(f.env, '1,0');
    // Nobody has started today's challenge yet, so it can still be repicked.
    f.sqlite.prepare("UPDATE room_runs SET started_at = ? WHERE attempt_id = 'seed'").run(yesterday);
    expect((await daily()).body.pick?.roomId).toBe('0,0'); expect((await daily()).cache).toBe('hit');
    f.env.ADMIN_API_KEY = 'admin-test';
    const admin = await handleAdminDaily(new Request('https://api.wamp.land/api/admin/daily', { method: 'PUT',
      headers: { 'x-admin-key': 'admin-test', Origin: 'https://wamp.land', 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: '1,0' }) }), f.env);
    expect((await admin.json() as DailyResponse).pick?.roomId).toBe('1,0');
    const after = await daily();
    expect(after.cache).toBe('miss'); expect(after.body.pick).toMatchObject({ roomId: '1,0', title: 'Second Level' });
  });

  it('keeps uncached reads (no edge cache) unchanged', async () => {
    vi.unstubAllGlobals();
    const request = new Request('https://api.wamp.land/api/daily');
    const response = await handleDaily(request, f.env, context);
    expect(response.headers.get('X-WAMP-Cache')).toBe('bypass');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual(await loadDailyResponse(f.env, null, NOW));
  });
});
