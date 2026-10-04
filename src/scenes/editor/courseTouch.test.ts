import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { CourseTouchController } from './courseTouch';

function pointer(id: number, x = 40, y = 40, type = 'touchstart'): Phaser.Input.Pointer {
  return { id, x, y, event: { type } } as Phaser.Input.Pointer;
}

function harness(action: 'brush' | 'draw' | 'objects' | 'tap' | 'bend') {
  let signature = 'initial';
  const host = {
    signature: () => signature, classify: () => action,
    schedule: (delay: number, callback: () => void) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
    begin: vi.fn(), beginBrush: vi.fn(), beginObjects: vi.fn(), move: vi.fn(), tap: vi.fn(),
    finish: vi.fn(), cancel: vi.fn(), worldPoint: (x: number, y: number) => ({ x: x * 2, y: y * 2 }),
    pinch: vi.fn(),
  };
  return { controller: new CourseTouchController(host), host, changeTool: () => { signature = 'new'; } };
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
    expect(host.finish).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), true);
  });
});
