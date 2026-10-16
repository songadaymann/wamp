import { isGameKeyboardYielded, isTextInputElement } from '../keyboardFocus';

/** R follows the same restart command as the HUD, without consuming text or browser shortcuts. */
export function installRestartShortcut(
  restart: () => void | Promise<void>,
  doc: Document = document,
): () => void {
  const keydown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() !== 'r' || event.repeat || event.defaultPrevented
      || event.ctrlKey || event.metaKey || event.altKey
      || doc.body.dataset.appMode !== 'play-world' || isGameKeyboardYielded(doc)
      || doc.getElementById('auth-panel')?.classList.contains('menu-open')
      || (event.target instanceof Element && isTextInputElement(event.target))) return;
    event.preventDefault();
    void restart();
  };
  doc.addEventListener('keydown', keydown);
  return () => doc.removeEventListener('keydown', keydown);
}
