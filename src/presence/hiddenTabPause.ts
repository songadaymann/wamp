/** How long a tab stays hidden before its realtime sockets close (F095). */
export const HIDDEN_TAB_PAUSE_DELAY_MS = 30_000;

/**
 * Calls `pause` once the page has been hidden for `delayMs`, and `resume` when it is visible
 * again. A quick switch away and back changes nothing.
 */
export function installHiddenTabPause(
  pause: () => void,
  resume: () => void,
  delayMs: number = HIDDEN_TAB_PAUSE_DELAY_MS,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): () => void {
  if (!doc) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  const handleVisibilityChange = (): void => {
    if (doc.hidden) {
      if (!timer && !paused) {
        timer = setTimeout(() => {
          timer = null;
          paused = true;
          pause();
        }, delayMs);
      }
      return;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (paused) {
      paused = false;
      resume();
    }
  };
  doc.addEventListener('visibilitychange', handleVisibilityChange);
  return () => {
    doc.removeEventListener('visibilitychange', handleVisibilityChange);
    if (timer) clearTimeout(timer);
  };
}
