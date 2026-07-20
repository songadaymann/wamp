interface CacheEntry<T> {
  value?: T;
  loadedAt: number;
  inFlight?: Promise<T>;
}

const entries = new Map<string, CacheEntry<unknown>>();
const FRESH_MS = 20_000;
const STALE_MS = 40_000;

export async function loadWithStaleWhileRevalidate<T>(
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = entries.get(key) as CacheEntry<T> | undefined;
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
  next.inFlight = refreshCacheEntry(key, next, loader);
  entries.set(key, next);
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
    const value = await loader();
    entry.value = value;
    entry.loadedAt = Date.now();
    entries.set(key, entry);
    return value;
  } finally {
    entry.inFlight = undefined;
  }
}
