import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { attachGamepadInput, OverworldGamepadInput } from './gamepadInput';

function pad(index = 0) {
  return { index, id: `fixture-${index}`, connected: true, mapping: 'standard' as GamepadMappingType,
    axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
}
function harness() {
  const device = pad(); let pads: ReturnType<typeof pad>[] = [device];
  const input = new OverworldGamepadInput(() => pads);
  const press = (index: number, down = true) => { device.buttons[index].pressed = down; device.buttons[index].value = down ? 1 : 0; };
  input.sample(true);
  return { input, device, press, setPads: (next: ReturnType<typeof pad>[]) => { pads = next; } };
}
afterEach(() => vi.unstubAllGlobals());

describe('standard gamepad input', () => {
  it('uses physical face positions and emits each action once while held', () => {
    const h = harness();
    for (const [button, action] of [[0, 'jump'], [2, 'slash'], [3, 'shoot'], [9, 'restart'], [8, 'stop'], [11, 'camera']] as const) {
      h.press(button); h.input.sample(true);
      expect(h.input.held(action)).toBe(true); expect(h.input.pressed(action)).toBe(true);
      h.input.sample(true); expect(h.input.pressed(action)).toBe(false);
      h.press(button, false); h.input.sample(true); expect(h.input.held(action)).toBe(false);
      h.press(button); h.input.sample(true); expect(h.input.pressed(action)).toBe(true);
      h.press(button, false); h.input.sample(true);
    }
  });
  it('shares the shoot edge across the face button and right bumper', () => {
    const h = harness(); h.press(3); h.input.sample(true); expect(h.input.pressed('shoot')).toBe(true);
    h.press(5); h.input.sample(true); expect(h.input.pressed('shoot')).toBe(false);
    h.press(3, false); h.input.sample(true); expect(h.input.held('shoot')).toBe(true);
    h.press(5, false); h.input.sample(true); h.press(5); h.input.sample(true); expect(h.input.pressed('shoot')).toBe(true);
  });
  it('filters stick drift and supplies fresh directional edges for ladders and crates', () => {
    const h = harness(); h.device.axes = [0.35, -0.2]; h.input.sample(true); expect(h.input.held('right')).toBe(false);
    h.device.axes = [0.8, 0]; h.input.sample(true); expect(h.input.pressed('right')).toBe(true);
    h.input.sample(true); expect(h.input.pressed('right')).toBe(false);
    h.device.axes = [-0.8, 0]; h.input.sample(true); expect(h.input.held('right')).toBe(false); expect(h.input.pressed('left')).toBe(true);
    h.device.axes = [0, -0.9]; h.input.sample(true); expect(h.input.pressed('up')).toBe(true);
  });
  it('requires an intentional downward stick push for crouch/stomp', () => {
    const h = harness(); h.device.axes = [0.9, 0.7]; h.input.sample(true);
    expect(h.input.held('right')).toBe(true); expect(h.input.pressed('down')).toBe(false);
    h.device.axes = [0.2, 0.9]; h.input.sample(true); expect(h.input.pressed('down')).toBe(true);
    h.input.sample(true); expect(h.input.pressed('down')).toBe(false);
  });
  it('reads all four d-pad directions even with a centered stick', () => {
    for (const [button, action] of [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']] as const) {
      const h = harness(); h.press(button); h.input.sample(true); expect(h.input.held(action)).toBe(true); expect(h.input.pressed(action)).toBe(true);
    }
  });
  it('waits for neutral after reconnecting instead of firing a held restart', () => {
    const h = harness(); h.setPads([]); h.input.sample(true); h.press(9); h.setPads([h.device]);
    h.input.sample(true); expect(h.input.pressed('restart')).toBe(false); expect(h.input.held('restart')).toBe(false);
    h.press(9, false); h.input.sample(true); h.press(9); h.input.sample(true); expect(h.input.pressed('restart')).toBe(true);
  });
  it('clears movement and requires neutral after losing gameplay focus', () => {
    const h = harness(); h.press(0); h.device.axes[0] = 1; h.input.sample(true); expect(h.input.held('jump')).toBe(true);
    h.input.sample(false); expect(h.input.held('right')).toBe(false);
    h.input.sample(true); expect(h.input.held('jump')).toBe(false); expect(h.input.held('right')).toBe(false);
    h.press(0, false); h.device.axes[0] = 0; h.input.sample(true); h.press(0); h.input.sample(true); expect(h.input.pressed('jump')).toBe(true);
  });
  it('clears presses across pause, sleep and scene lifecycle reset', () => {
    const h = harness(); h.press(2); h.input.sample(true); h.input.reset(); h.input.sample(true); expect(h.input.pressed('slash')).toBe(false);
  });
  it('ignores unknown layouts and disconnected pads, retaining a stable standard pad', () => {
    const unknown = pad(0), valid = pad(1); unknown.mapping = '';
    let pads = [null, unknown, valid]; const input = new OverworldGamepadInput(() => pads); input.sample(true);
    valid.buttons[0].pressed = true; input.sample(true); expect(input.pressed('jump')).toBe(true);
    pads = [unknown, valid]; input.sample(true); expect(input.pressed('jump')).toBe(false);
    valid.connected = false; input.sample(true); expect(input.held('jump')).toBe(false);
  });
  it('ignores nonfinite axes and tolerates short controller arrays', () => {
    const h = harness(); h.device.axes = [NaN, Infinity]; h.device.buttons = [];
    expect(() => h.input.sample(true)).not.toThrow(); expect(h.input.held('right')).toBe(false); expect(h.input.held('up')).toBe(false);
  });
  it('fails closed when the browser or embed denies the API', () => {
    vi.stubGlobal('navigator', { getGamepads: () => { throw new DOMException('denied', 'SecurityError'); } });
    const input = new OverworldGamepadInput(); expect(() => input.sample(true)).not.toThrow(); expect(input.held('jump')).toBe(false);
    vi.stubGlobal('navigator', {}); expect(() => input.sample(true)).not.toThrow();
  });
});


describe('gamepad scene lifecycle', () => {
  function connected() {
    const h = harness(), scene = new EventEmitter(), game = new EventEmitter();
    let focused = true, menuOpen = false, canPlay = true;
    const doc = { hidden: false, hasFocus: () => focused,
      getElementById: () => ({ classList: { contains: () => menuOpen } }) };
    vi.stubGlobal('document', doc);
    attachGamepadInput(h.input, scene, game, () => canPlay);
    scene.emit('preupdate');
    return { ...h, scene, game, doc, focus: (v: boolean) => { focused = v; },
      menu: (v: boolean) => { menuOpen = v; }, playing: (v: boolean) => { canPlay = v; } };
  }
  it.each(['pause', 'sleep', 'wake', 'resume', 'blur', 'hidden'])('rearms held buttons after %s', event => {
    const h = connected(); h.press(9); h.scene.emit('preupdate'); expect(h.input.pressed('restart')).toBe(true);
    (event === 'blur' || event === 'hidden' ? h.game : h.scene).emit(event);
    expect(h.input.held('restart')).toBe(false); h.scene.emit('preupdate'); expect(h.input.pressed('restart')).toBe(false);
    h.press(9, false); h.scene.emit('preupdate'); h.press(9); h.scene.emit('preupdate'); expect(h.input.pressed('restart')).toBe(true);
  });
  it('yields to focus, hidden tabs, menu drawers and inactive gameplay', () => {
    const h = connected();
    for (const block of [() => h.focus(false), () => { h.doc.hidden = true; }, () => h.menu(true), () => h.playing(false)]) {
      h.press(0, false); h.scene.emit('preupdate'); h.press(0); h.scene.emit('preupdate'); expect(h.input.held('jump')).toBe(true);
      block(); h.scene.emit('preupdate'); expect(h.input.held('jump')).toBe(false);
      h.focus(true); h.doc.hidden = false; h.menu(false); h.playing(true);
      h.press(0, false); h.scene.emit('preupdate');
    }
  });
  it('removes all input and reset listeners when the scene shuts down', () => {
    const h = connected(); h.press(2); h.scene.emit('preupdate'); h.scene.emit('shutdown');
    expect(h.input.held('slash')).toBe(false); expect(h.scene.eventNames()).toEqual([]); expect(h.game.eventNames()).toEqual([]);
  });
});
