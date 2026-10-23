import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH, editorState, updateEditorState } from '../../config';
import { EditorInteractionController } from './interaction';

vi.mock('phaser', () => ({ default: {
  Geom: { Rectangle: class Rectangle {} },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
    Vector2: class Vector2 { constructor(public x: number, public y: number) {} },
  },
} }));
const { layout } = vi.hoisted(() => ({ layout: { deviceClass: 'desktop', orientationState: 'landscape', coarsePointer: false } }));
vi.mock('../../ui/deviceLayout', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../ui/deviceLayout')>(),
  getDeviceLayoutState: () => layout,
}));

type Handler = (...args: unknown[]) => void;
const saved = { activeTool: editorState.activeTool, paletteMode: editorState.paletteMode, zoom: editorState.zoom, isPlaying: editorState.isPlaying };
beforeEach(() => { updateEditorState({ activeTool: 'move' }); updateEditorState({ paletteMode: 'tiles', zoom: 1, isPlaying: false }); });
afterEach(() => { updateEditorState(saved); Object.assign(layout, { deviceClass: 'desktop', orientationState: 'landscape', coarsePointer: false }); });

/** A camera with Phaser's scroll, zoom and origin arithmetic. */
function camera(width: number, height: number) {
  const cam = {
    x: 0, y: 0, width, height, originX: 0.5, originY: 0.5, zoom: 1, scrollX: 0, scrollY: 0,
    get displayWidth() { return cam.width / cam.zoom; },
    get displayHeight() { return cam.height / cam.zoom; },
    setZoom: (zoom: number) => { cam.zoom = zoom; return cam; },
    setScroll: (x: number, y: number) => { cam.scrollX = x; cam.scrollY = y; return cam; },
    centerOn: (x: number, y: number) => { cam.scrollX = x - cam.width / 2; cam.scrollY = y - cam.height / 2; return cam; },
    getBounds: () => ({ x: -4000, y: -4000, width: 8000, height: 8000, centerX: 0, centerY: 0 }),
    getWorldPoint: (x: number, y: number) => ({
      x: cam.scrollX + cam.width / 2 - cam.displayWidth / 2 + x / cam.zoom,
      y: cam.scrollY + cam.height / 2 - cam.displayHeight / 2 + y / cam.zoom,
    }),
  };
  return cam;
}

/** The room editor's pointer handlers on a fake scene, with the Move tool recorded. */
function harness(width = 400, height = 300) {
  const handlers = new Map<string, Handler>();
  const register = (prefix: string) => ({ on: vi.fn((event: string, fn: Handler) => handlers.set(prefix + event, fn)), off: vi.fn() });
  const cam = camera(width, height);
  const scene = {
    input: { ...register('input:'), activePointer: { isDown: false } },
    game: { events: register('game:'), canvas: { addEventListener: vi.fn(), ownerDocument: { body: { dataset: {} } } } },
    events: register('scene:'),
    scale: { width, height },
    cameras: { main: cam },
  };
  const objectMove = {
    down: vi.fn(() => editorState.activeTool === 'move'), move: vi.fn(() => true), up: vi.fn(() => true),
    stopGesture: vi.fn(() => true), validate: vi.fn(), hover: vi.fn(),
  };
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const host = new Proxy({ objectMove } as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : (calls[key] ??= vi.fn())),
  });
  const controller = new EditorInteractionController(scene as never, host as never, { getElementById: () => null } as never);
  controller.setupInput(() => {});
  const fire = (name: string, ...args: unknown[]) => handlers.get(name)!(...args);
  return { fire, cam, objectMove, controller };
}

function touch(id: number, x: number, y: number, type = 'touchmove') {
  return { id, x, y, wasTouch: true, downTime: id, event: { type },
    leftButtonDown: () => true, rightButtonDown: () => false, middleButtonDown: () => false,
    leftButtonReleased: () => false, rightButtonReleased: () => false };
}

describe('Move tool on a touch screen (F371)', () => {
  it('drags with one finger, then lets two fingers zoom and pan the room', () => {
    const h = harness();
    h.fire('input:pointerdown', touch(1, 100, 150, 'touchstart'));
    h.fire('input:pointermove', touch(1, 120, 150));
    expect(h.objectMove.down).toHaveBeenCalledOnce();
    expect(h.objectMove.move).toHaveBeenCalledOnce();

    h.fire('input:pointerdown', touch(2, 300, 150, 'touchstart'));
    // The second finger stops the drag (keeping the selection) instead of reaching Move.
    expect(h.objectMove.stopGesture).toHaveBeenCalledOnce();
    expect(h.objectMove.down).toHaveBeenCalledOnce();
    const anchor = h.cam.getWorldPoint(210, 150);
    h.fire('input:pointermove', touch(2, 340, 150));
    h.fire('input:pointermove', touch(1, 100, 200));
    h.fire('input:pointermove', touch(2, 340, 200));
    expect(editorState.zoom).toBeCloseTo(240 / 180, 2);
    // Both fingers moved down 50px: the room point between them followed them.
    const followed = h.cam.getWorldPoint(220, 200);
    expect(followed.x).toBeCloseTo(anchor.x, 4);
    expect(followed.y).toBeCloseTo(anchor.y, 4);
    expect(h.objectMove.move).toHaveBeenCalledOnce();

    h.fire('input:pointerup', touch(2, 340, 200, 'touchend'));
    h.fire('input:pointermove', touch(1, 60, 60));
    h.fire('input:pointerup', touch(1, 60, 60, 'touchend'));
    expect(h.objectMove.move).toHaveBeenCalledOnce();
    expect(h.objectMove.up).not.toHaveBeenCalled();

    // Once both lift, one finger drags objects again and releases through Move.
    h.fire('input:pointerdown', touch(3, 100, 150, 'touchstart'));
    h.fire('input:pointermove', touch(3, 140, 150));
    h.fire('input:pointerup', touch(3, 140, 150, 'touchend'));
    expect(h.objectMove.down).toHaveBeenCalledTimes(2);
    expect(h.objectMove.up).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 3 }), false);
  });

  it('stops a Move drag on a cancelled touch and leaves the mouse path unchanged', () => {
    const h = harness();
    h.fire('input:pointerdown', touch(1, 100, 150, 'touchstart'));
    h.fire('input:pointerup', touch(1, 100, 150, 'touchcancel'));
    expect(h.objectMove.stopGesture).toHaveBeenCalledOnce();
    expect(h.objectMove.up).not.toHaveBeenCalled();
    const mouse = { ...touch(9, 100, 150, 'mousedown'), wasTouch: false };
    h.fire('input:pointerdown', mouse);
    h.fire('input:pointerupoutside', { ...mouse, event: { type: 'mouseup' } });
    expect(h.objectMove.up).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 9 }), true);
  });
});

describe('Fit room on a phone (F371)', () => {
  it('frames the whole room in the middle of a portrait phone stage', () => {
    Object.assign(layout, { deviceClass: 'phone', orientationState: 'portrait', coarsePointer: true });
    const h = harness(390, 562);
    h.cam.setZoom(4).setScroll(900, 700);
    h.controller.fitToScreen();
    const topLeft = h.cam.getWorldPoint(0, 0);
    const bottomRight = h.cam.getWorldPoint(390, 562);
    expect(topLeft.x).toBeLessThanOrEqual(0);
    expect(topLeft.y).toBeLessThanOrEqual(0);
    expect(bottomRight.x).toBeGreaterThanOrEqual(ROOM_PX_WIDTH);
    expect(bottomRight.y).toBeGreaterThanOrEqual(ROOM_PX_HEIGHT);
    // Width-bound on a phone: the room fills the stage width less the 12px padding.
    expect(h.cam.zoom).toBeCloseTo((390 - 12) / ROOM_PX_WIDTH, 2);
    const middle = h.cam.getWorldPoint(195, 281);
    expect(middle.x).toBeCloseTo(ROOM_PX_WIDTH / 2, 4);
    expect(middle.y).toBeCloseTo(ROOM_PX_HEIGHT / 2, 4);
  });
});
