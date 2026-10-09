import { AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, getAuthDebugState } from '../../auth/client';
import { getLostSongService } from '../../lostSongs/service';
import { PROFILE_INVALIDATED_EVENT } from './profileEvents';

export function setupLostSongProgress(): () => void {
  const service = getLostSongService(), counter = document.getElementById('world-lost-songs');
  let invalidatedKey = '';
  const sync = () => { void service.setUser(getAuthDebugState().user?.id ?? null); };
  const render = () => {
    const state = service.snapshot();
    if (counter) {
      counter.textContent = 'Songs ' + state.total;
      counter.title = state.status || (state.guest ? 'Lost Songs found on this device. Sign in to keep them.' : 'Lost Songs found across the world.');
      counter.classList.toggle('hidden', state.total === 0 && !state.status);
    }
    const userId = getAuthDebugState().user?.id;
    const key = userId + ':' + state.total;
    if (userId && state.total > 0 && !state.pending && invalidatedKey !== key) {
      invalidatedKey = key;
      window.dispatchEvent(new CustomEvent(PROFILE_INVALIDATED_EVENT, { detail: { userId } }));
    }
  };
  const unsubscribe = service.subscribe(render);
  window.addEventListener(AUTH_STATE_CHANGED_EVENT, sync);
  window.addEventListener(AUTH_SESSION_REFRESHED_EVENT, sync);
  window.addEventListener('focus', sync);
  render(); sync();
  return () => {
    unsubscribe(); window.removeEventListener(AUTH_STATE_CHANGED_EVENT, sync);
    window.removeEventListener(AUTH_SESSION_REFRESHED_EVENT, sync); window.removeEventListener('focus', sync);
  };
}
