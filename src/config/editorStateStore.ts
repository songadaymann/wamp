import type { EditorState } from './editorState';
import type { TileSelection } from './room';

export type EditorStateKey = keyof EditorState;
export type EditorStateView = Omit<Readonly<EditorState>, 'selection' | 'layerVisibility'> & {
  readonly layerVisibility: Readonly<EditorState['layerVisibility']>;
  readonly selection: Readonly<Omit<TileSelection, 'occupiedMask' | 'patternOrder'>> & {
    readonly occupiedMask: readonly (readonly boolean[])[];
    readonly patternOrder?: readonly Readonly<{ col: number; row: number }>[];
  };
};
export interface EditorStateChange {
  readonly keys: readonly EditorStateKey[];
  readonly revision: number;
  /** Live read-only view. Read values when handling the notification. */
  readonly state: EditorStateView;
}

function sameSelection(a: EditorStateView['selection'], b: EditorStateView['selection']): boolean {
  return a === b || (a.tilesetKey === b.tilesetKey && a.startCol === b.startCol
    && a.startRow === b.startRow && a.width === b.width && a.height === b.height
    && a.occupiedMask.length === b.occupiedMask.length
    && a.occupiedMask.every((row, y) => row.length === b.occupiedMask[y].length
      && row.every((value, x) => value === b.occupiedMask[y][x]))
    && a.patternOrder?.length === b.patternOrder?.length
    && (a.patternOrder?.every((cell, i) => cell.col === b.patternOrder?.[i].col
      && cell.row === b.patternOrder?.[i].row) ?? true));
}

function ownSelection(selection: TileSelection): TileSelection {
  const copy = {
    ...selection,
    occupiedMask: selection.occupiedMask.map(row => Object.freeze([...row])),
    ...(selection.patternOrder ? { patternOrder: selection.patternOrder.map(cell => Object.freeze({ ...cell })) } : {}),
  };
  Object.freeze(copy.occupiedMask);
  if (copy.patternOrder) Object.freeze(copy.patternOrder);
  // The stored value is also frozen at runtime, including its nested cells.
  return Object.freeze(copy);
}

/** Synchronous writes; one automatic notification after the current command finishes. */
export function createEditorStateStore(initial: EditorState) {
  const values: EditorState = {
    ...initial,
    selection: ownSelection(initial.selection),
    layerVisibility: Object.freeze({ ...initial.layerVisibility }),
  };
  const keys = Object.keys(values) as EditorStateKey[];
  const state = Object.freeze(Object.defineProperties({}, Object.fromEntries(keys.map(key => [key, {
    enumerable: true, get: () => values[key],
  }])))) as EditorStateView;
  const listeners = new Set<(change: EditorStateChange) => void>();
  let pending = new Set<EditorStateKey>();
  let revision = 0;
  let scheduled = false;
  function notify(): void {
    scheduled = false;
    const changedKeys = Object.freeze([...pending]);
    pending = new Set();
    const change: EditorStateChange = Object.freeze({ keys: changedKeys, revision, state });
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(change); }
      catch (error) { console.error('Editor state subscriber failed.', error); }
    }
  }
  function setValue<K extends EditorStateKey>(key: K, value: EditorState[K]): void {
    values[key] = value;
    pending.add(key);
  }
  function update(patch: Partial<EditorState>): void {
    let changed = false;
    const patchKeys = Object.keys(patch) as EditorStateKey[];
    for (const key of patchKeys) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) throw new Error(`Unknown editor state field: ${key}`);
    }
    for (const key of patchKeys) {
      if (patch[key] === undefined) continue;
      if (key === 'selection') {
        const next = patch.selection;
        if (!next || sameSelection(values.selection, next)) continue;
        setValue(key, ownSelection(next));
      } else if (key === 'layerVisibility') {
        const next = patch.layerVisibility;
        if (!next || (['background', 'terrain', 'foreground'] as const).every(layer => values.layerVisibility[layer] === next[layer])) continue;
        setValue(key, Object.freeze({ ...next }));
      } else {
        const next = patch[key];
        if (Object.is(values[key], next)) continue;
        setValue(key, next as EditorState[typeof key]);
      }
      changed = true;
    }
    if (!changed) return;
    revision++;
    if (!scheduled) { scheduled = true; queueMicrotask(notify); }
  }
  function subscribe(listener: (change: EditorStateChange) => void): () => void {
    // Each registration owns its lifetime, even if the same callback is registered twice.
    const registered = (change: EditorStateChange) => listener(change);
    listeners.add(registered);
    return () => { listeners.delete(registered); };
  }
  return { state, update, subscribe };
}
