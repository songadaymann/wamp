import { describe, expect, it, vi } from 'vitest';
import { screenshotArchive } from './archive';
import { testBucket } from './testBucket';
describe('archive object consistency', () => {
  it('fails if an object disappears after listing', async () => {
    const { bucket, files } = testBucket({ 'screenshots/2026_10_19_0.png': new Uint8Array([1]) });
    const stream = await screenshotArchive(bucket, null); files.clear();
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow(/disappeared/);
  });
  it('rejects a changed ETag even when size is unchanged, cancelling its unread body', async () => {
    const { bucket } = testBucket(); const cancel = vi.fn();
    vi.mocked(bucket.list).mockResolvedValue({ objects: [{ key: 'screenshots/2026_10_19_0.png', size: 1, etag: 'before' }], truncated: false });
    vi.mocked(bucket.get).mockResolvedValue({ key: 'screenshots/2026_10_19_0.png', size: 1, etag: 'after', body: new ReadableStream({ cancel }, { highWaterMark: 0 }), text: async () => '', arrayBuffer: async () => new ArrayBuffer(1) });
    await expect(new Response(await screenshotArchive(bucket, null)).arrayBuffer()).rejects.toThrow(/changed/); expect(cancel).toHaveBeenCalledOnce();
  });
});
