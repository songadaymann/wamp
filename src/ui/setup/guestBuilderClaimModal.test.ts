import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ authenticated: false }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => auth, promptForSignIn: vi.fn() }));
vi.mock('../../guestRooms/client', () => ({ submitLatestGuestRoomDraftForRoom: vi.fn() }));
import { promptForSignIn } from '../../auth/client';
import { requestGuestBuilderClaim } from '../../progression/guestBuilderClaimEvents';
import { GuestBuilderActivityTracker } from '../../scenes/editor/guestBuilderActivityTracker';
import { GuestBuilderClaimModalController } from './guestBuilderClaimModal';

class Element extends EventTarget {
  private readonly classes = new Set(['hidden']);
  readonly classList = {
    add: (value: string) => this.classes.add(value),
    remove: (value: string) => this.classes.delete(value),
    contains: (value: string) => this.classes.has(value),
    toggle: (value: string, force: boolean) => force ? this.classes.add(value) : this.classes.delete(value),
  };
  readonly attributes = new Map<string, string>();
  textContent = '';
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
}
const controllers: GuestBuilderClaimModalController[] = [];
function fixture() {
  const ids = ['guest-builder-claim-modal', 'btn-guest-builder-claim-close', 'btn-guest-builder-claim-continue',
    'btn-guest-builder-claim-submit-guest', 'btn-guest-builder-claim-signin', 'guest-builder-claim-title',
    'guest-builder-claim-meta', 'guest-builder-claim-xp', 'guest-builder-claim-copy'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const doc = Object.assign(new EventTarget(), { getElementById: (id: string) => elements.get(id) ?? null });
  const win = new EventTarget();
  // A disabled browser-storage API must not prevent player-chosen sign-in.
  Object.defineProperty(win, 'localStorage', { get: () => { throw new Error('Storage unavailable'); } });
  vi.stubGlobal('window', win);
  const controller = new GuestBuilderClaimModalController(doc as unknown as Document);
  controllers.push(controller); controller.init();
  const request = (source: 'auto-save' | 'manual-save' | 'publish-attempt' | 'build-threshold') => requestGuestBuilderClaim({
    roomId: '5,7', roomCoordinates: { x: 5, y: 7 }, roomTitle: 'A guest draft', source, buildActivityCount: 41,
  });
  return { controller, elements, doc, win, request,
    click: (id: string) => elements.get(id)!.dispatchEvent(new Event('click')) };
}
beforeEach(() => { auth.authenticated = false; vi.clearAllMocks(); });
afterEach(() => { for (const controller of controllers.splice(0)) controller.destroy(); vi.unstubAllGlobals(); });

describe('player-chosen guest builder sign-in', () => {
  it('keeps the editor unobstructed when one stroke reaches the threshold, including a second room', () => {
    const f = fixture(); const requested = vi.fn(); f.win.addEventListener('guest-builder-claim-request', requested);
    let roomId = '5,7';
    const tracker = new GuestBuilderActivityTracker({ getRoomId: () => roomId,
      getRoomCoordinates: () => ({ x: 5, y: 7 }), getRoomTitle: () => null });
    tracker.recordPlacedBuildContent(41); expect(requested).toHaveBeenCalledTimes(1); expect(f.controller.isOpen()).toBe(false);
    tracker.recordPlacedBuildContent(100); expect(f.controller.isOpen()).toBe(false);
    roomId = '6,7'; tracker.reset(); tracker.recordPlacedBuildContent(41);
    expect(requested).toHaveBeenCalledTimes(2); expect(f.controller.isOpen()).toBe(false);
    expect(promptForSignIn).not.toHaveBeenCalled();
  });
  it('ignores automatic save requests without preventing a later explicit Save', () => {
    const f = fixture(); f.request('auto-save'); f.request('build-threshold');
    expect(f.controller.isOpen()).toBe(false); expect(promptForSignIn).not.toHaveBeenCalled();
    f.request('manual-save'); expect(f.controller.isOpen()).toBe(true);
    expect(f.elements.get('btn-guest-builder-claim-submit-guest')!.classList.contains('hidden')).toBe(true);
  });
  it('allows repeated explicit Save and opens sign-in only after choosing its button', () => {
    const f = fixture(); f.request('manual-save'); f.click('btn-guest-builder-claim-continue');
    expect(f.controller.isOpen()).toBe(false); expect(promptForSignIn).not.toHaveBeenCalled();
    f.request('manual-save'); expect(f.controller.isOpen()).toBe(true);
    f.click('btn-guest-builder-claim-signin'); expect(f.controller.isOpen()).toBe(false);
    expect(promptForSignIn).toHaveBeenCalledWith('Sign in to save this room to your account and earn Builder XP when you publish.');
  });
  it('keeps the Guest Rooms choice available only on an explicit Publish attempt', () => {
    const f = fixture(); f.request('publish-attempt'); expect(f.controller.isOpen()).toBe(true);
    expect(f.elements.get('btn-guest-builder-claim-submit-guest')!.classList.contains('hidden')).toBe(false);
    expect(f.elements.get('guest-builder-claim-copy')!.textContent).toContain('without XP or account benefits');
    f.click('btn-guest-builder-claim-close'); f.request('manual-save');
    expect(f.elements.get('btn-guest-builder-claim-submit-guest')!.classList.contains('hidden')).toBe(true);
  });
  it('ignores requests for signed-in builders and removes its listener on destroy', () => {
    const f = fixture(); auth.authenticated = true; f.request('manual-save'); f.request('publish-attempt');
    expect(f.controller.isOpen()).toBe(false); auth.authenticated = false;
    f.controller.destroy(); f.request('manual-save'); expect(f.controller.isOpen()).toBe(false);
  });
});
