import { cloneEditorClipboardState, type EditorClipboardState } from './clipboard';

/** A saved clipboard ("My Stamps"), kept in this browser. */
export interface EditorStamp {
  id: string;
  name: string;
  createdAt: string;
  clipboard: EditorClipboardState;
}

const STAMP_STORAGE_KEY = 'wamp_editor_stamps_v1';
export const MAX_EDITOR_STAMPS = 24;
const MAX_STAMP_STORAGE_CHARS = 3_000_000;

export function describeStamp(clipboard: EditorClipboardState): string {
  const objects = clipboard.objects?.length ?? 0;
  const tiles = clipboard.occupiedMask.reduce((count, row) => count + row.filter(Boolean).length, 0);
  const parts = [`${clipboard.width}×${clipboard.height} ${clipboard.sourceLayer}`];
  if (tiles > 0) parts.push(`${tiles} tile${tiles === 1 ? '' : 's'}`);
  if (objects > 0) parts.push(`${objects} object${objects === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function listEditorStamps(storage: Storage | null = getStorage()): EditorStamp[] {
  try {
    const raw = storage?.getItem(STAMP_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((stamp): stamp is EditorStamp => Boolean(stamp?.id && stamp?.clipboard?.width && stamp?.clipboard?.tiles))
      : [];
  } catch {
    return [];
  }
}

/** Newest first. Returns null with a reason when the stamp cannot be kept. */
export function saveEditorStamp(
  clipboard: EditorClipboardState,
  storage: Storage | null = getStorage(),
  now = new Date(),
): { stamp: EditorStamp; error: null } | { stamp: null; error: string } {
  if (!storage) return { stamp: null, error: 'Stamps need browser storage, which is unavailable here.' };
  const stamps = listEditorStamps(storage);
  if (stamps.length >= MAX_EDITOR_STAMPS) {
    return { stamp: null, error: `You can keep up to ${MAX_EDITOR_STAMPS} stamps. Delete one to save another.` };
  }
  const stamp: EditorStamp = {
    id: `stamp_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: describeStamp(clipboard),
    createdAt: now.toISOString(),
    clipboard: cloneEditorClipboardState(clipboard)!,
  };
  const json = JSON.stringify([stamp, ...stamps]);
  if (json.length > MAX_STAMP_STORAGE_CHARS) {
    return { stamp: null, error: 'That stamp is too large to save. Delete a stamp or copy a smaller area.' };
  }
  try {
    storage.setItem(STAMP_STORAGE_KEY, json);
  } catch {
    return { stamp: null, error: 'Browser storage is full. Delete a stamp to save another.' };
  }
  return { stamp, error: null };
}

export function deleteEditorStamp(id: string, storage: Storage | null = getStorage()): void {
  try {
    storage?.setItem(STAMP_STORAGE_KEY, JSON.stringify(listEditorStamps(storage).filter((stamp) => stamp.id !== id)));
  } catch {
    // Leave the list as it was.
  }
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
