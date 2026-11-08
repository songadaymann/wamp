import { afterEach, describe, expect, it } from 'vitest';
import { editorState, updateEditorState } from '../../config/editorState';
import { applyEditorToolSelection } from './editorToolSelection';
import { watchTriangleSelectionRelease } from './triangleSelectionRelease';

const original = {
  activeTool: editorState.activeTool,
  paletteMode: editorState.paletteMode,
  selectedObjectId: editorState.selectedObjectId,
  activeLayer: editorState.activeLayer,
  pencilSprayMode: editorState.pencilSprayMode,
  trianglePaintMode: editorState.trianglePaintMode,
};

afterEach(() => {
  updateEditorState({
    activeTool: original.activeTool,
    paletteMode: original.paletteMode,
    selectedObjectId: original.selectedObjectId,
    activeLayer: original.activeLayer,
    pencilSprayMode: original.pencilSprayMode,
    trianglePaintMode: original.trianglePaintMode,
  });
});

function flushEditorState(): Promise<void> {
  return new Promise(resolve => { queueMicrotask(resolve); });
}

describe('triangle selection release', () => {
  it('releases when Draw is chosen, including when Draw is already the active tool', () => {
    updateEditorState({ activeTool: 'pencil', pencilSprayMode: false });
    const releases: number[] = [];
    const stop = watchTriangleSelectionRelease(() => releases.push(1));
    applyEditorToolSelection('pencil');
    expect(releases).toEqual([1]);
    expect(editorState.pencilSprayMode).toBe(true);
    stop();
  });

  it('keeps the selection when the triangle tool is chosen or toggled', async () => {
    updateEditorState({ activeTool: 'pencil', trianglePaintMode: false });
    const releases: number[] = [];
    const stop = watchTriangleSelectionRelease(() => releases.push(1));
    applyEditorToolSelection('triangle');
    applyEditorToolSelection('triangle');
    await flushEditorState();
    expect(editorState.activeTool).toBe('triangle');
    expect(editorState.trianglePaintMode).toBe(true);
    expect(releases).toEqual([]);
    stop();
  });

  it('releases when the palette mode, object choice, or tile layer changes', async () => {
    updateEditorState({ paletteMode: 'objects', selectedObjectId: null, activeLayer: 'terrain', activeTool: 'pencil' });
    await flushEditorState();
    const releases: number[] = [];
    const stop = watchTriangleSelectionRelease(() => releases.push(releases.length + 1));
    updateEditorState({ paletteMode: 'tiles' });
    await flushEditorState();
    updateEditorState({ selectedObjectId: 'coin_gold' });
    await flushEditorState();
    updateEditorState({ activeLayer: 'foreground' });
    await flushEditorState();
    expect(releases).toEqual([1, 2, 3]);
    stop();
  });
});
