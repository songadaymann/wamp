import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../cloudflare/worker/activity/testDatabase';
import { testBucket } from './testBucket';
import type { MapScreenshotEnv } from './capture';
import { renderMapScreenshot } from './capture';
import { captureDailyMap, captureMapScreenshot } from './captureService';
import { reserveCapture, releaseCapture } from './lease';
import { CaptureBrowserCleanupError } from './managedBrowser';
vi.mock('./capture', () => ({ renderMapScreenshot: vi.fn(async () => ({ ok: true, zoom: 0.5 })) }));
let f: ReturnType<typeof fixture>, env: MapScreenshotEnv;
beforeEach(() => {
  f = fixture(); const { bucket } = testBucket();
  env = { DB: f.env.DB, SCREENSHOTS: bucket, MAP_SCREENSHOT_BROWSER: { fetch: vi.fn() }, WORLD_TILE_PUBLIC_BASE_URL: 'https://fixture.invalid', MAP_SCREENSHOT_ADMIN_BASE_URL: 'https://fixture.invalid' };
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T17:00:00Z')); vi.mocked(renderMapScreenshot).mockClear();
  vi.mocked(renderMapScreenshot).mockResolvedValue({ ok: true, zoom: 0.5 });
});
afterEach(() => { f.sqlite.close(); vi.useRealTimers(); });
describe('capture service budgets and zoom ownership', () => {
  it('returns at the request deadline and retains a bounded lease for uncertain cleanup', async () => {
    vi.mocked(renderMapScreenshot).mockImplementationOnce(() => new Promise<never>(() => undefined));
    const pending = captureMapScreenshot(env, 'manual'); await vi.advanceTimersByTimeAsync(120001);
    expect(await pending).toMatchObject({ ok: false, error: 'Map capture timed out.' });
    expect(await reserveCapture(env.DB, env.SCREENSHOTS, 'manual', '2026_10_19', Date.now())).toEqual({ busy: true });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains a lease after failed browser cleanup instead of starting another browser', async () => {
    vi.mocked(renderMapScreenshot).mockRejectedValueOnce(new CaptureBrowserCleanupError('Cleanup pending'));
    expect(await captureMapScreenshot(env, 'manual')).toMatchObject({ ok: false });
    expect(await captureMapScreenshot(env, 'manual')).toMatchObject({ busy: true });
    expect(renderMapScreenshot).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('retains failed attempts, releases the lease and leaves no timer', async () => {
    vi.mocked(renderMapScreenshot).mockRejectedValueOnce(new Error('Browser failed'));
    expect(await captureMapScreenshot(env, 'manual')).toMatchObject({ ok: false, error: 'Browser failed' });
    expect(await captureMapScreenshot(env, 'manual')).toMatchObject({ ok: true });
    expect(f.sqlite.prepare('SELECT slot FROM map_screenshot_capture_attempts ORDER BY slot').all()).toEqual([{ slot: 1 }, { slot: 2 }]);
    expect(f.sqlite.prepare('SELECT token,daily_zoom FROM map_screenshot_capture_lease').get()).toEqual({ token: null, daily_zoom: null });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('only commits daily zoom and never renders the same daily attempt twice', async () => {
    await captureMapScreenshot(env, 'daily');
    vi.mocked(renderMapScreenshot).mockResolvedValue({ ok: true, zoom: 0.9 }); await captureMapScreenshot(env, 'manual');
    expect(f.sqlite.prepare('SELECT daily_zoom,daily_zoom_date FROM map_screenshot_capture_lease').get()).toEqual({ daily_zoom: 0.5, daily_zoom_date: '2026_10_19' });
    expect(await captureMapScreenshot(env, 'daily')).toMatchObject({ skipped: true });
    expect(renderMapScreenshot).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('retries a busy cron inside its invocation and preserves the original Eastern day across midnight', async () => {
    vi.setSystemTime(new Date('2026-10-20T03:59:59Z'));
    const reservation = await reserveCapture(env.DB, env.SCREENSHOTS, 'manual', '2026_10_19', Date.now());
    if (!('lease' in reservation)) throw new Error('Expected lease');
    let waits = 0;
    const result = await captureDailyMap(env, async ms => { waits++; vi.setSystemTime(Date.now() + ms); await releaseCapture(env.DB, reservation.lease.token); });
    expect(result.ok).toBe(true); expect(waits).toBe(1);
    expect(vi.mocked(renderMapScreenshot).mock.calls[0]![1].lease.fileName).toBe('2026_10_19_0.png');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops busy retries at the fixed deadline without consuming daily attempts', async () => {
    f.sqlite.prepare('UPDATE map_screenshot_capture_lease SET token=?,expires_at=?').run('busy', Date.now() + 1000000);
    const start = Date.now(); let waits = 0;
    expect(await captureDailyMap(env, async ms => { waits++; vi.setSystemTime(Date.now() + ms); })).toMatchObject({ busy: true });
    expect(Date.now() - start).toBe(250000); expect(waits).toBe(25); expect(renderMapScreenshot).not.toHaveBeenCalled();
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM map_screenshot_capture_attempts').get()).toEqual({ n: 0 });
  });
});
