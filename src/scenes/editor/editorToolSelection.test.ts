import { afterEach, describe, expect, it } from 'vitest';
import { editorState, updateEditorState } from '../../config';
import { registerCustomSprite } from '../../customSprites/registry';
import {
  applyEditorToolSelection,
  isEditorLineCurve,
  resolveEditorLineEnd,
  getEditorToolUnavailableTitle,
  getEditorToolButtonAppearance,
  getEditorToolModePipState,
  getShapeFillModeUnavailableTitle,
  getShapeFillUiMode,
  getTileFlipModePipState,
  isEditorToolUnavailable,
  isPencilBrushPlacement,
  isPencilSprayPlacement,
  isPencilStampPlacement,
  isShapeFillModeAvailable,
  ensureEditorToolAvailable,
} from './editorToolSelection';

const originalMode = editorState.paletteMode;
const originalObjectId = editorState.selectedObjectId;

afterEach(() => {
  updateEditorState({ paletteMode: originalMode });
  updateEditorState({ selectedObjectId: originalObjectId });
});

describe('editorToolSelection availability', () => {
  it('greys scramble outside Advanced Tilesets and uses the fixed tooltip', () => {
    updateEditorState({ paletteMode: 'smart' });
    expect(isEditorToolUnavailable('randomize')).toBe(true);
    expect(getEditorToolUnavailableTitle('randomize')).toBe(
      'Scramble is only available for Terrain with Advanced Tilesets',
    );
    updateEditorState({ paletteMode: 'objects' });
    expect(isEditorToolUnavailable('randomize')).toBe(true);
    expect(getEditorToolUnavailableTitle('randomize')).toBe(
      'Scramble is only available for Terrain with Advanced Tilesets',
    );
    updateEditorState({ paletteMode: 'tiles' });
    expect(isEditorToolUnavailable('randomize')).toBe(false);
    expect(getEditorToolUnavailableTitle('randomize')).toBeNull();
  });

  it('keeps the current terrain tool across Auto-Tile and Tilesets, and falls back to Draw', () => {
    const originalTool = editorState.activeTool;
    const originalMaterial = editorState.smartMaterial;
    const originalSpray = editorState.pencilSprayMode;
    updateEditorState({ smartMaterial: 'forest.ground' });
    updateEditorState({ paletteMode: 'tiles' });
    updateEditorState({ activeTool: 'fill' });
    updateEditorState({ pencilSprayMode: false });
    updateEditorState({ paletteMode: 'smart' });
    expect(ensureEditorToolAvailable()).toBe('fill');
    updateEditorState({ paletteMode: 'tiles' });
    expect(ensureEditorToolAvailable()).toBe('fill');
    updateEditorState({ activeTool: 'randomize' });
    updateEditorState({ paletteMode: 'smart' });
    expect(ensureEditorToolAvailable()).toBe('pencil');
    expect(editorState.pencilSprayMode).toBe(false);
    updateEditorState({ activeTool: originalTool });
    updateEditorState({ smartMaterial: originalMaterial });
    updateEditorState({ pencilSprayMode: originalSpray });
  });

  it('offers Fill for repeatable objects but not one-off objects', () => {
    updateEditorState({ paletteMode: 'objects' });
    updateEditorState({ selectedObjectId: null });
    expect(isEditorToolUnavailable('fill')).toBe(true);
    expect(getEditorToolUnavailableTitle('fill')).toBe('Select a Decoration, Collectible, or Solid Block to fill');
    updateEditorState({ selectedObjectId: 'coin_gold' });
    expect(isEditorToolUnavailable('fill')).toBe(false);
    updateEditorState({ selectedObjectId: 'rock' });
    expect(isEditorToolUnavailable('fill')).toBe(false);
    updateEditorState({ selectedObjectId: 'spawn_point' });
    expect(isEditorToolUnavailable('fill')).toBe(true);
    updateEditorState({ selectedObjectId: 'sign' });
    expect(isEditorToolUnavailable('fill')).toBe(true);
    for (const kind of ['solid', 'sign'] as const) {
      registerCustomSprite({
        id: `repeat-test-${kind}`,
        name: `Repeat test ${kind}`,
        size: 16,
        kind,
        pixels: Array.from({ length: 256 }, () => '#ffffff'),
        status: 'active',
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
      }, { persist: false, notify: false });
    }
    updateEditorState({ selectedObjectId: 'custom_sprite:repeat-test-solid' });
    expect(isEditorToolUnavailable('fill')).toBe(false);
    updateEditorState({ selectedObjectId: 'custom_sprite:repeat-test-sign' });
    expect(isEditorToolUnavailable('fill')).toBe(true);
    expect(isEditorToolUnavailable('rect')).toBe(true);
    expect(getEditorToolUnavailableTitle('rect')).toBe('Rectangle is only available for Terrain');
    expect(isEditorToolUnavailable('ellipse')).toBe(true);
    expect(getEditorToolUnavailableTitle('ellipse')).toBe('Circle is only available for Terrain');
    expect(isEditorToolUnavailable('line')).toBe(true);
    expect(getEditorToolUnavailableTitle('line')).toBe('Line/Curve is only available for Terrain');
    updateEditorState({ paletteMode: 'smart' });
    expect(isEditorToolUnavailable('fill')).toBe(false);
    expect(isEditorToolUnavailable('rect')).toBe(false);
  });
});

describe('draw stamp vs brush placement', () => {
  const originalSelection = editorState.selection;
  const originalSize = editorState.pencilBrushSize;
  const originalMode = editorState.shapeFillMode;
  const originalTool = editorState.activeTool;
  const originalPalette = editorState.paletteMode;
  const originalSpray = editorState.pencilSprayMode;

  afterEach(() => {
    updateEditorState({ selection: originalSelection });
    updateEditorState({ pencilBrushSize: originalSize });
    updateEditorState({ shapeFillMode: originalMode });
    updateEditorState({ activeTool: originalTool });
    updateEditorState({ paletteMode: originalPalette });
    updateEditorState({ pencilSprayMode: originalSpray });
  });

  it('stamps multi-tile selections by default and brushes when pattern or shuffle is selected', () => {
    updateEditorState({ paletteMode: 'tiles' });
    updateEditorState({ activeTool: 'pencil' });
    updateEditorState({ selection: {
      ...editorState.selection,
      width: 2,
      height: 1,
      occupiedMask: [[true, true]],
      patternOrder: [
        { col: editorState.selection.startCol, row: editorState.selection.startRow },
        { col: editorState.selection.startCol + 1, row: editorState.selection.startRow },
      ],
    } });
    updateEditorState({ shapeFillMode: 'stamp' });
    updateEditorState({ pencilBrushSize: 3 });
    expect(isPencilStampPlacement()).toBe(true);
    expect(isPencilBrushPlacement()).toBe(false);
    updateEditorState({ shapeFillMode: 'pattern' });
    expect(isPencilStampPlacement()).toBe(false);
    expect(isPencilBrushPlacement()).toBe(true);
    expect(getShapeFillUiMode('fill')).toBe('pattern');
    updateEditorState({ shapeFillMode: 'stamp' });
    expect(getShapeFillUiMode('fill')).toBe('pattern');
    expect(getShapeFillUiMode('pencil')).toBe('stamp');
  });
});

describe('shape fill mode availability', () => {
  const originalSelection = editorState.selection;
  const originalTool = editorState.activeTool;
  const originalPalette = editorState.paletteMode;
  const originalSpray = editorState.pencilSprayMode;

  afterEach(() => {
    updateEditorState({ selection: originalSelection });
    updateEditorState({ activeTool: originalTool });
    updateEditorState({ paletteMode: originalPalette });
    updateEditorState({ pencilSprayMode: originalSpray });
  });

  function selectTwoTiles(): void {
    updateEditorState({ selection: {
      ...editorState.selection,
      width: 2,
      height: 1,
      occupiedMask: [[true, true]],
      patternOrder: [
        { col: editorState.selection.startCol, row: editorState.selection.startRow },
        { col: editorState.selection.startCol + 1, row: editorState.selection.startRow },
      ],
    } });
  }

  it('greys stamp, pattern, and shuffle until more than one tile is selected', () => {
    updateEditorState({ paletteMode: 'tiles' });
    updateEditorState({ activeTool: 'pencil' });
    updateEditorState({ selection: {
      ...editorState.selection,
      width: 1,
      height: 1,
      occupiedMask: [[true]],
      patternOrder: [{ col: editorState.selection.startCol, row: editorState.selection.startRow }],
    } });
    expect(isShapeFillModeAvailable('stamp')).toBe(false);
    expect(isShapeFillModeAvailable('pattern')).toBe(false);
    expect(isShapeFillModeAvailable('shuffle')).toBe(false);
    expect(getShapeFillModeUnavailableTitle('stamp')).toBe(
      'Select more than one tile to use Stamp, Pattern, or Shuffle',
    );
  });

  it('greys only stamp when a multi-tile selection is used without Draw', () => {
    updateEditorState({ paletteMode: 'tiles' });
    updateEditorState({ activeTool: 'rect' });
    selectTwoTiles();
    expect(isShapeFillModeAvailable('stamp')).toBe(false);
    expect(isShapeFillModeAvailable('pattern')).toBe(true);
    expect(isShapeFillModeAvailable('shuffle')).toBe(true);
    expect(getShapeFillModeUnavailableTitle('stamp')).toBe('Stamp is only available with the Draw tool');
    expect(getShapeFillModeUnavailableTitle('pattern')).toBeNull();
    updateEditorState({ activeTool: 'pencil' });
    expect(isShapeFillModeAvailable('stamp')).toBe(true);
  });

  it('greys stamp while Spray is selected and treats fill as pattern', () => {
    updateEditorState({ paletteMode: 'tiles' });
    updateEditorState({ activeTool: 'pencil' });
    updateEditorState({ pencilSprayMode: true });
    selectTwoTiles();
    updateEditorState({ shapeFillMode: 'stamp' });
    expect(isShapeFillModeAvailable('stamp')).toBe(false);
    expect(isShapeFillModeAvailable('pattern')).toBe(true);
    expect(getShapeFillModeUnavailableTitle('stamp')).toBe('Stamp is only available with Draw, not Spray');
    expect(getShapeFillUiMode('pencil')).toBe('pattern');
    expect(isPencilSprayPlacement()).toBe(true);
    expect(isPencilStampPlacement()).toBe(false);
    expect(isPencilBrushPlacement()).toBe(false);
    updateEditorState({ paletteMode: 'smart' });
    expect(isPencilSprayPlacement()).toBe(true);
    expect(isPencilStampPlacement()).toBe(false);
    expect(isPencilBrushPlacement()).toBe(false);
  });
});

describe('multi-state tool pips', () => {
  const originalRect = editorState.rectOutline;
  const originalEllipse = editorState.ellipseOutline;
  const originalLine = editorState.lineCurve;
  const originalSpray = editorState.pencilSprayMode;
  const originalTool = editorState.activeTool;

  afterEach(() => {
    updateEditorState({ rectOutline: originalRect });
    updateEditorState({ ellipseOutline: originalEllipse });
    updateEditorState({ lineCurve: originalLine });
    updateEditorState({ pencilSprayMode: originalSpray });
    updateEditorState({ activeTool: originalTool });
  });

  it('maps rectangle, circle, line, draw/spray, and flip cycles to pip indexes', () => {
    updateEditorState({ rectOutline: false });
    updateEditorState({ ellipseOutline: true });
    updateEditorState({ lineCurve: false });
    updateEditorState({ pencilSprayMode: false });
    expect(getEditorToolModePipState('rect')).toEqual({ count: 2, activeIndex: 0 });
    expect(getEditorToolModePipState('ellipse')).toEqual({ count: 2, activeIndex: 1 });
    expect(getEditorToolModePipState('line')).toEqual({ count: 2, activeIndex: 0 });
    updateEditorState({ lineCurve: true });
    expect(getEditorToolModePipState('line')).toEqual({ count: 2, activeIndex: 1 });
    expect(getEditorToolModePipState('pencil')).toEqual({ count: 2, activeIndex: 0 });
    updateEditorState({ activeTool: 'pencil' });
    applyEditorToolSelection('pencil');
    expect(editorState.pencilSprayMode).toBe(true);
    expect(getEditorToolModePipState('pencil')).toEqual({ count: 2, activeIndex: 1 });
    expect(getEditorToolButtonAppearance('pencil', true)?.label).toBe('Spray');
    expect(getTileFlipModePipState('off')).toEqual({ count: 3, activeIndex: 0 });
    expect(getTileFlipModePipState('on')).toEqual({ count: 3, activeIndex: 1 });
    expect(getTileFlipModePipState('rand')).toEqual({ count: 3, activeIndex: 2 });
  });
});


describe('Smart straight Line constraints', () => {
  const original = { paletteMode: editorState.paletteMode, smartMaterial: editorState.smartMaterial, activeTool: editorState.activeTool, lineCurve: editorState.lineCurve };
  afterEach(() => { updateEditorState(original); });

  it('keeps Start Bar horizontal in either direction and restores normal Curve behavior for other tools', () => {
    updateEditorState({ paletteMode: 'smart' });
    updateEditorState({ smartMaterial: 'wampos95.start-bar' });
    updateEditorState({ activeTool: 'line' });
    updateEditorState({ lineCurve: true });
    expect(resolveEditorLineEnd({ x: 2, y: 18 }, { x: 25, y: 10 }, true)).toEqual({ x: 25, y: 18 });
    expect(resolveEditorLineEnd({ x: 25, y: 18 }, { x: 2, y: 20 })).toEqual({ x: 2, y: 18 });
    applyEditorToolSelection('line');
    expect(isEditorLineCurve()).toBe(false);
    expect(getEditorToolModePipState('line')).toBeNull();
    expect(getEditorToolButtonAppearance('line', true)?.label).toBe('Line');
    updateEditorState({ smartMaterial: 'cyber.concrete' });
    expect(isEditorLineCurve()).toBe(true);
    expect(resolveEditorLineEnd({ x: 2, y: 18 }, { x: 25, y: 10 })).toEqual({ x: 25, y: 10 });
    updateEditorState({ paletteMode: 'tiles' });
    updateEditorState({ smartMaterial: 'wampos95.start-bar' });
    expect(isEditorLineCurve()).toBe(true);
  });
});
