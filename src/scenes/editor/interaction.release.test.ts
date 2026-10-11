import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE_SIZE, editorState } from '../../config';
import { EditorInteractionController } from './interaction';

vi.mock('phaser', () => ({ default: { Geom: { Rectangle: class Rectangle {} } } }));

type Handler = (...args: unknown[]) => void;
const saved = { paletteMode: editorState.paletteMode, activeTool: editorState.activeTool, isPlaying: editorState.isPlaying };
beforeEach(() => { editorState.paletteMode = 'tiles'; editorState.activeTool = 'pencil'; editorState.isPlaying = false; });
afterEach(() => { Object.assign(editorState, saved); });

/** The room editor's pointer handlers on a fake scene, with every host call recorded. */
function harness() {
  const handlers = new Map<string, Handler>();
  const register = (prefix: string) => ({ on: vi.fn((event: string, fn: Handler) => handlers.set(prefix + event, fn)), off: vi.fn() });
  const activePointer = mouse({ isDown: false, buttons: 0 });
  const scene = {
    input: { ...register('input:'), activePointer },
    game: { events: register('game:'), canvas: { addEventListener: vi.fn() } },
    events: register('scene:'),
    cameras: { main: { zoom: 1, scrollX: 0, scrollY: 0, getWorldPoint: (x: number, y: number) => ({ x, y }) } },
  };
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const host = new Proxy({ objectMove: undefined } as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : (calls[key] ??= vi.fn())),
  });
  new EditorInteractionController(scene as never, host as never, { getElementById: () => null } as never).setupInput(() => {});
  const fire = (name: string, ...args: unknown[]) => handlers.get(name)!(...args);
  const commits = () => calls.commitTileBatch?.mock.calls.length ?? 0;
  return { fire, scene, commits };
}
function mouse(overrides: { isDown?: boolean; buttons?: number } = {}) {
  const isDown = overrides.isDown ?? true;
  return { id: 1, x: 5 * TILE_SIZE, y: 5 * TILE_SIZE, wasTouch: false, isDown, event: { buttons: overrides.buttons ?? 1 },
    leftButtonDown: () => isDown, rightButtonDown: () => false, middleButtonDown: () => false,
    leftButtonReleased: () => !isDown, rightButtonReleased: () => false };
}

describe('room editor strokes released off the canvas (F054)', () => {
  it('commits a stroke released over a panel, once', () => {
    const h = harness();
    h.fire('input:pointerdown', mouse());
    h.fire('input:pointerupoutside', mouse({ isDown: false, buttons: 0 }));
    expect(h.commits()).toBe(1);
    h.fire('input:pointermove', mouse({ isDown: false, buttons: 0 }));
    expect(h.commits()).toBe(1);
  });

  it('commits when a move shows the button was released outside the window', () => {
    const h = harness();
    h.fire('input:pointerdown', mouse());
    h.fire('input:pointermove', mouse({ buttons: 0 }));
    expect(h.commits()).toBe(1);
  });

  it('commits a stroke in progress when the window loses focus', () => {
    const h = harness();
    h.fire('input:pointerdown', mouse());
    h.scene.input.activePointer.isDown = true;
    h.fire('game:blur');
    expect(h.commits()).toBe(1);
  });

  it('leaves an ordinary release and hover alone', () => {
    const h = harness();
    h.fire('input:pointerdown', mouse());
    h.fire('input:pointerup', mouse({ isDown: false, buttons: 0 }));
    h.fire('input:pointermove', mouse({ isDown: false, buttons: 0 }));
    h.fire('game:blur');
    expect(h.commits()).toBe(1);
  });
});
