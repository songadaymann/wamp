import { afterEach, describe, expect, it } from 'vitest';
import { MannCoolControllerInput, isMannCoolParentMessage, parseMannCoolKeyMessage, setMannCoolInputSource } from './mannCoolInput';
import { consumeTouchAction, getTouchInputState, pressTouchAction, resetTouchInputState, setTouchActionHeld, setTouchControlsActive, setTouchMove } from '../ui/mobile/touchControls';
const event = (key: string, eventType = 'keydown') => ({ type: 'keyEvent', key, eventType });
const input = () => { const source = new MannCoolControllerInput(); source.setEnabled(true); return source; };
afterEach(() => { setMannCoolInputSource(null); setTouchControlsActive(false); });
describe('mann.cool controller', () => {
  it('trusts only the actual embedded parent at the exact origin', () => {
    const parent = {} as Window, self = {} as Window, sibling = {} as Window;
    expect(isMannCoolParentMessage({ origin: 'https://mann.cool', source: parent }, parent, self)).toBe(true);
    for (const origin of ['http://mann.cool', 'https://mann.cool.evil.test', 'https://www.mann.cool', 'null']) expect(isMannCoolParentMessage({ origin, source: parent }, parent, self)).toBe(false);
    expect(isMannCoolParentMessage({ origin: 'https://mann.cool', source: sibling }, parent, self)).toBe(false);
    expect(isMannCoolParentMessage({ origin: 'https://mann.cool', source: self }, self, self)).toBe(false);
  });
  it('accepts shell key aliases and rejects malformed or unknown messages', () => {
    expect(parseMannCoolKeyMessage(event('KeyW'))).toEqual({ key: 'w', down: true });
    expect(parseMannCoolKeyMessage(event('Digit9', 'keyup'))).toEqual({ key: '9', down: false });
    for (const data of [null, [], 'ArrowRight', {}, event('Enter'), event('ArrowRight', 'press'), { type: 'other', key: 'a', eventType: 'keydown' }]) expect(parseMannCoolKeyMessage(data)).toBeNull();
  });
  it('keeps aliases independently held and opposing directions neutral', () => {
    const s = input(); s.handle(event('a')); s.handle(event('ArrowLeft')); s.handle(event('d'));
    expect(s.read().moveX).toBe(0); s.handle(event('a', 'keyup')); expect(s.read().moveX).toBe(0);
    s.handle(event('ArrowLeft', 'keyup')); expect(s.read().moveX).toBe(1); s.handle(event('d', 'keyup')); expect(s.read().active).toBe(false);
  });
  it('consumes one action for quick taps, repeats and aliases', () => {
    const s = input(); s.handle(event(' ')); s.handle(event(' ')); s.handle(event('ArrowUp'));
    expect(s.consume('jump')).toBe(true); expect(s.consume('jump')).toBe(false);
    s.handle(event(' ', 'keyup')); expect(s.read().jumpHeld).toBe(true);
    s.handle(event('ArrowUp', 'keyup')); s.handle(event('q')); s.handle(event('q', 'keyup'));
    expect(s.consume('slash')).toBe(true); expect(s.consume('slash')).toBe(false);
    for (const [key, action] of [['x', 'shoot'], ['9', 'cameraToggle'], ['Escape', 'stop'], ['r', 'restart']] as const) { s.handle(event(key)); expect(s.consume(action)).toBe(true); expect(s.consume(action)).toBe(false); }
  });
  it('requires release after menus, blur or disabled input', () => {
    const s = input(); s.handle(event('d')); s.handle(event(' ')); s.setEnabled(false);
    expect(s.read().active).toBe(false); expect(s.consume('jump')).toBe(false); s.setEnabled(true); s.handle(event('d')); expect(s.read().active).toBe(false);
    s.handle(event('d', 'keyup')); s.handle(event('d')); expect(s.read().moveX).toBe(1);
    s.clear(); s.handle(event('d')); expect(s.read().active).toBe(false);
    s.setEnabled(false); s.handle(event('q')); s.setEnabled(true); s.handle(event('q')); expect(s.consume('slash')).toBe(false);
    s.handle(event('q', 'keyup')); s.handle(event('q')); expect(s.consume('slash')).toBe(true);
  });
  it('composes native and remote holds without either release stealing ownership', () => {
    const s = input(); setMannCoolInputSource(s); setTouchControlsActive(true); setTouchMove(1, 0); setTouchActionHeld('jump', true);
    s.handle(event('ArrowRight')); s.handle(event(' ')); s.handle(event('ArrowRight', 'keyup')); s.handle(event(' ', 'keyup'));
    expect(getTouchInputState()).toMatchObject({ moveX: 1, jumpHeld: true });
    s.handle(event('ArrowRight')); s.handle(event(' ')); resetTouchInputState(); expect(getTouchInputState()).toMatchObject({ moveX: 1, jumpHeld: true });
    pressTouchAction('jump'); expect(consumeTouchAction('jump')).toBe(true); expect(consumeTouchAction('jump')).toBe(false);
  });
});
