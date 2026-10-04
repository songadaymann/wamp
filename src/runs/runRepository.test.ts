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
