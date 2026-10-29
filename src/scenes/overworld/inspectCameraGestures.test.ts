import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Math: { Vector2: class Vector2 {
  constructor(public x: number, public y: number) {}
} } } }));
import { applyInspectPointerPan, pointerPassedPanThreshold, zoomInspectCamera } from './inspectCameraGestures';
import { getScreenAnchorWorldPoint } from './camera';

function camera() {
  return { x: 40, y: 20, width: 800, height: 600, originX: 0.5, originY: 0.5,
    zoom: 1, scrollX: 640, scrollY: 400,
    get displayWidth() { return this.width / this.zoom; },
    get displayHeight() { return this.height / this.zoom; },
    setZoom(zoom: number) { this.zoom = zoom; },
    setScroll(x: number, y: number) { this.scrollX = x; this.scrollY = y; },
  };
}

describe('shared inspect camera gestures', () => {
  it('pans in world units with the configured threshold', () => {
    const cam = camera(); cam.zoom = 2;
    const start = { x: 10, y: 10 }, pointer = { x: 16, y: 10 };
    expect(pointerPassedPanThreshold(start, pointer, 5)).toBe(true);
    expect(pointerPassedPanThreshold(start, { x: 14, y: 10 }, 5)).toBe(false);
    applyInspectPointerPan(cam as never, start, { x: 640, y: 400 }, pointer);
    expect(cam.scrollX).toBe(637); expect(cam.scrollY).toBe(400);
  });

  it('keeps the pointer on the same world point after zoom, even when bounds recenter scroll', () => {
    const cam = camera(); const pointer = { x: 250, y: 170 };
    const before = getScreenAnchorWorldPoint(pointer.x, pointer.y, cam as never);
    const storeZoom = vi.fn(), constrain = vi.fn();
    expect(zoomInspectCamera({ camera: cam as never, minZoom: 0.25, maxZoom: 6,
      storeZoom, updateBounds: () => cam.setScroll(0, 0), constrain,
    }, 2, pointer)).toBe(true);
    const after = getScreenAnchorWorldPoint(pointer.x, pointer.y, cam as never);
    expect(after).toEqual(before); expect(storeZoom).toHaveBeenCalledWith(2);
    expect(constrain).toHaveBeenCalledTimes(1);
  });

  it('clamps to each host limit and avoids repeated UI work at that limit', () => {
    const cam = camera(), storeZoom = vi.fn(), constrain = vi.fn();
    const host = { camera: cam as never, minZoom: 0.1, maxZoom: 3, storeZoom, constrain };
    zoomInspectCamera(host, 20, { x: 100, y: 100 });
    expect(cam.zoom).toBe(3);
    expect(zoomInspectCamera(host, 20, { x: 100, y: 100 })).toBe(false);
    expect(storeZoom).toHaveBeenCalledTimes(1);
  });
});
