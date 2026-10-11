const MODAL_SELECTOR = '.history-modal';
const CLOSE_BUTTON_SELECTOR = 'button[id*="close" i], button[class*="close" i], button[aria-label^="Close" i]';

function isOpenModal(element: HTMLElement): boolean {
  return !element.classList.contains('hidden') && element.getAttribute('aria-hidden') !== 'true';
}

/** Open dialogs, bottom to top: higher z-index first, then later in the page. */
export function openModalsInStackOrder(doc: Document = document): HTMLElement[] {
  const view = doc.defaultView;
  return Array.from(doc.querySelectorAll<HTMLElement>(MODAL_SELECTOR))
    .filter(isOpenModal)
    .map((element, index) => ({ element, index, z: Number.parseInt(view?.getComputedStyle(element).zIndex ?? '', 10) || 0 }))
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map(({ element }) => element);
}

/** Whether any WAMP dialog (every dialog uses `.history-modal`) is open. */
export function hasBlockingModalOpen(doc: Document = document): boolean {
  return Array.from(doc.querySelectorAll<HTMLElement>(MODAL_SELECTOR)).some(isOpenModal);
}

/**
 * Escape closes the open dialog; it must not also reach the game, where it means
 * "leave the room" (and ends a duel). This runs in the capture phase, before any
 * dialog's own handler closes it, and only marks the event handled: dialogs still
 * close, and Phaser's keyboard skips handled events.
 *
 * With dialogs stacked (a profile opened from the leaderboard), every dialog's own
 * Escape handler would close at once; the guard instead closes only the top one, through
 * its close button, and stops the event there.
 */
export function installDialogEscapeGuard(doc: Document = document): () => void {
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    const open = openModalsInStackOrder(doc);
    if (open.length === 0) return;
    event.preventDefault();
    if (open.length < 2) return;
    const close = open[open.length - 1].querySelector<HTMLButtonElement>(CLOSE_BUTTON_SELECTOR);
    if (!close) return;
    event.stopImmediatePropagation();
    close.click();
  };
  doc.addEventListener('keydown', handleKeydown, { capture: true });
  return () => doc.removeEventListener('keydown', handleKeydown, { capture: true });
}

/** Only the top dialog dims the screen; dialogs underneath drop their backdrop. */
export function installModalStackBackdrops(doc: Document = document): () => void {
  let scheduled = false;
  const sync = (): void => {
    scheduled = false;
    const open = openModalsInStackOrder(doc);
    const covered = new Set(open.slice(0, -1));
    for (const element of doc.querySelectorAll<HTMLElement>(MODAL_SELECTOR)) {
      if (covered.has(element)) element.dataset.modalCovered = 'true';
      else delete element.dataset.modalCovered;
    }
  };
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(sync);
  });
  // Watch the dialogs themselves (they are in the page from the start), not every
  // class change in the game UI.
  for (const element of doc.querySelectorAll<HTMLElement>(MODAL_SELECTOR)) {
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  }
  sync();
  return () => observer.disconnect();
}
