import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { ComposerTouchController, uncoveredMapArea } from './composerMap';

function pointer(id: number, x = 100, y = 100, type = 'touchend'): Phaser.Input.Pointer {
  return { id, x, y, event: { type } } as Phaser.Input.Pointer;
}

function harness() {
  const host = {
    beginPan: vi.fn(), pan: vi.fn(), select: vi.fn(), settle: vi.fn(), pinch: vi.fn(),
    worldPoint: (x: number, y: number) => ({ x: x * 4, y: y * 4 }),
  };
  return { touch: new ComposerTouchController(host), host };
}

describe('Expanded Room setup map touch (F365)', () => {
  it('drags the map with one finger without selecting, and a tap still selects a cell', () => {
    const { touch, host } = harness();
    touch.down(pointer(1));
    touch.move(pointer(1, 106));
    expect(host.beginPan).not.toHaveBeenCalled();
    // The drag starts where the finger crosses the tap threshold, so the map does not jump.
    touch.move(pointer(1, 112));
    expect(host.beginPan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ x: 112, y: 100 }));
    expect(host.pan).not.toHaveBeenCalled();
    touch.move(pointer(1, 160, 140));
    expect(host.pan).toHaveBeenLastCalledWith(expect.objectContaining({ x: 160, y: 140 }));
    touch.up(pointer(1, 160, 140));
    expect(host.select).not.toHaveBeenCalled();
    expect(host.settle).toHaveBeenCalledOnce();

    touch.down(pointer(2, 50, 50));
    touch.move(pointer(2, 54, 52));
    touch.up(pointer(2, 54, 52));
    expect(host.select).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 2, x: 54 }));
    expect(host.settle).toHaveBeenCalledOnce();
  });

  it('pinch-zooms around the first midpoint and pans with it, then selects nothing', () => {
    const { touch, host } = harness();
    touch.down(pointer(1, 100, 100));
    touch.down(pointer(2, 200, 100));
    touch.move(pointer(2, 300, 100));
    expect(host.pinch).toHaveBeenLastCalledWith(2, { x: 600, y: 400 }, 200, 100);
    touch.move(pointer(1, 150, 100));
    expect(host.pinch).toHaveBeenLastCalledWith(0.75, { x: 600, y: 400 }, 225, 100);
    touch.up(pointer(2, 300, 100));
    // The pinch keeps the last finger until it lifts: no drag, no selection.
    touch.move(pointer(1, 20, 20));
    expect(host.pan).not.toHaveBeenCalled();
    expect(host.settle).not.toHaveBeenCalled();
    touch.up(pointer(1, 150, 100));
    expect(host.select).not.toHaveBeenCalled();
    expect(host.settle).toHaveBeenCalledOnce();
  });

  it('measures a new finger pair afresh when the first of three fingers lifts', () => {
    const { touch, host } = harness();
    touch.down(pointer(1, 100, 100));
    touch.down(pointer(2, 200, 100));
    touch.down(pointer(3, 300, 100));
    touch.up(pointer(1, 100, 100));
    // The new pair is measured where it stands, not against the old pair's distance and midpoint.
    touch.move(pointer(3, 400, 100));
    expect(host.pinch).not.toHaveBeenCalled();
    touch.move(pointer(3, 500, 100));
    expect(host.pinch).toHaveBeenLastCalledWith(1.5, { x: 1200, y: 400 }, 350, 100);
  });

  it('never selects on a cancelled touch or a release off the canvas, and forgets fingers on blur', () => {
    const { touch, host } = harness();
    touch.down(pointer(1));
    touch.up(pointer(1, 100, 100, 'touchcancel'));
    touch.down(pointer(1));
    touch.up(pointer(1), true);
    expect(host.select).not.toHaveBeenCalled();
    touch.down(pointer(1));
    touch.reset();
    // A finger left down when the window lost focus must not turn the next touch into a pinch.
    touch.down(pointer(2));
    touch.up(pointer(2));
    expect(host.pinch).not.toHaveBeenCalled();
    expect(host.select).toHaveBeenCalledOnce();
  });
});

describe('map area beside the Expanded Room setup panel', () => {
  const canvas = { left: 0, top: 0, width: 390, height: 844 };

  it('centres on the map above the phone sheet and right of the desktop column', () => {
    expect(uncoveredMapArea(canvas, { left: 0, top: 456, width: 390, height: 388 }, 390, 844))
      .toEqual({ x: 0, y: 0, width: 390, height: 456 });
    expect(uncoveredMapArea({ left: 0, top: 0, width: 1280, height: 800 }, { left: 16, top: 16, width: 380, height: 768 }, 1280, 800))
      .toEqual({ x: 396, y: 0, width: 884, height: 800 });
  });

  it('leaves out the phone account controls across the top', () => {
    const sheet = { left: 0, top: 456, width: 390, height: 388 };
    expect(uncoveredMapArea(canvas, sheet, 390, 844, { left: 8, top: 12, width: 374, height: 44 }))
      .toEqual({ x: 0, y: 56, width: 390, height: 400 });
    // The desktop account box covers only a corner of the map right of the column.
    expect(uncoveredMapArea({ left: 0, top: 0, width: 1280, height: 800 }, { left: 16, top: 16, width: 380, height: 768 }, 1280, 800,
      { left: 944, top: 16, width: 320, height: 60 })).toEqual({ x: 396, y: 0, width: 884, height: 800 });
  });

  it('uses the whole map when the panel is hidden or off the canvas, and maps CSS pixels to the camera', () => {
    expect(uncoveredMapArea(canvas, { left: 0, top: 0, width: 0, height: 0 }, 390, 844)).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(uncoveredMapArea(canvas, { left: 400, top: 0, width: 100, height: 100 }, 390, 844)).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(uncoveredMapArea({ left: 10, top: 20, width: 200, height: 400 }, { left: 10, top: 220, width: 200, height: 200 }, 400, 800))
      .toEqual({ x: 0, y: 0, width: 400, height: 400 });
  });
});
