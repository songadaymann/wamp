import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const focus = vi.hoisted(() => ({ yielded: false }));
vi.mock('../../ui/keyboardFocus', () => ({ isGameKeyboardYielded: () => focus.yielded }));
import { createOverworldKeyboardInput, OverworldKeyboardInput } from './keyboardInput';
import { changeKeyBinding, resetKeyBindings } from '../../settings/keyBindings';
class KeyEvent extends Event {
  code = ''; key = ''; repeat = false; ctrlKey = false; metaKey = false; altKey = false;
  constructor(type: 'keydown' | 'keyup', code: string, changes = {}) { super(type, { cancelable: true }); Object.assign(this, { code }, changes); }
}
function harness() {
  const target = new EventTarget(); let enabled = true;
  const input = new OverworldKeyboardInput(() => enabled, target as unknown as Window);
  const down = (code: string, changes = {}) => { const e = new KeyEvent('keydown', code, changes); target.dispatchEvent(e); return e; };
  const up = (code: string) => target.dispatchEvent(new KeyEvent('keyup', code));
  return { target, input, down, up, enable: (value: boolean) => { enabled = value; } };
}
afterEach(() => { resetKeyBindings(); focus.yielded = false; vi.unstubAllGlobals(); });
describe('physical gameplay keys', () => {
  it('moves on physical WASD on AZERTY without treating the printed Q as slash', () => {
    const h = harness(); h.down('KeyA', { key: 'q' });
    expect(h.input.held('left')).toBe(true); expect(h.input.held('slash')).toBe(false);
    h.down('KeyW', { key: 'z' }); expect(h.input.held('up')).toBe(true); expect(h.input.held('jump')).toBe(false);
    h.up('KeyA'); expect(h.input.held('left')).toBe(false); h.input.destroy();
  });
  it('consumes simultaneous aliases once and ignores OS repeats while retaining held aliases', () => {
    const h = harness(); expect(h.down('Space').defaultPrevented).toBe(true); h.down('KeyZ');
    expect(h.input.pressed('jump')).toBe(true); expect(h.input.pressed('jump')).toBe(false);
    h.down('KeyZ', { repeat: true }); expect(h.input.pressed('jump')).toBe(false);
    h.up('Space'); expect(h.input.held('jump')).toBe(true); h.up('KeyZ'); expect(h.input.held('jump')).toBe(false);
    h.down('KeyZ'); expect(h.input.pressed('jump')).toBe(true); h.input.destroy();
  });
  it('applies remapping immediately and clears old held and queued actions', () => {
    const h = harness(); h.down('KeyX'); changeKeyBinding('slash', 'KeyJ');
    expect(h.input.held('slash')).toBe(false); expect(h.input.pressed('slash')).toBe(false);
    h.down('KeyX'); expect(h.input.pressed('slash')).toBe(false);
    h.down('KeyJ'); expect(h.input.held('slash')).toBe(true); expect(h.input.pressed('slash')).toBe(true); h.input.destroy();
  });
  it('forgets actions on blur, disabled/modal input and teardown, including swallowed keyup', () => {
    const h = harness(); h.down('KeyD'); h.target.dispatchEvent(new Event('blur')); expect(h.input.hasHeldInput()).toBe(false);
    h.down('Space'); h.enable(false); expect(h.input.pressed('jump')).toBe(false);
    h.down('KeyX'); h.enable(true); expect(h.input.held('jump')).toBe(false); expect(h.input.pressed('slash')).toBe(false);
    h.down('KeyD'); h.enable(false); h.up('KeyD'); h.enable(true); expect(h.input.held('right')).toBe(false);
    h.input.destroy(); h.down('Space'); expect(h.input.pressed('jump')).toBe(false);
  });
  it('leaves browser chords, reserved chat keys and separately owned commands alone', () => {
    const h = harness();
    for (const changes of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) expect(h.down('KeyD', changes).defaultPrevented).toBe(false);
    for (const code of ['Tab', 'KeyT', 'KeyR', 'KeyP', 'Escape']) expect(h.down(code).defaultPrevented).toBe(false);
    expect(h.input.hasHeldInput()).toBe(false); h.input.destroy();
  });
  it('clears swallowed keys at each scene lifecycle boundary and detaches all lifecycle listeners', () => {
    const target = new EventTarget(), events = new EventEmitter(), gameEvents = new EventEmitter();
    const doc = { hidden: false, getElementById: () => null }; let playing = true, active = true;
    vi.stubGlobal('window', target); vi.stubGlobal('document', doc);
    const input = createOverworldKeyboardInput({ events, game: { events: gameEvents }, input: { keyboard: { isActive: () => active } } } as never, () => playing);
    const down = () => target.dispatchEvent(new KeyEvent('keydown', 'Space'));
    for (const [emitter, event] of [[events, 'pause'], [events, 'sleep'], [gameEvents, 'hidden']] as const) {
      down(); expect(input.held('jump')).toBe(true); emitter.emit(event);
      expect(input.pressed('jump')).toBe(false); expect(input.held('jump')).toBe(false);
    }
    down(); focus.yielded = true; events.emit('preupdate'); focus.yielded = false;
    expect(input.pressed('jump')).toBe(false); expect(input.held('jump')).toBe(false);
    down(); doc.hidden = true; events.emit('preupdate'); doc.hidden = false; expect(input.held('jump')).toBe(false);
    down(); active = false; expect(input.held('jump')).toBe(false); active = true; expect(input.pressed('jump')).toBe(false);
    down(); playing = false; events.emit('preupdate'); playing = true; expect(input.held('jump')).toBe(false);
    focus.yielded = true; down(); focus.yielded = false; expect(input.held('jump')).toBe(false);
    input.destroy(); down(); expect(input.pressed('jump')).toBe(false);
    for (const name of ['preupdate', 'pause', 'sleep']) expect(events.listenerCount(name)).toBe(0);
    expect(gameEvents.listenerCount('hidden')).toBe(0);
  });
});
