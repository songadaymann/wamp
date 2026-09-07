export const EDITOR_UI_STATE_CHANGED_EVENT = 'editor-ui-state-changed';
export const EDITOR_SPAWN_PLACED_EVENT = 'editor-spawn-placed';
export const EDITOR_SHELL_ESCAPE_REQUESTED_EVENT = 'editor-shell-escape-requested';

export interface EditorShellEscapeRequestedDetail {
  handled: boolean;
}
