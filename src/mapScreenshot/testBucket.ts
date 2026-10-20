import { vi } from 'vitest';
import type { ScreenshotR2Bucket } from './storage';

export function testBucket(initial: Record<string, string | Uint8Array> = {}) {
  const files = new Map(Object.entries(initial));
  const bucket: ScreenshotR2Bucket = {
    get: vi.fn(async key => {
      const value = files.get(key); if (value === undefined) return null;
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      return { key, size: bytes.length, uploaded: new Date(), body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }),
        text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer };
    }),
    put: vi.fn(async (key, value) => { files.set(key, typeof value === 'string' ? value : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice() : new Uint8Array(value)); }),
    list: vi.fn(async options => ({ objects: [...files].filter(([key]) => key.startsWith(options?.prefix ?? '')).map(([key, value]) => ({ key, size: typeof value === 'string' ? new TextEncoder().encode(value).length : value.byteLength })), truncated: false })),
  };
  return { bucket, files };
}
