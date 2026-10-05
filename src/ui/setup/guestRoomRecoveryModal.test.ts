import type Phaser from 'phaser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth-changed', AUTH_SESSION_REFRESHED_EVENT: 'session-refreshed', promptForSignIn: vi.fn() }));
vi.mock('../../guestRooms/client', () => ({ submitGuestRoomDraft: vi.fn() }));
vi.mock('../../guestRooms/draftRecoveryService', () => ({ GuestDraftRecoveryService: class {}, guestDraftAccountId: () => null }));
vi.mock('../../mint/roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn() }));
vi.mock('./profileEvents', () => ({ requestProfileInvalidation: vi.fn() }));
import { createDefaultRoomRecord } from '../../persistence/roomRepository';
import type { GuestDraftRecoveryItem } from '../../guestRooms/draftRecoveryService';
import { GuestRoomRecoveryModalController, GUEST_DRAFT_SNOOZE_PREFIX, PENDING_SIGN_IN_DRAFT_KEY } from './guestRoomRecoveryModal';

class Element extends EventTarget {
  readonly classes = new Set(['hidden']);
  readonly classList = { add: (...v: string[]) => v.forEach(s => this.classes.add(s)), remove: (...v: string[]) => v.forEach(s => this.classes.delete(s)),
    contains: (s: string) => this.classes.has(s), toggle: (s: string, force: boolean) => force ? this.classes.add(s) : this.classes.delete(s) };
  readonly attributes = new Map<string, string>(); readonly children: Element[] = [];
  textContent = ''; className = ''; value = ''; src = ''; alt = ''; type = '';
  setAttribute(k: string, v: string) { this.attributes.set(k, v); } getAttribute(k: string) { return this.attributes.get(k) ?? null; }
  toggleAttribute(k: string, value: boolean) { if (value) this.attributes.set(k, ''); else this.attributes.delete(k); }
  appendChild(child: Element) { this.children.push(child); return child; } querySelector() { return null; }
}
const room = createDefaultRoomRecord('1,0', { x: 1, y: 0 }); room.draft.title = 'Guest terrain'; room.claimerUserId = 'account';
const guest = (): GuestDraftRecoveryItem => ({ draft: { id: 'draft-id', guestUserId: 'guest-test', guestDisplayName: 'Guest', roomId: '1,0', roomX: 1, roomY: 0,
  title: 'Guest terrain', status: 'active', createdAt: room.draft.createdAt, updatedAt: room.draft.updatedAt, submittedAt: null, moderationStatus: 'private', snapshot: room.draft }, transfer: null, error: null });
const claimed = (): GuestDraftRecoveryItem => ({ ...guest(), transfer: { outcome: 'claimed', userId: 'account', draftId: 'draft-id', roomId: '1,0', claimedAt: 'claim-time', room } });
function fixture(storage = new Map<string, string>()) {
  const ids = ['guest-room-recovery-modal', 'guest-room-recovery-title', 'guest-room-recovery-meta', 'guest-room-recovery-copy', 'guest-room-recovery-status',
    'guest-room-recovery-preview', 'guest-room-recovery-preview-fallback', 'guest-room-recovery-benefits', 'guest-room-recovery-drafts', 'guest-room-recovery-drafts-label',
    'guest-room-recovery-locations', 'btn-guest-room-recovery-signin', 'btn-guest-room-recovery-submit', 'btn-guest-room-recovery-go', 'btn-guest-room-recovery-close',
    'btn-auth-guest-drafts', 'auth-panel', 'busy-overlay', 'reward-sting-layer', 'xp-receipt-layer', 'other-modal'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const doc = Object.assign(new EventTarget(), { body: { dataset: { appMode: 'world', appReady: 'true' } }, visibilityState: 'visible', hasFocus: () => true,
    getElementById: (id: string) => elements.get(id) ?? null, createElement: () => new Element(),
    querySelectorAll: (selector: string) => selector.includes('locations') ? elements.get('guest-room-recovery-locations')!.children
      : [elements.get('guest-room-recovery-modal')!, elements.get('other-modal')!] });
  const memory = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout, localStorage: memory, sessionStorage: memory });
  let account: string | null = null; let items = [guest()];
  const service = { sync: vi.fn(async () => ({ userId: account, items })), transfer: vi.fn(async () => claimed().transfer!) };
  const open = vi.fn(async () => true); const preview = vi.fn(async () => 'data:image/png;base64,AA==');
  const controller = new GuestRoomRecoveryModalController({} as Phaser.Game, doc as unknown as Document, win as unknown as Window,
    { service, account: () => account, openEditor: open, preview }); controller.init();
  return { controller, elements, doc, win, storage, service, open, preview,
    visible: () => !elements.get('guest-room-recovery-modal')!.classes.has('hidden'),
    account: (id: string | null = 'account') => { account = id; }, items: (value: GuestDraftRecoveryItem[]) => { items = value; },
    event: (name: string) => win.dispatchEvent(new Event(name)), click: (id: string) => elements.get(id)!.dispatchEvent(new Event('click')) };
}
beforeEach(() => vi.useFakeTimers()); afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe('guest draft sign-in and recovery lifecycle', () => {
  it.each(['button', 'Escape', 'backdrop'])('pauses automatic reminders after %s, including newer saves and other drafts across reloads', async kind => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(3500); expect(f.visible()).toBe(true);
    if (kind === 'button') f.click('btn-guest-room-recovery-close');
    else if (kind === 'backdrop') f.click('guest-room-recovery-modal');
    else f.doc.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(f.visible()).toBe(false); f.controller.destroy();
    const next = fixture(f.storage);
    next.items([{ ...guest(), draft: { ...guest().draft, updatedAt: 'new-save' } },
      { ...guest(), draft: { ...guest().draft, id: 'another-draft' } }]);
    await vi.advanceTimersByTimeAsync(3500); expect(next.visible()).toBe(false);
    for (const event of ['session-refreshed', 'focus', 'online']) { next.event(event); await vi.advanceTimersByTimeAsync(300); }
    expect(next.visible()).toBe(false);
    next.click('btn-auth-guest-drafts'); expect(next.visible()).toBe(true); expect(next.open).not.toHaveBeenCalled();
    next.controller.destroy();
  });
  it('pauses after a successful Go To Room, keeps manual recovery available and expires after three days', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(3500);
    f.click('btn-guest-room-recovery-go'); await vi.advanceTimersByTimeAsync(0);
    expect(f.open).toHaveBeenCalledWith(guest().draft.snapshot); expect(f.visible()).toBe(false);
    f.items([{ ...guest(), draft: { ...guest().draft, updatedAt: 'new-save' } }]);
    f.event('focus'); await vi.advanceTimersByTimeAsync(200); expect(f.visible()).toBe(false);
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000 - 201);
    f.event('session-refreshed'); await vi.advanceTimersByTimeAsync(0); expect(f.visible()).toBe(false);
    await vi.advanceTimersByTimeAsync(201); expect(f.visible()).toBe(true); f.controller.destroy();
  });
  it('does not pause reminders when an editor open fails or a mode change hides the modal', async () => {
    const f = fixture(); f.open.mockResolvedValueOnce(false); await vi.advanceTimersByTimeAsync(3500);
    f.click('btn-guest-room-recovery-go'); await vi.advanceTimersByTimeAsync(0); expect(f.visible()).toBe(true);
    f.doc.body.dataset.appMode = 'play-world'; f.event('wamp:app-mode-changed'); expect(f.visible()).toBe(false);
    f.items([{ ...guest(), draft: { ...guest().draft, updatedAt: 'new-save' } }]);
    f.doc.body.dataset.appMode = 'world'; f.event('wamp:app-mode-changed'); await vi.advanceTimersByTimeAsync(300);
    expect(f.visible()).toBe(true); f.controller.destroy();
  });
  it.each(['read-and-write', 'write-only'])('keeps the pause in memory when storage blocks %s', async kind => {
    const f = fixture();
    vi.spyOn(f.win.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    if (kind === 'read-and-write') vi.spyOn(f.win.localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    await vi.advanceTimersByTimeAsync(3500); f.click('btn-guest-room-recovery-close');
    f.items([{ ...guest(), draft: { ...guest().draft, updatedAt: 'new-save' } }]);
    f.event('focus'); await vi.advanceTimersByTimeAsync(300); expect(f.visible()).toBe(false);
    f.click('btn-auth-guest-drafts'); expect(f.visible()).toBe(true); f.controller.destroy();
  });
  it.each(['invalid', 'Infinity', 'beyond-three-days'])('ignores a malformed %s pause instead of hiding recovery indefinitely', async kind => {
    const f = fixture();
    f.storage.set(`${GUEST_DRAFT_SNOOZE_PREFIX}guest`, kind === 'beyond-three-days' ? String(Date.now() + 10 * 24 * 60 * 60 * 1000) : kind);
    await vi.advanceTimersByTimeAsync(3500); expect(f.visible()).toBe(true); f.controller.destroy();
  });
  it('honors a cross-tab pause and a later storage clear without losing newer draft content', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(3500); f.controller.close();
    f.items([{ ...guest(), draft: { ...guest().draft, updatedAt: 'new-save' } }]);
    const key = `${GUEST_DRAFT_SNOOZE_PREFIX}guest`; f.storage.set(key, String(Date.now() + 3 * 24 * 60 * 60 * 1000));
    f.win.dispatchEvent(Object.assign(new Event('storage'), { key })); await vi.advanceTimersByTimeAsync(200); expect(f.visible()).toBe(false);
    f.storage.delete(key); f.win.dispatchEvent(Object.assign(new Event('storage'), { key }));
    await vi.advanceTimersByTimeAsync(200); expect(f.visible()).toBe(true); expect(f.service.transfer).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it('scopes pauses to the current guest or account', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(3500); f.click('btn-guest-room-recovery-close');
    f.account(); f.items([claimed()]); f.event('auth-changed'); await vi.advanceTimersByTimeAsync(200); expect(f.visible()).toBe(true);
    f.click('btn-guest-room-recovery-close');
    f.account(null); f.items([{ ...guest(), draft: { ...guest().draft, updatedAt: 'new-save' } }]);
    f.event('auth-changed'); await vi.advanceTimersByTimeAsync(200); expect(f.visible()).toBe(false); f.controller.destroy();
  });
  it('continues newly chosen sign-in despite an older pause, but lets a later Close defer a pending conflict', async () => {
    const f = fixture(); f.storage.set(`${GUEST_DRAFT_SNOOZE_PREFIX}account`, String(Date.now() + 3 * 24 * 60 * 60 * 1000));
    await vi.advanceTimersByTimeAsync(3500); f.click('btn-guest-room-recovery-close');
    await vi.advanceTimersByTimeAsync(1); f.click('btn-auth-guest-drafts'); f.click('btn-guest-room-recovery-signin');
    f.account(); f.items([{ ...guest(), transfer: { outcome: 'conflict', userId: 'account', draftId: 'draft-id', reason: 'occupied',
      message: 'Your guest draft is still saved.', coordinates: { x: 1, y: 0 }, suggestedCoordinates: [] } }]);
    f.event('auth-changed'); await vi.advanceTimersByTimeAsync(200); expect(f.visible()).toBe(true);
    f.click('btn-guest-room-recovery-close'); f.event('focus'); await vi.advanceTimersByTimeAsync(300); expect(f.visible()).toBe(false);
    expect(f.storage.get(PENDING_SIGN_IN_DRAFT_KEY)).toBe('draft-id');
    f.click('btn-auth-guest-drafts'); expect(f.visible()).toBe(true); f.controller.destroy();
  });
  it('keeps an unfinished sign-in from undoing the guest pause, then resumes after the account arrives', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(3500); f.click('btn-guest-room-recovery-close');
    await vi.advanceTimersByTimeAsync(1); f.click('btn-auth-guest-drafts'); f.click('btn-guest-room-recovery-signin');
    f.items([{ ...guest(), draft: { ...guest().draft, updatedAt: 'new-save' } }]);
    f.event('session-refreshed'); await vi.advanceTimersByTimeAsync(4000); expect(f.visible()).toBe(false);
    expect(f.storage.get(PENDING_SIGN_IN_DRAFT_KEY)).toBe('draft-id'); expect(f.open).not.toHaveBeenCalled();
    f.account(); f.items([claimed()]); f.event('auth-changed'); await vi.advanceTimersByTimeAsync(200);
    expect(f.open).toHaveBeenCalledWith(room.draft); expect(f.storage.has(PENDING_SIGN_IN_DRAFT_KEY)).toBe(false); f.controller.destroy();
  });
  it.each(['busy-overlay', 'reward-sting-layer', 'xp-receipt-layer', 'auth-panel', 'other-modal'])('defers timer and session reminders behind %s', async id => {
    const f = fixture();
    if (id === 'auth-panel') f.elements.get(id)!.classes.add('menu-open'); else f.elements.get(id)!.classes.delete('hidden');
    f.event('session-refreshed'); await vi.advanceTimersByTimeAsync(4000); expect(f.visible()).toBe(false);
    if (id === 'auth-panel') f.elements.get(id)!.classes.delete('menu-open'); else f.elements.get(id)!.classes.add('hidden');
    await vi.advanceTimersByTimeAsync(300); expect(f.visible()).toBe(true); f.controller.destroy();
  });
  it('waits for app readiness and World, then keeps recovery out of active Play and editor work', async () => {
    const f = fixture(); f.doc.body.dataset.appReady = 'false'; await vi.advanceTimersByTimeAsync(3500); expect(f.service.sync).not.toHaveBeenCalled();
    f.doc.body.dataset.appReady = 'true'; f.doc.body.dataset.appMode = 'editor'; f.event('wamp:app-ready'); await vi.advanceTimersByTimeAsync(300); expect(f.service.sync).not.toHaveBeenCalled();
    f.doc.body.dataset.appMode = 'world'; f.event('wamp:app-mode-changed'); await vi.advanceTimersByTimeAsync(300); expect(f.visible()).toBe(true);
    f.doc.body.dataset.appMode = 'play-world'; f.event('wamp:app-mode-changed'); expect(f.visible()).toBe(false); f.controller.destroy();
  });
  it('uses auth, session, focus and visible return for cross-tab sign-in, without replacing work', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(3500); f.controller.close(); f.account(); f.items([claimed()]);
    for (const event of ['auth-changed', 'session-refreshed', 'focus', 'online']) { f.event(event); await vi.advanceTimersByTimeAsync(200); }
    expect(f.visible()).toBe(true); expect(f.open).not.toHaveBeenCalled();
    f.controller.close(); f.doc.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(400); expect(f.visible()).toBe(false);
    expect(f.service.sync).toHaveBeenCalledTimes(6); f.controller.destroy();
  });
  it('preserves same-tab intent through a failed open and removes it only after account resume succeeds', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(3500); f.click('btn-guest-room-recovery-signin'); expect(f.storage.get(PENDING_SIGN_IN_DRAFT_KEY)).toBe('draft-id');
    f.account(); f.items([claimed()]); f.open.mockResolvedValueOnce(false); f.event('auth-changed'); await vi.advanceTimersByTimeAsync(200);
    expect(f.storage.get(PENDING_SIGN_IN_DRAFT_KEY)).toBe('draft-id'); expect(f.open).toHaveBeenCalledTimes(1);
    f.event('focus'); await vi.advanceTimersByTimeAsync(200); expect(f.open).toHaveBeenCalledTimes(2); expect(f.storage.has(PENDING_SIGN_IN_DRAFT_KEY)).toBe(false); f.controller.destroy();
  });
  it('keeps a frontier conflict safe until the user selects a new destination', async () => {
    const f = fixture(); f.account(); f.items([{ ...guest(), transfer: { outcome: 'conflict', userId: 'account', draftId: 'draft-id', reason: 'occupied',
      message: 'Your guest draft is still saved. Choose a new spot.', coordinates: { x: 1, y: 0 }, suggestedCoordinates: [{ x: -1, y: 0 }] } }]);
    await vi.advanceTimersByTimeAsync(3500); expect(f.service.transfer).not.toHaveBeenCalled();
    expect(f.elements.get('guest-room-recovery-copy')!.textContent).toContain('still saved');
    f.elements.get('guest-room-recovery-locations')!.children[0].dispatchEvent(new Event('click')); await vi.advanceTimersByTimeAsync(0);
    expect(f.service.transfer).toHaveBeenCalledWith('draft-id', 'account', { x: -1, y: 0 });
    f.click('btn-guest-room-recovery-go'); await vi.advanceTimersByTimeAsync(0); expect(f.open).toHaveBeenCalledWith(room.draft); f.controller.destroy();
  });
  it('waits for other modals and rejects stale previous-account results', async () => {
    const f = fixture(); f.account(); f.items([claimed()]); f.elements.get('other-modal')!.classes.delete('hidden');
    await vi.advanceTimersByTimeAsync(3500); expect(f.visible()).toBe(false); f.elements.get('other-modal')!.classes.add('hidden');
    await vi.advanceTimersByTimeAsync(300); expect(f.visible()).toBe(true); f.account('other'); f.event('auth-changed'); expect(f.visible()).toBe(false);
    f.service.sync.mockResolvedValue({ userId: 'account', items: [claimed()] }); await vi.advanceTimersByTimeAsync(600); expect(f.visible()).toBe(false); f.controller.destroy();
  });
  it('retries network failures without losing the pending draft or spinning, and cleans up', async () => {
    const f = fixture(); f.storage.set(PENDING_SIGN_IN_DRAFT_KEY, 'draft-id'); f.service.sync.mockRejectedValue(new Error('Offline'));
    await vi.advanceTimersByTimeAsync(3500); await vi.advanceTimersByTimeAsync(19999); expect(f.service.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(f.service.sync).toHaveBeenCalledTimes(2); expect(f.storage.has(PENDING_SIGN_IN_DRAFT_KEY)).toBe(true);
    f.controller.destroy(); f.event('focus'); await vi.advanceTimersByTimeAsync(30000); expect(f.service.sync).toHaveBeenCalledTimes(2);
  });
});
