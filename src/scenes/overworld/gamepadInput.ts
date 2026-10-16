const ACTION_BITS = {
  left: 1, right: 2, up: 4, down: 8, jump: 16, slash: 32, shoot: 64,
  restart: 128, stop: 256, camera: 512,
} as const;
export type GamepadAction = keyof typeof ACTION_BITS;
export interface GamepadControls {
  held(action: GamepadAction): boolean;
  pressed(action: GamepadAction): boolean;
}

type Pad = Pick<Gamepad, 'index' | 'id' | 'mapping' | 'connected' | 'buttons' | 'axes'>;
const NO_PADS: readonly (Pad | null)[] = [];
function browserPads(): readonly (Pad | null)[] {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
      ? navigator.getGamepads() : NO_PADS;
  } catch {
    // Unsupported embeds can deny gamepad access. Keyboard and touch stay usable.
    return NO_PADS;
  }
}
function button(pad: Pad, index: number): boolean {
  const value = pad.buttons[index];
  return Boolean(value && (value.pressed || value.value > 0.5));
}
function axis(pad: Pad, index: number): number {
  const value = pad.axes[index] ?? 0;
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

/** Standard-layout physical positions, independent of the labels printed on a pad. */
export class OverworldGamepadInput implements GamepadControls {
  private index = -1;
  private id = '';
  private armed = false;
  private previous = 0;
  private current = 0;
  private edges = 0;

  constructor(private readonly readPads: () => readonly (Pad | null)[] = browserPads) {}

  isConnected(): boolean { return this.index >= 0; }
  hasHeldInput(): boolean { return this.current !== 0; }

  held(action: GamepadAction): boolean { return (this.current & ACTION_BITS[action]) !== 0; }
  pressed(action: GamepadAction): boolean { return (this.edges & ACTION_BITS[action]) !== 0; }

  reset = (): void => {
    this.index = -1;
    this.id = '';
    this.armed = false;
    this.previous = this.current = this.edges = 0;
  };

  sample(enabled: boolean): void {
    this.edges = this.current = 0;
    if (!enabled) { this.reset(); return; }
    const pads = this.readPads();
    let pad: Pad | null = null;
    for (let i = 0; i < pads.length; i += 1) {
      const candidate = pads[i];
      if (!candidate?.connected || candidate.mapping !== 'standard') continue;
      if (!pad || candidate.index === this.index) pad = candidate;
      if (candidate.index === this.index) break;
    }
    if (!pad) { this.reset(); return; }
    if (pad.index !== this.index || pad.id !== this.id) {
      this.reset(); this.index = pad.index; this.id = pad.id;
    }
    const x = axis(pad, 0), y = axis(pad, 1);
    let mask = 0;
    if (button(pad, 14) || x < -0.35) mask |= ACTION_BITS.left;
    if (button(pad, 15) || x > 0.35) mask |= ACTION_BITS.right;
    if (button(pad, 12) || y < -0.55) mask |= ACTION_BITS.up;
    // A diagonal drift while running must not become a crouch or butt stomp.
    if (button(pad, 13) || (y > 0.55 && y > Math.abs(x) * 1.2)) mask |= ACTION_BITS.down;
    if (button(pad, 0)) mask |= ACTION_BITS.jump;
    if (button(pad, 2)) mask |= ACTION_BITS.slash;
    if (button(pad, 3) || button(pad, 5)) mask |= ACTION_BITS.shoot;
    if (button(pad, 9)) mask |= ACTION_BITS.restart;
    if (button(pad, 8)) mask |= ACTION_BITS.stop;
    if (button(pad, 11)) mask |= ACTION_BITS.camera;
    if (!this.armed) {
      // Connecting, returning to Play or closing a dialog needs a neutral pad first.
      if (mask === 0) this.armed = true;
      return;
    }
    this.current = mask;
    this.edges = mask & ~this.previous;
    this.previous = mask;
  }
}


type Events = {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
};
const SCENE_RESETS = ['pause', 'sleep', 'wake', 'resume'] as const;
const GAME_RESETS = ['blur', 'hidden'] as const;

/** One poll before physics capture, with no held input carried across scene/focus changes. */
export function attachGamepadInput(input: OverworldGamepadInput, scene: Events, game: Events, canPlay: () => boolean): void {
  const poll = () => input.sample(canPlay() && !document.hidden && document.hasFocus()
    && !document.getElementById('auth-panel')?.classList.contains('menu-open'));
  const destroy = () => {
    scene.off('preupdate', poll); scene.off('shutdown', destroy);
    for (const event of SCENE_RESETS) scene.off(event, input.reset);
    for (const event of GAME_RESETS) game.off(event, input.reset);
    input.reset();
  };
  scene.on('preupdate', poll); scene.on('shutdown', destroy);
  for (const event of SCENE_RESETS) scene.on(event, input.reset);
  for (const event of GAME_RESETS) game.on(event, input.reset);
}
