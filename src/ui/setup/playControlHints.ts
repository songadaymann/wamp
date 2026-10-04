import { getDeviceLayoutState } from '../deviceLayout';

const PLAY_CONTROLS_SEEN_PREFIX = 'wamp:play-controls-seen:v1:';
const seenInDocument = new WeakMap<Document, Set<string>>();

function inputMode(): 'touch' | 'keyboard' {
  return getDeviceLayoutState().touchPrimary ? 'touch' : 'keyboard';
}

export function getPlayControlsStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasSeenPlayControls(storage: Storage | null, doc: Document): boolean {
  const mode = inputMode();
  if (seenInDocument.get(doc)?.has(mode)) return true;
  try {
    return storage?.getItem(`${PLAY_CONTROLS_SEEN_PREFIX}${mode}`) === '1';
  } catch {
    return false;
  }
}

export function markPlayControlsSeen(storage: Storage | null, doc: Document): void {
  const mode = inputMode();
  const seen = seenInDocument.get(doc) ?? new Set<string>();
  seen.add(mode);
  seenInDocument.set(doc, seen);
  try {
    storage?.setItem(`${PLAY_CONTROLS_SEEN_PREFIX}${mode}`, '1');
  } catch {
    // Acknowledgement still lasts for this document when storage is unavailable.
  }
}

export function renderPlayControlHints(element: HTMLElement | null, doc: Document): void {
  if (!element) return;
  const mode = inputMode();
  const hints = mode === 'touch'
    ? [['Left stick', 'Move'], ['Jump', 'Jump'], ['Sword', 'Slash'], ['Shoot', 'Shoot']]
    : [['A D / ← →', 'Move'], ['Space / W / ↑', 'Jump'], ['Q', 'Slash'], ['E', 'Shoot']];
  element.dataset.playControlsInput = mode;
  element.replaceChildren(...hints.map(([input, action]) => {
    const row = doc.createElement('div');
    row.className = 'play-intro-control';
    const key = doc.createElement('kbd');
    key.className = 'play-intro-key';
    key.textContent = input;
    const label = doc.createElement('span');
    label.textContent = action;
    row.append(key, label);
    return row;
  }));
}
