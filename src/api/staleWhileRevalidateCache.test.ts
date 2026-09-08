import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateStaleWhileRevalidateCache as invalidate, loadWithStaleWhileRevalidate as load, STALE_WHILE_REVALIDATE_CACHE_CAPACITY as capacity } from './staleWhileRevalidateCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('stale-while-revalidate request cache', () => {
  beforeEach(() => { invalidate(''); vi.useFakeTimers(); vi.setSystemTime(100_000); });
  afterEach(() => vi.useRealTimers());

  it('deduplicates concurrent loads', async () => {
    const pending = deferred<number>();
    const loader = vi.fn(() => pending.promise);
    const first = load('same', loader);
    const second = load('same', loader);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    pending.resolve(42);
    await expect(Promise.all([first, second])).resolves.toEqual([42, 42]);
  });

  it('keeps values fresh for 20 seconds and deduplicates a stale refresh', async () => {
    await load('swr', async () => 'first');
    const pending = deferred<string>();
    const loader = vi.fn(() => pending.promise);
    vi.advanceTimersByTime(20_000);
    expect(await load('swr', loader)).toBe('first');
    expect(loader).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(await load('swr', loader)).toBe('first');
    expect(await load('swr', loader)).toBe('first');
    expect(loader).toHaveBeenCalledTimes(1);
    pending.resolve('second');
    await vi.advanceTimersByTimeAsync(0);
    expect(await load('swr', loader)).toBe('second');
  });

  it.each([true, false])('never resurrects invalidated pending entries (old finishes first: %s)', async (oldFirst) => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const oldCall = load('profile:a', () => old.promise);
    invalidate('profile:');
    const freshCall = load('profile:a', () => fresh.promise);
    if (oldFirst) { old.resolve('old'); await oldCall; }
    fresh.resolve('fresh');
    expect(await freshCall).toBe('fresh');
    if (!oldFirst) { old.resolve('old'); await oldCall; }
    const unexpected = vi.fn(async () => 'wrong');
    expect(await load('profile:a', unexpected)).toBe('fresh');
    expect(unexpected).not.toHaveBeenCalled();
  });

  it('invalidates while refreshing without restoring the stale value', async () => {
    await load('profile:a', async () => 'first');
    vi.advanceTimersByTime(20_001);
    const pending = deferred<string>();
    expect(await load('profile:a', () => pending.promise)).toBe('first');
    invalidate('profile:');
    await load('profile:a', async () => 'new');
    pending.resolve('obsolete');
    await vi.advanceTimersByTimeAsync(0);
    expect(await load('profile:a', async () => 'wrong')).toBe('new');
  });

  it('retries failures, including synchronous loader throws', async () => {
    await expect(load('retry', () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(await load('retry', async () => 'recovered')).toBe('recovered');
    vi.advanceTimersByTime(20_001);
    expect(await load('retry', async () => { throw new Error('offline'); })).toBe('recovered');
    await vi.advanceTimersByTimeAsync(0);
    const retried = vi.fn(async () => 'updated');
    expect(await load('retry', retried)).toBe('recovered');
    await vi.advanceTimersByTimeAsync(0);
    expect(await load('retry', retried)).toBe('updated');
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it('expires settled values after the full 60 second window', async () => {
    await load('expired', async () => 'old');
    vi.advanceTimersByTime(60_001);
    const pending = deferred<string>();
    const call = load('expired', () => pending.promise);
    pending.resolve('new');
    expect(await call).toBe('new');
  });

  it('deduplicates a refresh even after the stale window expires', async () => {
    await load('slow', async () => 'old');
    vi.advanceTimersByTime(20_001);
    const pending = deferred<string>();
    const loader = vi.fn(() => pending.promise);
    expect(await load('slow', loader)).toBe('old');
    vi.advanceTimersByTime(40_000);
    const call = load('slow', loader);
    pending.resolve('new');
    expect(await call).toBe('new');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('evicts least recently accessed entries at capacity', async () => {
    for (let i = 0; i < capacity; i++) await load(String(i), async () => i);
    expect(await load('0', async () => -1)).toBe(0);
    await load('extra', async () => 99);
    expect(await load('0', async () => -1)).toBe(0);
    expect(await load('1', async () => -1)).toBe(-1);
  });

  it('bounds pending requests and never lets an evicted completion displace newer entries', async () => {
    const pending = deferred<number>();
    const old = load('old', () => pending.promise);
    for (let i = 0; i < capacity; i++) await load(String(i), async () => i);
    pending.resolve(123);
    expect(await old).toBe(123);
    expect(await load('0', async () => -1)).toBe(0);
    expect(await load('old', async () => 456)).toBe(456);
  });
});
