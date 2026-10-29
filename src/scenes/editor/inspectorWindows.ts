const STORAGE_KEY = 'wamp:inspector-option-windows';
export const INSPECTOR_WINDOWS_RESET_EVENT = 'wamp-inspector-windows-reset';

export interface InspectorWindowSource {
  visible: boolean;
  ballVisible: boolean;
  triangleVisible: boolean;
  npcVisible: boolean;
  swordsmanVisible: boolean;
  policeVisible: boolean;
  containerVisible: boolean;
  pressureVisible: boolean;
  bossVisible: boolean;
}

export function inspectorWindowLabel(
  state: InspectorWindowSource,
): { kind: string; title: string } | null {
  if (!state.visible) return null;
  if (state.ballVisible) return { kind: 'ball', title: 'Ball options' };
  if (state.triangleVisible) return { kind: 'triangle', title: 'Triangle options' };
  if (state.npcVisible) return { kind: 'npc', title: 'NPC options' };
  if (state.swordsmanVisible) return { kind: 'swordsman', title: 'Sword Hunter options' };
  if (state.policeVisible) return { kind: 'police', title: 'Police options' };
  if (state.containerVisible) return { kind: 'container', title: 'Container options' };
  if (state.pressureVisible) return { kind: 'pressure', title: 'Plate options' };
  if (state.bossVisible) return { kind: 'boss', title: 'Boss options' };
  return { kind: 'object', title: 'Object options' };
}

function readMinimized(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function isInspectorWindowMinimized(kind: string): boolean {
  return readMinimized()[kind] === true;
}

export function setInspectorWindowMinimized(kind: string, minimized: boolean): void {
  const next = readMinimized();
  if (minimized) next[kind] = true;
  else delete next[kind];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A private window can refuse storage. The open panel still toggles this visit.
  }
}

export function resetInspectorWindows(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as a failed write: the reset event still reopens the current panel.
  }
  window.dispatchEvent(new CustomEvent(INSPECTOR_WINDOWS_RESET_EVENT));
}
