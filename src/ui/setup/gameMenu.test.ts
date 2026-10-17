import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupGameMenu } from './gameMenu';
import { PROFILE_OPEN_REQUEST_EVENT } from './profileEvents';
const state = vi.hoisted(() => ({ current: { loading: false, authenticated: false, user: null as { id: string } | null, schoolManaged: undefined as boolean | undefined } }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth-state-changed', getAuthDebugState: () => state.current }));
class Item extends EventTarget {
  classes = new Set<string>(); action = false; open = false; textContent = '';
  classList = { contains: (c: string) => this.classes.has(c), toggle: (c: string, enabled: boolean) => enabled ? this.classes.add(c) : this.classes.delete(c), remove: (c: string) => this.classes.delete(c) };
  closest() { return this.action ? this : null; }
  click() { this.dispatchEvent(new Event('click')); }
}
function fixture() {
  const ids = ['menu-body', 'btn-menu-profile', 'btn-menu-my-rooms', 'auth-signin-reason', 'auth-panel', 'account-signin-options', 'auth-status'];
  const items = new Map(ids.map(id => [id, new Item()]));
  const win = new EventTarget(), before = vi.fn(), opened = vi.fn();
  vi.stubGlobal('Element', Item); vi.stubGlobal('window', win);
  win.addEventListener(PROFILE_OPEN_REQUEST_EVENT, e => opened((e as CustomEvent).detail));
  const dispose = setupGameMenu(before, { getElementById: (id: string) => items.get(id) } as never, win as Window);
  const item = (id: string) => items.get(id)!;
  return { item, before, opened, dispose, update: () => win.dispatchEvent(new Event('auth-state-changed')) };
}
beforeEach(() => { state.current = { loading: false, authenticated: false, user: null, schoolManaged: undefined }; });
afterEach(() => vi.unstubAllGlobals());
describe('account menu navigation', () => {
  it('offers a sign-in reason to guests without sending them to an account profile', () => {
    const f = fixture(); expect(f.item('btn-menu-profile').classes.has('hidden')).toBe(true);
    expect(f.item('btn-menu-my-rooms').classes.has('hidden')).toBe(true);
    expect(f.item('auth-signin-reason').classes.has('hidden')).toBe(false);
    f.item('btn-menu-profile').click(); f.item('btn-menu-my-rooms').click(); expect(f.opened).not.toHaveBeenCalled();
  });
  it('does not flash sign-in copy during session loading', () => {
    state.current.loading = true; const f = fixture(); expect(f.item('auth-signin-reason').classes.has('hidden')).toBe(true);
  });
  it('opens Profile normally and explicitly selects rooms for My Rooms, using the latest account', () => {
    const f = fixture(); state.current = { loading: false, authenticated: true, user: { id: 'alice' }, schoolManaged: undefined }; f.update();
    expect(f.item('btn-menu-profile').classes.has('hidden')).toBe(false);
    expect(f.item('auth-signin-reason').classes.has('hidden')).toBe(true);
    f.item('btn-menu-profile').click(); expect(f.opened).toHaveBeenLastCalledWith({ userId: 'alice' });
    state.current.user = { id: 'bob' }; f.update(); f.item('btn-menu-my-rooms').click();
    expect(f.opened).toHaveBeenLastCalledWith({ userId: 'bob', tab: 'rooms' });
  });
  it('stops routing to a stale account after logout', () => {
    state.current = { loading: false, authenticated: true, user: { id: 'alice' }, schoolManaged: undefined }; const f = fixture();
    state.current = { loading: false, authenticated: false, user: null, schoolManaged: undefined }; f.update();
    f.item('btn-menu-my-rooms').click(); expect(f.opened).not.toHaveBeenCalled();
    expect(f.item('btn-menu-profile').classes.has('hidden')).toBe(true);
  });
  it('does not invent public profiles for guest identifiers', () => {
    state.current = { loading: false, authenticated: true, user: { id: 'guest-local' }, schoolManaged: undefined }; const f = fixture();
    expect(f.item('btn-menu-profile').classes.has('hidden')).toBe(true);
    f.item('btn-menu-my-rooms').click(); expect(f.opened).not.toHaveBeenCalled();
  });
  it('closes the drawer for destinations while keeping sign-in and name forms open', () => {
    const f = fixture(), menu = f.item('menu-body'), panel = f.item('auth-panel'), input = new Item();
    panel.classes.add('menu-open'); const typing = new Event('click'); Object.defineProperty(typing, 'target', { value: input }); menu.dispatchEvent(typing);
    expect(panel.classes.has('menu-open')).toBe(true); expect(f.before).not.toHaveBeenCalled();
    input.action = true; const action = new Event('click'); Object.defineProperty(action, 'target', { value: input }); menu.dispatchEvent(action);
    expect(panel.classes.has('menu-open')).toBe(false); expect(f.before).toHaveBeenCalledOnce();
  });
  it('keeps guest sign-in open and preserves an expanded account linking form across same-account updates', () => {
    const f = fixture(); expect(f.item('account-signin-options').open).toBe(true);
    state.current = { loading: false, authenticated: true, user: { id: 'alice' }, schoolManaged: undefined }; f.update();
    expect(f.item('account-signin-options').open).toBe(false); f.item('account-signin-options').open = true;
    state.current.loading = true; f.update(); expect(f.item('account-signin-options').open).toBe(true);
    state.current.authenticated = false; f.update(); expect(f.item('account-signin-options').open).toBe(true);
  });
  it('keeps managed account linking hidden while retaining the existing profile destination', () => {
    state.current = { loading: false, authenticated: true, user: { id: 'alice' }, schoolManaged: true }; const f = fixture();
    expect(f.item('account-signin-options').classes.has('hidden')).toBe(true);
    expect(f.item('btn-menu-profile').classes.has('hidden')).toBe(false);
  });
  it('reveals a requested sign-in/linking status without reopening a manually closed unchanged message', () => {
    state.current = { loading: false, authenticated: true, user: { id: 'alice' }, schoolManaged: undefined }; const f = fixture();
    expect(f.item('account-signin-options').open).toBe(false); f.item('auth-status').textContent = 'Link an email to continue.'; f.update();
    expect(f.item('account-signin-options').open).toBe(true); f.item('account-signin-options').open = false; f.update();
    expect(f.item('account-signin-options').open).toBe(false);
    f.item('auth-status').textContent = 'The email link could not be sent.'; f.update(); expect(f.item('account-signin-options').open).toBe(true);
  });
  it('removes routing and account listeners on disposal', () => {
    state.current = { loading: false, authenticated: true, user: { id: 'alice' }, schoolManaged: undefined }; const f = fixture(); f.dispose();
    f.item('btn-menu-profile').click(); expect(f.opened).not.toHaveBeenCalled();
    state.current.authenticated = false; f.update(); expect(f.item('btn-menu-profile').classes.has('hidden')).toBe(false);
  });
});
