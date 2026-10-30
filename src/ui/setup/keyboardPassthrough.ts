import type Phaser from 'phaser';
import { syncGameKeyboardFocus } from '../keyboardFocus';

const GAMEPLAY_BUTTONS = [
  '#btn-world-play',
  '#btn-world-restart',
  '#btn-world-play-course',
  '#btn-room-sequence-stop',
  '#btn-room-sequence-restart',
  '#btn-room-sequence-next',
  '#btn-mobile-world-stop',
  '#btn-mobile-world-restart',
  '#btn-mobile-room-sequence-next',
].join(', ');

export function setupKeyboardShortcutPassthrough(game: Phaser.Game, doc: Document = document): void {
  // Phaser cancels the canvas pointer's native focus change. Explicitly release
  // the previous menu/form button before it can acquire :focus-visible on a key.
  doc.addEventListener('pointerdown', event => {
    if (event.target !== game.canvas) return;
    if (doc.activeElement instanceof HTMLElement && doc.activeElement !== game.canvas) doc.activeElement.blur();
    syncGameKeyboardFocus(game);
  }, { capture: true });
  // Space can make a clicked button :focus-visible without a focus event. A later
  // restart then yields the game keys to that button and Space repeatedly clicks it.
  // Release focus before its action runs; Tab/Enter/Space still activate it once.
  doc.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLElement>(GAMEPLAY_BUTTONS);
    if (!button || doc.activeElement !== button) return;
    button.blur();
    syncGameKeyboardFocus(game);
  }, { capture: true });

  doc.getElementById('sidebar')?.addEventListener('mousedown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const interactiveControl = target?.closest('button, input, select, textarea, label, a');
    if (!interactiveControl) {
      event.preventDefault();
    }
  });
}
