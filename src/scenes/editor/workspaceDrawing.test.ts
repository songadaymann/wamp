import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { editorState, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, TILE_SIZE, updateEditorState } from '../../config';
import { EditorWorkspaceDrawingController } from './workspaceDrawing';

const saved = { paletteMode: editorState.paletteMode, activeTool: editorState.activeTool,
  pencilSprayMode: editorState.pencilSprayMode, pencilSprayBrushSize: editorState.pencilSprayBrushSize,
  pencilSprayRate: editorState.pencilSprayRate, lineCurve: editorState.lineCurve };
beforeEach(() => updateEditorState({ paletteMode: 'tiles', activeTool: 'pencil', pencilSprayMode: false, lineCurve: false }));
afterEach(() => updateEditorState(saved));

function runtime() {
  return { beginTileBatch: vi.fn(), commitTileBatch: vi.fn(), cancelTileBatch: vi.fn(),
    beginObjectBatch: vi.fn(), commitObjectBatch: vi.fn(), cancelObjectBatch: vi.fn(),
    placeTileAt: vi.fn(), placeTileStroke: vi.fn(), eraseTileAt: vi.fn(), eraseStampAt: vi.fn(),
    paintRandomizeAt: vi.fn(), floodFill: vi.fn(), floodErase: vi.fn(), stampShape: vi.fn() };
}

function fixture() {
  const a = { origin: { x: 640, y: 400 }, runtime: runtime() };
  const b = { origin: { x: 640 + ROOM_PX_WIDTH, y: 400 }, runtime: runtime() };
  const placeObject = vi.fn(), copy = vi.fn(), preview = vi.fn(), clearPreview = vi.fn();
  const controller = new EditorWorkspaceDrawingController({
    sliceAt: (x, y) => [a, b].find(s => x >= s.origin.x && x < s.origin.x + ROOM_PX_WIDTH
      && y >= s.origin.y && y < s.origin.y + ROOM_PX_HEIGHT) ?? null,
    originOf: s => s.origin, runtimeOf: s => s.runtime,
    clampToSlice: (s, world) => ({
      x: Math.floor(Math.min(ROOM_PX_WIDTH - 1, Math.max(0, world.x - s.origin.x)) / TILE_SIZE),
      y: Math.floor(Math.min(ROOM_PX_HEIGHT - 1, Math.max(0, world.y - s.origin.y)) / TILE_SIZE),
    }), placeObject, copy, preview, clearPreview,
  });
  const point = (s: typeof a, x: number, y = 3) => ({ x: s.origin.x + x * TILE_SIZE, y: s.origin.y + y * TILE_SIZE });
  return { a, b, controller, point, placeObject, copy, preview, clearPreview };
}

describe('shared workspace drawing state', () => {
  it('commits mouse cells on leaving and the last cell exactly once on release', () => {
    const { a, b, controller: c, point } = fixture();
    c.begin(point(a, 2), 'pencil'); c.move(point(b, 4));
    expect(a.runtime.commitTileBatch).toHaveBeenCalledTimes(1);
    expect(b.runtime.commitTileBatch).not.toHaveBeenCalled();
    c.finish(point(b, 4)); c.finish(point(b, 4));
    expect(a.runtime.commitTileBatch).toHaveBeenCalledTimes(1);
    expect(b.runtime.commitTileBatch).toHaveBeenCalledTimes(1);
  });

  it('keeps all visited touch cells uncommitted and rolls each one back on a pinch', () => {
    const { a, b, controller: c, point } = fixture();
    c.begin(point(a, 2), 'pencil', { touch: true }); c.move(point(b, 4)); c.move(point(a, 5));
    expect(a.runtime.beginTileBatch).toHaveBeenCalledTimes(1);
    expect(b.runtime.beginTileBatch).toHaveBeenCalledTimes(1);
    expect(a.runtime.commitTileBatch).not.toHaveBeenCalled();
    expect(b.runtime.commitTileBatch).not.toHaveBeenCalled();
    c.cancel(); c.cancel();
    expect(a.runtime.cancelTileBatch).toHaveBeenCalledTimes(1);
    expect(b.runtime.cancelTileBatch).toHaveBeenCalledTimes(1);
    expect(c.isDrawing).toBe(false);
  });

  it('commits each visited touch object batch once after crossing back', () => {
    const { a, b, controller: c, point, placeObject } = fixture();
    c.beginObjects(point(a, 2), true); c.move(point(b, 4)); c.move(point(a, 5)); c.finish(point(a, 5));
    expect(a.runtime.beginObjectBatch).toHaveBeenCalledTimes(1);
    expect(b.runtime.beginObjectBatch).toHaveBeenCalledTimes(1);
    expect(a.runtime.commitObjectBatch).toHaveBeenCalledTimes(1);
    expect(b.runtime.commitObjectBatch).toHaveBeenCalledTimes(1);
    expect(placeObject.mock.calls.map(([s, t]) => [s === a ? 'a' : 'b', t])).toEqual([
      ['a', { x: 2, y: 3 }], ['b', { x: 4, y: 3 }], ['a', { x: 5, y: 3 }],
    ]);
  });

  it('fills skipped smart cells in world coordinates and resets the stamp grid at a slice boundary', () => {
    updateEditorState({ paletteMode: 'smart' });
    const { a, b, controller: c, point } = fixture();
    c.begin(point(a, 2), 'pencil'); c.move(point(a, 5)); c.move(point(b, 4));
    expect(a.runtime.placeTileStroke).toHaveBeenCalledExactlyOnceWith([3, 4, 5].map(x => point(a, x)));
    expect(b.runtime.placeTileStroke).not.toHaveBeenCalled();
    expect(b.runtime.placeTileAt).toHaveBeenCalledExactlyOnceWith(point(b, 4).x, point(b, 4).y);
  });

  it('keeps shapes in the starting slice and previews without opening history', () => {
    const { a, b, controller: c, point, preview } = fixture();
    c.begin(point(a, 2), 'rect'); c.move(point(b, 4));
    expect(preview).toHaveBeenLastCalledWith(a, 'rect', { x: 2, y: 3 }, { x: 39, y: 3 },
      expect.objectContaining({ copy: false }));
    expect(a.runtime.beginTileBatch).not.toHaveBeenCalled();
    c.finish(point(b, 4));
    expect(a.runtime.stampShape).toHaveBeenCalledWith('rect', 2, 3, 39, 3, expect.anything());
    expect(b.runtime.stampShape).not.toHaveBeenCalled();
  });

  it('copies in local coordinates and lets Escape discard the next preview', () => {
    const { a, b, controller: c, point, copy } = fixture();
    c.begin(point(a, 2), 'copy'); c.finish(point(b, 4));
    expect(copy).toHaveBeenCalledExactlyOnceWith(a, { x: 2, y: 3 }, { x: 39, y: 3 });
    c.begin(point(a, 2), 'rect'); c.clearShapes(); c.finish(point(a, 6));
    expect(a.runtime.stampShape).not.toHaveBeenCalled();
  });

  it('keeps a two-stage curve in its starting slice until the matching button commits', () => {
    updateEditorState({ activeTool: 'line', lineCurve: true });
    const { a, b, controller: c, point } = fixture();
    c.begin(point(a, 2), 'line'); c.finish(point(a, 8, 7)); c.move(point(b, 4, 9));
    expect(c.hasBend).toBe(true); expect(a.runtime.stampShape).not.toHaveBeenCalled();
    c.resolveBend(true, false);
    expect(a.runtime.stampShape).toHaveBeenCalledExactlyOnceWith('curve', 2, 3, 8, 7,
      { erase: false, mid: { x: 39, y: 9 } });
    expect(b.runtime.stampShape).not.toHaveBeenCalled();
    expect(c.hasBend).toBe(false);
  });

  it('forgets state at Phaser shutdown without mutating destroyed presentation layers', () => {
    const { a, controller: c, point } = fixture();
    c.begin(point(a, 2), 'pencil', { touch: true });
    c.reset(); c.cancel();
    expect(c.isDrawing).toBe(false);
    expect(a.runtime.cancelTileBatch).not.toHaveBeenCalled();
    expect(a.runtime.commitTileBatch).not.toHaveBeenCalled();
  });

  it('emits held Spray by time and never adds bursts just because the mouse moves', () => {
    updateEditorState({ pencilSprayMode: true, pencilSprayBrushSize: 5, pencilSprayRate: 1 });
    const { a, controller: c, point } = fixture(); const p = point(a, 2);
    c.begin(p, 'pencil'); c.move(point(a, 3)); c.move(point(a, 4));
    expect(a.runtime.placeTileAt).toHaveBeenCalledTimes(1);
    c.tickSpray(500, p, true);
    expect(a.runtime.placeTileAt).toHaveBeenCalledTimes(22);
    c.cancel(); c.tickSpray(500, p, true);
    expect(a.runtime.placeTileAt).toHaveBeenCalledTimes(22);
  });
});
