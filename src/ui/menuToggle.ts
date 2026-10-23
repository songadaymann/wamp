import { hasBlockingModalOpen } from './modalState';
import { hasPendingDialog } from './pendingDialog';

/**
 * The main menu button (F478). Its aria-expanded follows the panel's `menu-open` class, so every
 * place that closes the menu keeps it right. Escape closes the open menu and goes no further: Phaser
 * skips a handled key, so the press that closes the menu never also ends play, and chat and the
 * editor don't see it either. A dialog open over the menu keeps its own Escape. Focus that was in
 * the menu returns to the button; focus on the game stays there, so the game keeps its keys.
 */
export function installMenuToggle(panel: HTMLElement, toggle: HTMLElement, menu: HTMLElement | null,
  doc: Document = document): () => void {
  const isOpen = (): boolean => panel.classList.contains('menu-open');
  const syncExpanded = (): void => {
    const expanded = isOpen() ? 'true' : 'false';
    if (toggle.getAttribute('aria-expanded') !== expanded) toggle.setAttribute('aria-expanded', expanded);
  };
  const handleToggleClick = (event: Event): void => {
    event.stopPropagation();
    panel.classList.toggle('menu-open');
  };
  const handleDocumentClick = (event: Event): void => {
    if (isOpen() && !panel.contains(event.target as Node)) panel.classList.remove('menu-open');
  };
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || !isOpen() || hasBlockingModalOpen(doc) || hasPendingDialog()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const focusWasInMenu = Boolean(menu?.contains(doc.activeElement));
    panel.classList.remove('menu-open');
    if (focusWasInMenu) toggle.focus();
  };
  const observer = new MutationObserver(syncExpanded);
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  toggle.addEventListener('click', handleToggleClick);
  doc.addEventListener('click', handleDocumentClick);
  // Capture, so the menu hears Escape before chat, the editor and the game do.
  doc.addEventListener('keydown', handleKeydown, { capture: true });
  syncExpanded();
  return () => {
    observer.disconnect();
    toggle.removeEventListener('click', handleToggleClick);
    doc.removeEventListener('click', handleDocumentClick);
    doc.removeEventListener('keydown', handleKeydown, { capture: true });
  };
}
