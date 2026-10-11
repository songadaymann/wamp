let reducedMotionQuery: MediaQueryList | null | undefined;

/**
 * Whether the player has asked their system for less motion. The MediaQueryList is created
 * once and its `matches` stays current when the setting changes.
 */
export function prefersReducedMotion(): boolean {
  if (reducedMotionQuery === undefined) {
    reducedMotionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  }
  return reducedMotionQuery?.matches ?? false;
}
