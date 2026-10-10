import type { EditorClipboardState } from './clipboard';

const CLIPBOARD_STORAGE_KEY = 'wamp_editor_clipboard_v1';
/** Keep a runaway selection (e.g. large custom sprite art) from filling localStorage. */
const MAX_STORED_CLIPBOARD_CHARS = 1_500_000;

function isClipboardState(value: unknown): value is EditorClipboardState {
  const state = value as EditorClipboardState | null;
  return Boolean(state)
    && (state!.sourceLayer === 'background' || state!.sourceLayer === 'terrain' || state!.sourceLayer === 'foreground')
    && Number.isInteger(state!.width) && state!.width > 0
    && Number.isInteger(state!.height) && state!.height > 0
    && Array.isArray(state!.tiles) && state!.tiles.length === state!.height
    && Array.isArray(state!.occupiedMask) && state!.occupiedMask.length === state!.height
    && (state!.objects === undefined || Array.isArray(state!.objects));
}

/** The copy clipboard outlives a room switch and works across the room and Expanded editors. */
export function saveEditorClipboard(state: EditorClipboardState | null, storage: Storage | null = getStorage()): void {
  try {
    if (!storage) return;
    if (!state) {
      storage.removeItem(CLIPBOARD_STORAGE_KEY);
      return;
    }
    const json = JSON.stringify(state);
    if (json.length <= MAX_STORED_CLIPBOARD_CHARS) storage.setItem(CLIPBOARD_STORAGE_KEY, json);
  } catch {
    // Private mode or a full quota: the clipboard still works in this room.
  }
}

export function loadEditorClipboard(storage: Storage | null = getStorage()): EditorClipboardState | null {
  try {
    const raw = storage?.getItem(CLIPBOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isClipboardState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
