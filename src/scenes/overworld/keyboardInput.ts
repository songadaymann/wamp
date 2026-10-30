import type Phaser from 'phaser';
import { getKeyBindings, subscribeKeyBindings, KEYBOARD_ACTIONS, type KeyboardAction } from '../../settings/keyBindings';
import { isGameKeyboardYielded } from '../../ui/keyboardFocus';

export interface GameplayKeyboard {
  held(action: KeyboardAction): boolean;
  pressed(action: KeyboardAction): boolean;
}

/** A physical-key collector. Releases are observed even while a dialog/paused scene owns input. */
export class OverworldKeyboardInput implements GameplayKeyboard {
  private bindings = getKeyBindings();
  private readonly down = new Set<string>();
  private readonly edges = new Set<KeyboardAction>();
  private readonly unsubscribe: () => void;
  constructor(private readonly enabled: () => boolean, private readonly target: Window = window,
    private readonly captureEnabled: () => boolean = enabled) {
    this.unsubscribe = subscribeKeyBindings(() => { this.bindings = getKeyBindings(); this.reset(); });
    target.addEventListener('keydown', this.onDown, { capture: true });
    target.addEventListener('keyup', this.onUp, { capture: true });
    target.addEventListener('blur', this.reset);
  }
  held(action: KeyboardAction): boolean {
    if (!this.enabled()) { this.reset(); return false; }
    return this.bindings[action].some(code => this.down.has(code));
  }
  pressed(action: KeyboardAction): boolean {
    if (!this.enabled()) { this.reset(); return false; }
    const pressed = this.edges.has(action); this.edges.delete(action); return pressed;
  }
  hasHeldInput(): boolean { return KEYBOARD_ACTIONS.some(action => this.held(action)); }
  reset = (): void => { this.down.clear(); this.edges.clear(); };
  destroy(): void {
    this.unsubscribe(); this.reset();
    this.target.removeEventListener('keydown', this.onDown, { capture: true }); this.target.removeEventListener('keyup', this.onUp, { capture: true });
    this.target.removeEventListener('blur', this.reset);
  }
  private readonly onDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) { this.reset(); return; }
    if (!this.captureEnabled() || event.defaultPrevented || event.isComposing) { this.reset(); return; }
    // Restart/return-to-browse have command owners. Never also queue them as gameplay.
    const actions = KEYBOARD_ACTIONS.filter(action => action !== 'restart' && action !== 'stop' && this.bindings[action].includes(event.code));
    if (actions.length === 0) return;
    event.preventDefault();
    if (event.repeat || this.down.has(event.code)) return;
    for (const action of actions) if (!this.held(action)) this.edges.add(action);
    this.down.add(event.code);
  };
  private readonly onUp = (event: KeyboardEvent): void => { this.down.delete(event.code); };
}

export function createOverworldKeyboardInput(scene: Phaser.Scene, isPlaying: () => boolean): OverworldKeyboardInput {
  const enabled = () => isPlaying() && Boolean(scene.input.keyboard?.isActive()) && !document.hidden
    && !document.getElementById('auth-panel')?.classList.contains('menu-open');
  // Focus synchronization updates Phaser.enabled. Inspect full DOM ownership once per
  // frame and at keydown, rather than for every held/pressed action in the physics loop.
  const keyboard = new OverworldKeyboardInput(enabled, window, () => enabled() && !isGameKeyboardYielded());
  const check = () => { if (!enabled() || isGameKeyboardYielded()) keyboard.reset(); };
  scene.events.on('preupdate', check); scene.events.on('pause', keyboard.reset); scene.events.on('sleep', keyboard.reset);
  scene.game.events.on('hidden', keyboard.reset);
  const destroy = keyboard.destroy.bind(keyboard);
  keyboard.destroy = () => {
    scene.events.off('preupdate', check); scene.events.off('pause', keyboard.reset); scene.events.off('sleep', keyboard.reset);
    scene.game.events.off('hidden', keyboard.reset); destroy();
  };
  return keyboard;
}
