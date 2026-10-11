import Phaser from 'phaser';
import { hasBlockingModalOpen } from './modalState';

function isEditableInputType(type: string): boolean {
  const normalized = type.toLowerCase();

  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ].includes(normalized);
}

export function isTextInputElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    return isEditableInputType(element.type || 'text');
  }

  if (element instanceof HTMLElement) {
    return element.isContentEditable;
  }

  return false;
}

export function isNativeTextEditingElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (element instanceof HTMLTextAreaElement) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    return isEditableInputType(element.type || 'text');
  }

  if (element instanceof HTMLElement) {
    return element.isContentEditable;
  }

  return false;
}

export function isTextInputFocused(): boolean {
  return isTextInputElement(document.activeElement);
}

export function isNativeTextEditingFocused(): boolean {
  return isNativeTextEditingElement(document.activeElement);
}

/** Sliders, choices and dropdowns use the arrow keys and Space themselves. */
function isFormControlElement(element: Element | null): boolean {
  if (element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) return ['range', 'radio', 'checkbox'].includes(element.type);
  return element instanceof HTMLElement && ['slider', 'radio', 'listbox', 'spinbutton'].includes(element.getAttribute('role') ?? '');
}

/**
 * The game gives up its keys (and stops cancelling arrows and Space) while the player is
 * typing, adjusting a form control, or has a dialog open. A focused button outside a
 * dialog keeps game keys, so clicking a HUD button does not stop the player moving.
 */
export function isGameKeyboardYielded(doc: Document = document): boolean {
  const focused = doc.activeElement;
  return isTextInputElement(focused) || isFormControlElement(focused) || hasBlockingModalOpen(doc);
}

export function syncGameKeyboardFocus(game: Phaser.Game): void {
  const keyboardManager = game.input.keyboard;
  if (!keyboardManager) {
    return;
  }

  const yielded = isGameKeyboardYielded();
  keyboardManager.preventDefault = !yielded && keyboardManager.captures.length > 0;

  for (const scene of game.scene.getScenes(true)) {
    const keyboard = scene.input?.keyboard;
    if (!keyboard) {
      continue;
    }

    if (keyboard.enabled === !yielded) {
      continue;
    }
    keyboard.enabled = !yielded;
    if (yielded) {
      keyboard.resetKeys();
    }
  }
}

/**
 * Re-checks the game's keyboard when a dialog opens or closes. Focus changes are
 * handled where the game is created; a dialog can open without moving focus.
 */
export function installDialogKeyboardSync(game: Phaser.Game, doc: Document = document): () => void {
  const observer = new MutationObserver(() => syncGameKeyboardFocus(game));
  for (const element of doc.querySelectorAll('.history-modal')) {
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  }
  return () => observer.disconnect();
}
