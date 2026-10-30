export type AssistSpeed = 1 | 0.8 | 0.6;
export interface AssistSettings { speed: AssistSpeed; safeRespawn: boolean }
const KEY = 'wamp.settings.assist';
const listeners = new Set<(settings: AssistSettings) => void>();
let settings = readStored();
export function normalizeAssistSettings(value: Partial<AssistSettings> | null): AssistSettings {
  return { speed: value?.speed === 0.8 || value?.speed === 0.6 ? value.speed : 1, safeRespawn: value?.safeRespawn === true };
}
export function getAssistSettings(): AssistSettings { return { ...settings }; }
export function isAssistRequested(): boolean { return settings.speed !== 1 || settings.safeRespawn; }
export function getAssistSpeed(): AssistSpeed { return settings.speed; }
export function getSafeRespawnEnabled(): boolean { return settings.safeRespawn; }
export function subscribeAssistSettings(listener: (settings: AssistSettings) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function updateAssistSettings(next: Partial<AssistSettings>): void {
  const candidate = normalizeAssistSettings({ ...settings, ...next });
  if (candidate.speed === settings.speed && candidate.safeRespawn === settings.safeRespawn) return;
  settings = candidate;
  try { if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Session preferences still work. */ }
  for (const listener of listeners) listener(getAssistSettings());
}
function readStored(): AssistSettings {
  try { return normalizeAssistSettings(typeof window === 'undefined' ? null : JSON.parse(window.localStorage.getItem(KEY) || 'null')); }
  catch { return normalizeAssistSettings(null); }
}
