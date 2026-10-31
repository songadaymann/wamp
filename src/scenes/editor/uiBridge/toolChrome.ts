import type { ToolName } from '../../../config';
import type { EditorToolButtonAppearance } from '../editorToolSelection';

export const SMART_TOOL_LABELS: Readonly<Partial<Record<ToolName, string>>> = {
  pencil: 'Draw',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  triangle: 'Triangle',
  fill: 'Fill',
  randomize: 'Scramble',
};

export function applyEditorToolIcon(icon: Element, appearance: EditorToolButtonAppearance): void {
  const kind = appearance.iconKind ?? 'glyph';
  if (kind === 'mosaic') {
    if (!icon.classList.contains('tool-icon-mosaic')) {
      icon.className = 'tool-icon tool-icon-mosaic';
      icon.innerHTML = '<span></span><span></span><span></span><span></span>';
    }
    return;
  }
  if (kind === 'right-triangle') {
    icon.className = 'tool-icon tool-icon-right-triangle';
    icon.textContent = '';
    return;
  }
  if (appearance.icon === undefined) {
    return;
  }
  icon.className = 'tool-icon';
  icon.textContent = appearance.icon;
}
