import { changeKeyBinding, getKeyBindings, isBindableCode, keyboardActionLabel, keyboardCodeLabel,
  KEYBOARD_ACTION_LABELS, KEYBOARD_ACTIONS, keyBindingConflict, refreshKeyboardLayout, resetKeyBindings,
  subscribeKeyBindings, type KeyboardAction } from '../../settings/keyBindings';

/** Owns key capture only while the Controls dialog is visible; Escape cancels before dialog dismissal. */
export class KeyboardBindingsEditor {
  private capture: KeyboardAction | null = null;
  private readonly blockedReleases = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;
  private readonly rows: HTMLElement | null;
  private readonly status: HTMLElement | null;
  private readonly reset: HTMLElement | null;
  constructor(private readonly doc: Document = document) {
    this.rows = doc.getElementById('keyboard-bindings');
    this.status = doc.getElementById('keyboard-binding-status');
    this.reset = doc.getElementById('btn-keyboard-reset');
  }
  init(): void {
    this.rows?.addEventListener('click', this.onClick); this.reset?.addEventListener('click', this.onReset);
    this.doc.addEventListener('keydown', this.onKeyDown, true); this.doc.addEventListener('keyup', this.onKeyUp, true);
    this.unsubscribe = subscribeKeyBindings(() => this.render()); this.render();
  }
  open(): void {
    this.cancel(); void refreshKeyboardLayout().then(() => { if (!this.destroyed) this.render(); });
  }
  cancel(): void { this.capture = null; this.setStatus(''); this.updateButtons(); }
  destroy(): void {
    this.destroyed = true; this.cancel(); this.unsubscribe?.(); this.unsubscribe = null;
    this.rows?.removeEventListener('click', this.onClick); this.reset?.removeEventListener('click', this.onReset);
    this.doc.removeEventListener('keydown', this.onKeyDown, true); this.doc.removeEventListener('keyup', this.onKeyUp, true);
    this.blockedReleases.clear();
  }
  private render(): void {
    if (!this.rows) return;
    // Preserve the focused Change button when settings/layout labels update.
    if (!this.rows.childElementCount) for (const action of KEYBOARD_ACTIONS) {
      const row = this.doc.createElement('div'); row.className = 'keyboard-binding-row';
      const label = this.doc.createElement('span'); label.textContent = KEYBOARD_ACTION_LABELS[action];
      const keys = this.doc.createElement('kbd'); keys.dataset.bindingKeys = action; keys.className = 'controls-key';
      const button = this.doc.createElement('button'); button.type = 'button'; button.dataset.bindingAction = action;
      button.className = 'pixel-btn keyboard-binding-change'; button.setAttribute('aria-label', `Change ${KEYBOARD_ACTION_LABELS[action]} key`);
      row.append(label, keys, button); this.rows.append(row);
    }
    for (const keys of this.rows.querySelectorAll<HTMLElement>('[data-binding-keys]')) keys.textContent = keyboardActionLabel(keys.dataset.bindingKeys as KeyboardAction);
    this.updateButtons();
  }
  private updateButtons(): void {
    for (const button of this.rows?.querySelectorAll<HTMLButtonElement>('[data-binding-action]') ?? []) {
      const listening = button.dataset.bindingAction === this.capture;
      button.textContent = listening ? 'Cancel' : 'Change'; button.setAttribute('aria-pressed', String(listening));
    }
  }
  private setStatus(message: string): void { if (this.status) this.status.textContent = message; }
  private readonly onClick = (event: Event): void => {
    const action = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-binding-action]')?.dataset.bindingAction as KeyboardAction | undefined;
    if (!action || !KEYBOARD_ACTIONS.includes(action)) return;
    if (this.capture === action) { this.cancel(); return; }
    this.capture = action; this.updateButtons(); this.setStatus(`Press a key for ${KEYBOARD_ACTION_LABELS[action]}. Escape cancels.`);
  };
  private readonly onReset = (): void => { this.cancel(); resetKeyBindings(); this.setStatus('Default keys restored.'); };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.capture || this.doc.getElementById('controls-modal')?.classList.contains('hidden')) return;
    // Keep Tab navigation and system/browser chords available. Never record modifier-only keys.
    if (event.key === 'Tab') { this.cancel(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.blockedReleases.add(event.code);
    if (event.repeat) return;
    if (event.key === 'Escape') { this.cancel(); return; }
    const action = this.capture;
    if (!isBindableCode(event.code)) { this.setStatus('Choose a letter, number, arrow, Space or punctuation key. T/C are chat/comments; 0 fits the map.'); return; }
    const conflict = keyBindingConflict(action, event.code);
    if (conflict) { this.setStatus(`${keyboardCodeLabel(event.code)} is used for ${KEYBOARD_ACTION_LABELS[conflict]}. Change that key first.`); return; }
    const previous = getKeyBindings()[action];
    if (changeKeyBinding(action, event.code)) {
      this.cancel(); this.setStatus(`${KEYBOARD_ACTION_LABELS[action]}: ${keyboardActionLabel(action)}. Saved on this device.`);
      // Keep this explicit so replacing all aliases is visible to the player before the next action.
      this.rows?.querySelector(`[data-binding-action="${action}"]`)?.setAttribute('title', `Replaced ${previous.map(keyboardCodeLabel).join(' / ')}`);
    }
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.blockedReleases.delete(event.code)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
}
