import type Phaser from 'phaser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth-changed', AUTH_SESSION_REFRESHED_EVENT: 'session-refreshed', promptForSignIn: vi.fn() }));
vi.mock('../../guestRooms/client', () => ({ submitGuestRoomDraft: vi.fn() }));
vi.mock('../../guestRooms/draftRecoveryService', () => ({ GuestDraftRecoveryService: class {}, guestDraftAccountId: () => null }));
vi.mock('../../mint/roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn() }));
vi.mock('./profileEvents', () => ({ requestProfileInvalidation: vi.fn() }));
import { createDefaultRoomRecord } from '../../persistence/roomRepository';
import type { GuestDraftRecoveryItem } from '../../guestRooms/draftRecoveryService';
import { GuestRoomRecoveryModalController, PENDING_SIGN_IN_DRAFT_KEY } from './guestRoomRecoveryModal';

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
function fixture() {
  const ids = ['guest-room-recovery-modal', 'guest-room-recovery-title', 'guest-room-recovery-meta', 'guest-room-recovery-copy', 'guest-room-recovery-status',
    'guest-room-recovery-preview', 'guest-room-recovery-preview-fallback', 'guest-room-recovery-benefits', 'guest-room-recovery-drafts', 'guest-room-recovery-drafts-label',
    'guest-room-recovery-locations', 'btn-guest-room-recovery-signin', 'btn-guest-room-recovery-submit', 'btn-guest-room-recovery-go', 'btn-guest-room-recovery-close',
    'btn-auth-guest-drafts', 'auth-panel', 'busy-overlay', 'reward-sting-layer', 'xp-receipt-layer', 'other-modal'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const doc = Object.assign(new EventTarget(), { body: { dataset: { appMode: 'world', appReady: 'true' } }, visibilityState: 'visible', hasFocus: () => true,
    getElementById: (id: string) => elements.get(id) ?? null, createElement: () => new Element(),
    querySelectorAll: (selector: string) => selector.includes('locations') ? elements.get('guest-room-recovery-locations')!.children
      : [elements.get('guest-room-recovery-modal')!, elements.get('other-modal')!] });
  const storage = new Map<string, string>();
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
