import { editorState, type ShapeFillMode, type ToolName } from '../../config';
import type { EditorShapeKind } from './shapeTiles';
import { countOccupiedSelectionTiles } from './selectionPattern';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { isSolidCustomSpriteObjectConfig } from '../../config';
import { getCustomSpriteDefinitionByObjectId } from '../../customSprites/registry';

export function canRepeatSelectedEditorObject(): boolean {
  const customSprite = getCustomSpriteDefinitionByObjectId(editorState.selectedObjectId);
  if (customSprite) {
    return customSprite.kind === 'decoration'
      || customSprite.kind === 'collectible'
      || customSprite.kind === 'solid';
  }
  const config = editorState.selectedObjectId
    ? getEditorObjectConfigById(editorState.selectedObjectId)
    : null;
  return Boolean(config && (
    (config.category === 'decoration' && config.id !== 'sign' && config.id !== 'sign_arrow') ||
    config.category === 'collectible' ||
    isSolidCustomSpriteObjectConfig(config)
  ));
}

export function isMoreEditorTool(tool: ToolName): boolean {
  return tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'fill' || tool === 'randomize';
}

export function isShapeEditorTool(tool: ToolName): tool is 'rect' | 'ellipse' {
  return tool === 'rect' || tool === 'ellipse';
}

export function isPathEditorTool(tool: ToolName): tool is 'line' {
  return tool === 'line';
}

export function isShapeFillEditorTool(tool: ToolName): boolean {
  return tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'fill';
}

export function isPencilStampPlacement(): boolean {
  if (editorState.paletteMode !== 'tiles') {
    return false;
  }
  if (countOccupiedSelectionTiles(editorState.selection) <= 1) {
    return editorState.pencilBrushSize <= 1;
  }
  return editorState.shapeFillMode === 'stamp';
}

export function isPencilBrushPlacement(): boolean {
  return editorState.paletteMode === 'tiles' && !isPencilStampPlacement();
}

export function getShapeFillUiMode(tool: ToolName = editorState.activeTool): ShapeFillMode {
  if (tool === 'pencil') {
    return editorState.shapeFillMode;
  }
  return editorState.shapeFillMode === 'shuffle' ? 'shuffle' : 'pattern';
}

export function isDragStampEditorTool(tool: ToolName): tool is 'rect' | 'ellipse' | 'line' {
  return isShapeEditorTool(tool) || isPathEditorTool(tool);
}

export function isEditorLineCurve(): boolean {
  return editorState.lineCurve;
}

export function isEditorToolUnavailable(tool: ToolName): boolean {
  if (tool === 'randomize') {
    return editorState.paletteMode !== 'tiles';
  }
  if (tool === 'fill') {
    return editorState.paletteMode === 'objects' && !canRepeatSelectedEditorObject();
  }
  if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
    return editorState.paletteMode === 'objects';
  }
  return false;
}

export function getEditorToolUnavailableTitle(tool: ToolName): string | null {
  if (!isEditorToolUnavailable(tool)) {
    return null;
  }
  if (tool === 'randomize') {
    return 'Scramble is only available for Terrain with Advanced Tilesets';
  }
  if (tool === 'fill') {
    return 'Select a Decoration, Collectible, or Solid Block to fill';
  }
  if (tool === 'rect') {
    return 'Rectangle is only available for Terrain';
  }
  if (tool === 'ellipse') {
    return 'Circle is only available for Terrain';
  }
  if (tool === 'line') {
    return 'Line/Curve is only available for Terrain';
  }
  return null;
}

export function applyEditorToolSelection(tool: ToolName): void {
  if (isEditorToolUnavailable(tool)) {
    return;
  }
  if (editorState.activeTool === tool && isShapeEditorTool(tool)) {
    toggleEditorShapeOutline(tool);
    return;
  }
  if (editorState.activeTool === tool && tool === 'line') {
    editorState.lineCurve = !editorState.lineCurve;
    return;
  }
  if (tool === 'randomize') {
    editorState.randomizeBrushSize = editorState.scrambleBrushSize;
  }
  editorState.activeTool = tool;
}

export function toggleEditorShapeOutline(tool: 'rect' | 'ellipse'): void {
  if (tool === 'rect') {
    editorState.rectOutline = !editorState.rectOutline;
    return;
  }
  editorState.ellipseOutline = !editorState.ellipseOutline;
}

export function isEditorShapeOutline(tool: ToolName): boolean {
  if (tool === 'rect') {
    return editorState.rectOutline;
  }
  if (tool === 'ellipse') {
    return editorState.ellipseOutline;
  }
  return false;
}

export function getEditorStampKind(tool: ToolName, curveBend = false): EditorShapeKind | null {
  if (tool === 'rect' || tool === 'ellipse') {
    return tool;
  }
  if (tool === 'line') {
    return curveBend ? 'curve' : 'line';
  }
  return null;
}

export function getEditorToolHudLabel(tool: ToolName, pastePreviewActive = false): string {
  switch (tool) {
    case 'eraser':
      return `Erase ${editorState.eraserBrushSize}x${editorState.eraserBrushSize}`;
    case 'rect':
      return editorState.rectOutline ? 'Rectangle Outlined' : 'Rectangle Filled';
    case 'ellipse':
      return editorState.ellipseOutline ? 'Ellipse Outlined' : 'Ellipse Filled';
    case 'line':
      return editorState.lineCurve ? 'Curve' : 'Line';
    case 'randomize':
      return `Scramble ${editorState.randomizeBrushSize}x${editorState.randomizeBrushSize}`;
    case 'fill':
      return 'Fill';
    case 'copy':
      return pastePreviewActive ? 'Paste' : 'Copy';
    case 'pencil':
      return isPencilBrushPlacement() && editorState.pencilBrushSize > 1
        ? `Draw ${editorState.pencilBrushSize}x${editorState.pencilBrushSize}`
        : 'Draw';
    default:
      return 'Draw';
  }
}

export interface EditorToolButtonAppearance {
  icon?: string;
  iconKind?: 'glyph' | 'mosaic';
  label?: string;
  title: string;
  dimPart: string | null;
}

export function getEditorToolButtonAppearance(tool: ToolName, selected: boolean): EditorToolButtonAppearance | null {
  if (tool === 'rect') {
    return {
      icon: editorState.rectOutline ? '\u25A1' : '\u25A0',
      title: 'Rectangle Filled / Outlined (R) hold Shift for proportional',
      dimPart: selected ? (editorState.rectOutline ? 'filled' : 'outlined') : null,
    };
  }
  if (tool === 'ellipse') {
    return {
      icon: editorState.ellipseOutline ? '\u25CB' : '\u25CF',
      title: 'Circle Filled / Outlined (O) hold Shift for proportional',
      dimPart: selected ? (editorState.ellipseOutline ? 'filled' : 'outlined') : null,
    };
  }
  if (tool === 'line') {
    return {
      icon: editorState.lineCurve ? '\u223F' : '\u2571',
      label: editorState.lineCurve ? 'Curve' : 'Line',
      title: editorState.lineCurve
        ? 'Curve (L); select again to switch to Line. Hold Shift to snap'
        : 'Line (L); select again to switch to Curve. Hold Shift to snap',
      dimPart: null,
    };
  }
  if (tool === 'randomize') {
    return {
      iconKind: 'mosaic',
      label: 'Scramble',
      title: 'Scramble (V)',
      dimPart: null,
    };
  }
  return null;
}
