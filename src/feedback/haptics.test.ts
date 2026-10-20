import { afterEach, describe, expect, it, vi } from 'vitest';
import { HapticFeedbackController, isHapticsAvailable, playHaptic, destroyHaptics } from './haptics';
import { updateComfortSettings } from '../settings/comfortSettings';

afterEach(() => { destroyHaptics(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const state = { now: 100, available: true, enabled: true, active: true };
  const vibrate = vi.fn(() => true);
  const controller = new HapticFeedbackController({
    now: () => state.now, available: () => state.available,
    enabled: () => state.enabled, active: () => state.active, vibrate,
  });
  return { state, vibrate, controller };
}

describe('bounded gameplay vibration', () => {
  it('coalesces pickup bursts and lets damage/goal replace weaker cues without being truncated', () => {
    const f = fixture();
    expect(f.controller.play('jump')).toBe(true);
    expect(f.controller.play('collect')).toBe(false);
    expect(f.controller.play('hit')).toBe(true);
    expect(f.controller.play('damage')).toBe(true);
    expect(f.controller.play('goal')).toBe(true);
    f.state.now += 100;
    expect(f.controller.play('hit')).toBe(false);
    expect(f.controller.play('goal')).toBe(false);
    f.state.now += 30;
    expect(f.controller.play('collect')).toBe(true);
    expect(f.vibrate.mock.calls).toEqual([[5], [15], [[20, 30, 20]], [[30, 40, 60]], [8]]);
  });

  it.each(['enabled', 'available', 'active'] as const)('cancels an active cue once when %s becomes false', key => {
    const f = fixture(); f.controller.play('goal'); f.state[key] = false;
    expect(f.controller.play('collect')).toBe(false);
    f.controller.play('damage');
    expect(f.vibrate.mock.calls).toEqual([[[30, 40, 60]], [0]]);
    f.state[key] = true;
    expect(f.controller.play('jump')).toBe(true);
  });

  it('does not send pointless cancellation after a short pulse has finished', () => {
    const f = fixture(); f.controller.play('jump'); f.state.now += 6;
    f.controller.cancel(); f.controller.cancel();
    expect(f.vibrate).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('contains browser rejections and exceptions and rate-limits refused calls too', () => {
    const f = fixture(); f.vibrate.mockReturnValueOnce(false);
    expect(f.controller.play('hit')).toBe(false);
    expect(f.controller.play('hit')).toBe(false);
    f.state.now += 80;
    f.vibrate.mockImplementationOnce(() => { throw new Error('Blocked by browser'); });
    expect(() => f.controller.play('hit')).not.toThrow();
    expect(f.controller.play('hit')).toBe(false);
    expect(f.vibrate).toHaveBeenCalledTimes(2);
  });

  it('uses capability and touch input checks, with no browser-name detection or iframe calls', () => {
    expect(isHapticsAvailable()).toBe(false);
    const top = {};
    const media = { matches: true };
    const win = { self: top, top, matchMedia: vi.fn(() => media) };
    vi.stubGlobal('window', win); vi.stubGlobal('navigator', {});
    expect(isHapticsAvailable()).toBe(false);
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
    expect(isHapticsAvailable()).toBe(true);
    media.matches = false; expect(isHapticsAvailable()).toBe(false);
    media.matches = true; win.self = {}; expect(isHapticsAvailable()).toBe(false);
  });
});

function browserFixture() {
  const flags = { visible: true, focused: true, activated: true, menu: false, modal: false };
  const body = { dataset: { appMode: 'play-world' } };
  const win = Object.assign(new EventTarget(), {
    top: null as unknown, self: null as unknown,
    matchMedia: () => ({ matches: true }),
    localStorage: { setItem: vi.fn() },
  });
  win.top = win; win.self = win;
  const doc = Object.assign(new EventTarget(), {
    body,
    hasFocus: () => flags.focused,
    getElementById: () => flags.menu ? { classList: { contains: () => true } } : null,
    querySelectorAll: () => flags.modal ? [{ classList: { contains: () => false }, getAttribute: () => null }] : [],
  });
  Object.defineProperty(doc, 'visibilityState', { get: () => flags.visible ? 'visible' : 'hidden' });
  let modeChanged = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { modeChanged = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const vibrate = vi.fn(() => true);
  vi.stubGlobal('navigator', { vibrate, userActivation: { get hasBeenActive() { return flags.activated; } } });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  vi.spyOn(performance, 'now').mockReturnValue(100);
  updateComfortSettings({ haptics: true });
  return { flags, body, win, doc, vibrate, disconnect, modeChanged: () => modeChanged() };
}

it('cancels on hide, blur, leaving Play and the device off switch; teardown removes listeners', () => {
  const f = browserFixture();
  playHaptic('goal'); f.flags.visible = false; f.doc.dispatchEvent(new Event('visibilitychange'));
  f.flags.visible = true;
  playHaptic('goal'); f.win.dispatchEvent(new Event('blur'));
  playHaptic('goal'); f.body.dataset.appMode = 'world'; f.modeChanged();
  f.body.dataset.appMode = 'play-world';
  playHaptic('goal'); updateComfortSettings({ haptics: false });
  expect(f.vibrate.mock.calls).toEqual(Array.from({ length: 4 }, () => [[[30, 40, 60]], [0]]).flat());
  destroyHaptics(); expect(f.disconnect).toHaveBeenCalledOnce();
  f.vibrate.mockClear(); f.win.dispatchEvent(new Event('blur'));
  f.doc.dispatchEvent(new Event('visibilitychange')); updateComfortSettings({ haptics: true });
  expect(f.vibrate).not.toHaveBeenCalled();
});

it('requires active, focused gameplay and a user gesture, with menus/dialogs yielded', () => {
  const f = browserFixture();
  f.flags.activated = false; playHaptic('jump'); f.flags.activated = true;
  f.flags.focused = false; playHaptic('jump'); f.flags.focused = true;
  f.flags.menu = true; playHaptic('jump'); f.flags.menu = false;
  f.flags.modal = true; playHaptic('jump'); f.flags.modal = false;
  f.body.dataset.appMode = 'editor'; playHaptic('jump');
  expect(f.vibrate).not.toHaveBeenCalled();
  f.body.dataset.appMode = 'play-world'; playHaptic('jump');
  expect(f.vibrate).toHaveBeenCalledExactlyOnceWith(5);
});
