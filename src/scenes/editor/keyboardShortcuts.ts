import type { ToolName } from '../../config';

export const EDITOR_TOOL_KEYBOARD_SHORTCUTS = {
  B: 'pencil',
  E: 'eraser',
  C: 'copy',
  F: 'fill',
  R: 'rect',
  O: 'ellipse',
  L: 'line',
  G: 'fill',
} as const satisfies Readonly<Record<string, ToolName>>;

export function getEditorToolForShortcutKey(key: string): ToolName | null {
  const normalizedKey = key.toUpperCase() as keyof typeof EDITOR_TOOL_KEYBOARD_SHORTCUTS;
  return EDITOR_TOOL_KEYBOARD_SHORTCUTS[normalizedKey] ?? null;
}
