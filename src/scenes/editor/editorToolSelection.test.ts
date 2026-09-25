import { afterEach, describe, expect, it } from 'vitest';
import { editorState } from '../../config';
import { registerCustomSprite } from '../../customSprites/registry';
import {
  applyEditorToolSelection,
  isEditorLineCurve,
  resolveEditorLineEnd,
  getEditorToolHudLabel,
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
  editorState.paletteMode = originalMode;
  editorState.selectedObjectId = originalObjectId;
});

describe('editorToolSelection availability', () => {
  it('greys scramble outside Advanced Tilesets and uses the fixed tooltip', () => {
    editorState.paletteMode = 'smart';
    expect(isEditorToolUnavailable('randomize')).toBe(true);
    expect(getEditorToolUnavailableTitle('randomize')).toBe(
      'Scramble is only available for Terrain with Advanced Tilesets',
    );
    editorState.paletteMode = 'objects';
    expect(isEditorToolUnavailable('randomize')).toBe(true);
    expect(getEditorToolUnavailableTitle('randomize')).toBe(
      'Scramble is only available for Terrain with Advanced Tilesets',
    );
    editorState.paletteMode = 'tiles';
    expect(isEditorToolUnavailable('randomize')).toBe(false);
    expect(getEditorToolUnavailableTitle('randomize')).toBeNull();
  });

  it('keeps the current terrain tool across Auto-Tile and Tilesets, and falls back to Draw', () => {
    const originalTool = editorState.activeTool;
    const originalMaterial = editorState.smartMaterial;
    const originalSpray = editorState.pencilSprayMode;
    editorState.smartMaterial = 'forest.ground';
    editorState.paletteMode = 'tiles';
    editorState.activeTool = 'fill';
    editorState.pencilSprayMode = false;
    editorState.paletteMode = 'smart';
    expect(ensureEditorToolAvailable()).toBe('fill');
    editorState.paletteMode = 'tiles';
    expect(ensureEditorToolAvailable()).toBe('fill');
    editorState.activeTool = 'randomize';
    editorState.paletteMode = 'smart';
    expect(ensureEditorToolAvailable()).toBe('pencil');
    expect(editorState.pencilSprayMode).toBe(false);
    editorState.activeTool = originalTool;
    editorState.smartMaterial = originalMaterial;
    editorState.pencilSprayMode = originalSpray;
  });

  it('offers Fill for repeatable objects but not one-off objects', () => {
    editorState.paletteMode = 'objects';
    editorState.selectedObjectId = null;
    expect(isEditorToolUnavailable('fill')).toBe(true);
    expect(getEditorToolUnavailableTitle('fill')).toBe('Select a Decoration, Collectible, or Solid Block to fill');
    editorState.selectedObjectId = 'coin_gold';
    expect(isEditorToolUnavailable('fill')).toBe(false);
    editorState.selectedObjectId = 'rock';
    expect(isEditorToolUnavailable('fill')).toBe(false);
    editorState.selectedObjectId = 'spawn_point';
    expect(isEditorToolUnavailable('fill')).toBe(true);
    editorState.selectedObjectId = 'sign';
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
    editorState.selectedObjectId = 'custom_sprite:repeat-test-solid';
    expect(isEditorToolUnavailable('fill')).toBe(false);
    editorState.selectedObjectId = 'custom_sprite:repeat-test-sign';
    expect(isEditorToolUnavailable('fill')).toBe(true);
    expect(isEditorToolUnavailable('rect')).toBe(true);
    expect(getEditorToolUnavailableTitle('rect')).toBe('Rectangle is only available for Terrain');
    expect(isEditorToolUnavailable('ellipse')).toBe(true);
    expect(getEditorToolUnavailableTitle('ellipse')).toBe('Circle is only available for Terrain');
    expect(isEditorToolUnavailable('line')).toBe(true);
    expect(getEditorToolUnavailableTitle('line')).toBe('Line/Curve is only available for Terrain');
    editorState.paletteMode = 'smart';
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
    editorState.selection = originalSelection;
    editorState.pencilBrushSize = originalSize;
    editorState.shapeFillMode = originalMode;
    editorState.activeTool = originalTool;
    editorState.paletteMode = originalPalette;
    editorState.pencilSprayMode = originalSpray;
  });

  it('stamps multi-tile selections by default and brushes when pattern or shuffle is selected', () => {
    editorState.paletteMode = 'tiles';
    editorState.activeTool = 'pencil';
    editorState.selection = {
      ...editorState.selection,
      width: 2,
      height: 1,
      occupiedMask: [[true, true]],
      patternOrder: [
        { col: editorState.selection.startCol, row: editorState.selection.startRow },
        { col: editorState.selection.startCol + 1, row: editorState.selection.startRow },
      ],
    };
    editorState.shapeFillMode = 'stamp';
    editorState.pencilBrushSize = 3;
    expect(isPencilStampPlacement()).toBe(true);
    expect(isPencilBrushPlacement()).toBe(false);
    editorState.shapeFillMode = 'pattern';
    expect(isPencilStampPlacement()).toBe(false);
    expect(isPencilBrushPlacement()).toBe(true);
    expect(getShapeFillUiMode('fill')).toBe('pattern');
    editorState.shapeFillMode = 'stamp';
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
    editorState.selection = originalSelection;
    editorState.activeTool = originalTool;
    editorState.paletteMode = originalPalette;
    editorState.pencilSprayMode = originalSpray;
  });

  function selectTwoTiles(): void {
    editorState.selection = {
      ...editorState.selection,
      width: 2,
      height: 1,
      occupiedMask: [[true, true]],
      patternOrder: [
        { col: editorState.selection.startCol, row: editorState.selection.startRow },
        { col: editorState.selection.startCol + 1, row: editorState.selection.startRow },
      ],
    };
  }

  it('greys stamp, pattern, and shuffle until more than one tile is selected', () => {
    editorState.paletteMode = 'tiles';
    editorState.activeTool = 'pencil';
    editorState.selection = {
      ...editorState.selection,
      width: 1,
      height: 1,
      occupiedMask: [[true]],
      patternOrder: [{ col: editorState.selection.startCol, row: editorState.selection.startRow }],
    };
    expect(isShapeFillModeAvailable('stamp')).toBe(false);
    expect(isShapeFillModeAvailable('pattern')).toBe(false);
    expect(isShapeFillModeAvailable('shuffle')).toBe(false);
    expect(getShapeFillModeUnavailableTitle('stamp')).toBe(
      'Select more than one tile to use Stamp, Pattern, or Shuffle',
    );
  });

  it('greys only stamp when a multi-tile selection is used without Draw', () => {
    editorState.paletteMode = 'tiles';
    editorState.activeTool = 'rect';
    selectTwoTiles();
    expect(isShapeFillModeAvailable('stamp')).toBe(false);
    expect(isShapeFillModeAvailable('pattern')).toBe(true);
    expect(isShapeFillModeAvailable('shuffle')).toBe(true);
    expect(getShapeFillModeUnavailableTitle('stamp')).toBe('Stamp is only available with the Draw tool');
    expect(getShapeFillModeUnavailableTitle('pattern')).toBeNull();
    editorState.activeTool = 'pencil';
    expect(isShapeFillModeAvailable('stamp')).toBe(true);
  });

  it('greys stamp while Spray is selected and treats fill as pattern', () => {
    editorState.paletteMode = 'tiles';
    editorState.activeTool = 'pencil';
    editorState.pencilSprayMode = true;
    selectTwoTiles();
    editorState.shapeFillMode = 'stamp';
    expect(isShapeFillModeAvailable('stamp')).toBe(false);
    expect(isShapeFillModeAvailable('pattern')).toBe(true);
    expect(getShapeFillModeUnavailableTitle('stamp')).toBe('Stamp is only available with Draw, not Spray');
    expect(getShapeFillUiMode('pencil')).toBe('pattern');
    expect(isPencilSprayPlacement()).toBe(true);
    expect(isPencilStampPlacement()).toBe(false);
    expect(isPencilBrushPlacement()).toBe(false);
    editorState.paletteMode = 'smart';
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
    editorState.rectOutline = originalRect;
    editorState.ellipseOutline = originalEllipse;
    editorState.lineCurve = originalLine;
    editorState.pencilSprayMode = originalSpray;
    editorState.activeTool = originalTool;
  });

  it('maps rectangle, circle, line, draw/spray, and flip cycles to pip indexes', () => {
    editorState.rectOutline = false;
    editorState.ellipseOutline = true;
    editorState.lineCurve = false;
    editorState.pencilSprayMode = false;
    expect(getEditorToolModePipState('rect')).toEqual({ count: 2, activeIndex: 0 });
    expect(getEditorToolModePipState('ellipse')).toEqual({ count: 2, activeIndex: 1 });
    expect(getEditorToolModePipState('line')).toEqual({ count: 2, activeIndex: 0 });
    editorState.lineCurve = true;
    expect(getEditorToolModePipState('line')).toEqual({ count: 2, activeIndex: 1 });
    expect(getEditorToolModePipState('pencil')).toEqual({ count: 2, activeIndex: 0 });
    editorState.activeTool = 'pencil';
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
  afterEach(() => { Object.assign(editorState, original); });

  it('keeps Start Bar horizontal in either direction and restores normal Curve behavior for other tools', () => {
    editorState.paletteMode = 'smart';
    editorState.smartMaterial = 'wampos95.start-bar';
    editorState.activeTool = 'line';
    editorState.lineCurve = true;
    expect(resolveEditorLineEnd({ x: 2, y: 18 }, { x: 25, y: 10 }, true)).toEqual({ x: 25, y: 18 });
    expect(resolveEditorLineEnd({ x: 25, y: 18 }, { x: 2, y: 20 })).toEqual({ x: 2, y: 18 });
    applyEditorToolSelection('line');
    expect(isEditorLineCurve()).toBe(false);
    expect(getEditorToolModePipState('line')).toBeNull();
    expect(getEditorToolHudLabel('line')).toBe('Line');
    expect(getEditorToolButtonAppearance('line', true)?.label).toBe('Line');
    editorState.smartMaterial = 'cyber.concrete';
    expect(isEditorLineCurve()).toBe(true);
    expect(resolveEditorLineEnd({ x: 2, y: 18 }, { x: 25, y: 10 })).toEqual({ x: 25, y: 10 });
    editorState.paletteMode = 'tiles';
    editorState.smartMaterial = 'wampos95.start-bar';
    expect(isEditorLineCurve()).toBe(true);
  });
});
