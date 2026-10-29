import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH, editorState, updateEditorState } from '../../config';
import { EditorInteractionController } from './interaction';
import { objectMoveFixture } from './objectMoveController.testSupport';
import type { EditorObjectMoveController } from './objectMoveController';

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
const saved = { activeTool: editorState.activeTool, paletteMode: editorState.paletteMode, zoom: editorState.zoom, isPlaying: editorState.isPlaying, pencilSprayMode: editorState.pencilSprayMode, pencilSprayBrushSize: editorState.pencilSprayBrushSize, pencilSprayRate: editorState.pencilSprayRate };
beforeEach(() => { updateEditorState({ activeTool: 'move' }); updateEditorState({ paletteMode: 'tiles', zoom: 1, isPlaying: false }); });
afterEach(() => {
  updateEditorState(saved);
  Object.assign(layout, { deviceClass: 'desktop', orientationState: 'landscape', coarsePointer: false });
  vi.useRealTimers();
});

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

/** The room editor's pointer handlers on a fake scene, with the Move tool recorded (or a real one). */
function harness(width = 400, height = 300, realMove = false) {
  const handlers = new Map<string, Handler>();
  const register = (prefix: string) => ({ on: vi.fn((event: string, fn: Handler) => handlers.set(prefix + event, fn)), off: vi.fn() });
  const cam = camera(width, height);
  const scene = {
    input: { ...register('input:'), activePointer: { isDown: false } },
    game: { events: register('game:'), canvas: { addEventListener: vi.fn(), ownerDocument: { body: { dataset: {} } } } },
    events: register('scene:'),
    scale: { width, height },
    cameras: { main: cam },
    time: { delayedCall: (delay: number, callback: () => void) => { const timer = setTimeout(callback, delay); return { remove: () => clearTimeout(timer) }; } },
  };
  const real = realMove ? objectMoveFixture(cam) : null;
  const objectMove = real?.controller ?? {
    claims: () => editorState.activeTool === 'move',
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
  return { fire, cam, scene, calls, objectMove: objectMove as Exclude<typeof objectMove, EditorObjectMoveController>, controller, real };
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
    expect(h.objectMove.down).not.toHaveBeenCalled();
    h.fire('input:pointermove', touch(1, 120, 150));
    // Move starts at the original press once the finger has dragged past 6px.
    expect(h.objectMove.down).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 1 }), { x: 100, y: 150 });
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

describe('Move selection through a pinch (F371)', () => {
  it('keeps an area selection when the first pinch finger lands outside it', () => {
    vi.useFakeTimers();
    const h = harness(400, 300, true);
    const move = h.real!;
    h.fire('input:pointerdown', touch(1, 40, 40, 'touchstart'));
    h.fire('input:pointermove', touch(1, 100, 90));
    h.fire('input:pointerup', touch(1, 100, 90, 'touchend'));
    expect(move.controller.selectedArea).toEqual({ minX: 2, minY: 2, maxX: 6, maxY: 5 });
    move.host.prepare.mockClear();
    move.host.showStatus.mockClear();
    // Phaser delivers the two fingers one after another; the first lands outside the selection.
    h.fire('input:pointerdown', touch(2, 300, 200, 'touchstart'));
    h.fire('input:pointerdown', touch(3, 360, 200, 'touchstart'));
    h.fire('input:pointermove', touch(3, 390, 200));
    h.fire('input:pointerup', touch(3, 390, 200, 'touchend'));
    h.fire('input:pointerup', touch(2, 300, 200, 'touchend'));
    vi.advanceTimersByTime(200);
    expect(editorState.zoom).toBeCloseTo(1.5, 2);
    expect(move.controller.selectedArea).toEqual({ minX: 2, minY: 2, maxX: 6, maxY: 5 });
    expect(move.host.prepare).not.toHaveBeenCalled();
    expect(move.host.showStatus).not.toHaveBeenCalled();
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

describe('room editor through the shared touch controller (F274)', () => {
  it('does not paint when a second finger arrives before a brush starts', () => {
    vi.useFakeTimers(); updateEditorState({ activeTool: 'pencil' });
    const h = harness();
    h.fire('input:pointerdown', touch(1, 100, 150, 'touchstart'));
    h.fire('input:pointerdown', touch(2, 300, 150, 'touchstart'));
    vi.advanceTimersByTime(300);
    h.fire('input:pointerup', touch(2, 300, 150, 'touchend'));
    h.fire('input:pointerup', touch(1, 100, 150, 'touchend'));
    expect(h.calls.placeTileAt).toBeUndefined();
    expect(h.calls.commitTileBatch).toBeUndefined();
    expect(h.controller.hasPendingTouchEdit).toBe(false);
  });

  it('sprays while a touch holds still, then stops immediately on cancellation', () => {
    vi.useFakeTimers(); updateEditorState({ activeTool: 'pencil', pencilSprayMode: true,
      pencilSprayBrushSize: 5, pencilSprayRate: 1 });
    const h = harness(); const p = { ...touch(1, 100, 150, 'touchstart'), isDown: true };
    h.scene.input.activePointer = p;
    h.fire('input:pointerdown', p); vi.advanceTimersByTime(300);
    h.controller.tickSpray(500);
    expect(h.calls.placeTileAt).toHaveBeenCalledTimes(22);
    h.fire('input:pointerup', touch(1, 100, 150, 'touchcancel'));
    h.controller.tickSpray(500);
    expect(h.calls.placeTileAt).toHaveBeenCalledTimes(22);
    expect(h.calls.cancelTileBatch).toHaveBeenCalledTimes(1);
    expect(h.calls.commitTileBatch).toBeUndefined();
  });

  it('cancels a deferred brush when editor input becomes locked', () => {
    vi.useFakeTimers(); updateEditorState({ activeTool: 'pencil' });
    const h = harness();
    h.fire('input:pointerdown', touch(1, 100, 150, 'touchstart'));
    Object.assign(h.scene.game.canvas.ownerDocument.body.dataset, { editorSpriteUiLocked: 'true' });
    vi.advanceTimersByTime(300);
    expect(h.calls.placeTileAt).toBeUndefined();
    expect(h.controller.hasPendingTouchEdit).toBe(false);
  });
});

describe('touch start outside the editable room (F274)', () => {
  it('does not turn a tiny drag into a Fill tap inside the room', () => {
    updateEditorState({ activeTool: 'fill' });
    const h = harness();
    h.fire('input:pointerdown', touch(1, -1, 150, 'touchstart'));
    h.fire('input:pointerup', touch(1, 1, 150, 'touchend'));
    expect(h.calls.handleToolDown).toBeUndefined();
  });
});
