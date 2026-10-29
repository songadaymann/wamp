import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { EditorPathBendController } from './shapeInteraction';

describe('shared curve gesture', () => {
  it.each([false, true])('commits the matching button once (erase=%s) in the starting slice', erase => {
    const host = { preview: vi.fn(), stamp: vi.fn(), finish: vi.fn() };
    const controller = new EditorPathBendController<string>(host);
    const start = { x: 2, y: 3 }, end = { x: 8, y: 7 };
    controller.begin('starting-room', start, end, erase);
    start.x = 99; end.y = 99;
    controller.update({ x: 5, y: 9 });
    expect(controller.resolve(!erase, erase)).toBe(true);
    expect(host.stamp).toHaveBeenCalledExactlyOnceWith({ target: 'starting-room',
      start: { x: 2, y: 3 }, end: { x: 8, y: 7 }, mid: { x: 5, y: 9 }, erase });
    expect(controller.resolve(!erase, erase)).toBe(false);
    expect(controller.bend).toBeNull();
    expect(host.finish).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('cancels with the opposite button (erase=%s)', erase => {
    const host = { preview: vi.fn(), stamp: vi.fn(), finish: vi.fn() };
    const controller = new EditorPathBendController<string>(host);
    controller.begin('r', { x: 0, y: 0 }, { x: 6, y: 4 }, erase);
    expect(controller.resolve(false, false)).toBe(false);
    expect(controller.resolve(erase, !erase)).toBe(true);
    expect(host.stamp).not.toHaveBeenCalled();
    expect(controller.bend).toBeNull();
  });

  it('lets touch commit explicitly and cancellation discard a pending bend', () => {
    const host = { preview: vi.fn(), stamp: vi.fn(), finish: vi.fn() };
    const controller = new EditorPathBendController<string>(host);
    controller.begin('r', { x: 0, y: 0 }, { x: 6, y: 4 }, false);
    controller.clear(); controller.commit();
    expect(host.stamp).not.toHaveBeenCalled();
    controller.begin('r', { x: 0, y: 0 }, { x: 6, y: 4 }, false);
    controller.commit(); controller.commit();
    expect(host.stamp).toHaveBeenCalledTimes(1);
  });
});
