import { editorState, type ToolName } from '../../config';

export function isMoreEditorTool(tool: ToolName): boolean {
  return tool === 'rect' || tool === 'ellipse' || tool === 'fill';
}

export function isShapeEditorTool(tool: ToolName): tool is 'rect' | 'ellipse' {
  return tool === 'rect' || tool === 'ellipse';
}

export function applyEditorToolSelection(tool: ToolName): void {
  if (editorState.activeTool === tool && isShapeEditorTool(tool)) {
    toggleEditorShapeOutline(tool);
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

export function getEditorToolHudLabel(tool: ToolName, pastePreviewActive = false): string {
  switch (tool) {
    case 'eraser':
      return `Erase ${editorState.eraserBrushSize}x${editorState.eraserBrushSize}`;
    case 'rect':
      return editorState.rectOutline ? 'Rectangle Outline' : 'Rectangle';
    case 'ellipse':
      return editorState.ellipseOutline ? 'Ellipse Outline' : 'Ellipse';
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
      ? { label: 'Rectangle Outline', title: 'Rectangle Outline (R)' }
      : { label: 'Rect', title: 'Rectangle (R)' };
  }
  if (tool === 'ellipse') {
    return editorState.ellipseOutline
      ? { label: 'Ellipse Outline', title: 'Ellipse Outline (E)' }
      : { label: 'Ellipse', title: 'Ellipse (E)' };
  }
  return null;
}
