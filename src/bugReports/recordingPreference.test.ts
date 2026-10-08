import { afterEach, expect, it, vi } from 'vitest';
import { bugRecordingAllowed, setBugRecordingAllowed } from './recordingPreference';
function setup(blocked = false) {
  const values = new Map<string,string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => {
    if (blocked) throw new Error('Storage unavailable'); values.set(key, value);
  } });
  vi.stubGlobal('navigator', { doNotTrack: '0', globalPrivacyControl: false });
  vi.stubGlobal('window', new EventTarget());
  return values;
}
afterEach(() => { setup(); setBugRecordingAllowed(true); vi.unstubAllGlobals(); });
it('honors device opt-out and notifies the existing recorder', () => {
  const values = setup(), changed = vi.fn(); window.addEventListener('wamp-recording-preference-changed', changed);
  setBugRecordingAllowed(false); expect(bugRecordingAllowed()).toBe(false); expect(values.get('wamp_replay_opt_out')).toBe('1');
  expect(changed).toHaveBeenCalledOnce(); setBugRecordingAllowed(true); expect(bugRecordingAllowed()).toBe(true);
});
it('does not override Do Not Track or Global Privacy Control', () => {
  setup(); setBugRecordingAllowed(true); vi.stubGlobal('navigator', { doNotTrack: '1' }); expect(bugRecordingAllowed()).toBe(false);
  vi.stubGlobal('navigator', { doNotTrack: '0', globalPrivacyControl: true }); expect(bugRecordingAllowed()).toBe(false);
});
it('honors opt-out for this visit even if storage writes are blocked', () => {
  setup(true); setBugRecordingAllowed(false); expect(bugRecordingAllowed()).toBe(false);
  setBugRecordingAllowed(true); expect(bugRecordingAllowed()).toBe(true);
});
