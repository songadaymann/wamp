import { describe, expect, it } from 'vitest';
import { EDITOR_TOOL_KEYBOARD_SHORTCUTS, getEditorToolForShortcutKey } from './keyboardShortcuts';

describe('editor tool shortcuts', () => {
  it('uses the approved familiar tool map and keeps the legacy fill alias', () => {
    expect(EDITOR_TOOL_KEYBOARD_SHORTCUTS).toEqual({
      B: 'pencil',
      E: 'eraser',
      C: 'copy',
      F: 'fill',
      R: 'rect',
      O: 'ellipse',
      L: 'line',
      G: 'fill',
    });
    expect(getEditorToolForShortcutKey('c')).toBe('copy');
    expect(getEditorToolForShortcutKey('x')).toBeNull();
  });
});
