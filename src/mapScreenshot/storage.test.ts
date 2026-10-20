import { describe, expect, it, vi } from 'vitest';
import { loadPreviousZoom, type ScreenshotR2Bucket } from './storage';
import { STATE_OBJECT_KEY } from './config';

function history(zooms: Record<string, string | undefined>, stateZoom?: number) {
  const cancelled: string[] = [];
  const readImage = vi.fn(() => { throw new Error('Zoom recovery must not buffer PNG bytes.'); });
  const bucket: ScreenshotR2Bucket = {
    list: vi.fn(async () => ({ truncated: false, objects: Object.keys(zooms).map(name => ({ key: 'screenshots/' + name, size: 1 })) })),
    get: vi.fn(async (key: string) => {
      if (key === STATE_OBJECT_KEY) {
        return stateZoom === undefined ? null : { key, size: 1, body: new ReadableStream<Uint8Array>(), text: async () => JSON.stringify({ zoom: stateZoom }), arrayBuffer: readImage };
      }
      const name = key.slice('screenshots/'.length);
      if (!(name in zooms)) return null;
      const customMetadata: Record<string, string> = {};
      const zoom = zooms[name];
      if (zoom !== undefined) customMetadata.zoom = zoom;
      return { key, size: 1, customMetadata,
        body: new ReadableStream<Uint8Array>({ cancel() { cancelled.push(name); } }), text: readImage, arrayBuffer: readImage };
    }),
    put: vi.fn(),
  };
  return { bucket, cancelled, readImage };
}

describe('daily zoom recovery during migration', () => {
  it('does not start storage work after the capture deadline', async () => {
    const f = history({ '2026_10_19_0.png': '0.5' });
    await expect(loadPreviousZoom(f.bucket, AbortSignal.abort(new Error('Deadline')))).rejects.toThrow('Deadline');
    expect(f.bucket.list).not.toHaveBeenCalled(); expect(f.bucket.get).not.toHaveBeenCalled();
  });
  it('cancels a body returned after the deadline and stops before further history reads', async () => {
    const f = history({ '2026_10_20_0.png': '0.6', '2026_10_19_0.png': '0.5' });
    const controller = new AbortController(), original = f.bucket.get;
    f.bucket.get = vi.fn(async (key: string) => { const object = await original(key); controller.abort(new Error('Deadline')); return object; });
    await expect(loadPreviousZoom(f.bucket, controller.signal)).rejects.toThrow('Deadline');
    expect(f.bucket.get).toHaveBeenCalledOnce(); expect(f.cancelled).toEqual(['2026_10_20_0.png']);
  });
  it('prefers the daily capture over newer manual metadata and contaminated shared state', async () => {
    const f = history({ '2026_10_20_1.png': '0.9', '2026_10_19_0.png': '0.5' }, 0.8);
    expect(await loadPreviousZoom(f.bucket)).toBe(0.5);
    expect(f.cancelled).toEqual(['2026_10_19_0.png']);
    expect(f.bucket.get).not.toHaveBeenCalledWith(STATE_OBJECT_KEY);
    expect(f.readImage).not.toHaveBeenCalled();
  });
  it('finds the latest usable daily metadata and releases every unread PNG body', async () => {
    const f = history({ '2026_10_20_0.png': 'Infinity', '2026_10_19_0.png': '', '2026_10_18_0.png': undefined, '2026_10_17_0.png': '0.4' }, 0.9);
    expect(await loadPreviousZoom(f.bucket)).toBe(0.4);
    expect(f.cancelled).toEqual(['2026_10_20_0.png', '2026_10_19_0.png', '2026_10_18_0.png', '2026_10_17_0.png']);
    expect(f.readImage).not.toHaveBeenCalled();
  });
  it('retains legacy shared-state recovery if no daily baseline exists', async () => {
    const f = history({ '2026_10_20_1.png': '0.9' }, 0.7);
    expect(await loadPreviousZoom(f.bucket)).toBe(0.7);
    expect(f.cancelled).toEqual([]);
  });
  it('recovers the last manual metadata only without daily/state history, or fits a first-ever capture', async () => {
    const f = history({ '2026_10_20_1.png': '0.8', '2026_10_19_1.png': '0.7' });
    expect(await loadPreviousZoom(f.bucket)).toBe(0.8);
    expect(f.cancelled).toEqual(['2026_10_20_1.png']);
    expect(f.readImage).not.toHaveBeenCalled();
    expect(await loadPreviousZoom(history({}).bucket)).toBeNull();
  });
});
