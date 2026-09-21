import { describe, expect, it, vi } from 'vitest';
import { OverworldInspectInputController } from './inspectInput';

vi.mock('phaser', () => ({ default: { Math: { Distance: { Between: vi.fn() } } } }));

describe('overworld fit shortcut', () => {
  it('uses 0 instead of F and removes the listener on destroy', () => {
    const keyboard = { on: vi.fn(), off: vi.fn() };
    const input = { keyboard, on: vi.fn(), off: vi.fn() };
    const scene = { input, cameras: { main: { scrollX: 0, scrollY: 0 } } };
    const fitLoadedWorld = vi.fn();
    const controller = new OverworldInspectInputController(scene as never, {
      getMode: () => 'browse',
      getCameraMode: () => 'inspect',
      setCameraMode: vi.fn(),
      applyCameraMode: vi.fn(),
      fitLoadedWorld,
      returnToWorld: vi.fn(),
      adjustZoomByFactor: vi.fn(),
      constrainInspectCamera: vi.fn(),
      getRoomCoordinatesForPoint: () => ({ x: 0, y: 0 }),
      isWithinLoadedRoomBounds: () => true,
      onSelectCoordinates: vi.fn(),
      syncBrowseWindowToCamera: vi.fn(),
    });

    controller.initialize();
    const fitListener = keyboard.on.mock.calls.find(([event]) => event === 'keydown-ZERO')?.[1];
    expect(fitListener).toBeTypeOf('function');
    expect(keyboard.on).not.toHaveBeenCalledWith('keydown-F', expect.any(Function));
    fitListener();
    expect(fitLoadedWorld).toHaveBeenCalledOnce();

    controller.destroy();
    expect(keyboard.off).toHaveBeenCalledWith('keydown-ZERO', fitListener);
  });
});
