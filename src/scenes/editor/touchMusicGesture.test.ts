import { describe, expect, it, vi } from 'vitest';
import { TouchMusicGesture, planTouchMusicZoom } from './touchMusicGesture';

function fixture() {
  const host = {
    cellAt: ({ x, y }: { x: number; y: number }) => x >= 0 && y >= 0 ? { step: Math.floor(x / 44), row: Math.floor(y / 44) } : null,
    pan: vi.fn(), pinch: vi.fn(), preview: vi.fn(), commit: vi.fn(),
  };
  return { host, gesture: new TouchMusicGesture(host) };
}

describe('touch music gesture ownership', () => {
  it('defers a tap until release and never treats a pan as a note', () => {
    const { host, gesture } = fixture();
    gesture.down(1, { x: 20, y: 20 }, 'pencil', false);
    expect(host.commit).not.toHaveBeenCalled();
    gesture.up(1);
    expect(host.commit).toHaveBeenCalledExactlyOnceWith([{ step: 0, row: 0 }], 'pencil');
    gesture.down(2, { x: 20, y: 20 }, 'pencil', false);
    gesture.move(2, { x: 140, y: 64 });
    gesture.up(2);
    expect(host.commit).toHaveBeenCalledTimes(1);
    expect(host.pan).toHaveBeenCalledWith(-120, -44);
  });

  it('fills fast explicit drawing strokes, with one commit on release', () => {
    const { host, gesture } = fixture();
    gesture.down(1, { x: 20, y: 64 }, 'pencil', true);
    gesture.move(1, { x: 152, y: 64 });
    expect(host.commit).not.toHaveBeenCalled();
    gesture.up(1);
    expect(host.commit).toHaveBeenCalledExactlyOnceWith([0, 1, 2, 3].map(step => ({ step, row: 1 })), 'pencil');
    expect(host.pan).not.toHaveBeenCalled();
  });

  it('discards a pending drawing stroke when a second finger arrives, even after one finger lifts', () => {
    const { host, gesture } = fixture();
    gesture.down(1, { x: 20, y: 64 }, 'pencil', true);
    gesture.move(1, { x: 108, y: 64 });
    gesture.down(2, { x: 200, y: 64 }, 'pencil', true);
    gesture.move(2, { x: 244, y: 64 });
    expect(host.pinch).toHaveBeenCalled();
    gesture.up(2);
    gesture.move(1, { x: 152, y: 64 });
    gesture.up(1);
    expect(host.commit).not.toHaveBeenCalled();
    gesture.down(3, { x: 20, y: 64 }, 'pencil', false);
    gesture.up(3);
    expect(host.commit).toHaveBeenCalledOnce();
  });

  it('cancellation, blur/reset and unexpected capture loss discard pending edits', () => {
    for (const cancel of ['up', 'reset']) {
      const { host, gesture } = fixture();
      gesture.down(1, { x: 20, y: 64 }, 'eraser', true);
      gesture.move(1, { x: 108, y: 64 });
      if (cancel === 'up') gesture.up(1, true);
      else gesture.cancel();
      gesture.up(1);
      expect(host.commit).not.toHaveBeenCalled();
    }
  });

  it('copy selects without panning and a third finger cannot author notes', () => {
    const { host, gesture } = fixture();
    gesture.down(1, { x: 20, y: 64 }, 'copy', false);
    gesture.move(1, { x: 108, y: 108 });
    gesture.up(1);
    expect(host.commit.mock.calls[0][1]).toBe('copy');
    expect(host.pan).not.toHaveBeenCalled();
    host.commit.mockClear();
    for (const id of [1, 2, 3]) gesture.down(id, { x: id * 44, y: 64 }, 'pencil', true);
    gesture.move(3, { x: 220, y: 108 });
    for (const id of [1, 2, 3]) gesture.up(id);
    expect(host.commit).not.toHaveBeenCalled();
  });

  it('dragging from outside a cell pans without creating a note', () => {
    const { host, gesture } = fixture();
    gesture.down(1, { x: -5, y: 20 }, 'pencil', true);
    gesture.move(1, { x: 108, y: 108 });
    gesture.up(1);
    expect(host.commit).not.toHaveBeenCalled();
    expect(host.pan).toHaveBeenCalled();
  });
});

describe('touch music zoom geometry', () => {
  it('keeps minimum 44px cells and caps at 88px', () => {
    expect(planTouchMusicZoom(44, 0.01, { x: 0, y: 0 }, { x: 48, y: 32 }).size).toBe(44);
    expect(planTouchMusicZoom(70, 100, { x: 0, y: 0 }, { x: 48, y: 32 }).size).toBe(88);
  });

  it('keeps the musical location anchored beneath a moving pinch midpoint', () => {
    const before = { x: 352, y: 220 }, from = { x: 180, y: 164 }, to = { x: 200, y: 184 };
    const plan = planTouchMusicZoom(44, 1.5, before, from, to);
    expect((before.x + from.x - 48) / 44).toBeCloseTo((plan.scroll.x + to.x - 48) / plan.size);
    expect((before.y + from.y - 32) / 44).toBeCloseTo((plan.scroll.y + to.y - 32) / plan.size);
  });
});
