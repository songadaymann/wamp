import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './http';
import type { MapScreenshotEnv } from './capture';
import { captureDailyMap } from './captureService';
import { testBucket } from './testBucket';
vi.mock('./captureService', () => ({ captureDailyMap: vi.fn(async () => ({ ok: true })) }));
afterEach(() => vi.clearAllMocks());
describe('public screenshot service', () => {
  it.each(['/api/capture', '/api/capture/daily'])('denies all public capture calls even with spoofed private headers: %s', async path => {
    const database = vi.fn(() => { throw new Error('Database must not be used'); }), browser = vi.fn();
    const { bucket } = testBucket();
    const env = { DB: { prepare: database }, SCREENSHOTS: bucket, MAP_SCREENSHOT_BROWSER: { fetch: browser } } as unknown as MapScreenshotEnv;
    for (const base of ['', '/capture']) {
      const req = new Request('https://raw-map-worker.example' + base + path, { method: 'POST', headers: { 'X-WAMP-Public-Base-Path': base, 'x-admin-key': 'spoof', Authorization: 'Bearer spoof' } });
      expect((await worker.fetch(req, env)).status).toBe(403);
    }
    expect(database).not.toHaveBeenCalled(); expect(browser).not.toHaveBeenCalled(); expect(bucket.list).not.toHaveBeenCalled(); expect(bucket.get).not.toHaveBeenCalled();
  });
  it('keeps the gallery/list/files and month/all-history archives public and reads file bodies lazily', async () => {
    const { bucket } = testBucket({ 'screenshots/2026_10_19_0.png': new Uint8Array([1, 2]), 'screenshots/2026_09_19_0.png': new Uint8Array([3]) });
    const env = { SCREENSHOTS: bucket, MAP_SCREENSHOT_ADMIN_BASE_URL: 'https://fixture.invalid' } as MapScreenshotEnv;
    const get = (path: string) => worker.fetch(new Request('https://map.example' + path), env);
    expect((await get('/api/health')).status).toBe(200);
    const gallery = await (await get('/')).text(); expect(gallery).toContain('Capture in Launch Admin'); expect(gallery).not.toContain("method: 'POST'");
    expect(await (await get('/api/screenshots')).json()).toMatchObject({ screenshots: expect.any(Array) });
    const archive = await get('/archive.zip?month=2026_10'); expect(archive.status).toBe(200); expect(bucket.get).not.toHaveBeenCalled();
    await archive.arrayBuffer(); expect(bucket.get).toHaveBeenCalledTimes(1); expect(bucket.list).toHaveBeenLastCalledWith(expect.objectContaining({ prefix: 'screenshots/2026_10_' }));
    vi.mocked(bucket.get).mockClear(); await (await get('/archive.zip')).arrayBuffer(); expect(bucket.get).toHaveBeenCalledTimes(2);
    const image = await get('/files/2026_10_19_0.png'); expect(image.headers.get('content-length')).toBe('2'); expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    expect((await get('/archive.zip?month=invalid')).status).toBe(400);
    vi.mocked(bucket.get).mockClear();
    const head = await worker.fetch(new Request('https://map.example/archive.zip', { method: 'HEAD' }), env);
    expect(head.status).toBe(200); expect(await head.text()).toBe(''); expect(bucket.get).not.toHaveBeenCalled();
  });
  it('schedules only the bounded daily capture owner', async () => {
    const pending: Promise<unknown>[] = [], log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const env = {} as MapScreenshotEnv;
      await worker.scheduled({ cron: '0 4 * * *', scheduledTime: Date.now() }, env, { waitUntil: promise => pending.push(promise) });
      await Promise.all(pending); expect(captureDailyMap).toHaveBeenCalledExactlyOnceWith(env);
    } finally { log.mockRestore(); }
  });
});
