import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api/baseUrl', () => ({ getApiBaseUrl: () => 'https://private.example.test' }));
import { createRunRepository } from './runRepository';
afterEach(() => vi.unstubAllGlobals());
describe('personal discovery session isolation', () => {
  it.each(['unrated', 'unbeaten', 'unvisited'] as const)('never reuses %s results after an account switch or sign-out', async sort => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ sort, results: [{ roomId: 'account-a-clear' }] }))
      .mockResolvedValueOnce(Response.json({ sort, results: [{ roomId: 'account-b-clear' }] }))
      .mockResolvedValueOnce(Response.json({ error: 'Sign in' }, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const repo = createRunRepository();
    expect((await repo.loadRoomDiscovery(null, sort)).results[0]?.roomId).toBe('account-a-clear');
    expect((await repo.loadRoomDiscovery(null, sort)).results[0]?.roomId).toBe('account-b-clear');
    await expect(repo.loadRoomDiscovery(null, sort)).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [, options] of fetch.mock.calls) expect(options.credentials).toBe('include');
  });
});

describe('fresh global windows', () => {
  it('keeps accounts and Monday rollovers out of the shared cache and preserves period metadata', async () => {
    const week = { window: 'week', period: { startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z' }, serverTime: '2026-10-05T18:00:00.000Z', entries: [], viewerEntry: null, viewerNext: null };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(week)).mockResolvedValueOnce(Response.json({ ...week, serverTime: '2026-10-05T19:00:00.000Z' }));
    vi.stubGlobal('fetch', fetch); const repo = createRunRepository(), abort = new AbortController();
    expect(await repo.loadGlobalLeaderboard(25, 'week', abort.signal)).toEqual(week);
    expect((await repo.loadGlobalLeaderboard(25, 'week')).serverTime).toBe('2026-10-05T19:00:00.000Z');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain('window=week');
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'include', signal: abort.signal });
  });
  it('rejects a legacy lifetime response instead of displaying lifetime points as weekly points', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ entries: [], viewerEntry: null })));
    await expect(createRunRepository().loadGlobalLeaderboard(25, 'week')).rejects.toThrow('This Week is unavailable');
  });
});
