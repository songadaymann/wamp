import { describe, expect, it } from 'vitest';
import { WeightedPinnedLruCache } from './lru';

describe('weighted pinned LRU cache', () => {
  it('evicts the least recently used unpinned entry by weight', () => {
    const cache = new WeightedPinnedLruCache<string, string>(10);
    cache.set('a', 'A', 4);
    cache.set('b', 'B', 4);
    expect(cache.get('a')).toBe('A');

    const result = cache.set('c', 'C', 4);
    expect(result.evicted.map((entry) => entry.key)).toEqual(['b']);
    expect(cache.keysByMostRecent()).toEqual(['c', 'a']);
    expect(cache.totalWeight).toBe(8);
  });

  it('permits pinned visible and fallback tiles to exceed the cap temporarily', () => {
    const cache = new WeightedPinnedLruCache<string, string>(10);
    cache.set('visible', 'visible', 8, { pinned: true });
    cache.set('fallback', 'fallback', 8, { pinned: true });
    expect(cache.totalWeight).toBe(16);
    expect(cache.size).toBe(2);

    expect(cache.unpin('fallback').map((entry) => entry.key)).toEqual(['fallback']);
    expect(cache.totalWeight).toBe(8);
    expect(cache.has('visible')).toBe(true);
  });

  it('rejects an oversized unpinned insertion without evicting pinned coverage', () => {
    const cache = new WeightedPinnedLruCache<string, string>(10);
    cache.set('visible', 'visible', 8, { pinned: true });
    const result = cache.set('guard', 'guard', 12);
    expect(result.stored).toBe(false);
    expect(result.evicted.map((entry) => entry.key)).toEqual(['guard']);
    expect(cache.has('visible')).toBe(true);
  });

  it('trims unpinned entries after lowering the resource budget', () => {
    const cache = new WeightedPinnedLruCache<string, string>(20);
    cache.set('a', 'A', 5);
    cache.set('b', 'B', 5);
    cache.set('c', 'C', 5);
    expect(cache.setCapacity(7).map((entry) => entry.key)).toEqual(['a', 'b']);
    expect(cache.keysByMostRecent()).toEqual(['c']);
  });
});
