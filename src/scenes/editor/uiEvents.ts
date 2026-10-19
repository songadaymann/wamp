import { editorState, subscribeEditorState } from '../../config/editorState';
import type { EditorStateKey } from '../../config/editorStateStore';

const EDITOR_UI_REFRESH_EVENT = 'editor-ui-refresh';
// Zoom labels already update with the camera; palette surfaces need every other setting.
export const EDITOR_CONTROL_STATE_KEYS: readonly EditorStateKey[] = Object.freeze(
  (Object.keys(editorState) as EditorStateKey[]).filter(key => key !== 'zoom'),
);
export const EDITOR_SPAWN_PLACED_EVENT = 'editor-spawn-placed';
export const EDITOR_SHELL_ESCAPE_REQUESTED_EVENT = 'editor-shell-escape-requested';
export const EDITOR_AUTO_COLLAPSE_EVENT = 'mobile-editor-auto-collapse';

export interface EditorUiRefreshDetail { objectCategory?: string }
export interface EditorShellEscapeRequestedDetail { handled: boolean }

declare global {
  interface WindowEventMap {
    'editor-ui-refresh': CustomEvent<EditorUiRefreshDetail>;
    'editor-spawn-placed': Event;
    'editor-shell-escape-requested': CustomEvent<EditorShellEscapeRequestedDetail>;
    'mobile-editor-auto-collapse': Event;
  }
}

/** Explicit invalidation for UI-only changes, separate from automatic state notifications. */
export function refreshEditorUi(target: Window | null, detail: EditorUiRefreshDetail = {}): void {
  target?.dispatchEvent(new CustomEvent(EDITOR_UI_REFRESH_EVENT, { detail }));
}

/** Each registration owns both subscriptions and must be disposed with its owner. */
export function subscribeEditorUi(
  target: Window,
  listener: (detail: EditorUiRefreshDetail) => void,
  keys?: readonly EditorStateKey[],
): () => void {
  const stop = subscribeEditorState(change => {
    if (!keys || change.keys.some(key => keys.includes(key))) listener({});
  });
  const onRefresh = (event: CustomEvent<EditorUiRefreshDetail>) => listener(event.detail);
  target.addEventListener(EDITOR_UI_REFRESH_EVENT, onRefresh);
  return () => { stop(); target.removeEventListener(EDITOR_UI_REFRESH_EVENT, onRefresh); };
}

export function requestEditorShellEscape(target: Window, detail: EditorShellEscapeRequestedDetail): void {
  target.dispatchEvent(new CustomEvent(EDITOR_SHELL_ESCAPE_REQUESTED_EVENT, { detail }));
}
