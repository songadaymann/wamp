export type FrameRateMode = 'auto' | '60' | 'uncapped';
export const FRAME_RATE_MODE_STORAGE_KEY = 'wamp.frameRateMode.v1';
const listeners = new Set<(mode: FrameRateMode) => void>();

export function normalizeFrameRateMode(value: unknown): FrameRateMode {
  return value === '60' || value === 'uncapped' ? value : 'auto';
}
function readMode(): FrameRateMode {
  try {
    return normalizeFrameRateMode(typeof window === 'undefined' ? null : window.localStorage.getItem(FRAME_RATE_MODE_STORAGE_KEY));
  } catch { return 'auto'; }
}
let mode = readMode();
export function getFrameRateMode(): FrameRateMode { return mode; }
export function setFrameRateMode(value: unknown): FrameRateMode {
  const next = normalizeFrameRateMode(value);
  if (next === mode) return mode;
  mode = next;
  try { window.localStorage.setItem(FRAME_RATE_MODE_STORAGE_KEY, mode); } catch { /* Keep the session choice if storage is unavailable. */ }
  for (const listener of listeners) listener(mode);
  return mode;
}
export function subscribeFrameRateMode(listener: (mode: FrameRateMode) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
