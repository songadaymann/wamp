import { describe, expect, it, vi } from 'vitest';
import { OverworldInspectInputController } from './inspectInput';

vi.mock('phaser', () => ({ default: { Math: { Distance: { Between: vi.fn(() => 100) } } } }));
vi.mock('../../ui/deviceLayout', () => ({ getDeviceLayoutState: () => ({ coarsePointer: false }) }));
vi.mock('../../settings/userSettings', () => ({ getGameSettings: () => ({ panningStyle: 'option-drag' }) }));

describe('overworld fit shortcut', () => {
  it('uses 0 instead of F and removes the listener on destroy', () => {
    const keyboard = { on: vi.fn(), off: vi.fn() };
    const input = { keyboard, on: vi.fn(), off: vi.fn() };
    const scene = { input, game: { events: { on: vi.fn(), off: vi.fn() } }, cameras: { main: { scrollX: 0, scrollY: 0 } } };
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

type Handler = (...args: unknown[]) => void;
function harness() {
  const handlers = new Map<string, Handler>();
  const register = (prefix: string) => ({ on: vi.fn((event: string, fn: Handler) => handlers.set(prefix + event, fn)), off: vi.fn() });
  const camera = { scrollX: 0, scrollY: 0, zoom: 1, setScroll: vi.fn(), getWorldPoint: (x: number, y: number) => ({ x, y }) };
  const activePointer = mouse({ isDown: false });
  const scene = { input: { ...register('input:'), keyboard: register('key:'), activePointer }, game: { events: register('game:') }, cameras: { main: camera } };
  const host = {
    getMode: () => 'browse' as const, getCameraMode: () => 'inspect' as const, setCameraMode: vi.fn(), applyCameraMode: vi.fn(),
    fitLoadedWorld: vi.fn(), returnToWorld: vi.fn(), adjustZoomByFactor: vi.fn(), constrainInspectCamera: vi.fn(),
    getRoomCoordinatesForPoint: () => ({ x: 3, y: 4 }), isWithinLoadedRoomBounds: () => true,
    onSelectCoordinates: vi.fn(), syncBrowseWindowToCamera: vi.fn(),
  };
  new OverworldInspectInputController(scene as never, host).initialize();
  const fire = (name: string, ...args: unknown[]) => handlers.get(name)!(...args);
  return { fire, camera, host, scene, handlers };
}
function mouse(overrides: { isDown?: boolean; buttons?: number; altKey?: boolean; middle?: boolean; x?: number } = {}) {
  return { id: 1, x: overrides.x ?? 100, y: 100, wasTouch: false, isDown: overrides.isDown ?? true,
    event: { buttons: overrides.buttons ?? 4, altKey: overrides.altKey ?? false }, middleButtonDown: () => overrides.middle ?? false };
}

describe('map panning after a release the canvas never saw (F054)', () => {
  it('stops panning when the button is released over a panel', () => {
    const h = harness();
    h.fire('input:pointerdown', mouse({ middle: true }));
    h.fire('input:pointermove', mouse({ middle: true, x: 200 }));
    expect(h.camera.setScroll).toHaveBeenCalledTimes(1);
    h.fire('input:pointerupoutside', mouse({ isDown: false, buttons: 0 }));
    expect(h.host.syncBrowseWindowToCamera).toHaveBeenCalledOnce();
    h.fire('input:pointermove', mouse({ isDown: false, buttons: 0, x: 300 }));
    expect(h.camera.setScroll).toHaveBeenCalledTimes(1);
  });

  it('treats a move with no buttons held as the release when none arrived', () => {
    const h = harness();
    h.fire('input:pointerdown', mouse({ middle: true }));
    h.fire('input:pointermove', mouse({ buttons: 0, x: 200 }));
    h.fire('input:pointermove', mouse({ buttons: 0, x: 300 }));
    expect(h.camera.setScroll).not.toHaveBeenCalled();
    expect(h.host.syncBrowseWindowToCamera).toHaveBeenCalledOnce();
  });
});

describe('pan keys after focus leaves the game (F059)', () => {
  it('reads Alt from the click, so an Alt-Tab cannot leave it held', () => {
    const h = harness();
    expect(h.handlers.has('key:keydown-ALT')).toBe(false);
    h.fire('input:pointerdown', mouse({ buttons: 1 }));
    expect(h.host.onSelectCoordinates).toHaveBeenCalled();
    h.fire('input:pointerup', mouse({ isDown: false, buttons: 0 }));
    h.fire('input:pointerdown', mouse({ buttons: 1, altKey: true }));
    h.fire('input:pointermove', mouse({ buttons: 1, altKey: true, x: 200 }));
    expect(h.camera.setScroll).toHaveBeenCalledTimes(1);
  });

  it('forgets a held Space and ends a pan when the window loses focus', () => {
    const h = harness();
    h.fire('key:keydown-SPACE');
    h.scene.input.activePointer.isDown = true;
    h.fire('input:pointerdown', mouse({ buttons: 1 }));
    expect(h.host.onSelectCoordinates).not.toHaveBeenCalled();
    h.fire('game:blur');
    expect(h.host.syncBrowseWindowToCamera).toHaveBeenCalledOnce();
    h.fire('input:pointerdown', mouse({ buttons: 1 }));
    expect(h.host.onSelectCoordinates).toHaveBeenCalled();
  });
});
