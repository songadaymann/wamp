import { hasBlockingModalOpen } from './modalState';
import { hasPendingDialog } from './pendingDialog';

interface MenuElements {
  panel: HTMLElement;
  toggle: HTMLElement;
  game: HTMLElement | null;
}

// The wallet sign-in window (Reown AppKit) opens over the menu without closing it.
const WALLET_WINDOW_SELECTOR = 'w3m-modal.open, appkit-modal.open';

/**
 * The main menu button (F478). Its aria-expanded follows the panel's `menu-open` class, so every
 * place that closes the menu keeps it right. Escape closes the open menu and goes no further: Phaser
 * skips a handled key, so the press that closes the menu never also ends play, and chat and the
 * editor don't see it either. The menu only takes Escape while focus is in the panel, on the page or
 * on the game; a dialog, a pending pop-up or the wallet window over it keeps its own Escape.
 */
export function installMenuToggle({ panel, toggle, game }: MenuElements, doc: Document = document): () => void {
  let openedByKeyboard = false;
  let swallowRepeats = false;
  const isOpen = (): boolean => panel.classList.contains('menu-open');
  const syncExpanded = (): void => {
    const expanded = isOpen() ? 'true' : 'false';
    if (!isOpen()) openedByKeyboard = false;
    if (toggle.getAttribute('aria-expanded') !== expanded) toggle.setAttribute('aria-expanded', expanded);
  };
  const ownsEscape = (): boolean => {
    const active = doc.activeElement;
    const focusHere = !active || active === doc.body || panel.contains(active) || Boolean(game?.contains(active));
    return focusHere && !hasBlockingModalOpen(doc) && !hasPendingDialog() && !doc.querySelector(WALLET_WINDOW_SELECTOR);
  };
  const handleToggleClick = (event: MouseEvent): void => {
    event.stopPropagation();
    panel.classList.toggle('menu-open');
    // A click from Enter or Space has no click count.
    openedByKeyboard = isOpen() && event.detail === 0;
  };
  const handleDocumentClick = (event: Event): void => {
    if (isOpen() && !panel.contains(event.target as Node)) panel.classList.remove('menu-open');
  };
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    // Holding Escape: the repeats of a press the menu took must not reach the editor or the game.
    if (event.repeat && swallowRepeats) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    swallowRepeats = false;
    if (event.isComposing || !isOpen() || !ownsEscape()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    swallowRepeats = true;
    const active = doc.activeElement;
    const returnToButton = openedByKeyboard;
    panel.classList.remove('menu-open');
    // A keyboard player goes back to the button. Anyone else goes back to the page, because a
    // button focused during a key press counts as keyboard focus and would take the game's keys.
    if (returnToButton) toggle.focus();
    else if (active && panel.contains(active) && 'blur' in active) (active as HTMLElement).blur();
  };
  const handleKeyup = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') swallowRepeats = false;
  };
  const observer = new MutationObserver(syncExpanded);
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  toggle.addEventListener('click', handleToggleClick);
  doc.addEventListener('click', handleDocumentClick);
  // Capture, so the menu hears Escape before chat, the editor and the game do.
  doc.addEventListener('keydown', handleKeydown, { capture: true });
  doc.addEventListener('keyup', handleKeyup, { capture: true });
  syncExpanded();
  return () => {
    observer.disconnect();
    toggle.removeEventListener('click', handleToggleClick);
    doc.removeEventListener('click', handleDocumentClick);
    doc.removeEventListener('keydown', handleKeydown, { capture: true });
    doc.removeEventListener('keyup', handleKeyup, { capture: true });
  };
}
