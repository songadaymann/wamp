import type { WorldTileManifestReady } from './types';

const WORLD_TILE_BYTE_CACHE_NAME = 'wamp-world-tile-bytes-v1';
const WORLD_TILE_BYTE_METADATA_DB = 'wamp-world-tile-byte-metadata-v1';
const WORLD_TILE_BYTE_METADATA_STORE = 'entries';

interface WorldTileByteMetadata {
  key: string;
  url: string;
  contentHash: string;
  byteLength: number;
  lastAccess: number;
}

export interface WorldTileByteCacheResult {
  blob: Blob;
  cacheHit: boolean;
}

export interface WorldTileByteCacheDiagnostics {
  hits: number;
  misses: number;
  evictions: number;
  memoryBytes: number;
}

interface InFlightWorldTileByteRequest {
  promise: Promise<WorldTileByteCacheResult>;
  signal?: AbortSignal;
}

export function worldTileByteCacheKey(ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>): string {
  return `${ready.contentHash}:${ready.url}`;
}

export class WorldTileByteCache {
  private readonly memory = new Map<string, { blob: Blob; lastAccess: number }>();
  private readonly inFlight = new Map<string, InFlightWorldTileByteRequest>();
  private memoryBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly byteBudget: number) {}

  async getOrFetch(
    ready: WorldTileManifestReady,
    signal?: AbortSignal,
    forceNetwork = false,
  ): Promise<WorldTileByteCacheResult> {
    signal?.throwIfAborted();
    const key = worldTileByteCacheKey(ready);
    const requestKey = `${forceNetwork ? 'network' : 'cache'}:${key}`;
    const existingRequest = this.inFlight.get(requestKey);
    if (existingRequest && existingRequest.signal === signal && !signal?.aborted) {
      return existingRequest.promise;
    }
    const inFlightRequest: InFlightWorldTileByteRequest = {
      promise: Promise.resolve({ blob: new Blob(), cacheHit: false }),
      signal,
    };
    inFlightRequest.promise = this.loadOrFetch(key, ready, signal, forceNetwork)
      .finally(() => {
        if (this.inFlight.get(requestKey) === inFlightRequest) {
          this.inFlight.delete(requestKey);
        }
      });
    this.inFlight.set(requestKey, inFlightRequest);
    return inFlightRequest.promise;
  }

  detachPendingRequests(): void {
    this.inFlight.clear();
  }

  private async loadOrFetch(
    key: string,
    ready: WorldTileManifestReady,
    signal?: AbortSignal,
    forceNetwork = false,
  ): Promise<WorldTileByteCacheResult> {
    if (!forceNetwork) {
      const memoryHit = this.memory.get(key);
      if (memoryHit) {
        memoryHit.lastAccess = Date.now();
        this.hits += 1;
        return { blob: memoryHit.blob, cacheHit: true };
      }

      const persistentHit = await this.loadPersistent(key, ready);
      if (persistentHit) {
        this.hits += 1;
        this.setMemory(key, persistentHit);
        return { blob: persistentHit, cacheHit: true };
      }
    }

    this.misses += 1;
    const response = await fetch(ready.url, {
      cache: 'force-cache',
      credentials: 'omit',
      mode: 'cors',
      signal,
    });
    if (!response.ok) throw new Error(`World tile request failed with status ${response.status}.`);
    const blob = await response.blob();
    if (blob.size <= 0 || blob.size !== ready.byteLength) {
      throw new Error(`World tile byte length mismatch for ${ready.contentHash}.`);
    }
    await assertWorldTileContentHash(blob, ready.contentHash);
    this.setMemory(key, blob);
    await this.savePersistent(key, ready, blob);
    return { blob, cacheHit: false };
  }

  async delete(ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>): Promise<void> {
    const key = worldTileByteCacheKey(ready);
    const memoryEntry = this.memory.get(key);
    if (memoryEntry) {
      this.memory.delete(key);
      this.memoryBytes -= memoryEntry.blob.size;
    }
    const cache = await openCacheStorage();
    if (cache) await cache.delete(buildCacheRequest(ready));
    await deleteMetadata(key);
  }

  getDiagnostics(): WorldTileByteCacheDiagnostics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      memoryBytes: this.memoryBytes,
    };
  }

  private async loadPersistent(
    key: string,
    ready: Pick<WorldTileManifestReady, 'url' | 'contentHash' | 'byteLength'>,
  ): Promise<Blob | null> {
    const cache = await openCacheStorage();
    if (!cache) return null;
    const response = await cache.match(buildCacheRequest(ready));
    if (!response) return null;
    const blob = await response.blob();
    if (blob.size !== ready.byteLength) {
      await cache.delete(buildCacheRequest(ready));
      await deleteMetadata(key);
      return null;
    }
    try {
      await assertWorldTileContentHash(blob, ready.contentHash);
    } catch {
      await cache.delete(buildCacheRequest(ready));
      await deleteMetadata(key);
      return null;
    }
    await saveMetadata({
      key,
      url: ready.url,
      contentHash: ready.contentHash,
      byteLength: blob.size,
      lastAccess: Date.now(),
    });
    return blob;
  }

  private async savePersistent(
    key: string,
    ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>,
    blob: Blob,
  ): Promise<void> {
    const cache = await openCacheStorage();
    if (!cache) return;
    try {
      await cache.put(buildCacheRequest(ready), new Response(blob, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      }));
      await saveMetadata({
        key,
        url: ready.url,
        contentHash: ready.contentHash,
        byteLength: blob.size,
        lastAccess: Date.now(),
      });
      await this.prunePersistent(cache);
    } catch {
      // CacheStorage and IndexedDB are opportunistic; the in-memory copy remains usable.
    }
  }

  private setMemory(key: string, blob: Blob): void {
    const previous = this.memory.get(key);
    if (previous) this.memoryBytes -= previous.blob.size;
    this.memory.set(key, { blob, lastAccess: Date.now() });
    this.memoryBytes += blob.size;
    while (this.memoryBytes > Math.min(this.byteBudget, 16 * 1_024 * 1_024) && this.memory.size > 1) {
      const oldest = [...this.memory.entries()].sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
      if (!oldest) break;
      this.memory.delete(oldest[0]);
      this.memoryBytes -= oldest[1].blob.size;
    }
  }

  private async prunePersistent(cache: Cache): Promise<void> {
    const entries = await loadAllMetadata();
    let total = entries.reduce((sum, entry) => sum + entry.byteLength, 0);
    for (const entry of entries.sort((left, right) => left.lastAccess - right.lastAccess)) {
      if (total <= this.byteBudget) break;
      await cache.delete(buildCacheRequest(entry));
      await deleteMetadata(entry.key);
      total -= entry.byteLength;
      this.evictions += 1;
    }
  }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('SubtleCrypto is required to validate world tile bytes.');
  }
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function assertWorldTileContentHash(blob: Blob, expectedHash: string): Promise<void> {
  const actualHash = await sha256Hex(blob);
  if (actualHash !== expectedHash) {
    throw new Error(`World tile content hash mismatch: expected ${expectedHash}, received ${actualHash}.`);
  }
}

function buildCacheRequest(ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>): Request {
  const url = new URL(ready.url);
  url.searchParams.set('__wamp_tile_hash', ready.contentHash);
  return new Request(url.toString(), { method: 'GET' });
}

async function openCacheStorage(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(WORLD_TILE_BYTE_CACHE_NAME);
  } catch {
    return null;
  }
}

function openMetadataDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(WORLD_TILE_BYTE_METADATA_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WORLD_TILE_BYTE_METADATA_STORE)) {
        request.result.createObjectStore(WORLD_TILE_BYTE_METADATA_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function saveMetadata(entry: WorldTileByteMetadata): Promise<void> {
  const database = await openMetadataDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(WORLD_TILE_BYTE_METADATA_STORE, 'readwrite');
    transaction.objectStore(WORLD_TILE_BYTE_METADATA_STORE).put(entry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  database.close();
}

async function deleteMetadata(key: string): Promise<void> {
  const database = await openMetadataDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(WORLD_TILE_BYTE_METADATA_STORE, 'readwrite');
    transaction.objectStore(WORLD_TILE_BYTE_METADATA_STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  database.close();
}

async function loadAllMetadata(): Promise<WorldTileByteMetadata[]> {
  const database = await openMetadataDatabase();
  if (!database) return [];
  const entries = await new Promise<WorldTileByteMetadata[]>((resolve) => {
    const request = database
      .transaction(WORLD_TILE_BYTE_METADATA_STORE, 'readonly')
      .objectStore(WORLD_TILE_BYTE_METADATA_STORE)
      .getAll();
    request.onsuccess = () => resolve(request.result as WorldTileByteMetadata[]);
    request.onerror = () => resolve([]);
  });
  database.close();
  return entries;
}
