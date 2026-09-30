import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Vector2: class Vector2 {
        constructor(public x = 0, public y = 0) {}
      },
      Clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max),
    },
  },
}));

import {
  clientPointToCameraScreen,
  getScreenAnchorWorldPoint,
  getScrollForScreenAnchor,
} from './camera';

describe('clientPointToCameraScreen', () => {
  it('maps a wheel event through the editor canvas offset into camera space', () => {
    const screen = clientPointToCameraScreen(
      780,
      432,
      { left: 280, top: 132, width: 1000, height: 600 },
      1000,
      600,
    );

    expect(screen).toEqual({ x: 500, y: 300 });
  });

  it('scales when the canvas css size differs from the camera viewport', () => {
    const screen = clientPointToCameraScreen(
      250,
      150,
      { left: 50, top: 50, width: 400, height: 200 },
      800,
      400,
    );

    expect(screen).toEqual({ x: 400, y: 200 });
  });

  it('ignores wheel events that land outside the canvas', () => {
    expect(clientPointToCameraScreen(
      10,
      10,
      { left: 280, top: 132, width: 1000, height: 600 },
      1000,
      600,
    )).toBeNull();
    expect(clientPointToCameraScreen(
      400,
      400,
      { left: 0, top: 0, width: 0, height: 600 },
      1000,
      600,
    )).toBeNull();
  });
});

describe('cursor anchored zoom', () => {
  it('keeps the world point under the cursor after the zoom changes', () => {
    const camera = {
      x: 0,
      y: 0,
      width: 1000,
      height: 600,
      originX: 0.5,
      originY: 0.5,
      scrollX: 40,
      scrollY: -20,
      zoom: 1,
      displayWidth: 1000,
      displayHeight: 600,
    };
    const cursor = { x: 220, y: 140 };
    const anchor = getScreenAnchorWorldPoint(cursor.x, cursor.y, camera as never);

    camera.zoom = 2;
    camera.displayWidth = camera.width / camera.zoom;
    camera.displayHeight = camera.height / camera.zoom;
    const nextScroll = getScrollForScreenAnchor(anchor.x, anchor.y, cursor.x, cursor.y, camera as never);
    camera.scrollX = nextScroll.x;
    camera.scrollY = nextScroll.y;

    const anchored = getScreenAnchorWorldPoint(cursor.x, cursor.y, camera as never);
    expect(anchored.x).toBeCloseTo(anchor.x);
    expect(anchored.y).toBeCloseTo(anchor.y);
  });
});
