import { editorState } from '../../config';
import { isNativeTextEditingFocused } from '../../ui/keyboardFocus';

export type EditorHistoryShortcutActions = {
  sceneActive: boolean;
  undo: () => void;
  redo: () => void;
};

/** Capture-phase Ctrl/Cmd+Z / Ctrl+Y so history reaches WAMP before browser or host chrome. */
export function handleEditorHistoryShortcutCapture(
  event: KeyboardEvent,
  actions: EditorHistoryShortcutActions,
): void {
  if (!actions.sceneActive || editorState.isPlaying) return;
  const key = event.key.toLowerCase();
  const primaryModifier = event.metaKey || event.ctrlKey;
  const undoRequested = primaryModifier && key === 'z';
  const ctrlRedoRequested = event.ctrlKey && !event.metaKey && key === 'y';
  if (!undoRequested && !ctrlRedoRequested) return;
  if (isNativeTextEditingFocused()) return;
  event.preventDefault();
  event.stopPropagation();
  if ((undoRequested && event.shiftKey) || ctrlRedoRequested) actions.redo();
  else actions.undo();
}

export function createEditorHistoryShortcutHandler(
  getActions: () => EditorHistoryShortcutActions,
): (event: KeyboardEvent) => void {
  return (event) => handleEditorHistoryShortcutCapture(event, getActions());
}

/** Delete/Backspace for a pinned triangle. Returns true when the key was consumed. */
export function handlePinnedTriangleDeleteKey(
  event: KeyboardEvent,
  deletePinned: () => boolean,
): boolean {
  const key = event.key.toLowerCase();
  if (key !== 'delete' && key !== 'backspace') return false;
  if (deletePinned()) {
    event.preventDefault();
    event.stopPropagation();
  }
  return true;
}
