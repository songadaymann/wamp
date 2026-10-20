import { renderMapScreenshot, type CaptureResult, type MapScreenshotEnv } from './capture';
import { formatEasternDate } from './naming';
import { assertCaptureLease, CAPTURE_LEASE_MS, CAPTURE_TIMEOUT_MS, commitDailyZoom, releaseCapture, reserveCapture } from './lease';
import { CaptureBrowserCleanupError } from './managedBrowser';

/** The only capture owner: reserve before expensive work; never launch recurring idle work. */
export async function captureMapScreenshot(env: MapScreenshotEnv, mode: 'manual' | 'daily', date = new Date()): Promise<CaptureResult> {
  env = { ...env, DB: env.DB.withSession?.('first-primary') ?? env.DB };
  const day = formatEasternDate(date);
  const reservation = await reserveCapture(env.DB, env.SCREENSHOTS, mode, day, Date.now());
  if ('busy' in reservation) return { ok: false, busy: true, reason: 'A map capture is already running. Try again shortly.' };
  if ('exhausted' in reservation) return { ok: false, skipped: true, reason: mode === 'daily' ? `Daily capture for ${day} already exists or was attempted.` : `All nine manual capture attempts for ${day} are used.` };
  const { lease } = reservation, controller = new AbortController();
  let retainLease = false;
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(controller.signal.reason); });
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Map capture timed out.')), CAPTURE_TIMEOUT_MS);
  const assertActive = async () => { controller.signal.throwIfAborted(); await assertCaptureLease(env.DB, lease.token); controller.signal.throwIfAborted(); };
  try {
    const result = await Promise.race([renderMapScreenshot(env, { mode, lease, signal: controller.signal, startedAt: date.getTime(), assertActive }), aborted]);
    if (result.ok && mode === 'daily' && typeof result.zoom === 'number') { await assertActive(); await commitDailyZoom(env.DB, lease, result.zoom); }
    return result;
  } catch (error) {
    retainLease = controller.signal.aborted || error instanceof CaptureBrowserCleanupError;
    return { ok: false, error: error instanceof Error ? error.message : String(error), reason: 'Map capture failed. The attempt remains used.' };
  } finally {
    clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
    if (!retainLease) await releaseCapture(env.DB, lease.token);
  }
}

/** Wait only inside a scheduled invocation, bounded below the platform's cron lifetime. */
export async function captureDailyMap(env: MapScreenshotEnv, wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<CaptureResult> {
  const date = new Date(), deadline = Date.now() + CAPTURE_LEASE_MS + 10_000;
  while (true) {
    const result = await captureMapScreenshot(env, 'daily', date);
    if (!result.busy || Date.now() >= deadline) return result;
    await wait(Math.min(10_000, deadline - Date.now()));
  }
}
