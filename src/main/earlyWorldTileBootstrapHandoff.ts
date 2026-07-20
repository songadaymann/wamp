import {
  WORLD_TILE_REPLACEMENT_INVALIDATED_EVENT,
  WORLD_TILE_REPLACEMENT_READY_EVENT,
  getWorldReplacementCoverageState,
  type WorldReplacementCoverageEventTarget,
} from './worldReplacementCoverage';

export { WORLD_TILE_REPLACEMENT_READY_EVENT } from './worldReplacementCoverage';

const APP_READY_EVENT = 'wamp:app-ready';
const HANDOFF_FRAME_COUNT = 2;

export interface EarlyWorldTileBootstrapHandoffEnvironment {
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'requestAnimationFrame' | 'cancelAnimationFrame'> & {
    __wampEarlyWorldTiles?: {
      alignToGameContainer?(): void;
      release(reason?: string): void;
    };
  } & WorldReplacementCoverageEventTarget;
  doc: { body: { dataset: { appReady?: string } } | null };
}

/**
 * Keep the fixed bootstrap cover through the first verified Phaser replacement
 * paint. App readiness and replacement coverage can arrive in either order;
 * two animation frames prevent a detach in the same pre-paint task. Coverage
 * invalidation cancels a pending detach, so a stale readiness event cannot
 * release the cover while replacement imagery is changing.
 */
export function installEarlyWorldTileBootstrapHandoff(
  environment: EarlyWorldTileBootstrapHandoffEnvironment = { win: window, doc: document },
): () => void {
  let animationFrameId: number | null = null;
  let remainingFrames = HANDOFF_FRAME_COUNT;
  let disposed = false;
  let appReady = environment.doc.body?.dataset.appReady === 'true';
  let replacementKey: string | null = null;

  const cancelPendingRelease = () => {
    if (animationFrameId !== null) {
      environment.win.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    remainingFrames = HANDOFF_FRAME_COUNT;
  };

  const isReplacementCurrent = (key: string): boolean => (
    getWorldReplacementCoverageState(environment.win)?.key === key
  );

  const finish = () => {
    if (disposed || !replacementKey || !isReplacementCurrent(replacementKey)) return;
    environment.win.__wampEarlyWorldTiles?.release('phaser-coverage-painted');
    cleanup();
  };
  const waitForReplacementPaint = () => {
    if (disposed || !appReady || !replacementKey || animationFrameId !== null) return;
    const expectedKey = replacementKey;
    const step = () => {
      animationFrameId = null;
      if (disposed) return;
      if (!appReady || !isReplacementCurrent(expectedKey)) {
        syncReplacementState();
        return;
      }
      remainingFrames -= 1;
      if (remainingFrames <= 0) {
        finish();
        return;
      }
      animationFrameId = environment.win.requestAnimationFrame(step);
    };
    animationFrameId = environment.win.requestAnimationFrame(step);
  };
  const syncReplacementState = () => {
    if (disposed) return;
    const currentKey = getWorldReplacementCoverageState(environment.win)?.key ?? null;
    if (currentKey !== replacementKey) {
      cancelPendingRelease();
      replacementKey = currentKey;
    }
    waitForReplacementPaint();
  };
  const handleAppReady = () => {
    appReady = true;
    environment.win.__wampEarlyWorldTiles?.alignToGameContainer?.();
    syncReplacementState();
  };
  const handleReplacementStateChanged = () => syncReplacementState();
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    environment.win.removeEventListener(APP_READY_EVENT, handleAppReady);
    environment.win.removeEventListener(WORLD_TILE_REPLACEMENT_READY_EVENT, handleReplacementStateChanged);
    environment.win.removeEventListener(
      WORLD_TILE_REPLACEMENT_INVALIDATED_EVENT,
      handleReplacementStateChanged,
    );
    cancelPendingRelease();
  };

  environment.win.addEventListener(APP_READY_EVENT, handleAppReady);
  environment.win.addEventListener(WORLD_TILE_REPLACEMENT_READY_EVENT, handleReplacementStateChanged);
  environment.win.addEventListener(
    WORLD_TILE_REPLACEMENT_INVALIDATED_EVENT,
    handleReplacementStateChanged,
  );
  if (appReady) handleAppReady();
  else syncReplacementState();
  return cleanup;
}
