import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExpandedRoomRepository } from './repository';
import { createCourseRepository } from '../courses/courseRepository';
import { invalidateStaleWhileRevalidateCache } from '../api/staleWhileRevalidateCache';
vi.mock('../api/baseUrl', () => ({ getApiBaseUrl: () => 'https://fixture.invalid' }));
vi.mock('../generatedUsers/leaderboards', () => ({ filterCourseLeaderboardForCurrentSurface: (value: unknown) => value }));
afterEach(() => { vi.unstubAllGlobals(); invalidateStaleWhileRevalidateCache('leaderboard:'); });
describe('Expanded Room explicit refresh after a saved clear', () => {
  it.each(['native', 'legacy'])('bypasses both client and browser caches for %s', async kind => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ entries: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ rank: 1 }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ rank: 1 }] })));
    vi.stubGlobal('fetch', request);
    const repository = kind === 'native' ? createExpandedRoomRepository().loadExpandedRoomLeaderboard.bind(createExpandedRoomRepository())
      : createCourseRepository().loadCourseLeaderboard.bind(createCourseRepository());
    expect((await repository('whole', 3, 25)).entries).toEqual([]);
    expect((await repository('whole', 3, 25)).entries).toEqual([]);
    expect(request).toHaveBeenCalledOnce();
    expect((await repository('whole', 3, 25, true)).entries).toEqual([{ rank: 1 }]);
    expect(request.mock.calls[1][1]).toMatchObject({ cache: 'no-store', credentials: 'include' });
    // The old empty board cannot return on the next ordinary read.
    expect((await repository('whole', 3, 25)).entries).toEqual([{ rank: 1 }]);
  });
});
