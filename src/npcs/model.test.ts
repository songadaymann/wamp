import { describe, expect, it } from 'vitest';
import {
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
});
