import { afterEach, expect, it, vi } from 'vitest';
import { LostSongService } from './service';
import type { LostSongRepository } from './repository';

function fixture(stored = '[]', blocked = false) {
  const values = new Map([['ep_lost_songs_v1', stored]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {
    if (blocked) throw new Error('Storage blocked'); values.set(key, value);
  } } as Storage;
  const repository: LostSongRepository = {
    progress: vi.fn(async () => ({ roomIds: ['1,0'], total: 1, nextCursor: null })),
    claim: vi.fn(async roomIds => ({ claimed: roomIds, skipped: [], xp: 5 })),
    play: vi.fn(), find: vi.fn(),
  };
  const service = new LostSongService(repository, storage, userId => ({ userId, guest: { guestUserId: 'guest-test', recoveryToken: 't'.repeat(64) } }));
  return { service, repository, values };
}
afterEach(() => vi.useRealTimers());
it('persists only confirmed guest receipts, reloads safely and claims them once without refetching each room', async () => {
  const f = fixture();
  const receipt = { roomId: '0,0', foundAt: new Date().toISOString(), xp: 0 };
  f.service.confirm(receipt, f.service.identity()); f.service.confirm(receipt, f.service.identity());
  expect(f.service.snapshot().total).toBe(1);
  expect(JSON.parse(f.values.get('ep_lost_songs_v1')!)).toHaveLength(1);
  const reloaded = fixture(f.values.get('ep_lost_songs_v1')!);
  expect(reloaded.service.hasFound('0,0')).toBe(true);
  await f.service.setUser('player');
  await f.service.setUser('player');
  expect(f.repository.claim).toHaveBeenCalledTimes(1);
  expect(f.repository.progress).toHaveBeenCalledTimes(1);
  expect(f.service.snapshot().total).toBe(2);
  expect(f.service.hasFound('0,0')).toBe(true);
  expect(JSON.parse(f.values.get('ep_lost_songs_v1')!)).toEqual([]);
});
it('keeps receipt claiming retryable after a failed reply, uses a bounded cooldown and never mixes account caches', async () => {
  vi.useFakeTimers();
  const f = fixture(JSON.stringify([{ roomId: '0,0', foundAt: new Date().toISOString() }]));
  vi.mocked(f.repository.claim).mockRejectedValueOnce(new Error('Lost response'));
  await f.service.setUser('a'); expect(f.service.snapshot().status).toContain('retry');
  await f.service.setUser('a'); expect(f.repository.claim).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(66_000); await f.service.setUser('a');
  expect(f.service.hasFound('0,0')).toBe(true);
  await f.service.setUser('b');
  expect(f.service.hasFound('0,0')).toBe(false);
  expect(f.service.hasFound('1,0')).toBe(true);
  await f.service.setUser(null);
  expect(f.service.snapshot().total).toBe(0);
});
it('ignores a stale account list while preserving a pickup that wins the initial-load race', async () => {
  const f = fixture();
  let resolve!: (page: { roomIds: string[]; total: number; nextCursor: null }) => void;
  vi.mocked(f.repository.progress).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const first = f.service.setUser('a');
  await f.service.setUser('b'); resolve({ roomIds: ['9,0'], total: 1, nextCursor: null }); await first;
  expect(f.service.hasFound('9,0')).toBe(false);
  let resolveNext!: typeof resolve;
  vi.mocked(f.repository.progress).mockImplementationOnce(() => new Promise(done => { resolveNext = done; }));
  const next = f.service.setUser('c');
  f.service.confirm({ roomId: '2,0', foundAt: new Date().toISOString(), xp: 5 }, f.service.identity());
  resolveNext({ roomIds: [], total: 0, nextCursor: null }); await next;
  expect(f.service.hasFound('2,0')).toBe(true); expect(f.service.snapshot().total).toBe(1);
});
it('tolerates blocked/malformed storage, removes expired receipts and pages an account list once', async () => {
  const blocked = fixture('bad-json', true);
  expect(blocked.service.confirm({ roomId: '0,0', foundAt: new Date().toISOString(), xp: 0 }, blocked.service.identity())).toBe(false);
  expect(blocked.service.snapshot().total).toBe(1);
  expect(fixture('[{"roomId":"0,0","foundAt":"2000-01-01"}]').service.snapshot().total).toBe(0);
  const f = fixture();
  vi.mocked(f.repository.progress).mockResolvedValueOnce({ roomIds: ['0,0'], total: 2, nextCursor: '0,0' })
    .mockResolvedValueOnce({ roomIds: ['1,0'], total: 2, nextCursor: null });
  await f.service.setUser('player'); await f.service.setUser('player');
  expect(f.repository.progress).toHaveBeenCalledTimes(2); expect(f.service.snapshot().total).toBe(2);
});
