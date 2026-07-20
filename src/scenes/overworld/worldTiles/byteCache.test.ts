import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorldTileByteCache,
  sha256Hex,
  worldTileByteCacheKey,
  type WorldTileByteCachePersistence,
  type WorldTileByteCacheStore,
  type WorldTileByteMetadata,
} from './byteCache';
import type { WorldTileManifestReady } from './types';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function createReady(
  contents: string,
  suffix = 'tile',
): Promise<{ blob: Blob; ready: WorldTileManifestReady }> {
  const blob = new Blob([contents]);
  return {
    blob,
    ready: {
      generation: 1,
      contentHash: await sha256Hex(blob),
      url: `https://tiles.example.test/${suffix}.png`,
      width: 642,
      height: 354,
      overlap: 1,
      byteLength: blob.size,
    },
  };
}

class FakeWorldTilePersistence implements WorldTileByteCachePersistence {
  readonly blobs = new Map<string, Blob>();
  readonly metadata = new Map<string, WorldTileByteMetadata>();
  readonly events: string[] = [];
  putGate: Promise<void> | null = null;
  metadataGate: Promise<void> | null = null;
  failPut = false;
  failMetadata = false;

  readonly store: WorldTileByteCacheStore = {
    match: vi.fn(async (request: Request) => {
      const hash = this.hashFromRequest(request);
      this.events.push(`cache:match:${hash}`);
      const blob = this.blobs.get(hash);
      return blob ? new Response(blob) : undefined;
    }),
    put: vi.fn(async (request: Request, response: Response) => {
      const hash = this.hashFromRequest(request);
      this.events.push(`cache:put:${hash}`);
      if (this.putGate) await this.putGate;
      if (this.failPut) throw new Error('cache put failed');
      this.blobs.set(hash, await response.blob());
    }),
    delete: vi.fn(async (request: Request) => {
      const hash = this.hashFromRequest(request);
      this.events.push(`cache:delete:${hash}`);
      return this.blobs.delete(hash);
    }),
  };

  openCache = vi.fn(async () => this.store);

  saveMetadata = vi.fn(async (entries: readonly WorldTileByteMetadata[]) => {
    this.events.push(`metadata:save:${entries.map((entry) => entry.contentHash).sort().join(',')}`);
    if (this.metadataGate) await this.metadataGate;
    if (this.failMetadata) throw new Error('metadata save failed');
    for (const entry of entries) this.metadata.set(entry.key, { ...entry });
    return true;
  });

  deleteMetadata = vi.fn(async (keys: readonly string[]) => {
    this.events.push(`metadata:delete:${keys.join(',')}`);
    for (const key of keys) this.metadata.delete(key);
  });

  loadAllMetadata = vi.fn(async () => {
    this.events.push('metadata:load');
    return [...this.metadata.values()].map((entry) => ({ ...entry }));
  });

  seed(ready: WorldTileManifestReady, blob: Blob, lastAccess = 1): void {
    this.blobs.set(ready.contentHash, blob);
    const key = worldTileByteCacheKey(ready);
    this.metadata.set(key, {
      key,
      url: ready.url,
      contentHash: ready.contentHash,
      byteLength: blob.size,
      lastAccess,
    });
  }

  private hashFromRequest(request: Request): string {
    return new URL(request.url).searchParams.get('__wamp_tile_hash') ?? '';
  }
}

describe('world tile byte cache identity', () => {
  it('keeps immutable content revisions separate even if a URL is reused accidentally', () => {
    const url = 'https://tiles.example.test/world/tile.png';
    expect(worldTileByteCacheKey({ url, contentHash: 'first' }))
      .not.toBe(worldTileByteCacheKey({ url, contentHash: 'second' }));
  });

  it('computes the renderer-compatible lowercase SHA-256 digest', async () => {
    expect(await sha256Hex(new Blob(['wamp']))).toBe(
      '5bed0e036c8e899173b3eb483f3eebcab972fd4803109123ad5e8cac08de555d',
    );
  });

  it('deduplicates concurrent immutable fetches by content hash', async () => {
    const blob = new Blob(['tile-bytes']);
    const contentHash = await sha256Hex(blob);
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new WorldTileByteCache(1_024);
    const ready = {
      generation: 1,
      contentHash,
      url: 'https://tiles.example.test/tile.png',
      width: 642 as const,
      height: 354 as const,
      overlap: 1 as const,
      byteLength: blob.size,
    };
    const [first, second] = await Promise.all([
      cache.getOrFetch(ready),
      cache.getOrFetch(ready),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.blob.size).toBe(second.blob.size);
    await cache.flushPersistence();
  });

  it('detaches an old lifecycle without letting its completion clear the replacement request', async () => {
    const blob = new Blob(['tile-bytes']);
    const contentHash = await sha256Hex(blob);
    const deferred: Array<() => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      deferred.push(() => resolve(new Response(blob, { status: 200 })));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new WorldTileByteCache(1_024);
    const ready = {
      generation: 1,
      contentHash,
      url: 'https://tiles.example.test/tile.png',
      width: 642 as const,
      height: 354 as const,
      overlap: 1 as const,
      byteLength: blob.size,
    };

    const obsolete = cache.getOrFetch(ready);
    cache.detachPendingRequests();
    const replacement = cache.getOrFetch(ready);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    deferred[0]();
    await obsolete;
    const deduplicatedReplacement = cache.getOrFetch(ready);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    deferred[1]();
    await Promise.all([replacement, deduplicatedReplacement]);
    await cache.flushPersistence();
  });

  it('does not poison the cache when valid-length bytes have the wrong hash', async () => {
    const correct = new Blob(['good']);
    const corrupt = new Blob(['evil']);
    const contentHash = await sha256Hex(correct);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(corrupt, { status: 200 }))
      .mockResolvedValueOnce(new Response(correct, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new WorldTileByteCache(1_024);
    const ready = {
      generation: 1,
      contentHash,
      url: 'https://tiles.example.test/tile.png',
      width: 642 as const,
      height: 354 as const,
      overlap: 1 as const,
      byteLength: correct.size,
    };
    await expect(cache.getOrFetch(ready)).rejects.toThrow('content hash mismatch');
    await expect(cache.getOrFetch(ready, undefined, true)).resolves.toMatchObject({ cacheHit: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await cache.flushPersistence();
  });
});

describe('world tile byte cache deferred persistence', () => {
  it('returns a validated persistent hit before its last-access metadata write finishes', async () => {
    const { blob, ready } = await createReady('persistent-hit');
    const persistence = new FakeWorldTilePersistence();
    persistence.seed(ready, blob);
    const metadataGate = createDeferred();
    persistence.metadataGate = metadataGate.promise;
    const cache = new WorldTileByteCache(1_024, persistence);

    const result = await cache.getOrFetch(ready);
    expect(result).toMatchObject({ cacheHit: true });
    expect(await result.blob.text()).toBe('persistent-hit');

    await vi.waitFor(() => expect(persistence.saveMetadata).toHaveBeenCalledTimes(1));
    metadataGate.resolve();
    await cache.flushPersistence();
  });

  it('returns validated network bytes before CacheStorage persistence finishes', async () => {
    const { blob, ready } = await createReady('network-hit');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(blob, { status: 200 })));
    const persistence = new FakeWorldTilePersistence();
    const putGate = createDeferred();
    persistence.putGate = putGate.promise;
    const cache = new WorldTileByteCache(1_024, persistence);

    const result = await cache.getOrFetch(ready);
    expect(result).toMatchObject({ cacheHit: false });
    expect(await result.blob.text()).toBe('network-hit');

    await vi.waitFor(() => expect(persistence.store.put).toHaveBeenCalledTimes(1));
    putGate.resolve();
    await cache.flushPersistence();
  });

  it('coalesces repeated immutable writes and metadata work into one persistence batch', async () => {
    vi.useFakeTimers();
    const { blob, ready } = await createReady('coalesced');
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const persistence = new FakeWorldTilePersistence();
    const cache = new WorldTileByteCache(1_024, persistence);

    const firstRequest = new AbortController();
    const secondRequest = new AbortController();
    await Promise.all([
      cache.getOrFetch(ready, firstRequest.signal, true),
      cache.getOrFetch(ready, secondRequest.signal, true),
    ]);
    await cache.flushPersistence();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(persistence.store.put).toHaveBeenCalledTimes(1);
    expect(persistence.saveMetadata).toHaveBeenCalledTimes(1);
    expect(persistence.loadAllMetadata).toHaveBeenCalledTimes(1);
  });

  it('coalesces verified persistent-hit touches into one metadata transaction', async () => {
    const first = await createReady('first', 'first');
    const second = await createReady('second', 'second');
    const persistence = new FakeWorldTilePersistence();
    persistence.seed(first.ready, first.blob);
    persistence.seed(second.ready, second.blob);
    const cache = new WorldTileByteCache(1_024, persistence);

    await Promise.all([
      cache.getOrFetch(first.ready),
      cache.getOrFetch(second.ready),
    ]);
    await cache.flushPersistence();

    expect(persistence.saveMetadata).toHaveBeenCalledTimes(1);
    expect(persistence.saveMetadata.mock.calls[0]?.[0]).toHaveLength(2);
    expect(persistence.loadAllMetadata).toHaveBeenCalledTimes(1);
  });

  it('applies coalesced last-access touches before pruning the persistent LRU', async () => {
    const hot = await createReady('hot!', 'hot');
    const old = await createReady('old!', 'old');
    const persistence = new FakeWorldTilePersistence();
    persistence.seed(hot.ready, hot.blob, 1);
    persistence.seed(old.ready, old.blob, 2);
    const cache = new WorldTileByteCache(hot.blob.size, persistence);

    await cache.getOrFetch(hot.ready);
    await cache.flushPersistence();

    expect(persistence.blobs.has(hot.ready.contentHash)).toBe(true);
    expect(persistence.blobs.has(old.ready.contentHash)).toBe(false);
    const saveIndex = persistence.events.findIndex((event) => event.startsWith('metadata:save:'));
    const loadIndex = persistence.events.indexOf('metadata:load');
    const deleteIndex = persistence.events.indexOf(`cache:delete:${old.ready.contentHash}`);
    expect(saveIndex).toBeGreaterThan(-1);
    expect(loadIndex).toBeGreaterThan(saveIndex);
    expect(deleteIndex).toBeGreaterThan(loadIndex);
  });

  it('keeps network and memory results usable when deferred persistence fails', async () => {
    const putFailure = await createReady('put-failure', 'put-failure');
    const metadataFailure = await createReady('metadata-failure', 'metadata-failure');
    const blobs = [putFailure.blob, metadataFailure.blob];
    const fetchMock = vi.fn(async () => new Response(blobs.shift(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const persistence = new FakeWorldTilePersistence();
    persistence.failPut = true;
    const cache = new WorldTileByteCache(1_024, persistence);

    await expect(cache.getOrFetch(putFailure.ready)).resolves.toMatchObject({ cacheHit: false });
    await expect(cache.flushPersistence()).resolves.toBeUndefined();
    await expect(cache.getOrFetch(putFailure.ready)).resolves.toMatchObject({ cacheHit: true });

    persistence.failPut = false;
    persistence.failMetadata = true;
    await expect(cache.getOrFetch(metadataFailure.ready)).resolves.toMatchObject({ cacheHit: false });
    await expect(cache.flushPersistence()).resolves.toBeUndefined();
    await expect(cache.getOrFetch(metadataFailure.ready)).resolves.toMatchObject({ cacheHit: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(persistence.store.put).toHaveBeenCalledTimes(2);
    expect(persistence.saveMetadata).toHaveBeenCalledTimes(1);
    await cache.flushPersistence();
  });

  it('evicts a corrupt persistent response before using verified network bytes', async () => {
    const good = await createReady('good', 'corruption');
    const corrupt = new Blob(['evil']);
    const persistence = new FakeWorldTilePersistence();
    persistence.seed(good.ready, corrupt);
    const fetchMock = vi.fn(async () => new Response(good.blob, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new WorldTileByteCache(1_024, persistence);

    const result = await cache.getOrFetch(good.ready);
    expect(result).toMatchObject({ cacheHit: false });
    expect(await result.blob.text()).toBe('good');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(persistence.events).toContain(`cache:delete:${good.ready.contentHash}`);
    expect(persistence.deleteMetadata).toHaveBeenCalledWith([worldTileByteCacheKey(good.ready)]);
    await cache.flushPersistence();
  });
});
