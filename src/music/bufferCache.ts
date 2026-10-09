type BufferGroup = 'clip' | 'loop' | 'segment';
interface CacheEntry {
  promise: Promise<AudioBuffer>;
  group: BufferGroup;
  bytes: number;
}
export const ROOM_MUSIC_BUFFER_CACHE_BYTES = 50 * 1024 * 1024;
// Arrange segments are one lane of one 2-bar slot; a full arrangement can use 64.
const GROUP_LIMITS: Record<BufferGroup, number> = { clip: 16, loop: 4, segment: 64 };

/** Shared retention budget across decoded clips and rendered lane/pattern/phrase loops. */
export class RoomMusicBufferCache {
  private entries = new Map<string, CacheEntry>();

  get(key: string): Promise<AudioBuffer> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.promise;
  }

  set(key: string, group: BufferGroup, promise: Promise<AudioBuffer>): void {
    const entry = { promise, group, bytes: 0 };
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.trim();
    void promise.then(buffer => {
      // An evicted/replaced request must not recache itself when it resolves late.
      if (this.entries.get(key) !== entry) return;
      entry.bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
      if (entry.bytes > ROOM_MUSIC_BUFFER_CACHE_BYTES) this.entries.delete(key);
      this.trim();
    }, () => { if (this.entries.get(key) === entry) this.entries.delete(key); });
  }

  private trim(): void {
    for (const group of ['clip', 'loop', 'segment'] as const) {
      const keys = [...this.entries].filter(([, entry]) => entry.group === group).map(([key]) => key);
      for (const key of keys.slice(0, Math.max(0, keys.length - GROUP_LIMITS[group]))) this.entries.delete(key);
    }
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [key, entry] of this.entries) {
      if (bytes <= ROOM_MUSIC_BUFFER_CACHE_BYTES) break;
      this.entries.delete(key);
      bytes -= entry.bytes;
    }
  }

  getDebugSnapshot(): { clipEntries: number; loopEntries: number; segmentEntries: number; pendingEntries: number; bytes: number; maxBytes: number } {
    const entries = [...this.entries.values()];
    return {
      clipEntries: entries.filter(e => e.group === 'clip').length,
      loopEntries: entries.filter(e => e.group === 'loop').length,
      segmentEntries: entries.filter(e => e.group === 'segment').length,
      pendingEntries: entries.filter(e => e.bytes === 0).length,
      bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
      maxBytes: ROOM_MUSIC_BUFFER_CACHE_BYTES,
    };
  }
}
