import { describe, expect, it, vi } from 'vitest';
import { EditorSprayTicker } from './sprayTicker';
import { getSprayTilesPerSecond, listCircleBrushOffsets } from './sprayTiles';

describe('held editor Spray timing', () => {
  it('emits the same amount over a second at different frame rates without pointer moves', () => {
    const count = (frames: number) => {
      const ticker = new EditorSprayTicker(); const emit = vi.fn();
      for (let n = 0; n < frames; n += 1) ticker.tick(1000 / frames, true, 5, 1, emit);
      return emit.mock.calls.length;
    };
    expect(count(20)).toBeCloseTo(getSprayTilesPerSecond(5, 1), 0);
    expect(Math.abs(count(20) - count(60))).toBeLessThanOrEqual(1);
  });

  it('drops fractional work on release/cancellation and ignores negative time', () => {
    const ticker = new EditorSprayTicker(); const emit = vi.fn();
    ticker.tick(20, true, 5, 1, emit);
    ticker.tick(0, false, 5, 1, emit);
    ticker.tick(10, true, 5, 1, emit);
    ticker.tick(-1000, true, 5, 1, emit);
    expect(emit).not.toHaveBeenCalled();
    ticker.reset(); ticker.tick(20, true, 5, 1, emit);
    expect(emit).not.toHaveBeenCalled();
  });

  it('caps a stalled frame to one brush circle', () => {
    const ticker = new EditorSprayTicker(); const emit = vi.fn();
    ticker.tick(10000, true, 5, 1, emit);
    expect(emit).toHaveBeenCalledTimes(listCircleBrushOffsets(5).length);
  });
});
