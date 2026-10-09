import { describe, expect, it, vi } from 'vitest';
import { drawRoomEdgeGuides } from './edgeGuideDrawing';

describe('room edge guide drawing', () => {
  it('draws bounded chevrons and distinct X marks inside the room at desktop/phone zooms', () => {
    const lines: number[][] = [], graphics = { clear: vi.fn(), lineStyle: vi.fn(), lineBetween: (...v: number[]) => lines.push(v) };
    const guides = [{ side: 'left' as const, start: 13, end: 339, state: 'connected' as const }, { side: 'right' as const, start: 160, end: 180, state: 'blocked' as const }, { side: 'top' as const, start: 10, end: 630, state: 'open-space' as const }];
    for (const zoom of [1.5, 0.4]) {
      lines.length = 0; drawRoomEdgeGuides(graphics as never, guides, zoom);
      expect(lines).toHaveLength(18);
      for (const [x1, y1, x2, y2] of lines) {
        expect(x1).toBeGreaterThanOrEqual(0); expect(x2).toBeLessThanOrEqual(640);
        expect(y1).toBeGreaterThanOrEqual(0); expect(y2).toBeLessThanOrEqual(352);
      }
      expect(graphics.lineStyle.mock.calls.slice(-3).map(a => a[1])).toEqual([0x75cf60, 0xff6f3c, 0x7de5ff]);
    }
  });
  it('clears prior guides when a seam is excluded or the scene resets', () => {
    const graphics = { clear: vi.fn(), lineStyle: vi.fn(), lineBetween: vi.fn() };
    drawRoomEdgeGuides(graphics as never, [], 1); expect(graphics.clear).toHaveBeenCalledOnce(); expect(graphics.lineBetween).not.toHaveBeenCalled();
  });
});
