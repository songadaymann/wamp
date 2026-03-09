import Phaser from 'phaser';

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

export function isTextInputFocused(): boolean {
  return isTextInputElement(document.activeElement);
}

export function syncGameKeyboardFocus(game: Phaser.Game): void {
  const keyboardManager = game.input.keyboard;
  if (!keyboardManager) {
    return;
  }

  const textInputFocused = isTextInputFocused();
  keyboardManager.preventDefault = !textInputFocused && keyboardManager.captures.length > 0;

  for (const scene of game.scene.getScenes(true)) {
    const keyboard = scene.input?.keyboard;
    if (!keyboard) {
      continue;
    }

    keyboard.enabled = !textInputFocused;
    if (textInputFocused) {
      keyboard.resetKeys();
    }
  }
}
