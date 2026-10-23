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
import { createDefaultCourseRecord } from '../courses/model';
import { CourseComposerScene } from './CourseComposerScene';

function camera(width: number, height: number) {
  const cam = {
    x: 0, y: 0, width, height, originX: 0.5, originY: 0.5, zoom: 1, scrollX: 0, scrollY: 0,
    get displayWidth() { return cam.width / cam.zoom; },
    get displayHeight() { return cam.height / cam.zoom; },
    setZoom: (zoom: number) => { cam.zoom = zoom; return cam; },
    setScroll: (x: number, y: number) => { cam.scrollX = x; cam.scrollY = y; return cam; },
    worldAt: (x: number, y: number) => ({
      x: cam.scrollX + cam.width / 2 - cam.displayWidth / 2 + x / cam.zoom,
      y: cam.scrollY + cam.height / 2 - cam.displayHeight / 2 + y / cam.zoom,
    }),
  };
  return cam;
}

/**
 * The setup scene on a 390x844 phone. Like the real panel, the sheet appears only when the
 * scene renders its state while running; during create() it is still hidden.
 */
function harness() {
  const record = createDefaultCourseRecord('first-open');
  record.draft.roomRefs = [{ roomId: '10,10', coordinates: { x: 10, y: 10 }, roomVersion: 1, roomTitle: null }];
  const state = { running: false, sheetShown: false };
  const sheet = { getBoundingClientRect: () => (state.sheetShown
    ? { left: 0, top: 456, width: 390, height: 388 } : { left: 0, top: 0, width: 0, height: 0 }) };
  const accountBar = { classList: { contains: () => false }, getBoundingClientRect: () => ({ left: 8, top: 12, width: 374, height: 44 }) };
  const cam = camera(390, 844);
  const scene = Object.assign(Object.create(CourseComposerScene.prototype), {
    cameras: { main: cam },
    scale: { width: 390, height: 844 },
    game: { canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }),
      ownerDocument: {
        querySelector: (selector: string) => (selector === '.course-editor-panel' ? sheet : null),
        getElementById: (id: string) => (id === 'auth-panel' ? accountBar : null),
      },
    } },
    backupDebouncer: { flush: vi.fn() },
    draftBackup: { open: async (next: unknown) => next, recoveryStatus: null },
    worldStreamingController: { getWorldWindow: () => null, refreshAround: vi.fn(async () => {}) },
    resolveInitialRecord: async () => record,
    renderUi: () => { if (state.running) state.sheetShown = true; },
    redraw: vi.fn(),
    statusText: null,
    inspectZoom: 0.18,
    selectedCoordinates: { x: 10, y: 10 },
    centerCoordinates: { x: 10, y: 10 },
  }) as { openFromData(data: object): Promise<void> };
  return { scene, state, cam };
}

describe('Expanded Room setup first open on a phone (F365)', () => {
  it('centres the course in the map above the sheet and below the account controls', async () => {
    const h = harness();
    const opening = h.scene.openFromData({ courseId: 'first-open', selectedCoordinates: { x: 10, y: 10 } });
    // Phaser marks the scene running once create() returns, before its first await resumes.
    h.state.running = true;
    await opening;
    expect(h.state.sheetShown).toBe(true);
    // The map left visible runs from the account controls (y 56) to the sheet (y 456).
    const middle = h.cam.worldAt(195, 256);
    expect(middle.x).toBeCloseTo(10.5 * ROOM_PX_WIDTH, 3);
    expect(middle.y).toBeCloseTo(10.5 * ROOM_PX_HEIGHT, 3);
  });
});
