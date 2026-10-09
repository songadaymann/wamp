import { describe, expect, it, vi } from 'vitest';
import { drawRoomEdgeGuideMarks, drawRoomEdgeGuides } from './edgeGuideDrawing';

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
  it('places markers at fixed edge positions, and an Expanded cell draws the same marks at its origin', () => {
    const record = () => { const lines: number[][] = []; return { lines, graphics: { clear: vi.fn(), lineStyle: vi.fn(), lineBetween: (...v: number[]) => lines.push(v) } }; };
    const guides = [{ side: 'left' as const, start: 100, end: 140, state: 'connected' as const }, { side: 'bottom' as const, start: 300, end: 340, state: 'blocked' as const }];
    const room = record(); drawRoomEdgeGuides(room.graphics as never, guides, 1);
    // Left chevron at x = size + 2 (size 4 at zoom 1), centered on its span.
    expect(room.lines[0]).toEqual([6 + 4, 120 - 4, 6 - 4, 120]);
    // Bottom X centered at y = 352 - size - 2.
    expect(room.lines[2]).toEqual([320 - 4, 346 - 4, 320 + 4, 346 + 4]);
    const cell = record(); drawRoomEdgeGuideMarks(cell.graphics as never, guides, 1, { x: 640, y: 352 });
    expect(cell.graphics.clear).not.toHaveBeenCalled();
    expect(cell.lines).toEqual(room.lines.map(([x1, y1, x2, y2]) => [x1 + 640, y1 + 352, x2 + 640, y2 + 352]));
  });
});
