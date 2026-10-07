import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecentTopGhost, loadRoomGhosts, notifyGhostBestUpdated, subscribeGhostBestUpdates } from './ghostRepository';
import type { RunGhost } from './ghostRace';
const ghost: RunGhost = { schemaVersion: 1, attemptId: 'record', roomId: '1,2', roomVersion: 1,
  displayName: 'Leader', avatarId: 'default-player', elapsedMs: 1000, points: [
    { atMs: 0, roomX: 1, roomY: 2, x: 0, y: 100, vx: 100, vy: 0, grounded: true, snap: false },
    { atMs: 1000, roomX: 1, roomY: 2, x: 100, y: 100, vx: 100, vy: 0, grounded: true, snap: false },
  ] };
const response = (personal: RunGhost | null = null) => ({ roomId: '1,2', roomVersion: 1,
  top: { ghost, reason: null }, personal: { ghost: personal, reason: personal ? null : 'sign_in' } });
const load = (signal = new AbortController().signal) => loadRoomGhosts('1,2', 1, { x: 1, y: 2 }, signal);
beforeEach(() => notifyGhostBestUpdated('1,2'));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('recent public records and saved-best refresh', () => {
  it('reuses only the public top recording, and fetches personal bests for each session', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(response({ ...ghost, attemptId: 'account-a' })))
      .mockResolvedValueOnce(Response.json(response({ ...ghost, attemptId: 'account-b' }))); vi.stubGlobal('fetch', fetch);
    expect((await load()).personal.ghost?.attemptId).toBe('account-a');
    expect(getRecentTopGhost('1,2', 1)?.attemptId).toBe('record');
    expect(getRecentTopGhost('1,2', 2)).toBeNull();
    expect((await load()).personal.ghost?.attemptId).toBe('account-b');
    for (const [, options] of fetch.mock.calls) expect(options).toMatchObject({ cache: 'no-store', credentials: 'include' });
  });
  it('expires a recent record and invalidates every target version of a saved room', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000); vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
    await load(); vi.setSystemTime(131_000);
    expect(getRecentTopGhost('1,2', 1)).toBeNull();
    await load(); notifyGhostBestUpdated('1,2');
    expect(getRecentTopGhost('1,2', 1)).toBeNull();
  });
  it('never warms the quick-return cache from a response started before a successful save or after cancellation', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const stale = load(); notifyGhostBestUpdated('1,2'); resolve(Response.json(response())); await stale;
    expect(getRecentTopGhost('1,2', 1)).toBeNull();
    const abort = new AbortController(), cancelled = load(abort.signal); abort.abort(); resolve(Response.json(response())); await cancelled;
    expect(getRecentTopGhost('1,2', 1)).toBeNull();
  });
  it('notifies only matching open rooms and stops notifying a closed room', () => {
    const listener = vi.fn(), unsubscribe = subscribeGhostBestUpdates('1,2', listener);
    notifyGhostBestUpdated('3,4'); expect(listener).not.toHaveBeenCalled();
    notifyGhostBestUpdated('1,2'); expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe(); notifyGhostBestUpdated('1,2'); expect(listener).toHaveBeenCalledTimes(1);
  });
  it('rejects a different selected layout or foreign-room recording before reuse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ ...response(), roomVersion: 2 }))
      .mockResolvedValueOnce(Response.json({ ...response(), top: { ghost: { ...ghost, roomId: '3,4' } } })));
    await expect(load()).rejects.toThrow('layout changed');
    await expect(load()).rejects.toThrow('room changed'); expect(getRecentTopGhost('1,2', 1)).toBeNull();
  });
});
