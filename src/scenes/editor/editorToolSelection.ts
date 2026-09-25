import { getSmartBrushDefinition, isSmartBrushToolSupported } from '../../autotiling/registry';
import { snapLineEnd, type EditorShapeKind, type TilePoint } from './shapeTiles';
import { countOccupiedSelectionTiles } from './selectionPattern';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import {
  TILE_FLIP_MODES,
  editorState,
  isSolidCustomSpriteObjectConfig,
  type ShapeFillMode,
  type TileFlipMode,
  type ToolName,
} from '../../config';
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

export function isPencilSprayPlacement(): boolean {
  return editorState.activeTool === 'pencil'
    && editorState.pencilSprayMode
    && (editorState.paletteMode === 'tiles' || editorState.paletteMode === 'smart');
}

export function isPencilStampPlacement(): boolean {
  if (isPencilSprayPlacement()) {
    return false;
  }
  if (editorState.paletteMode !== 'tiles') {
    return false;
  }
  if (countOccupiedSelectionTiles(editorState.selection) <= 1) {
    return editorState.pencilBrushSize <= 1;
  }
  return editorState.shapeFillMode === 'stamp';
}

export function isPencilBrushPlacement(): boolean {
  if (isPencilSprayPlacement()) {
    return false;
  }
  return editorState.paletteMode === 'tiles' && !isPencilStampPlacement();
}

export function getShapeFillUiMode(tool: ToolName = editorState.activeTool): ShapeFillMode {
  if (tool === 'pencil' && !editorState.pencilSprayMode) {
    return editorState.shapeFillMode;
  }
  return editorState.shapeFillMode === 'shuffle' ? 'shuffle' : 'pattern';
}

export function isShapeFillModeAvailable(
  mode: ShapeFillMode,
  tool: ToolName = editorState.activeTool,
): boolean {
  if (editorState.paletteMode !== 'tiles') {
    return false;
  }
  if (countOccupiedSelectionTiles(editorState.selection) <= 1) {
    return false;
  }
  if (mode === 'stamp') {
    return tool === 'pencil' && !editorState.pencilSprayMode;
  }
  return true;
}

export function getShapeFillModeUnavailableTitle(mode: ShapeFillMode): string | null {
  if (isShapeFillModeAvailable(mode)) {
    return null;
  }
  if (editorState.paletteMode !== 'tiles' || countOccupiedSelectionTiles(editorState.selection) <= 1) {
    return 'Select more than one tile to use Stamp, Pattern, or Shuffle';
  }
  if (mode === 'stamp') {
    if (editorState.activeTool === 'pencil' && editorState.pencilSprayMode) {
      return 'Stamp is only available with Draw, not Spray';
    }
    return 'Stamp is only available with the Draw tool';
  }
  return null;
}

export function isDragStampEditorTool(tool: ToolName): tool is 'rect' | 'ellipse' | 'line' {
  return isShapeEditorTool(tool) || isPathEditorTool(tool);
}

function getEditorLineAxis(): 'horizontal' | 'vertical' | undefined {
  return editorState.paletteMode === 'smart' ? getSmartBrushDefinition(editorState.smartMaterial).lineAxis : undefined;
}

export function resolveEditorLineEnd(start: TilePoint, current: TilePoint, snap = false): TilePoint {
  const axis = getEditorLineAxis();
  if (axis === 'horizontal') return { x: current.x, y: start.y };
  if (axis === 'vertical') return { x: start.x, y: current.y };
  return snap ? snapLineEnd(start, current) : current;
}

export function isEditorLineCurve(): boolean {
  return !getEditorLineAxis() && editorState.lineCurve;
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

export function isEditorToolAvailable(tool: ToolName): boolean {
  if (isEditorToolUnavailable(tool)) {
    return false;
  }
  if (
    editorState.paletteMode === 'smart'
    && (tool === 'pencil' || tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'fill')
    && !isSmartBrushToolSupported(editorState.smartMaterial, tool)
  ) {
    return false;
  }
  return true;
}

export function ensureEditorToolAvailable(): ToolName {
  if (isEditorToolAvailable(editorState.activeTool)) {
    return editorState.activeTool;
  }
  const previous = editorState.activeTool;
  editorState.activeTool = 'pencil';
  if (previous !== 'pencil') {
    editorState.pencilSprayMode = false;
  }
  return editorState.activeTool;
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
    if (!getEditorLineAxis()) editorState.lineCurve = !editorState.lineCurve;
    return;
  }
  if (editorState.activeTool === tool && tool === 'pencil') {
    editorState.pencilSprayMode = !editorState.pencilSprayMode;
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
      return isEditorLineCurve() ? 'Curve' : 'Line';
    case 'randomize':
      return `Scramble ${editorState.randomizeBrushSize}x${editorState.randomizeBrushSize}`;
    case 'fill':
      return 'Fill';
    case 'copy':
      return pastePreviewActive ? 'Paste' : 'Copy';
    case 'pencil':
      if (isPencilSprayPlacement()) {
        return `Spray ${editorState.pencilSprayBrushSize}x${editorState.pencilSprayBrushSize}`;
      }
      return isPencilBrushPlacement() && editorState.pencilBrushSize > 1
        ? `Draw ${editorState.pencilBrushSize}x${editorState.pencilBrushSize}`
        : 'Draw';
    default:
      return 'Draw';
  }
}

export interface EditorModePipState {
  count: number;
  activeIndex: number;
}

export function getEditorToolModePipState(tool: ToolName): EditorModePipState | null {
  if (tool === 'pencil') {
    return { count: 2, activeIndex: editorState.pencilSprayMode ? 1 : 0 };
  }
  if (tool === 'rect') {
    return { count: 2, activeIndex: editorState.rectOutline ? 1 : 0 };
  }
  if (tool === 'ellipse') {
    return { count: 2, activeIndex: editorState.ellipseOutline ? 1 : 0 };
  }
  if (tool === 'line') {
    return getEditorLineAxis() ? null : { count: 2, activeIndex: editorState.lineCurve ? 1 : 0 };
  }
  return null;
}

export function getTileFlipModePipState(mode: TileFlipMode): EditorModePipState {
  const activeIndex = Math.max(0, TILE_FLIP_MODES.indexOf(mode));
  return { count: TILE_FLIP_MODES.length, activeIndex };
}

export interface EditorToolButtonAppearance {
  icon?: string;
  iconKind?: 'glyph' | 'mosaic';
  label?: string;
  title: string;
  dimPart: string | null;
}

export function getEditorToolButtonAppearance(tool: ToolName, selected: boolean): EditorToolButtonAppearance | null {
  if (tool === 'pencil') {
    return {
      icon: editorState.pencilSprayMode ? '\u2592' : '\u270E',
      label: editorState.pencilSprayMode ? 'Spray' : 'Draw',
      title: editorState.pencilSprayMode
        ? 'Spray (B or 1); select again to switch to Draw'
        : 'Draw (B or 1); select again to switch to Spray',
      dimPart: null,
    };
  }
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
    const axis = getEditorLineAxis();
    return {
      icon: isEditorLineCurve() ? '\u223F' : '\u2571',
      label: isEditorLineCurve() ? 'Curve' : 'Line',
      title: axis ? `Line (L); stays ${axis} for this brush` : isEditorLineCurve()
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
