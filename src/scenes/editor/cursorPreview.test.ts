import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Geom: { Rectangle: class Rectangle {} } } }));

import { editorState, TILE_SIZE, updateEditorState } from '../../config';
import { drawEditorCursor } from './cursorPreview';
import { listCircleBrushOffsets } from './sprayTiles';

const saved = { paletteMode: editorState.paletteMode, activeTool: editorState.activeTool,
  pencilSprayMode: editorState.pencilSprayMode, pencilSprayBrushSize: editorState.pencilSprayBrushSize };
afterEach(() => updateEditorState(saved));

describe('shared editor cursor in a workspace slice', () => {
  it('shows only circular Spray cells, translated from the slice origin', () => {
    updateEditorState({ paletteMode: 'tiles', activeTool: 'pencil', pencilSprayMode: true, pencilSprayBrushSize: 5 });
    const g = { fillStyle: vi.fn(), lineStyle: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn() };
    drawEditorCursor(g as never, { tile: { x: 4, y: 6 }, origin: { x: 640, y: 400 } });
    const cells = listCircleBrushOffsets(5).map(({ dx, dy }) => [
      640 + (4 - 2 + dx) * TILE_SIZE, 400 + (6 - 2 + dy) * TILE_SIZE, TILE_SIZE, TILE_SIZE,
    ]);
    expect(g.fillRect.mock.calls).toEqual(cells);
    expect(g.strokeRect.mock.calls).toEqual(cells);
  });

  it('places a goal cursor at the hovered local cell in either workspace', () => {
    const g = { fillStyle: vi.fn(), lineStyle: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn() };
    drawEditorCursor(g as never, { tile: { x: 3, y: 2 }, origin: { x: 640, y: 400 }, goalPlacement: true });
    expect(g.strokeRect).toHaveBeenCalledWith(640 + 3 * TILE_SIZE, 400 + 2 * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  });
});
