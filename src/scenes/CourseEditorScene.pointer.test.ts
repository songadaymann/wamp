import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Scene: class {},
  Math: {
    Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
    Vector2: class Vector2 { constructor(public x: number, public y: number) {} },
    Distance: { Between: (x: number, y: number, xx: number, yy: number) => Math.hypot(xx - x, yy - y) },
  },
} }));
vi.mock('../ui/appMode', () => ({ setAppMode: vi.fn() }));

import { TILE_SIZE, editorState, updateEditorState } from '../config';
import { CourseEditorScene } from './CourseEditorScene';

const saved = { paletteMode: editorState.paletteMode, activeTool: editorState.activeTool };
beforeEach(() => updateEditorState({ paletteMode: 'tiles', activeTool: 'pencil' }));
afterEach(() => updateEditorState(saved));

function pointer(x = 10, buttons = 2, wasTouch = false) {
  return { id: 1, x, y: 10, wasTouch, isDown: buttons !== 0, event: { buttons },
    rightButtonDown: () => buttons === 2, leftButtonDown: () => buttons === 1,
    middleButtonDown: () => buttons === 4 };
}

function harness() {
  const handlers = new Map<string, (p: ReturnType<typeof pointer>) => void>();
  const register = () => ({ on: vi.fn() });
  const objectMoveController = { down: vi.fn(() => false), move: vi.fn(() => false), up: vi.fn(() => false), stopGesture: vi.fn(), cancel: vi.fn() };
  const touchControls = { down: vi.fn(), move: vi.fn(), up: vi.fn() };
  const scene = Object.assign(Object.create(CourseEditorScene.prototype), {
    input: { on: (name: string, fn: (p: ReturnType<typeof pointer>) => void) => handlers.set(name, fn) },
    game: { events: register() }, events: register(),
    cameras: { main: { zoom: 2, scrollX: 20, scrollY: 30, setScroll: vi.fn() } },
    modifierKeys: {}, musicWorkflow: { isActive: () => false },
    pendingRightClickPanPointerId: null, isPanning: false, activeObjectDragRoomId: null,
    tileDragMode: null, rectStart: null, pathBend: null,
    objectMoveController, touchControls, constrainCamera: vi.fn(),
    handlePrimaryPointerDown: vi.fn(), handleSecondaryPointerClick: vi.fn(),
    handlePointerDrag: vi.fn(), finishPointerAction: vi.fn(), updateCursorHighlight: vi.fn(),
  });
  scene.setupPointerControls();
  return { scene, objectMoveController, touchControls,
    fire: (name: string, p = pointer()) => handlers.get(name)!(p) };
}

describe('Expanded Room pointer compatibility before shared input (F274)', () => {
  it('keeps a short right click as erase without panning or drawing', () => {
    const h = harness();
    h.fire('pointerdown'); h.fire('pointermove', pointer(14)); h.fire('pointerup', pointer(14, 0));
    expect(h.scene.handleSecondaryPointerClick).toHaveBeenCalledTimes(1);
    expect(h.scene.handlePrimaryPointerDown).not.toHaveBeenCalled();
    expect(h.scene.cameras.main.setScroll).not.toHaveBeenCalled();
  });

  it('pans past the threshold using camera zoom, then never erases on release', () => {
    const h = harness();
    h.fire('pointerdown'); h.fire('pointermove', pointer(16)); h.fire('pointerup', pointer(16, 0));
    expect(h.scene.cameras.main.setScroll).toHaveBeenCalledWith(17, 30);
    expect(h.scene.handleSecondaryPointerClick).not.toHaveBeenCalled();
    expect(h.scene.finishPointerAction).not.toHaveBeenCalled();
    expect(h.scene.isPanning).toBe(false);
  });

  it('does not erase when a pending right click releases outside', () => {
    const h = harness(); h.fire('pointerdown'); h.fire('pointerupoutside', pointer(10, 0));
    expect(h.scene.handleSecondaryPointerClick).not.toHaveBeenCalled();
    expect(h.scene.pendingRightClickPanPointerId).toBeNull();
  });

  it('routes touch to its gesture controller before object moves', () => {
    const h = harness(); const p = pointer(10, 1, true);
    h.fire('pointerdown', p); h.fire('pointermove', p); h.fire('pointerup', p);
    expect(h.touchControls.down).toHaveBeenCalledWith(p);
    expect(h.touchControls.move).toHaveBeenCalledWith(p);
    expect(h.touchControls.up).toHaveBeenCalledWith(p, false);
    expect(h.objectMoveController.down).not.toHaveBeenCalled();
    expect(h.scene.handlePrimaryPointerDown).not.toHaveBeenCalled();
  });

  it('lets an object move consume left input before drawing', () => {
    const h = harness(); h.objectMoveController.down.mockReturnValue(true);
    h.fire('pointerdown', pointer(10, 1));
    expect(h.scene.handlePrimaryPointerDown).not.toHaveBeenCalled();
  });

  it('pans with the middle button without painting or starting an object move', () => {
    const h = harness();
    h.fire('pointerdown', pointer(10, 4)); h.fire('pointermove', pointer(16, 4));
    h.fire('pointerup', pointer(16, 0));
    expect(h.scene.cameras.main.setScroll).toHaveBeenCalledWith(17, 30);
    expect(h.scene.handlePrimaryPointerDown).not.toHaveBeenCalled();
    expect(h.objectMoveController.down).not.toHaveBeenCalled();
    expect(h.scene.handleSecondaryPointerClick).not.toHaveBeenCalled();
  });

  it('fills skipped smart-terrain cells in the selected slice at its world origin', () => {
    updateEditorState({ paletteMode: 'smart' });
    const scene = Object.assign(Object.create(CourseEditorScene.prototype), {
      pencilDragStart: { x: 2, y: 3 }, lastPencilStampOrigin: null,
    });
    const slice = { origin: { x: 640, y: 400 }, runtime: { placeTileAt: vi.fn(), placeTileStroke: vi.fn() } };
    scene.placeCoursePencilStamp(slice, 2, 3);
    scene.placeCoursePencilStamp(slice, 5, 3);
    scene.placeCoursePencilStamp(slice, 5, 3);
    expect(slice.runtime.placeTileAt).toHaveBeenCalledExactlyOnceWith(640 + 2 * TILE_SIZE, 400 + 3 * TILE_SIZE);
    expect(slice.runtime.placeTileStroke).toHaveBeenCalledExactlyOnceWith([3, 4, 5].map(x => ({
      x: 640 + x * TILE_SIZE, y: 400 + 3 * TILE_SIZE,
    })));
  });
});
