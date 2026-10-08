import { BUG_RECORDING_CHANGED } from './model';
let volatilePreference: boolean | null = null;
export function bugRecordingAllowed(): boolean {
  if (volatilePreference === false) return false;
  try { if (localStorage.getItem('wamp_replay_opt_out') === '1') return false; } catch { /* Volatile device. */ }
  return navigator.doNotTrack !== '1' && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
}
export function setBugRecordingAllowed(allowed: boolean): void {
  try { localStorage.setItem('wamp_replay_opt_out', allowed ? '0' : '1'); volatilePreference = null; }
  catch { volatilePreference = allowed; }
  window.dispatchEvent(new CustomEvent(BUG_RECORDING_CHANGED, { detail: allowed }));
}
