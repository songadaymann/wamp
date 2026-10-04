import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorTouchCandidate, EditorTouchGesture } from './touchGesture';

afterEach(() => vi.useRealTimers());

function candidate() {
  return new EditorTouchCandidate((delay, callback) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  });
}

describe('first-finger editing candidate', () => {
  it('waits for a 90ms hold and begins only once', () => {
    vi.useFakeTimers();
    const edit = candidate();
    const begin = vi.fn();
    edit.down({ x: 10, y: 10 }, begin);
    vi.advanceTimersByTime(89);
    edit.move({ x: 15, y: 10 });
    expect(begin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    edit.activate();
    edit.move({ x: 40, y: 10 });
    expect(begin).toHaveBeenCalledOnce();
  });

  it('starts a drag after 6px or a quick tap on release without a delayed duplicate', () => {
    vi.useFakeTimers();
    const edit = candidate();
    const begin = vi.fn();
    edit.down({ x: 10, y: 10 }, begin);
    edit.move({ x: 17, y: 10 });
    expect(begin).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(200);
    edit.down({ x: 10, y: 10 }, begin);
    edit.activate();
    vi.advanceTimersByTime(200);
    expect(begin).toHaveBeenCalledTimes(2);
  });

  it('drops a pending contact on pinch and cannot start it after a new gesture', () => {
    vi.useFakeTimers();
    const edit = candidate();
    const cancelled = vi.fn();
    const fresh = vi.fn();
    edit.down({ x: 10, y: 10 }, cancelled);
    edit.cancel();
    vi.advanceTimersByTime(30);
    edit.down({ x: 20, y: 20 }, fresh);
    vi.advanceTimersByTime(60);
    expect(cancelled).not.toHaveBeenCalled();
    expect(fresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(fresh).toHaveBeenCalledOnce();
  });
});

const point = (id: number, x = 40, y = 40) => ({ id, x, y });

describe('touch editor gesture ownership', () => {
  it('recognizes taps, drags, and an excursion returning to its starting point', () => {
    const gesture = new EditorTouchGesture();
    expect(gesture.down(point(1))).toBe('edit');
    expect(gesture.up(point(1, 45))).toBe('tap');
    gesture.down(point(1));
    gesture.move(point(1, 70));
    expect(gesture.up(point(1))).toBe('drag');
    gesture.down(point(1));
    expect(gesture.up(point(1, 80))).toBe('drag');
  });

  it('keeps a pinch latched through either release order and a third finger', () => {
    for (const firstUp of [1, 2]) {
      const gesture = new EditorTouchGesture();
      gesture.down(point(1));
      expect(gesture.down(point(2, 90))).toBe('pinch');
      expect(gesture.up(point(firstUp))).toBe('ignore');
      const remaining = firstUp === 1 ? 2 : 1;
      expect(gesture.move(point(remaining, 100))).toBe('ignore');
      expect(gesture.down(point(3))).toBe('pinch');
      gesture.up(point(3));
      expect(gesture.up(point(remaining))).toBe('ignore');
      expect(gesture.down(point(4))).toBe('edit');
      expect(gesture.up(point(4))).toBe('tap');
    }
  });

  it('ignores stray releases and suppresses an interrupted stroke until every touch lifts', () => {
    const gesture = new EditorTouchGesture();
    expect(gesture.up(point(1))).toBe('ignore');
    gesture.down(point(1));
    gesture.suppress();
    expect(gesture.move(point(1, 80))).toBe('ignore');
    expect(gesture.up(point(1))).toBe('ignore');
    expect(gesture.down(point(2))).toBe('edit');
    gesture.reset();
    expect(gesture.points.size).toBe(0);
    expect(gesture.up(point(2))).toBe('ignore');
  });
});
