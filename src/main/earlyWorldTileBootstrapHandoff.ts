const APP_READY_EVENT = 'wamp:app-ready';
const HANDOFF_FRAME_COUNT = 2;

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
 * Keep the fixed coarse cover through the first replacement paint. App-ready
 * is emitted only after either tiled GPU coverage or the compact renderer has
 * produced its initial world, and two animation frames prevent a detach in
 * that same pre-paint task.
 */
export function installEarlyWorldTileBootstrapHandoff(
  environment: EarlyWorldTileBootstrapHandoffEnvironment = { win: window, doc: document },
): () => void {
  let animationFrameId: number | null = null;
  let remainingFrames = HANDOFF_FRAME_COUNT;
  let disposed = false;

  const finish = () => {
    if (disposed) return;
    environment.win.__wampEarlyWorldTiles?.release('phaser-coverage-painted');
    cleanup();
  };
  const waitForReplacementPaint = () => {
    if (disposed || animationFrameId !== null) return;
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
    environment.win.__wampEarlyWorldTiles?.alignToGameContainer?.();
    waitForReplacementPaint();
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    environment.win.removeEventListener(APP_READY_EVENT, handleAppReady);
    if (animationFrameId !== null) {
      environment.win.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  environment.win.addEventListener(APP_READY_EVENT, handleAppReady);
  if (environment.doc.body?.dataset.appReady === 'true') handleAppReady();
  return cleanup;
}
