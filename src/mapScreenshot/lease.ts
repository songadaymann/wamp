import type { D1Database } from '../cloudflare/worker/core/types';
import type { ScreenshotR2Bucket } from './storage';
import { SCREENSHOT_KEY_PREFIX } from './config';

export const CAPTURE_TIMEOUT_MS = 120_000;
export const CAPTURE_LEASE_MS = 240_000;
export interface CaptureLease { token: string; day: string; slot: number; fileName: string; previousZoom: number | null }
export type LeaseResult = { lease: CaptureLease } | { busy: true } | { exhausted: true };

export async function reserveCapture(db: Pick<D1Database, 'prepare'>, bucket: ScreenshotR2Bucket, mode: 'manual' | 'daily', day: string, now: number): Promise<LeaseResult> {
  const token = crypto.randomUUID();
  const lock = await db.prepare(`UPDATE map_screenshot_capture_lease SET token = ?, expires_at = ? WHERE id = 1 AND expires_at <= ? RETURNING daily_zoom`)
    .bind(token, now + CAPTURE_LEASE_MS, now).first<{ daily_zoom: number | null }>();
  if (!lock) return { busy: true };
  try {
    // Cleanup is indexed, bounded and runs only during an actual capture request.
    await db.prepare(`DELETE FROM map_screenshot_capture_attempts WHERE token IN (SELECT token FROM map_screenshot_capture_attempts WHERE started_at < ? ORDER BY started_at LIMIT 100) RETURNING token`)
      .bind(now - 7 * 86400_000).all();
    const existing = await bucket.list({ prefix: `${SCREENSHOT_KEY_PREFIX}${day}_`, limit: 1000 });
    if (existing.truncated) throw new Error('Screenshot day listing exceeded its limit.');
    const slots = existing.objects.map(o => /^\d{4}_\d{2}_\d{2}_([0-9])\.png$/.exec(o.key.slice(SCREENSHOT_KEY_PREFIX.length)))
      .filter((m): m is RegExpExecArray => m !== null).map(m => Number(m[1]));
    await assertCaptureLease(db, token);
    const candidates = mode === 'daily' ? [0] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const available = candidates.filter(slot => !slots.includes(slot));
    const row = available.length ? await db.prepare(`INSERT INTO map_screenshot_capture_attempts (day,slot,token,started_at)
      SELECT ?, CAST(candidate.value AS INTEGER), ?, ? FROM json_each(?) candidate
      WHERE NOT EXISTS (SELECT 1 FROM map_screenshot_capture_attempts a WHERE a.day = ? AND a.slot = CAST(candidate.value AS INTEGER))
      AND EXISTS (SELECT 1 FROM map_screenshot_capture_lease WHERE id = 1 AND token = ? AND expires_at > ?)
      ORDER BY candidate.value LIMIT 1 RETURNING slot`)
      .bind(day, token, now, JSON.stringify(available), day, token, Date.now()).first<{ slot: number }>() : null;
    if (!row) { await releaseCapture(db, token); return { exhausted: true }; }
    return { lease: { token, day, slot: row.slot, fileName: `${day}_${row.slot}.png`, previousZoom: lock.daily_zoom } };
  } catch (error) { await releaseCapture(db, token); throw error; }
}
export async function assertCaptureLease(db: Pick<D1Database, 'prepare'>, token: string, now = Date.now()): Promise<void> {
  const row = await db.prepare('SELECT token FROM map_screenshot_capture_lease WHERE id = 1 AND token = ? AND expires_at > ?').bind(token, now).first();
  if (!row) throw new Error('Capture reservation expired.');
}
export async function commitDailyZoom(db: Pick<D1Database, 'prepare'>, lease: CaptureLease, zoom: number, now = Date.now()): Promise<void> {
  const row = await db.prepare(`UPDATE map_screenshot_capture_lease SET daily_zoom = ?, daily_zoom_date = ?
    WHERE id = 1 AND token = ? AND expires_at > ?
    AND EXISTS (SELECT 1 FROM map_screenshot_capture_attempts WHERE token = ? AND slot = 0)
    RETURNING token`).bind(zoom, lease.day, lease.token, now, lease.token).first();
  if (!row) throw new Error('Capture reservation expired before saving daily zoom.');
}
export async function releaseCapture(db: Pick<D1Database, 'prepare'>, token: string): Promise<void> {
  await db.prepare('UPDATE map_screenshot_capture_lease SET token = NULL, expires_at = 0 WHERE id = 1 AND token = ? RETURNING id').bind(token).first();
}
