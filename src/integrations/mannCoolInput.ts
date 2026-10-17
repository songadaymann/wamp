import type { TouchActionName, TouchInputState } from '../ui/mobile/touchControls';

export const MANN_COOL_ORIGIN = 'https://mann.cool';
type Action = TouchActionName | 'left' | 'right' | 'up' | 'down';
const KEYS: Readonly<Record<string, Action>> = {
  arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
  arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
  ' ': 'jump', space: 'jump', spacebar: 'jump',
  q: 'slash', z: 'slash', e: 'shoot', x: 'shoot',
  '9': 'cameraToggle', escape: 'stop', r: 'restart',
};
const EMPTY: Readonly<TouchInputState> = Object.freeze({
  active: false, moveX: 0, moveY: 0, jumpHeld: false, slashHeld: false, shootHeld: false,
});

export function parseMannCoolKeyMessage(data: unknown): { key: string; down: boolean } | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  if (message.type !== 'keyEvent' || typeof message.key !== 'string'
    || (message.eventType !== 'keydown' && message.eventType !== 'keyup')) return null;
  let key = message.key.toLowerCase();
  if (/^key[a-z]$/.test(key)) key = key.slice(3);
  if (key === 'digit9') key = '9';
  return Object.prototype.hasOwnProperty.call(KEYS, key) ? { key, down: message.eventType === 'keydown' } : null;
}

export function isMannCoolParentMessage(
  event: Pick<MessageEvent, 'origin' | 'source'>, parent: Window, self: Window,
): boolean {
  return parent !== self && event.origin === MANN_COOL_ORIGIN && event.source === parent;
}

/** Independent input ownership: native pointer releases never release parent keys. */
export class MannCoolControllerInput {
  private enabled = false;
  private readonly held = new Set<string>();
  private readonly blocked = new Set<string>();
  private readonly pressed = new Set<TouchActionName>();
  private state: Readonly<TouchInputState> = EMPTY;

  setEnabled(enabled: boolean): void {
    if (!enabled) this.clear();
    this.enabled = enabled;
  }

  clear(): void {
    for (const key of this.held) this.blocked.add(key);
    this.held.clear(); this.pressed.clear(); this.state = EMPTY;
  }

  handle(data: unknown): void {
    const event = parseMannCoolKeyMessage(data);
    if (!event) return;
    const { key, down } = event;
    if (!down) {
      this.held.delete(key); this.blocked.delete(key); this.updateState(); return;
    }
    if (!this.enabled) { this.blocked.add(key); return; }
    if (this.blocked.has(key) || this.held.has(key)) return;
    const action = KEYS[key];
    const edge = action === 'up' ? 'jump' : action;
    const alreadyHeld = this.hasAction(action) || (edge === 'jump' && (this.hasAction('up') || this.hasAction('jump')));
    this.held.add(key);
    if (!alreadyHeld && edge !== 'left' && edge !== 'right' && edge !== 'down') this.pressed.add(edge);
    this.updateState();
  }

  read(): Readonly<TouchInputState> { return this.state; }
  consume(action: TouchActionName): boolean { return this.pressed.delete(action); }
  debug(): Record<string, unknown> { return { ...this.state, enabled: this.enabled, heldKeys: [...this.held] }; }

  private hasAction(action: Action): boolean {
    for (const key of this.held) if (KEYS[key] === action) return true;
    return false;
  }

  private updateState(): void {
    this.state = {
      active: this.enabled && this.held.size > 0,
      moveX: Number(this.hasAction('right')) - Number(this.hasAction('left')),
      moveY: Number(this.hasAction('down')) - Number(this.hasAction('up')),
      jumpHeld: this.hasAction('up') || this.hasAction('jump'),
      slashHeld: this.hasAction('slash'), shootHeld: this.hasAction('shoot'),
    };
  }
}

let source: MannCoolControllerInput | null = null;
export function setMannCoolInputSource(input: MannCoolControllerInput | null): void { source = input; }
export function readMannCoolInput(): Readonly<TouchInputState> { return source?.read() ?? EMPTY; }
export function consumeMannCoolAction(action: TouchActionName): boolean { return source?.consume(action) ?? false; }
export function getMannCoolInputDebugState(): Record<string, unknown> { return source?.debug() ?? { ...EMPTY, enabled: false }; }
