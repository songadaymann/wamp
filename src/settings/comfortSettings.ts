export type ReduceMotionMode = 'system' | 'on' | 'off';
export type PlayCameraStyle = 'follow' | 'room';
export interface ComfortSettings { reduceMotion: ReduceMotionMode; cameraStyle: PlayCameraStyle; haptics: boolean; clearedRoomChecks: boolean }
const MOTION_KEY = 'wamp.settings.reduceMotion';
const CAMERA_KEY = 'wamp.settings.cameraStyle';
const CLEARED_CHECKS_KEY = 'wamp.settings.clearedRoomChecks';
const HAPTICS_KEY = 'wamp.settings.haptics';
const defaults: ComfortSettings = { reduceMotion: 'system', cameraStyle: 'follow', haptics: true, clearedRoomChecks: false };
const listeners = new Set<(settings: ComfortSettings) => void>();
let settings = readStored();

export function getComfortSettings(): ComfortSettings { return { ...settings }; }
// These scalar getters are used in the play loop without allocating a settings snapshot.
export function getReduceMotionMode(): ReduceMotionMode { return settings.reduceMotion; }
export function getPlayCameraStyle(): PlayCameraStyle { return settings.cameraStyle; }
export function getClearedRoomChecksEnabled(): boolean { return settings.clearedRoomChecks; }
export function getHapticsEnabled(): boolean { return settings.haptics; }
export function subscribeComfortSettings(listener: (settings: ComfortSettings) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function updateComfortSettings(next: Partial<ComfortSettings>): void {
  const candidate = normalize({ ...settings, ...next });
  if (candidate.reduceMotion === settings.reduceMotion && candidate.cameraStyle === settings.cameraStyle
    && candidate.haptics === settings.haptics && candidate.clearedRoomChecks === settings.clearedRoomChecks) return;
  settings = candidate;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MOTION_KEY, settings.reduceMotion);
      window.localStorage.setItem(CAMERA_KEY, settings.cameraStyle);
      window.localStorage.setItem(CLEARED_CHECKS_KEY, String(settings.clearedRoomChecks));
      window.localStorage.setItem(HAPTICS_KEY, String(settings.haptics));
    }
  } catch { /* Preferences still work when browser storage is unavailable. */ }
  for (const listener of listeners) listener(getComfortSettings());
}
function normalize(value: Partial<ComfortSettings>): ComfortSettings {
  return { reduceMotion: value.reduceMotion === 'on' || value.reduceMotion === 'off' ? value.reduceMotion : 'system',
    cameraStyle: value.cameraStyle === 'room' ? 'room' : 'follow',
    clearedRoomChecks: value.clearedRoomChecks === true,
    haptics: typeof value.haptics === 'boolean' ? value.haptics : defaults.haptics };
}
function readStored(): ComfortSettings {
  if (typeof window === 'undefined') return { ...defaults };
  try {
    return normalize({ reduceMotion: window.localStorage.getItem(MOTION_KEY) as ReduceMotionMode,
      cameraStyle: window.localStorage.getItem(CAMERA_KEY) as PlayCameraStyle,
      clearedRoomChecks: window.localStorage.getItem(CLEARED_CHECKS_KEY) === 'true',
      haptics: window.localStorage.getItem(HAPTICS_KEY) !== 'false' });
  } catch { return { ...defaults }; }
}
