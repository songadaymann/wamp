import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env, WorkerExecutionContextLike } from '../core/types';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), room: vi.fn(), selection: vi.fn(), board: vi.fn(), cache: vi.fn() }));
vi.mock('../auth/request', () => ({ loadOptionalRequestAuth: mocks.auth, requireOptionalScope: vi.fn() }));
vi.mock('../rooms/store', () => ({ loadRoomRecord: mocks.room }));
vi.mock('./roomLeaderboardAggregation', () => ({ resolveAggregatedRoomLeaderboardSelection: mocks.selection }));
vi.mock('./leaderboards', () => ({ buildRoomLeaderboardResponse: mocks.board }));
vi.mock('../core/publicCache', () => ({ loadAnonymousPublicCache: mocks.cache }));
import { handleRoomLeaderboard } from './routes';
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue(null); mocks.room.mockResolvedValue({});
  mocks.selection.mockReturnValue({ snapshot: { goal: { type: 'reach_exit' } } });
  mocks.board.mockResolvedValue({ entries: [{ attemptId: 'new-clear' }] });
  mocks.cache.mockImplementation((_request, _context, load) => load());
});
describe('fresh room leaderboard responses', () => {
  it.each([false, true])('serves a post-clear lookup without HTTP or edge reuse, signed in: %s', async signedIn => {
    if (signedIn) mocks.auth.mockResolvedValue({ user: { id: 'viewer', walletAddress: null } });
    const request = new Request('https://api.wamp.land/api/leaderboards/rooms/1%2C2?version=1&fresh=1');
    const response = await handleRoomLeaderboard(request, new URL(request.url), {} as Env, '1,2', {} as WorkerExecutionContextLike);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.cache.mock.calls[0][1]).toBeUndefined();
    expect((await response.json()).entries[0].attemptId).toBe('new-clear');
  });
  it('retains the ordinary anonymous cache outside a recent clear', async () => {
    const context = {} as WorkerExecutionContextLike;
    const request = new Request('https://api.wamp.land/api/leaderboards/rooms/1%2C2?version=1');
    const response = await handleRoomLeaderboard(request, new URL(request.url), {} as Env, '1,2', context);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=20');
    expect(mocks.cache.mock.calls[0][1]).toBe(context);
  });
});
