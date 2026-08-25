import { editorState, type ToolName } from '../../config';
import type { EditorShapeKind } from './shapeTiles';

export function isMoreEditorTool(tool: ToolName): boolean {
  return tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'fill';
}

export function isShapeEditorTool(tool: ToolName): tool is 'rect' | 'ellipse' {
  return tool === 'rect' || tool === 'ellipse';
}

export function isPathEditorTool(tool: ToolName): tool is 'line' {
  return tool === 'line';
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
      return editorState.rectOutline ? 'Rectangle Outline' : 'Rectangle';
    case 'ellipse':
      return editorState.ellipseOutline ? 'Ellipse Outline' : 'Ellipse';
    case 'line':
      return editorState.lineCurve ? 'Curve' : 'Line';
    case 'fill':
      return 'Fill';
    case 'copy':
      return pastePreviewActive ? 'Paste' : 'Copy';
    default:
      return 'Draw';
  }
}

export function getEditorToolButtonCopy(tool: ToolName): { label: string; title: string } | null {
  if (tool === 'rect') {
    return editorState.rectOutline
      ? { label: 'Rectangle Outline', title: 'Rectangle Outline (R) hold Shift for proportional' }
      : { label: 'Rect', title: 'Rectangle (R) hold Shift for proportional' };
  }
  if (tool === 'ellipse') {
    return editorState.ellipseOutline
      ? { label: 'Ellipse Outline', title: 'Ellipse Outline (E) hold Shift for proportional' }
      : { label: 'Ellipse', title: 'Ellipse (E) hold Shift for proportional' };
  }
  if (tool === 'line') {
    return editorState.lineCurve
      ? { label: 'Curve', title: 'Line / Curve (L) hold Shift to snap' }
      : { label: 'Line', title: 'Line / Curve (L) hold Shift to snap' };
  }
  return null;
}
