import { editorState, type ToolName } from '../../config';
import type { EditorShapeKind } from './shapeTiles';

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

export function isDragStampEditorTool(tool: ToolName): tool is 'rect' | 'ellipse' | 'line' {
  return isShapeEditorTool(tool) || isPathEditorTool(tool);
}

export function isEditorLineCurve(): boolean {
  return editorState.lineCurve;
}

export function applyEditorToolSelection(tool: ToolName): void {
  if (editorState.activeTool === tool && isShapeEditorTool(tool)) {
    toggleEditorShapeOutline(tool);
    return;
  }
  if (editorState.activeTool === tool && tool === 'line') {
    editorState.lineCurve = !editorState.lineCurve;
    return;
  }
  if (editorState.activeTool === tool && tool === 'randomize') {
    if (editorState.randomizeScramble) {
      editorState.scrambleBrushSize = editorState.randomizeBrushSize;
    } else {
      editorState.shuffleBrushSize = editorState.randomizeBrushSize;
    }
    editorState.randomizeScramble = !editorState.randomizeScramble;
    editorState.randomizeBrushSize = editorState.randomizeScramble
      ? editorState.scrambleBrushSize
      : editorState.shuffleBrushSize;
    return;
  }
  if (tool === 'randomize') {
    editorState.randomizeBrushSize = editorState.randomizeScramble
      ? editorState.scrambleBrushSize
      : editorState.shuffleBrushSize;
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
      return editorState.randomizeScramble
        ? `Scramble ${editorState.randomizeBrushSize}x${editorState.randomizeBrushSize}`
        : `Shuffle ${editorState.randomizeBrushSize}x${editorState.randomizeBrushSize}`;
    case 'fill':
      return 'Fill';
    case 'copy':
      return pastePreviewActive ? 'Paste' : 'Copy';
    default:
      return 'Draw';
  }
}

export interface EditorToolButtonAppearance {
  icon?: string;
  iconKind?: 'glyph' | 'mosaic' | 'broken-pencil';
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
      iconKind: editorState.randomizeScramble ? 'mosaic' : 'broken-pencil',
      label: editorState.randomizeScramble ? 'Scramble' : 'Shuffle',
      title: editorState.randomizeScramble
        ? 'Scramble (V); select again to switch to Shuffle'
        : 'Shuffle (V); select again to switch to Scramble',
      dimPart: null,
    };
  }
  return null;
}
