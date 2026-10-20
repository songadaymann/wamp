import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../cloudflare/worker/activity/testDatabase';
import { assertCaptureLease, CAPTURE_LEASE_MS, commitDailyZoom, releaseCapture, reserveCapture } from './lease';
import { testBucket } from './testBucket';

let f: ReturnType<typeof fixture>;
const day = '2026_10_19';
beforeEach(() => { f = fixture(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T17:00:00Z')); });
afterEach(() => { f.sqlite.close(); vi.useRealTimers(); });
describe('durable screenshot reservations', () => {
  it('admits only one concurrent request before any R2 listing or render', async () => {
    const { bucket } = testBucket();
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveCapture(f.env.DB, bucket, 'manual', day, Date.now())));
    expect(results.filter(r => 'lease' in r)).toHaveLength(1); expect(results.filter(r => 'busy' in r)).toHaveLength(19);
    expect(bucket.list).toHaveBeenCalledTimes(1);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM map_screenshot_capture_attempts').get()).toEqual({ n: 1 });
  });
  it('spends all nine manual attempts, preserves daily zero and never reuses a failed slot', async () => {
    const { bucket } = testBucket();
    for (let slot = 1; slot <= 9; slot++) {
      const result = await reserveCapture(f.env.DB, bucket, 'manual', day, Date.now()); expect('lease' in result).toBe(true);
      if (!('lease' in result)) throw new Error('Expected lease');
      expect(result.lease.slot).toBe(slot); await releaseCapture(f.env.DB, result.lease.token);
    }
    expect(await reserveCapture(f.env.DB, bucket, 'manual', day, Date.now())).toEqual({ exhausted: true });
    const daily = await reserveCapture(f.env.DB, bucket, 'daily', day, Date.now());
    if (!('lease' in daily)) throw new Error('Expected daily lease'); expect(daily.lease.slot).toBe(0);
    await releaseCapture(f.env.DB, daily.lease.token);
    expect(await reserveCapture(f.env.DB, bucket, 'daily', day, Date.now())).toEqual({ exhausted: true });
    expect(f.sqlite.prepare('SELECT token FROM map_screenshot_capture_lease').get()).toEqual({ token: null });
  });
  it('accounts for existing files before allocating a fresh slot', async () => {
    const { bucket } = testBucket(Object.fromEntries([0, 1, 3].map(i => [`screenshots/${day}_${i}.png`, 'png'])));
    const manual = await reserveCapture(f.env.DB, bucket, 'manual', day, Date.now());
    if (!('lease' in manual)) throw new Error('Expected lease'); expect(manual.lease.fileName).toBe(`${day}_2.png`);
    await releaseCapture(f.env.DB, manual.lease.token);
    expect(await reserveCapture(f.env.DB, bucket, 'daily', day, Date.now())).toEqual({ exhausted: true });
  });
  it('fences an expired writer and release while retaining the new lease and daily zoom', async () => {
    const { bucket } = testBucket(); const first = await reserveCapture(f.env.DB, bucket, 'manual', day, Date.now());
    if (!('lease' in first)) throw new Error('Expected lease');
    vi.setSystemTime(Date.now() + CAPTURE_LEASE_MS + 1);
    const second = await reserveCapture(f.env.DB, bucket, 'daily', day, Date.now());
    if (!('lease' in second)) throw new Error('Expected new lease');
    await expect(assertCaptureLease(f.env.DB, first.lease.token)).rejects.toThrow(/expired/);
    await expect(commitDailyZoom(f.env.DB, first.lease, 0.1)).rejects.toThrow();
    await releaseCapture(f.env.DB, first.lease.token); await assertCaptureLease(f.env.DB, second.lease.token);
    await commitDailyZoom(f.env.DB, second.lease, 0.5); await releaseCapture(f.env.DB, second.lease.token);
    const third = await reserveCapture(f.env.DB, bucket, 'manual', day, Date.now());
    if (!('lease' in third)) throw new Error('Expected lease'); expect(third.lease.previousZoom).toBe(0.5);
  });
  it('cleans at most 100 indexed old attempts per invocation', async () => {
    const insert = f.sqlite.prepare('INSERT INTO map_screenshot_capture_attempts VALUES (?,?,?,?)');
    for (let n = 0; n < 150; n++) insert.run(`old-${n}`, 0, `old-${n}`, Date.now() - 10 * 86400_000);
    const { bucket } = testBucket(); await reserveCapture(f.env.DB, bucket, 'manual', day, Date.now());
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM map_screenshot_capture_attempts WHERE token LIKE 'old-%'").get()).toEqual({ n: 50 });
  });
});
