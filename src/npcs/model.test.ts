import { describe, expect, it } from 'vitest';
import {
  getJimothyActionAnimationKey,
  JIMOTHY_ANIMATION_KEYS,
  normalizeNpcFriendlyFire,
  normalizeNpcPlayerCollision,
} from './model';

describe('NPC interaction settings', () => {
  it('keeps player collision and friendly fire enabled for existing NPCs', () => {
    expect(normalizeNpcPlayerCollision(undefined)).toBe(true);
    expect(normalizeNpcFriendlyFire(null)).toBe(true);
  });

  it('preserves explicit interaction opt-outs', () => {
    expect(normalizeNpcPlayerCollision(false)).toBe(false);
    expect(normalizeNpcFriendlyFire(false)).toBe(false);
  });

  it('uses pre-flipped death and victory frames when facing left', () => {
    expect(getJimothyActionAnimationKey('death', 1)).toBe(JIMOTHY_ANIMATION_KEYS.death);
    expect(getJimothyActionAnimationKey('victory', 1)).toBe(JIMOTHY_ANIMATION_KEYS.victory);
    expect(getJimothyActionAnimationKey('death', -1)).toBe(JIMOTHY_ANIMATION_KEYS.deathLeft);
    expect(getJimothyActionAnimationKey('victory', -1)).toBe(JIMOTHY_ANIMATION_KEYS.victoryLeft);
  });
});
