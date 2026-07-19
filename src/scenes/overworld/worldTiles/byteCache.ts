import type { WorldTileManifestReady } from './types';

const WORLD_TILE_BYTE_CACHE_NAME = 'wamp-world-tile-bytes-v1';
const WORLD_TILE_BYTE_METADATA_DB = 'wamp-world-tile-byte-metadata-v1';
const WORLD_TILE_BYTE_METADATA_STORE = 'entries';

export interface WorldTileByteMetadata {
  key: string;
  url: string;
  contentHash: string;
  byteLength: number;
  lastAccess: number;
}

export interface WorldTileByteCacheStore {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

export interface WorldTileByteCachePersistence {
  openCache(): Promise<WorldTileByteCacheStore | null>;
  saveMetadata(entries: readonly WorldTileByteMetadata[]): Promise<boolean>;
  deleteMetadata(keys: readonly string[]): Promise<void>;
  loadAllMetadata(): Promise<WorldTileByteMetadata[]>;
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

interface PendingWorldTileByteWrite {
  key: string;
  ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>;
  blob: Blob;
  lastAccess: number;
}

export function worldTileByteCacheKey(ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>): string {
  return `${ready.contentHash}:${ready.url}`;
}

export class WorldTileByteCache {
  private readonly memory = new Map<string, { blob: Blob; lastAccess: number }>();
  private readonly inFlight = new Map<string, InFlightWorldTileByteRequest>();
  private readonly pendingWrites = new Map<string, PendingWorldTileByteWrite>();
  private readonly pendingTouches = new Map<string, WorldTileByteMetadata>();
  private persistenceBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private persistenceDrain: Promise<void> | null = null;
  private memoryBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    private readonly byteBudget: number,
    private readonly persistence: WorldTileByteCachePersistence = browserWorldTileByteCachePersistence,
  ) {}

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
    this.schedulePersistentWrite(key, ready, blob);
    return { blob, cacheHit: false };
  }

  async delete(ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>): Promise<void> {
    const key = worldTileByteCacheKey(ready);
    const memoryEntry = this.memory.get(key);
    if (memoryEntry) {
      this.memory.delete(key);
      this.memoryBytes -= memoryEntry.blob.size;
    }
    this.pendingWrites.delete(key);
    this.pendingTouches.delete(key);
    const activeDrain = this.persistenceDrain;
    if (activeDrain) await activeDrain;
    try {
      const cache = await this.persistence.openCache();
      if (cache) await cache.delete(buildCacheRequest(ready));
    } catch {
      // Persistent storage is opportunistic; memory eviction still succeeds.
    }
    try {
      await this.persistence.deleteMetadata([key]);
    } catch {
      // Persistent metadata is opportunistic as well.
    }
  }

  /** Drains deferred persistence work. Intended for deterministic tests and lifecycle teardown. */
  async flushPersistence(): Promise<void> {
    while (this.persistenceBatchTimer || this.persistenceDrain || this.hasPendingPersistence()) {
      if (this.persistenceBatchTimer) {
        clearTimeout(this.persistenceBatchTimer);
        this.persistenceBatchTimer = null;
      }
      if (!this.persistenceDrain && this.hasPendingPersistence()) this.startPersistenceDrain();
      const activeDrain = this.persistenceDrain;
      if (activeDrain) await activeDrain;
      else await Promise.resolve();
    }
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
    let cache: WorldTileByteCacheStore | null;
    let response: Response | undefined;
    try {
      cache = await this.persistence.openCache();
      if (!cache) return null;
      response = await cache.match(buildCacheRequest(ready));
    } catch {
      return null;
    }
    if (!response) return null;
    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      await this.evictPersistentEntry(cache, key, ready);
      return null;
    }
    if (blob.size !== ready.byteLength) {
      await this.evictPersistentEntry(cache, key, ready);
      return null;
    }
    try {
      await assertWorldTileContentHash(blob, ready.contentHash);
    } catch {
      await this.evictPersistentEntry(cache, key, ready);
      return null;
    }
    this.scheduleMetadataTouch(key, ready, blob.size);
    return blob;
  }

  private schedulePersistentWrite(
    key: string,
    ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>,
    blob: Blob,
  ): void {
    this.pendingWrites.set(key, { key, ready, blob, lastAccess: Date.now() });
    this.pendingTouches.delete(key);
    this.schedulePersistenceBatch();
  }

  private scheduleMetadataTouch(
    key: string,
    ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>,
    byteLength: number,
    lastAccess = Date.now(),
  ): void {
    const pendingWrite = this.pendingWrites.get(key);
    if (pendingWrite) {
      pendingWrite.lastAccess = Math.max(pendingWrite.lastAccess, lastAccess);
      return;
    }
    this.pendingTouches.set(key, {
      key,
      url: ready.url,
      contentHash: ready.contentHash,
      byteLength,
      lastAccess,
    });
    this.schedulePersistenceBatch();
  }

  private schedulePersistenceBatch(): void {
    if (this.persistenceBatchTimer || this.persistenceDrain) return;
    this.persistenceBatchTimer = setTimeout(() => {
      this.persistenceBatchTimer = null;
      this.startPersistenceDrain();
    }, 0);
  }

  private startPersistenceDrain(): void {
    if (this.persistenceDrain || !this.hasPendingPersistence()) return;
    const writes = [...this.pendingWrites.values()];
    const touches = [...this.pendingTouches.values()];
    this.pendingWrites.clear();
    this.pendingTouches.clear();
    let settled: Promise<void>;
    settled = this.persistBatch(writes, touches)
      .catch(() => {
        // CacheStorage and IndexedDB are opportunistic; the in-memory copies remain usable.
      })
      .finally(() => {
        if (this.persistenceDrain === settled) this.persistenceDrain = null;
        if (this.hasPendingPersistence()) this.schedulePersistenceBatch();
      });
    this.persistenceDrain = settled;
  }

  private hasPendingPersistence(): boolean {
    return this.pendingWrites.size > 0 || this.pendingTouches.size > 0;
  }

  private async persistBatch(
    writes: readonly PendingWorldTileByteWrite[],
    touches: readonly WorldTileByteMetadata[],
  ): Promise<void> {
    let cache: WorldTileByteCacheStore | null = null;
    try {
      cache = await this.persistence.openCache();
    } catch {
      // Metadata touches are still useful even if CacheStorage is temporarily unavailable.
    }

    const metadataByKey = new Map(touches.map((entry) => [entry.key, entry]));
    if (cache) {
      const activeCache = cache;
      const persistedWrites = await Promise.all(writes.map(async (write) => {
        try {
          await activeCache.put(buildCacheRequest(write.ready), new Response(write.blob, {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          }));
          return write;
        } catch {
          return null;
        }
      }));
      for (const write of persistedWrites) {
        if (!write) continue;
        const candidate: WorldTileByteMetadata = {
          key: write.key,
          url: write.ready.url,
          contentHash: write.ready.contentHash,
          byteLength: write.blob.size,
          lastAccess: write.lastAccess,
        };
        const current = metadataByKey.get(candidate.key);
        if (!current || current.lastAccess <= candidate.lastAccess) {
          metadataByKey.set(candidate.key, candidate);
        }
      }
    }

    if (metadataByKey.size === 0) return;
    let metadataSaved = false;
    try {
      metadataSaved = await this.persistence.saveMetadata([...metadataByKey.values()]);
    } catch {
      return;
    }
    if (!metadataSaved) return;

    if (!cache) {
      try {
        cache = await this.persistence.openCache();
      } catch {
        return;
      }
    }
    if (cache) await this.prunePersistent(cache);
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

  private async prunePersistent(cache: WorldTileByteCacheStore): Promise<void> {
    const entries = await this.persistence.loadAllMetadata();
    let total = entries.reduce((sum, entry) => sum + entry.byteLength, 0);
    const deletedKeys: string[] = [];
    for (const entry of entries.sort((left, right) => left.lastAccess - right.lastAccess)) {
      if (total <= this.byteBudget) break;
      try {
        await cache.delete(buildCacheRequest(entry));
      } catch {
        continue;
      }
      deletedKeys.push(entry.key);
      total -= entry.byteLength;
      this.evictions += 1;
    }
    if (deletedKeys.length > 0) await this.persistence.deleteMetadata(deletedKeys);
  }

  private async evictPersistentEntry(
    cache: WorldTileByteCacheStore,
    key: string,
    ready: Pick<WorldTileManifestReady, 'url' | 'contentHash'>,
  ): Promise<void> {
    await Promise.allSettled([
      cache.delete(buildCacheRequest(ready)),
      this.persistence.deleteMetadata([key]),
    ]);
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

async function openCacheStorage(): Promise<WorldTileByteCacheStore | null> {
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

async function saveMetadata(entries: readonly WorldTileByteMetadata[]): Promise<boolean> {
  if (entries.length === 0) return true;
  const database = await openMetadataDatabase();
  if (!database) return false;
  const saved = await new Promise<boolean>((resolve) => {
    const transaction = database.transaction(WORLD_TILE_BYTE_METADATA_STORE, 'readwrite');
    const store = transaction.objectStore(WORLD_TILE_BYTE_METADATA_STORE);
    for (const entry of entries) store.put(entry);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
  database.close();
  return saved;
}

async function deleteMetadata(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const database = await openMetadataDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(WORLD_TILE_BYTE_METADATA_STORE, 'readwrite');
    const store = transaction.objectStore(WORLD_TILE_BYTE_METADATA_STORE);
    for (const key of keys) store.delete(key);
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

const browserWorldTileByteCachePersistence: WorldTileByteCachePersistence = {
  openCache: openCacheStorage,
  saveMetadata,
  deleteMetadata,
  loadAllMetadata,
};
