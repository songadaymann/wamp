import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PALETTE_TOUCH_FLING_STOP_MS,
  PALETTE_TOUCH_HOLD_MS,
  PALETTE_TOUCH_SLOP_PX,
  PaletteTouchPress,
} from './paletteTouchPress';

const cell = { col: 3, row: 21 };
let holds: Array<[typeof cell, number]>;
let cancelledHolds: number;
let press: PaletteTouchPress<typeof cell>;

beforeEach(() => {
  vi.useFakeTimers();
  holds = [];
  cancelledHolds = 0;
  press = new PaletteTouchPress((held, pointerId) => holds.push([held, pointerId]), () => { cancelledHolds++; });
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

  it('waits as long as a platform long press, so a slow swipe after a short rest still scrolls', () => {
    expect(PALETTE_TOUCH_HOLD_MS).toBeGreaterThanOrEqual(400);
    press.down(1, cell, 100, 200);
    vi.advanceTimersByTime(240);
    for (let frame = 1; frame <= 10; frame++) {
      vi.advanceTimersByTime(16);
      press.move(1, 100, 200 - 6 * frame);
    }
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    expect(holds).toEqual([]);
    expect(press.up(1)).toBeNull();
  });

  it('starts a block selection after a still hold, then follows the finger', () => {
    press.down(7, cell, 100, 200);
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    expect(holds).toEqual([[cell, 7]]);
    expect(press.holding).toBe(true);
    // Far moves now extend the block instead of cancelling it.
    expect(press.move(7, 180, 260)).toBe(true);
    expect(press.up(7)).toBeNull();
    expect(press.holding).toBe(false);
    expect(cancelledHolds).toBe(0);
  });

  it('only stops a fling when the finger lands while the picker is still scrolling', () => {
    press.noteScroll();
    vi.advanceTimersByTime(PALETTE_TOUCH_FLING_STOP_MS - 20);
    press.down(1, cell, 100, 200);
    expect(press.active).toBe(false);
    expect(press.up(1)).toBeNull();
    vi.advanceTimersByTime(40);
    press.down(1, cell, 100, 200);
    expect(press.up(1)).toEqual(cell);
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
    expect(cancelledHolds).toBe(0);
  });

  it('gives back the block when a second finger lands during a hold', () => {
    press.down(1, cell, 100, 200);
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    press.move(1, 180, 260);
    press.interrupt();
    expect(cancelledHolds).toBe(1);
    expect(press.up(1)).toBeNull();
    press.down(1, cell, 100, 200);
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    press.down(2, cell, 120, 220);
    expect(cancelledHolds).toBe(2);
  });

  it('forgets the press when the browser takes the touch for scrolling', () => {
    press.down(1, cell, 100, 200);
    press.cancel();
    vi.advanceTimersByTime(PALETTE_TOUCH_HOLD_MS);
    expect(holds).toEqual([]);
    expect(press.up(1)).toBeNull();
  });
});
