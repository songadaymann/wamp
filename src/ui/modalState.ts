/** Whether any WAMP dialog (every dialog uses `.history-modal`) is open. */
export function hasBlockingModalOpen(doc: Document = document): boolean {
  return Array.from(doc.querySelectorAll<HTMLElement>('.history-modal')).some((element) =>
    !element.classList.contains('hidden')
    && element.getAttribute('aria-hidden') !== 'true'
  );
}

/**
 * Escape closes the open dialog; it must not also reach the game, where it means
 * "leave the room" (and ends a duel). This runs in the capture phase, before any
 * dialog's own handler closes it, and only marks the event handled: dialogs still
 * close, and Phaser's keyboard skips handled events.
 */
export function installDialogEscapeGuard(doc: Document = document): () => void {
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && hasBlockingModalOpen(doc)) event.preventDefault();
  };
  doc.addEventListener('keydown', handleKeydown, { capture: true });
  return () => doc.removeEventListener('keydown', handleKeydown, { capture: true });
}
