import Phaser from 'phaser';
import { hasBlockingModalOpen, watchModals } from './modalState';

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

/** A button or link the player reached with the keyboard (Tab), not by clicking it. */
export function isKeyboardFocusedControl(element: Element | null): boolean {
  if (!(element instanceof HTMLElement) || !element.matches('button, a[href], [role="button"], summary')) return false;
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * The game gives up its keys (and stops cancelling arrows, Space and Enter) while the player
 * is typing, adjusting a form control, has a dialog open, or has tabbed to a button. A button
 * focused by clicking it keeps game keys, so clicking a HUD button does not stop the player
 * moving.
 */
export function isGameKeyboardYielded(doc: Document = document): boolean {
  const focused = doc.activeElement;
  return isTextInputElement(focused)
    || isFormControlElement(focused)
    || isKeyboardFocusedControl(focused)
    || hasBlockingModalOpen(doc);
}

export function syncGameKeyboardFocus(game: Phaser.Game): void {
  const keyboardManager = game.input.keyboard;
  if (!keyboardManager) {
    return;
  }

  const yielded = isGameKeyboardYielded();
  keyboardManager.preventDefault = !yielded && keyboardManager.captures.length > 0;

  // A room intro pauses its scene. Closing the dialog can update focus before
  // Phaser processes the queued resume, so paused scenes need their keys back too.
  for (const scene of game.scene.getScenes(false)) {
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
  return watchModals(doc, () => syncGameKeyboardFocus(game));
}
