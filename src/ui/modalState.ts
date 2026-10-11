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

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isShown(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 && element.closest('.hidden') === null;
}

/** Tab stops in order. A radio group is one stop: its checked radio, else its first. */
function focusableIn(container: HTMLElement): HTMLElement[] {
  const seenGroups = new Set<string>();
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (!isShown(element)) return false;
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name) return true;
    if (seenGroups.has(element.name)) return false;
    const group = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .filter((radio) => radio.name === element.name && isShown(radio));
    const stop = group.find((radio) => radio.checked) ?? group[0];
    if (stop !== element) return false;
    seenGroups.add(element.name);
    return true;
  });
}

function dialogPanel(modal: HTMLElement): HTMLElement {
  return modal.querySelector<HTMLElement>('[role="dialog"]') ?? modal;
}

/**
 * Keyboard focus follows the dialogs: opening one moves focus into it (its [data-autofocus] control,
 * otherwise the dialog itself, so phones don't raise a keyboard), Tab and Shift+Tab stay inside
 * the top dialog, and closing it returns focus to where it was. Dialogs that focus something
 * themselves when they open keep that.
 */
export function installModalFocusManagement(doc: Document = document): () => void {
  const view = doc.defaultView;
  const returnFocus = new Map<HTMLElement, HTMLElement | null>();
  let open = new Set<HTMLElement>();

  const focusInto = (modal: HTMLElement): void => {
    if (!open.has(modal) || modal.contains(doc.activeElement)) return;
    const panel = dialogPanel(modal);
    const preferred = panel.querySelector<HTMLElement>('[data-autofocus]');
    if (preferred && isShown(preferred)) {
      preferred.focus({ preventScroll: true });
      return;
    }
    if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
    panel.focus({ preventScroll: true });
  };

  const sync = (): void => {
    const now = new Set(openModalsInStackOrder(doc));
    for (const modal of now) {
      if (open.has(modal)) continue;
      const active = doc.activeElement;
      returnFocus.set(modal, active instanceof HTMLElement && active !== doc.body ? active : null);
      // Let the dialog's own open code run first; it may focus a field itself.
      view?.requestAnimationFrame(() => focusInto(modal));
    }
    for (const modal of open) {
      if (now.has(modal)) continue;
      const target = returnFocus.get(modal) ?? null;
      returnFocus.delete(modal);
      const active = doc.activeElement;
      const focusWasInDialog = active === doc.body || active === null || modal.contains(active);
      if (focusWasInDialog && target?.isConnected && isShown(target)) target.focus({ preventScroll: true });
      else if (focusWasInDialog && active instanceof HTMLElement && modal.contains(active)) active.blur();
    }
    open = now;
  };

  let lastTabBackward = false;
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    lastTabBackward = event.shiftKey;
    const stack = openModalsInStackOrder(doc);
    const top = stack[stack.length - 1];
    if (!top) return;
    const items = focusableIn(dialogPanel(top));
    const active = doc.activeElement;
    if (items.length === 0) {
      event.preventDefault();
      focusInto(top);
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const inside = active instanceof HTMLElement && top.contains(active);
    if (!inside || (event.shiftKey && (active === first || active === dialogPanel(top))) || (!event.shiftKey && active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  };

  // Backstop for anything the Tab handler misses: focus that lands outside the top dialog
  // while it is open goes back in.
  const handleFocusIn = (event: FocusEvent): void => {
    const stack = openModalsInStackOrder(doc);
    const top = stack[stack.length - 1];
    if (!top || !(event.target instanceof Node) || top.contains(event.target)) return;
    const items = focusableIn(dialogPanel(top));
    const target = lastTabBackward ? items[items.length - 1] : items[0];
    if (target) target.focus({ preventScroll: true });
    else focusInto(top);
  };

  const observer = new MutationObserver(sync);
  for (const element of doc.querySelectorAll<HTMLElement>(MODAL_SELECTOR)) {
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  }
  doc.addEventListener('keydown', handleKeydown, { capture: true });
  doc.addEventListener('focusin', handleFocusIn);
  open = new Set(openModalsInStackOrder(doc));
  for (const modal of open) {
    returnFocus.set(modal, null);
    view?.requestAnimationFrame(() => focusInto(modal));
  }
  return () => {
    observer.disconnect();
    doc.removeEventListener('keydown', handleKeydown, { capture: true });
    doc.removeEventListener('focusin', handleFocusIn);
  };
}
