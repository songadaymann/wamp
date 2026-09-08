interface CacheEntry<T> {
  value?: T;
  loadedAt: number;
  inFlight?: Promise<T>;
}

const entries = new Map<string, CacheEntry<unknown>>();
// Includes pending requests; eviction detaches them without cancelling their callers.
export const STALE_WHILE_REVALIDATE_CACHE_CAPACITY = 256;
const FRESH_MS = 20_000;
const STALE_MS = 40_000;

export async function loadWithStaleWhileRevalidate<T>(
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  // Sweep expired settled entries lazily; active requests still deduplicate.
  for (const [cachedKey, entry] of entries) {
    if (!entry.inFlight && now - entry.loadedAt > FRESH_MS + STALE_MS) {
      entries.delete(cachedKey);
    }
  }
  const existing = entries.get(key) as CacheEntry<T> | undefined;
  if (existing) {
    entries.delete(key);
    entries.set(key, existing);
  }
  if (existing?.value !== undefined && now - existing.loadedAt <= FRESH_MS) {
    return existing.value;
  }

  if (existing?.value !== undefined && now - existing.loadedAt <= FRESH_MS + STALE_MS) {
    if (!existing.inFlight) {
      existing.inFlight = refreshCacheEntry(key, existing, loader);
      void existing.inFlight.catch(() => undefined);
    }
    return existing.value;
  }

  if (existing?.inFlight) return existing.inFlight;
  const next = existing ?? { loadedAt: 0 };
  entries.set(key, next);
  while (entries.size > STALE_WHILE_REVALIDATE_CACHE_CAPACITY) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey !== undefined) entries.delete(oldestKey);
  }
  next.inFlight = refreshCacheEntry(key, next, loader);
  return next.inFlight;
}

export function invalidateStaleWhileRevalidateCache(prefix: string): void {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

async function refreshCacheEntry<T>(
  key: string,
  entry: CacheEntry<T>,
  loader: () => Promise<T>,
): Promise<T> {
  try {
    const value = await Promise.resolve().then(loader);
    // Invalidated or evicted requests may finish for their callers, but cannot
    // reclaim a cache slot or overwrite a newer request for the same key.
    if (entries.get(key) === entry) {
      entry.value = value;
      entry.loadedAt = Date.now();
    }
    return value;
  } finally {
    entry.inFlight = undefined;
  }
}
