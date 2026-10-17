import { AUTH_STATE_CHANGED_EVENT, getAuthDebugState, type AuthDebugState } from '../../auth/client';
import { isOpenableProfileUserId, requestProfileOpen } from './profileEvents';

/** Account destinations belong to the menu, independent of which game scene is running. */
export function setupGameMenu(beforeAction: () => void, doc: Document = document, win: Window = window): () => void {
  const menu = doc.getElementById('menu-body');
  const profile = doc.getElementById('btn-menu-profile');
  const rooms = doc.getElementById('btn-menu-my-rooms');
  const reason = doc.getElementById('auth-signin-reason');
  const options = doc.getElementById('account-signin-options') as HTMLDetailsElement | null;
  const status = doc.getElementById('auth-status');
  let shownStatus = '';
  let identity: string | null = null;
  let auth = getAuthDebugState();
  const render = () => {
    const hasProfile = auth.authenticated && isOpenableProfileUserId(auth.user?.id);
    profile?.classList.toggle('hidden', !hasProfile);
    rooms?.classList.toggle('hidden', !hasProfile);
    options?.classList.toggle('hidden', auth.schoolManaged);
    const nextIdentity = auth.authenticated ? auth.user?.id ?? 'account' : 'guest';
    if (identity !== nextIdentity && options) options.open = !auth.authenticated;
    identity = nextIdentity;
    const message = status && !status.classList.contains('hidden') ? status.textContent?.trim() ?? '' : '';
    if (message && message !== shownStatus && options && !auth.schoolManaged) options.open = true;
    shownStatus = message;
    reason?.classList.toggle('hidden', auth.loading || auth.authenticated);
  };
  const change = (event: Event) => {
    auth = (event as CustomEvent<AuthDebugState>).detail ?? getAuthDebugState();
    render();
  };
  const closeForAction = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('[data-menu-action]')) {
      doc.getElementById('auth-panel')?.classList.remove('menu-open');
      beforeAction();
    }
  };
  const openProfile = () => { if (auth.authenticated) requestProfileOpen(auth.user?.id); };
  const openRooms = () => { if (auth.authenticated) requestProfileOpen(auth.user?.id, 'rooms'); };
  menu?.addEventListener('click', closeForAction, { capture: true });
  profile?.addEventListener('click', openProfile);
  rooms?.addEventListener('click', openRooms);
  win.addEventListener(AUTH_STATE_CHANGED_EVENT, change);
  render();
  return () => {
    menu?.removeEventListener('click', closeForAction, { capture: true });
    profile?.removeEventListener('click', openProfile);
    rooms?.removeEventListener('click', openRooms);
    win.removeEventListener(AUTH_STATE_CHANGED_EVENT, change);
  };
}
