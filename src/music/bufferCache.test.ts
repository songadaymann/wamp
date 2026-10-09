import { describe, expect, it } from 'vitest';
import { RoomMusicBufferCache, ROOM_MUSIC_BUFFER_CACHE_BYTES } from './bufferCache';

const buffer = (bytes = 1024) => ({ length: bytes / 4, numberOfChannels: 1 }) as AudioBuffer;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
describe('shared room music buffer retention', () => {
  it('keeps four LRU loops across kinds and separately bounds decoded clips', async () => {
    const cache = new RoomMusicBufferCache();
    for (const key of ['pattern:a', 'phrase:b', 'lane:c', 'pattern:d']) cache.set(key, 'loop', Promise.resolve(buffer()));
    const retained = cache.get('pattern:a'); cache.set('phrase:e', 'loop', Promise.resolve(buffer()));
    expect(cache.get('phrase:b')).toBeUndefined(); expect(cache.get('pattern:a')).toBe(retained);
    for (let i = 0; i < 17; i++) cache.set(`clip:${i}`, 'clip', Promise.resolve(buffer()));
    await settle(); expect(cache.get('clip:0')).toBeUndefined();
    expect(cache.getDebugSnapshot()).toMatchObject({ clipEntries: 16, loopEntries: 4, pendingEntries: 0 });
  });
  it('keeps up to 64 Arrange segments without evicting room loops', async () => {
    const cache = new RoomMusicBufferCache();
    cache.set('pattern:a', 'loop', Promise.resolve(buffer()));
    for (let i = 0; i < 65; i++) cache.set(`segment:${i}`, 'segment', Promise.resolve(buffer()));
    await settle();
    expect(cache.get('segment:0')).toBeUndefined(); expect(cache.get('segment:64')).toBeTruthy(); expect(cache.get('pattern:a')).toBeTruthy();
    expect(cache.getDebugSnapshot()).toMatchObject({ segmentEntries: 64, loopEntries: 1, clipEntries: 0 });
  });
  it('uses one byte budget across decoded clips and rendered loops', async () => {
    const cache = new RoomMusicBufferCache();
    cache.set('clip', 'clip', Promise.resolve(buffer(30 * 1024 * 1024)));
    cache.set('loop', 'loop', Promise.resolve(buffer(30 * 1024 * 1024)));
    await settle(); expect(cache.get('clip')).toBeUndefined(); expect(cache.get('loop')).toBeTruthy();
    expect(cache.getDebugSnapshot().bytes).toBe(30 * 1024 * 1024);
    expect(cache.getDebugSnapshot().bytes).toBeLessThanOrEqual(ROOM_MUSIC_BUFFER_CACHE_BYTES);
  });
  it('does not retain an oversized buffer while preserving its active caller', async () => {
    const cache = new RoomMusicBufferCache(), value = buffer(ROOM_MUSIC_BUFFER_CACHE_BYTES + 4), promise = Promise.resolve(value);
    cache.set('big', 'loop', promise); expect(await promise).toBe(value); await settle();
    expect(cache.get('big')).toBeUndefined(); expect(cache.getDebugSnapshot().bytes).toBe(0);
  });
  it('bounds pending entries and does not recache late evicted buffers or cancel their callers', async () => {
    const cache = new RoomMusicBufferCache(); let resolve!: (value: AudioBuffer) => void;
    const old = new Promise<AudioBuffer>(done => { resolve = done; }); cache.set('old', 'loop', old);
    expect(cache.get('old')).toBe(old);
    for (let i = 0; i < 4; i++) cache.set(String(i), 'loop', new Promise(() => {}));
    expect(cache.getDebugSnapshot()).toMatchObject({ loopEntries: 4, pendingEntries: 4 });
    const value = buffer(); resolve(value); expect(await old).toBe(value); await settle();
    expect(cache.get('old')).toBeUndefined(); expect(cache.getDebugSnapshot().bytes).toBe(0);
  });
  it('failed loads can retry and a replaced request cannot delete its newer owner', async () => {
    const cache = new RoomMusicBufferCache(); let reject!: (error: Error) => void;
    const old = new Promise<AudioBuffer>((_, fail) => { reject = fail; }); cache.set('key', 'clip', old);
    const replacement = Promise.resolve(buffer()); cache.set('key', 'clip', replacement);
    reject(new Error('offline')); await expect(old).rejects.toThrow('offline'); await settle(); expect(cache.get('key')).toBe(replacement);
    const failed = Promise.reject(new Error('retry')); cache.set('failed', 'loop', failed); await expect(failed).rejects.toThrow('retry'); await settle();
    expect(cache.get('failed')).toBeUndefined(); cache.set('failed', 'loop', replacement); expect(await cache.get('failed')).toEqual(await replacement);
  });
});
