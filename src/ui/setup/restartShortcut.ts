import { matchesKeyboardAction } from '../../settings/keyBindings';
import { isGameKeyboardYielded, isTextInputElement } from '../keyboardFocus';

/** Configured gameplay commands share the HUD actions and yield to native/browser controls. */
export function installGameplayShortcuts(
  commands: { restart: () => void | Promise<void>; stop: () => void | Promise<void> },
  doc: Document = document,
): () => void {
  const keydown = (event: KeyboardEvent): void => {
    const action = matchesKeyboardAction('restart', event) ? 'restart' : matchesKeyboardAction('stop', event) ? 'stop' : null;
    if (!action || event.repeat || event.defaultPrevented
      || event.ctrlKey || event.metaKey || event.altKey
      || doc.body.dataset.appMode !== 'play-world' || isGameKeyboardYielded(doc)
      || doc.getElementById('auth-panel')?.classList.contains('menu-open')
      || (event.target instanceof Element && isTextInputElement(event.target))) return;
    event.preventDefault();
    void commands[action]();
  };
  doc.addEventListener('keydown', keydown);
  return () => doc.removeEventListener('keydown', keydown);
}
