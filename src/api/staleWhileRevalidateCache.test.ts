import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateStaleWhileRevalidateCache, loadWithStaleWhileRevalidate } from './staleWhileRevalidateCache';

describe('stale-while-revalidate request cache', () => {
  beforeEach(() => {
    invalidateStaleWhileRevalidateCache('');
    vi.useRealTimers();
  });

  it('deduplicates concurrent loads', async () => {
    let resolve!: (value: number) => void;
    const loader = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
    const first = loadWithStaleWhileRevalidate('same', loader);
    const second = loadWithStaleWhileRevalidate('same', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    resolve(42);
    await expect(Promise.all([first, second])).resolves.toEqual([42, 42]);
  });

  it('returns a stale value while one background refresh runs', async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    await expect(loadWithStaleWhileRevalidate('swr', loader)).resolves.toBe('first');
    vi.advanceTimersByTime(20_001);
    await expect(loadWithStaleWhileRevalidate('swr', loader)).resolves.toBe('first');
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    await expect(loadWithStaleWhileRevalidate('swr', loader)).resolves.toBe('second');
  });
});
