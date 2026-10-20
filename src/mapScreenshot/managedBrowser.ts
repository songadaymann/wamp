/** Owns cleanup even when launch resolves after cancellation or page work fails. */
export class CaptureBrowserCleanupError extends Error {}
export async function withCaptureBrowser<T extends { close(): Promise<void>; disconnect?(): Promise<void> | void }, R>(
  launch: () => Promise<T>, work: (browser: T) => Promise<R>, signal: AbortSignal,
): Promise<R> {
  signal.throwIfAborted();
  const browser = await launch();
  let close: Promise<void> | null = null;
  const closeOnce = () => close ??= (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([browser.close(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Browser close timed out.')), 10_000); })]);
    } catch {
      try { void Promise.resolve(browser.disconnect?.()).catch(() => undefined); } catch { /* The lease still protects uncertain cleanup. */ }
      throw new CaptureBrowserCleanupError('Browser cleanup is pending. The capture reservation remains held until it expires.');
    } finally { clearTimeout(timer); }
  })();
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => { void closeOnce().catch(() => undefined); rejectAbort(signal.reason ?? new Error('Browser capture timed out.')); };
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 90_000);
  try {
    signal.throwIfAborted();
    const result = await Promise.race([work(browser), aborted]); signal.throwIfAborted(); return result;
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort); await closeOnce();
  }
}
