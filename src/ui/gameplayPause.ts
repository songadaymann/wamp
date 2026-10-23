import { hasBlockingModalOpen, watchModals } from './modalState';
import { hasPendingDialog, subscribePendingDialogs } from './pendingDialog';

export interface GameplayPauseContext {
  playing: boolean;
  available: boolean;
  ranked?: boolean;
  liveReason: 'multiplayer' | 'weekly-rush' | null;
}

interface PauseEvents {
  on(event: 'prestep', callback: () => void): unknown;
  off(event: 'prestep', callback: () => void): unknown;
}

/** Compose menu, intro and suggestion ownership before changing the Phaser scene state. */
export function applyGameplayPause(
  scene: { pause(): unknown; resume(): unknown },
  feedback: { setScenePaused(paused: boolean): void },
  requested: boolean,
  applied: boolean,
): boolean {
  if (requested === applied) return applied;
  feedback.setScenePaused(requested);
  if (requested) scene.pause();
  else scene.resume();
  return requested;
}

/** Watches UI changes once; the game-level check also runs while the scene is paused. */
export function installGameplayPause(
  events: PauseEvents,
  getContext: () => GameplayPauseContext,
  requestPause: (paused: boolean) => void,
  doc: Document = document,
): () => void {
  const menu = doc.getElementById('auth-panel');
  const status = doc.getElementById('game-pause-status');
  let blocked = false;
  let requested = false;
  let message = '';
  let destroyed = false;
  const sync = (): void => {
    if (destroyed) return;
    const context = getContext();
    const pause = context.available && context.playing && blocked && !context.liveReason;
    if (pause !== requested) {
      requested = pause;
      requestPause(pause);
    }
    const nextMessage = context.playing && context.available
      ? context.liveReason === 'weekly-rush' ? 'Weekly Rush keeps running'
        : context.liveReason === 'multiplayer' ? 'Multiplayer keeps running' : context.ranked ? 'Paused. Ranking time includes breaks.' : 'Paused'
      : '';
    if (status && message !== nextMessage) {
      message = nextMessage;
      status.textContent = message;
      status.classList.toggle('hidden', !message);
    }
  };
  const readUi = (): void => {
    blocked = Boolean(menu?.classList.contains('menu-open')) || hasBlockingModalOpen(doc) || hasPendingDialog()
      || doc.visibilityState === 'hidden';
    sync();
  };
  const menuObserver = new MutationObserver(readUi);
  if (menu) menuObserver.observe(menu, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  // Includes dialogs inserted on demand (modalState watches the page for them).
  const stopWatchingModals = watchModals(doc, readUi);
  doc.addEventListener('visibilitychange', readUi);
  const unsubscribePending = subscribePendingDialogs(readUi);
  events.on('prestep', sync);
  readUi();
  return () => {
    destroyed = true;
    menuObserver.disconnect(); stopWatchingModals();
    doc.removeEventListener('visibilitychange', readUi);
    unsubscribePending();
    events.off('prestep', sync);
    // Teardown must never resume a stopped/sleeping/replaced scene.
    if (status) { status.textContent = ''; status.classList.add('hidden'); }
  };
}
