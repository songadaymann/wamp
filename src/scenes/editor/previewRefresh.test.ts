import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorPreviewRefresh } from './previewRefresh';

afterEach(() => vi.useRealTimers());
describe('editor preview coalescing', () => {
  it('dispatches only after 150ms of quiet and drops superseded pending edits', () => {
    vi.useFakeTimers(); const run = vi.fn(), refresh = new EditorPreviewRefresh(run);
    for (let i = 0; i < 50; i++) { refresh.schedule(); vi.advanceTimersByTime(10); }
    expect(run).not.toHaveBeenCalled(); vi.advanceTimersByTime(139); expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(run).toHaveBeenCalledOnce();
  });
  it('flushes the final canvas gesture once and cancels stopped/closed previews', () => {
    vi.useFakeTimers(); const run = vi.fn(), refresh = new EditorPreviewRefresh(run);
    refresh.schedule(); refresh.schedule(); refresh.flush(); refresh.flush(); vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledOnce(); refresh.schedule(); refresh.cancel(); vi.advanceTimersByTime(200); expect(run).toHaveBeenCalledOnce();
  });
});
