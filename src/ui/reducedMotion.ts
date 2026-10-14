import { getReduceMotionMode, subscribeComfortSettings } from '../settings/comfortSettings';
let reducedMotionQuery: MediaQueryList | null | undefined;

function resolveReducedMotion(): boolean {
  const mode = getReduceMotionMode();
  return mode === 'on' || (mode === 'system' && (reducedMotionQuery?.matches ?? false));
}
function syncReducedMotionAttribute(): void {
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.reduceMotion = resolveReducedMotion() ? 'on' : 'off';
  }
}
function initializeMotionQuery(): void {
  if (reducedMotionQuery !== undefined) return;
  reducedMotionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  reducedMotionQuery?.addEventListener?.('change', syncReducedMotionAttribute);
  syncReducedMotionAttribute();
}

/** Effective comfort preference; System tracks one live MediaQueryList. */
export function prefersReducedMotion(): boolean {
  initializeMotionQuery();
  return resolveReducedMotion();
}
subscribeComfortSettings(() => { initializeMotionQuery(); syncReducedMotionAttribute(); });
if (typeof window !== 'undefined') initializeMotionQuery();
