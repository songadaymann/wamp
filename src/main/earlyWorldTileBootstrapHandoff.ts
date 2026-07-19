const APP_READY_EVENT = 'wamp:app-ready';
export const WORLD_TILE_REPLACEMENT_READY_EVENT = 'wamp:world-tiles-replacement-ready';
const HANDOFF_FRAME_COUNT = 2;
const HANDOFF_FALLBACK_TIMEOUT_MS = 10_000;

export interface EarlyWorldTileBootstrapHandoffEnvironment {
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'requestAnimationFrame' | 'cancelAnimationFrame'> & {
    __wampEarlyWorldTiles?: {
      alignToGameContainer?(): void;
      release(reason?: string): void;
    };
  };
  doc: { body: { dataset: { appReady?: string } } | null };
}

/**
 * Keep the fixed bootstrap cover through the first verified Phaser replacement
 * paint. App readiness and replacement coverage can arrive in either order;
 * two animation frames prevent a detach in the same pre-paint task. The timeout
 * is a last-resort escape hatch if a renderer fails to publish its milestone.
 */
export function installEarlyWorldTileBootstrapHandoff(
  environment: EarlyWorldTileBootstrapHandoffEnvironment = { win: window, doc: document },
): () => void {
  let animationFrameId: number | null = null;
  let remainingFrames = HANDOFF_FRAME_COUNT;
  let disposed = false;
  let appReady = environment.doc.body?.dataset.appReady === 'true';
  let replacementReady = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const finish = () => {
    if (disposed) return;
    environment.win.__wampEarlyWorldTiles?.release('phaser-coverage-painted');
    cleanup();
  };
  const waitForReplacementPaint = () => {
    if (disposed || !appReady || !replacementReady || animationFrameId !== null) return;
    const step = () => {
      animationFrameId = null;
      if (disposed) return;
      remainingFrames -= 1;
      if (remainingFrames <= 0) {
        finish();
        return;
      }
      animationFrameId = environment.win.requestAnimationFrame(step);
    };
    animationFrameId = environment.win.requestAnimationFrame(step);
  };
  const handleAppReady = () => {
    appReady = true;
    environment.win.__wampEarlyWorldTiles?.alignToGameContainer?.();
    waitForReplacementPaint();
    if (!replacementReady && fallbackTimer === null) {
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        replacementReady = true;
        waitForReplacementPaint();
      }, HANDOFF_FALLBACK_TIMEOUT_MS);
    }
  };
  const handleReplacementReady = () => {
    replacementReady = true;
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    waitForReplacementPaint();
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    environment.win.removeEventListener(APP_READY_EVENT, handleAppReady);
    environment.win.removeEventListener(WORLD_TILE_REPLACEMENT_READY_EVENT, handleReplacementReady);
    if (animationFrameId !== null) {
      environment.win.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  };

  environment.win.addEventListener(APP_READY_EVENT, handleAppReady);
  environment.win.addEventListener(WORLD_TILE_REPLACEMENT_READY_EVENT, handleReplacementReady);
  if (appReady) handleAppReady();
  return cleanup;
}
