import { afterEach, describe, expect, it, vi } from 'vitest';
import { TILE_SIZE, TRIANGLE_PIECE_OBJECT_ID, editorState, updateEditorState } from '../../config';
import { EditorInteractionController } from './interaction';

vi.mock('phaser', () => ({ default: { Geom: { Rectangle: class Rectangle {} } } }));

type Handler = (...args: unknown[]) => void;
const saved = {
  paletteMode: editorState.paletteMode,
  activeTool: editorState.activeTool,
  isPlaying: editorState.isPlaying,
};

afterEach(() => { updateEditorState(saved); });

function harness() {
  const handlers = new Map<string, Handler>();
  const register = (prefix: string) => ({
    on: vi.fn((event: string, fn: Handler) => handlers.set(prefix + event, fn)),
    off: vi.fn(),
  });
  const scene = {
    input: { ...register('input:'), activePointer: rightClick() },
    game: { events: register('game:'), canvas: { addEventListener: vi.fn() } },
    events: register('scene:'),
    cameras: { main: { zoom: 1, scrollX: 0, scrollY: 0, getWorldPoint: (x: number, y: number) => ({ x, y }) } },
  };
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const host = new Proxy({ objectMove: undefined } as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : (calls[key] ??= vi.fn())),
  });
  new EditorInteractionController(scene as never, host as never, { getElementById: () => null } as never).setupInput(() => {});
  return {
    fire: (name: string, ...args: unknown[]) => handlers.get(name)!(...args),
    calls,
  };
}

function rightClick() {
  return {
    id: 1,
    x: 4 * TILE_SIZE,
    y: 6 * TILE_SIZE,
    wasTouch: false,
    isDown: true,
    event: { buttons: 2 },
    leftButtonDown: () => false,
    rightButtonDown: () => true,
    middleButtonDown: () => false,
    leftButtonReleased: () => false,
    rightButtonReleased: () => false,
  };
}

describe('triangle tool right click', () => {
  it('deletes the triangle under the cursor and does not erase tiles', () => {
    updateEditorState({ paletteMode: 'tiles', activeTool: 'triangle', isPlaying: false });
    const h = harness();
    h.fire('input:pointerdown', rightClick());
    expect(h.calls.removeObjectAt).toHaveBeenCalledTimes(1);
    const [x, y, filter] = h.calls.removeObjectAt.mock.calls[0];
    expect(x).toBe(4 * TILE_SIZE);
    expect(y).toBe(6 * TILE_SIZE);
    expect(filter({ id: TRIANGLE_PIECE_OBJECT_ID })).toBe(true);
    expect(filter({ id: 'coin_gold' })).toBe(false);
    expect(h.calls.beginTileBatch).toBeUndefined();
    expect(h.calls.eraseTileAt).toBeUndefined();
  });
});
