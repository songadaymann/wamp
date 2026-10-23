import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PALETTE_TOUCH_HOLD_MS, PALETTE_TOUCH_SLOP_PX, PaletteTouchPress } from './paletteTouchPress';

const cell = { col: 3, row: 21 };
let holds: Array<typeof cell>;
let press: PaletteTouchPress<typeof cell>;

beforeEach(() => {
  vi.useFakeTimers();
  holds = [];
  press = new PaletteTouchPress(held => holds.push(held));
});
afterEach(() => vi.useRealTimers());

describe('touch on the tileset picker (F368)', () => {
  it('picks the tapped tile when the finger lifts before the hold', () => {
    press.down(1, cell, 100, 200);
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS - 50);
    expect(press.move(1, 103, 204)).toBe(false);
    expect(press.up(1)).toEqual(cell);
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    expect(holds).toEqual([]);
    expect(press.active).toBe(false);
  });

  it('lets a swipe scroll the picker without selecting anything', () => {
    press.down(1, cell, 100, 200);
    expect(press.move(1, 100, 200 - PALETTE_TOUCH_SLOP_PX - 1)).toBe(false);
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    expect(holds).toEqual([]);
    expect(press.up(1)).toBeNull();
  });

  it('starts a block selection after a still hold, then follows the finger', () => {
    press.down(1, cell, 100, 200);
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    expect(holds).toEqual([cell]);
    expect(press.holding).toBe(true);
    // Far moves now extend the block instead of cancelling it.
    expect(press.move(1, 180, 260)).toBe(true);
    expect(press.up(1)).toBeNull();
    expect(press.holding).toBe(false);
  });

  it('ignores other pointers, and a second finger cancels the press', () => {
    press.down(1, cell, 100, 200);
    expect(press.move(2, 300, 300)).toBe(false);
    expect(press.up(2)).toBeNull();
    expect(press.active).toBe(true);
    press.down(2, { col: 0, row: 0 }, 140, 220);
    expect(press.active).toBe(false);
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    expect(holds).toEqual([]);
    expect(press.up(1)).toBeNull();
  });

  it('forgets the press when the browser takes the touch for scrolling', () => {
    press.down(1, cell, 100, 200);
    press.cancel();
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    expect(holds).toEqual([]);
    expect(press.up(1)).toBeNull();
  });
});
