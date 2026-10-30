import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorState, updateEditorState } from '../../config';
import { EditorTouchController } from './editorTouch';
import { objectMoveFixture } from './objectMoveController.testSupport';

const savedTool = editorState.activeTool;
afterEach(() => { updateEditorState({ activeTool: savedTool }); vi.useRealTimers(); });

function pointer(id: number, x = 40, y = 40, type = 'touchstart'): Phaser.Input.Pointer {
  return { id, x, y, event: { type } } as Phaser.Input.Pointer;
}

function harness(action: 'brush' | 'draw' | 'objects' | 'tap' | 'bend', moveSelected = false,
  moveTool: ConstructorParameters<typeof EditorTouchController>[0]['moveTool'] = {
    claims: () => moveSelected, down: vi.fn(() => moveSelected), move: vi.fn(() => true), up: vi.fn(() => true), stopGesture: vi.fn(() => true),
  }) {
  let signature = 'initial';
  const host = {
    moveTool,
    signature: () => signature, classify: () => action,
    schedule: (delay: number, callback: () => void) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
    begin: vi.fn(), beginBrush: vi.fn(), beginObjects: vi.fn(), move: vi.fn(), tap: vi.fn(),
    finish: vi.fn(), cancel: vi.fn(), worldPoint: (x: number, y: number) => ({ x: x * 2, y: y * 2 }),
    pinch: vi.fn(),
  };
  return { controller: new EditorTouchController(host), host, changeTool: () => { signature = 'new'; } };
}

describe('expanded editor touch ownership', () => {
  it('defers destructive tap actions and rejects a drag or a pinch', () => {
    const { controller, host } = harness('tap');
    controller.down(pointer(1));
    expect(host.tap).not.toHaveBeenCalled();
    controller.up(pointer(1));
    expect(host.tap).toHaveBeenCalledTimes(1);
    controller.down(pointer(1));
    controller.move(pointer(1, 70));
    controller.up(pointer(1, 70));
    controller.down(pointer(1));
    controller.down(pointer(2));
    controller.up(pointer(2));
    controller.up(pointer(1));
    expect(host.tap).toHaveBeenCalledTimes(1);
  });

  it('starts a repeated object brush at the original point and finishes only on release', () => {
    const { controller, host } = harness('objects');
    controller.down(pointer(1));
    controller.move(pointer(1, 45));
    expect(host.beginObjects).not.toHaveBeenCalled();
    controller.move(pointer(1, 70));
    controller.move(pointer(1, 80));
    expect(host.beginObjects).toHaveBeenCalledExactlyOnceWith({ id: 1, x: 40, y: 40 });
    expect(host.finish).not.toHaveBeenCalled();
    controller.up(pointer(1, 80));
    expect(host.finish).toHaveBeenCalledOnce();
    expect(host.tap).not.toHaveBeenCalled();
  });

  it('cancels a late brush preview and suppresses the surviving finger', () => {
    const { controller, host } = harness('draw');
    controller.down(pointer(1));
    controller.move(pointer(1, 70));
    controller.down(pointer(2, 100));
    expect(host.cancel).toHaveBeenCalledOnce();
    controller.up(pointer(2, 100));
    const moves = host.move.mock.calls.length;
    controller.move(pointer(1, 80));
    controller.up(pointer(1, 80));
    expect(host.move).toHaveBeenCalledTimes(moves);
    expect(host.finish).not.toHaveBeenCalled();
    controller.down(pointer(3));
    controller.up(pointer(3));
    expect(host.finish).toHaveBeenCalledOnce();
  });

  it('cancels native interruption and a changed tool without committing', () => {
    const { controller, host, changeTool } = harness('draw');
    controller.down(pointer(1));
    controller.up(pointer(1, 40, 40, 'touchcancel'));
    controller.down(pointer(1));
    changeTool();
    controller.validate();
    controller.up(pointer(1));
    expect(host.cancel).toHaveBeenCalledTimes(2);
    expect(host.finish).not.toHaveBeenCalled();
  });

  it('keeps the original world anchor while two fingers move', () => {
    const { controller, host } = harness('draw');
    controller.down(pointer(1, 20));
    controller.down(pointer(2, 60));
    controller.move(pointer(2, 100));
    expect(host.pinch).toHaveBeenCalledWith(2, { x: 80, y: 80 }, 60, 40);
    controller.move(pointer(1, 40));
    expect(host.pinch).toHaveBeenLastCalledWith(0.75, { x: 80, y: 80 }, 70, 40);
  });

  it('lets a curve bend preview move and accepts it on release', () => {
    const { controller, host } = harness('bend');
    controller.down(pointer(1));
    expect(host.begin).not.toHaveBeenCalled();
    controller.move(pointer(1, 80));
    controller.up(pointer(1, 80));
    expect(host.finish).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), true, false);
  });

  it('lets Move drag with one finger and gives a second finger the pinch (F371)', () => {
    const { controller, host } = harness('draw', true);
    controller.down(pointer(1, 20));
    expect(host.moveTool.down).not.toHaveBeenCalled();
    controller.move(pointer(1, 30));
    // Move starts at the original press once the finger has dragged past 6px.
    expect(host.moveTool.down).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 1 }), { x: 20, y: 40 });
    expect(host.moveTool.move).toHaveBeenCalledOnce();
    controller.down(pointer(2, 60));
    // The drag stops (its selection stays) and nothing reaches the edit handlers.
    expect(host.moveTool.stopGesture).toHaveBeenCalledOnce();
    expect(host.moveTool.down).toHaveBeenCalledOnce();
    controller.move(pointer(2, 90));
    expect(host.pinch).toHaveBeenCalledWith(2, { x: 90, y: 80 }, 60, 40);
    controller.up(pointer(2, 90));
    controller.move(pointer(1, 10));
    controller.up(pointer(1, 10));
    expect(host.moveTool.move).toHaveBeenCalledOnce();
    expect(host.moveTool.up).not.toHaveBeenCalled();
    expect(host.begin).not.toHaveBeenCalled();
    expect(host.finish).not.toHaveBeenCalled();
    controller.down(pointer(3, 20));
    controller.move(pointer(3, 50));
    controller.up(pointer(3, 50), true);
    expect(host.moveTool.up).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 3 }), true);
  });

  it('keeps an area selection and the selected cell when a pinch lands outside it (F371)', () => {
    vi.useFakeTimers();
    updateEditorState({ activeTool: 'move' });
    const move = objectMoveFixture({ getWorldPoint: (x, y) => ({ x, y }) });
    const { controller, host } = harness('draw', true, move.controller);
    const touch = (id: number, x: number, y: number) => ({ ...pointer(id, x, y, 'touchmove'), wasTouch: true }) as Phaser.Input.Pointer;
    controller.down(touch(1, 40, 40));
    controller.move(touch(1, 100, 90));
    controller.up(touch(1, 100, 90));
    expect(move.controller.selectedArea).toEqual({ minX: 2, minY: 2, maxX: 6, maxY: 5 });
    move.host.prepare.mockClear();
    move.host.showStatus.mockClear();
    // Phaser delivers the two fingers one after another; the first lands outside the selection.
    controller.down(touch(2, 300, 200));
    controller.down(touch(3, 400, 200));
    controller.move(touch(3, 450, 200));
    controller.up(touch(3, 450, 200));
    controller.up(touch(2, 300, 200));
    vi.advanceTimersByTime(200);
    expect(host.pinch).toHaveBeenCalled();
    expect(move.controller.selectedArea).toEqual({ minX: 2, minY: 2, maxX: 6, maxY: 5 });
    // prepare would switch the selected cell and close the inspector; no status flashes either.
    expect(move.host.prepare).not.toHaveBeenCalled();
    expect(move.host.showStatus).not.toHaveBeenCalled();
  });

  it('starts Move after a 90ms hold even if the finger stays still', () => {
    vi.useFakeTimers();
    const { controller, host } = harness('draw', true);
    controller.down(pointer(1, 20));
    vi.advanceTimersByTime(89);
    expect(host.moveTool.down).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(host.moveTool.down).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 1 }), { x: 20, y: 40 });
    controller.up(pointer(1, 20));
    expect(host.moveTool.up).toHaveBeenCalledOnce();
  });

  it('cancels a Move drag on a native interruption without releasing it', () => {
    const { controller, host } = harness('draw', true);
    controller.down(pointer(1));
    controller.up(pointer(1, 40, 40, 'touchcancel'));
    expect(host.moveTool.stopGesture).toHaveBeenCalledOnce();
    expect(host.moveTool.up).not.toHaveBeenCalled();
  });
});
