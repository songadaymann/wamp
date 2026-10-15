import { expect, it } from 'vitest';
import { keyboardViewportInset } from './keyboardViewport';
it('anchors above a portrait keyboard without treating its visual height as a rotation', () => {
  expect(keyboardViewportInset(844, { height: 360, offsetTop: 0, scale: 1 })).toBe(484);
});
it('accounts for a keyboard-driven visual viewport pan instead of double-offsetting the composer', () => {
  expect(keyboardViewportInset(844, { height: 360, offsetTop: 120, scale: 1 })).toBe(364);
});
it('does not interpret pinch zoom or a normal layout resize as a keyboard', () => {
  expect(keyboardViewportInset(844, { height: 360, offsetTop: 0, scale: 2 })).toBe(0);
  expect(keyboardViewportInset(360, { height: 360, offsetTop: 0, scale: 1 })).toBe(0);
  expect(keyboardViewportInset(844, null)).toBe(0);
});
