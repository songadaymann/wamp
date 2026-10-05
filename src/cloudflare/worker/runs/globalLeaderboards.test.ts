import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { buildGlobalLeaderboardResponse, loadViewerRankedGlobalLeaderboardRow, parseGlobalLeaderboardWindow } from './globalLeaderboards';
import { handleGlobalLeaderboard } from './routes';
import { globalLeaderboardWeek } from '../../../runs/globalLeaderboardWindow';
import { LEGACY_GENERATED_USER_LINKS_TABLE, LEGACY_GENERATED_DISPLAY_NAME_PREFIX } from '../generatedUsers/legacySource';

const NOW = '2026-10-05T18:00:00.000Z';
let f: ReturnType<typeof fixture>;
function user(id: string, lifetime = 1000, name = id, email: string | null = `${id}@example.test`) {
  f.sqlite.prepare('INSERT OR IGNORE INTO users (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, email, name, NOW, NOW);
  f.sqlite.prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?').run(name, email, id);
  f.sqlite.prepare('INSERT INTO user_stats (user_id,user_display_name,total_points,completed_runs,total_rooms_published,updated_at) VALUES (?,?,?,100,20,?)').run(id, name, lifetime, NOW);
}
function points(id: string, userId: string, amount: number, at = NOW, kind = 'run_completed') {
  f.sqlite.prepare('INSERT INTO point_events (id,user_id,event_type,source_key,points,created_at) VALUES (?,?,?,?,?,?)').run(id, userId, kind, id, amount, at);
}
beforeEach(() => { f = fixture(); vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { f.sqlite.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('global points windows on the fully migrated database', () => {
  it('uses Monday UTC across DST, Sunday and year boundaries', () => {
    for (const [now, start, end] of [
      ['2026-10-04T23:59:59.999Z', '2026-09-28', '2026-10-05'],
      ['2026-10-05T00:00:00.000Z', '2026-10-05', '2026-10-12'],
      ['2026-11-01T06:30:00.000Z', '2026-10-26', '2026-11-02'],
      ['2027-01-01T00:00:00.000Z', '2026-12-28', '2027-01-04'],
    ]) expect(globalLeaderboardWeek(new Date(now))).toEqual({ startsAt: `${start}T00:00:00.000Z`, endsAt: `${end}T00:00:00.000Z` });
  });
  it('sums points, including publishing, within exact bounds; ignores PXP, old and future events', async () => {
    user('builder', 100000); user('p1', 50); user('p2', 2000);
    points('publish', 'builder', 300, '2026-10-05T00:00:00.000Z', 'room_first_published');
    points('clear', 'p1', 400); points('old', 'builder', 999, '2026-10-04T23:59:59.999Z');
    points('future', 'builder', 9999, '2026-10-05T18:00:00.001Z'); points('next', 'builder', 9999, '2026-10-12T00:00:00.000Z');
    f.sqlite.prepare("INSERT INTO pxp_events (id,user_id,event_type,source_type,source_id,dedupe_key,amount,created_at) VALUES ('pxp','p2','clear','room','0,0','pxp',99999,?)").run(NOW);
    const response = await buildGlobalLeaderboardResponse(f.env, 25, 'builder', 'week');
    expect(response.entries.map(row => [row.userId, row.pointsInWindow])).toEqual([['p1', 400], ['builder', 300]]);
    expect(response.viewerEntry).toMatchObject({ rank: 2, totalPoints: 100000, pointsInWindow: 300 });
    expect(response.viewerNext).toEqual({ userId: 'p1', userDisplayName: 'p1', pointsToPass: 101 });
    expect(response.period).toEqual({ startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z' });
    const next = await buildGlobalLeaderboardResponse(f.env, 25, 'p1', 'week', new Date('2026-10-12T00:00:00.000Z'));
    expect(next.entries.map(row => row.userId)).toEqual(['builder']); expect(next.viewerEntry).toBeNull();
  });
  it('keeps exact off-list rank and immediate gap in one bounded snapshot', async () => {
    for (let n = 1; n <= 60; n++) { const id = `actor-${n}`; user(id, n * 1000); points(id, id, 61 - n); }
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    const response = await buildGlobalLeaderboardResponse(f.env, 25, 'actor-40', 'week');
    expect(prepare).toHaveBeenCalledOnce(); expect(response.entries).toHaveLength(25);
    expect(response.viewerEntry).toMatchObject({ rank: 40, pointsInWindow: 21 });
    expect(response.viewerNext).toEqual({ userId: 'actor-39', userDisplayName: 'actor-39', pointsToPass: 2 });
    expect(response.entries.some(row => row.userId === 'actor-39')).toBe(false);
  });
  it('preserves both generated exclusions without excluding ordinary email-less players', async () => {
    user('generated', 10000, 'Renamed', null); user('prefix', 10000, `${LEGACY_GENERATED_DISPLAY_NAME_PREFIX}123`);
    user('wallet', 100, 'Wallet', null); user('ordinary', 100, 'Ordinary', null);
    f.sqlite.prepare(`INSERT INTO ${LEGACY_GENERATED_USER_LINKS_TABLE} (user_id,ogp_id,created_at,updated_at) VALUES ('generated','fixture',?,?)`).run(NOW, NOW);
    f.sqlite.prepare("UPDATE users SET wallet_address = 'fixture-wallet' WHERE id = 'wallet'").run();
    for (const id of ['generated', 'prefix', 'wallet', 'ordinary']) points(id, id, 100);
    for (const window of ['all', 'week'] as const) {
      const response = await buildGlobalLeaderboardResponse(f.env, 25, 'generated', window);
      expect(response.entries.map(row => row.userId)).toEqual(['ordinary', 'wallet']); expect(response.viewerEntry).toBeNull();
    }
  });
  it('breaks weekly ties without lifetime advantages; zero/reversed points and guests have no viewer rank', async () => {
    user('a', 1, 'Same'); user('b', 999999, 'Same'); user('zero');
    points('a', 'a', 10); points('b', 'b', 10); points('z1', 'zero', 10); points('z2', 'zero', -10);
    const week = await buildGlobalLeaderboardResponse(f.env, 25, 'b', 'week');
    expect(week.entries.map(row => row.userId)).toEqual(['a', 'b']); expect(week.viewerNext?.pointsToPass).toBe(1);
    expect((await buildGlobalLeaderboardResponse(f.env, 25, 'zero', 'week')).viewerEntry).toBeNull();
    expect((await buildGlobalLeaderboardResponse(f.env, 25, null, 'week')).viewerEntry).toBeNull();
    expect((await loadViewerRankedGlobalLeaderboardRow(f.env, 'b'))?.overall_rank).toBe(1);
    expect((await buildGlobalLeaderboardResponse(f.env, 1)).entries[0]?.userId).toBe('b');
  });
  it('uses the existing time index, rejects unknown windows and bypasses the public cache for weekly reads', async () => {
    const plan = f.sqlite.prepare('EXPLAIN QUERY PLAN SELECT user_id,SUM(points) FROM point_events WHERE created_at >= ? AND created_at < ? GROUP BY user_id').all('2026-10-05', '2026-10-12');
    expect(JSON.stringify(plan)).toContain('idx_point_events_created_user');
    expect(parseGlobalLeaderboardWindow(null)).toBe('all'); expect(() => parseGlobalLeaderboardWindow('month')).toThrow('all or week');
    const match = vi.fn(() => { throw new Error('Weekly request entered public cache'); });
    vi.stubGlobal('caches', { default: { match } });
    const request = new Request('https://api.example.test/api/leaderboards/global?window=week');
    const response = await handleGlobalLeaderboard(request, new URL(request.url), f.env, { waitUntil: vi.fn() });
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(match).not.toHaveBeenCalled(); expect(await response.json()).toMatchObject({ window: 'week', entries: [], viewerEntry: null });
  });
});
