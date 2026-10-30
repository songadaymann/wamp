import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Scene: class {},
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Vector2: class Vector2 { constructor(public x: number, public y: number) {} },
  },
} }));
vi.mock('../ui/appMode', () => ({ setAppMode: vi.fn() }));

import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../config';
import { CourseEditorScene } from './CourseEditorScene';

function camera(width: number, height: number) {
  let bounds = { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  const cam = {
    x: 0, y: 0, width, height, originX: 0.5, originY: 0.5, zoom: 1, scrollX: 0, scrollY: 0, midPoint: { x: 0, y: 0 },
    get displayWidth() { return cam.width / cam.zoom; },
    get displayHeight() { return cam.height / cam.zoom; },
    setZoom: (zoom: number) => { cam.zoom = zoom; return cam; },
    setScroll: (x: number, y: number) => { cam.scrollX = x; cam.scrollY = y; return cam; },
    // Like Phaser, centerOn also records the middle of the view, which a resize keeps.
    centerOn: (x: number, y: number) => { cam.midPoint = { x, y }; cam.scrollX = x - cam.width / 2; cam.scrollY = y - cam.height / 2; return cam; },
    setBounds: (x: number, y: number, w: number, h: number) => { bounds = { x, y, width: w, height: h, centerX: x + w / 2, centerY: y + h / 2 }; return cam; },
    getBounds: () => bounds,
    worldX: (screenX: number) => cam.scrollX + cam.width / 2 + (screenX - cam.width / 2) / cam.zoom,
    screenX: (worldX: number) => (worldX - cam.scrollX - cam.width / 2) * cam.zoom + cam.width / 2,
  };
  return cam;
}

/** The Expanded Room editor with two cells side by side, on a phone held either way. */
function fit(orientationState: 'landscape' | 'portrait', width: number, height: number) {
  const cam = camera(width, height);
  const scene = Object.assign(Object.create(CourseEditorScene.prototype), {
    cameras: { main: cam },
    scale: { width, height },
    game: { canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 48, width, height }),
      ownerDocument: {
        body: { dataset: { deviceClass: 'phone', orientationState, editorDockShell: 'true' } },
        // The library sheet is open, so the switch is hidden and its column is not measurable.
        getElementById: () => null,
      },
    } },
    musicWorkflow: { isActive: () => false },
    workspaceBounds: { minX: 99, maxX: 100, minY: 99, maxY: 99 },
    inspectZoom: 0.22,
    renderUi: vi.fn(),
  }) as { fitToScreen(): void };
  scene.fitToScreen();
  return cam;
}

describe('Expanded Room fit beside the landscape Draw/Erase switch (F369)', () => {
  it('fits the rooms right of the switch column and centres them there', () => {
    const cam = fit('landscape', 740, 258);
    // The 60px column leaves 680px: (680 - 64 padding) / 1280px of rooms.
    expect(cam.zoom).toBeCloseTo(0.481, 3);
    expect(cam.worldX(60 + 680 / 2)).toBeCloseTo(ROOM_PX_WIDTH, 3);
    expect(cam.screenX(0)).toBeGreaterThanOrEqual(60);
    expect(cam.screenX(2 * ROOM_PX_WIDTH)).toBeLessThanOrEqual(740);
    expect(cam.scrollY + cam.height / 2).toBeCloseTo(ROOM_PX_HEIGHT / 2, 3);
  });

  it('records the middle of the view, so the sheet closing keeps the rooms where Fit put them', () => {
    const cam = fit('landscape', 740, 258);
    expect(cam.midPoint.x).toBeCloseTo(cam.worldX(740 / 2), 3);
    expect(cam.midPoint.y).toBeCloseTo(ROOM_PX_HEIGHT / 2, 3);
  });

  it('keeps the whole width in portrait, where the switch sits below the rooms', () => {
    const cam = fit('portrait', 390, 742);
    expect(cam.worldX(390 / 2)).toBeCloseTo(ROOM_PX_WIDTH, 3);
    expect(cam.zoom).toBeCloseTo((390 - 64) / (2 * ROOM_PX_WIDTH), 3);
  });
});
