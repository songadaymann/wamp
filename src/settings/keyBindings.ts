export const KEYBOARD_ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'slash', 'shoot', 'camera', 'restart', 'stop'] as const;
export type KeyboardAction = typeof KEYBOARD_ACTIONS[number];
export type KeyBindings = Record<KeyboardAction, string[]>;
export const KEYBOARD_ACTION_LABELS: Record<KeyboardAction, string> = {
  left: 'Move left', right: 'Move right', up: 'Up / climb / jump', down: 'Down / crouch',
  jump: 'Jump', slash: 'Slash', shoot: 'Shoot', camera: 'Follow camera', restart: 'Restart run', stop: 'Return to browse',
};
const DEFAULTS: KeyBindings = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ'], slash: ['KeyQ', 'KeyX'], shoot: ['KeyE'], camera: ['Digit9'], restart: ['KeyR'], stop: ['KeyP'],
};
const STORAGE_KEY = 'wamp.settings.keyboard';
const listeners = new Set<() => void>();
let bindings = readStored();
let layoutLabels = new Map<string, string>();

/** Physical positions keep movement usable on AZERTY and other layouts. T/C open chat/comments; 0 fits the map. */
export function isBindableCode(code: unknown): code is string {
  return typeof code === 'string' && /^(Key[A-Z]|Digit[1-9]|Arrow(?:Left|Right|Up|Down)|Space|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Backquote|Numpad[0-9]|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide|NumpadDecimal)$/.test(code) && code !== 'KeyT' && code !== 'KeyC';
}
export function defaultKeyBindings(): KeyBindings { return Object.fromEntries(KEYBOARD_ACTIONS.map(a => [a, [...DEFAULTS[a]]])) as KeyBindings; }
export function normalizeKeyBindings(value: unknown): KeyBindings {
  const result = defaultKeyBindings();
  if (!value || typeof value !== 'object') return result;
  // A stored map is accepted atomically: corrupt/conflicting preferences cannot disable controls.
  const used = new Set<string>();
  for (const action of KEYBOARD_ACTIONS) {
    const codes: unknown = (value as Record<string, unknown>)[action];
    if (!Array.isArray(codes) || codes.length === 0 || codes.length > 4 || codes.some(code => !isBindableCode(code) || used.has(code))) return defaultKeyBindings();
    result[action] = [...new Set(codes as string[])];
    for (const code of result[action]) used.add(code);
  }
  return result;
}
export function getKeyBindings(): KeyBindings { return Object.fromEntries(KEYBOARD_ACTIONS.map(a => [a, [...bindings[a]]])) as KeyBindings; }
export function matchesKeyboardAction(action: KeyboardAction, event: Pick<KeyboardEvent, 'code'>): boolean { return bindings[action].includes(event.code); }
export function keyBindingConflict(action: KeyboardAction, code: string): KeyboardAction | undefined {
  return KEYBOARD_ACTIONS.find(other => other !== action && bindings[other].includes(code));
}
export function changeKeyBinding(action: KeyboardAction, code: string): boolean {
  if (!isBindableCode(code) || keyBindingConflict(action, code)) return false;
  bindings = { ...bindings, [action]: [code] }; save(); return true;
}
export function resetKeyBindings(): void { bindings = defaultKeyBindings(); save(); }
export function subscribeKeyBindings(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function keyboardCodeLabel(code: string): string {
  const fixed: Record<string, string> = { Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`' };
  return fixed[code] ?? layoutLabels.get(code)?.toUpperCase() ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
}
export function keyboardActionLabel(action: KeyboardAction): string { return bindings[action].map(keyboardCodeLabel).join(' / '); }
/** Optional browser capability; fixed physical-position labels remain available when denied/unsupported. */
export async function refreshKeyboardLayout(): Promise<void> {
  try {
    const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
    if (keyboard) layoutLabels = await keyboard.getLayoutMap();
  } catch { /* Mapping still uses event.code. */ }
}
function save(): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch { /* Session settings still work. */ }
  for (const listener of listeners) listener();
}
function readStored(): KeyBindings {
  try { return normalizeKeyBindings(typeof window === 'undefined' ? null : JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')); }
  catch { return defaultKeyBindings(); }
}

if (typeof navigator !== 'undefined') void refreshKeyboardLayout();
