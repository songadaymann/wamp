import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth', AUTH_SESSION_REFRESHED_EVENT: 'session', getAuthDebugState: () => ({}), promptForSignIn: vi.fn() }));
vi.mock('../../guestRooms/runClaimService', () => ({ GUEST_ACCOUNT_PROGRESS_EVENT: 'claimed' }));
vi.mock('../../guestRooms/runService', () => ({ GUEST_RUN_PROGRESS_CHANGED_EVENT: 'saved' }));
vi.mock('../../guestRooms/runRepository', () => ({ createGuestRunRepository: () => ({}), captureGuestRunIdentity: vi.fn() }));
vi.mock('../../runs/runRepository', () => ({ createRunRepository: () => ({}) }));
import { PostRunReminderController } from './postRunReminder';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { POST_RUN_GUEST_CLAIM_REQUEST_EVENT, POST_RUN_RATING_SUBMITTED_EVENT } from '../../progression/postRunRatingEvents';
import type { GuestRunProgressRecord } from '../../progression/guestRunProgress';

class Element extends EventTarget {
  readonly classes = new Set(['hidden']);
  readonly classList = { contains: (name: string) => this.classes.has(name), add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name), toggle: (name: string, force: boolean) => force ? this.classes.add(name) : this.classes.delete(name) };
  textContent = ''; blur = vi.fn();
  constructor(readonly id: string) { super(); }
  getAttribute() { return null; }
  click() { this.dispatchEvent(new Event('click')); }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const record = (status?: 'saved' | 'queued' | 'unverified'): GuestRunProgressRecord => ({ id: 'clear', contentType: 'room', contentId: '0,0', contentTitle: 'A room',
  version: 1, elapsedMs: 1000, deaths: 0, score: null, potentialPxp: 20, completedAt: new Date().toISOString(),
  guestProgress: status ? { clientRunId: 'clear', attemptId: 'attempt', status, durable: true, reason: null } : undefined });
const controllers: PostRunReminderController[] = [];
function fixture(initialAccount: string | null = 'a', records: GuestRunProgressRecord[] = [], pendingCount = 2) {
  const elements = new Map(['post-run-reminder', 'btn-post-run-reminder', 'btn-post-run-reminder-dismiss', 'btn-auth-rate-clears',
    'auth-panel', 'busy-overlay', 'reward-sting-layer', 'xp-receipt-layer', 'other-modal'].map(id => [id, new Element(id)]));
  const doc = Object.assign(new EventTarget(), { body: { dataset: { appMode: 'world', appReady: 'true' } }, visibilityState: 'visible',
    activeElement: null as Element | null, getElementById: (id: string) => elements.get(id) ?? null, querySelectorAll: () => [elements.get('other-modal')!] });
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  let account = initialAccount, guest = 'g1', count = 3;
  const loadUnratedCount = vi.fn(async () => count);
  const pending = vi.fn(async () => ({ clears: [], totalClears: pendingCount }));
  const options = { account: () => account, identity: () => ({ guestUserId: guest, recoveryToken: 'private' }), local: () => records,
    loadUnratedCount, pending, openUnrated: vi.fn(), openGuestHistory: vi.fn(), beforeOpen: vi.fn(), signIn: vi.fn() };
  const controller = new PostRunReminderController(options, doc as unknown as Document, win as unknown as Window);
  controller.init();
  const f = { controller, doc, win, options, elements, event: (name: string) => win.dispatchEvent(new Event(name)),
    account: (value: string | null) => { account = value; }, guest: (value: string) => { guest = value; }, count: (value: number) => { count = value; },
    visible: () => !elements.get('post-run-reminder')!.classes.has('hidden'), label: () => elements.get('btn-post-run-reminder')!.textContent,
    menu: () => !elements.get('btn-auth-rate-clears')!.classes.has('hidden') };
  controllers.push(controller); return f;
}
const flush = () => vi.advanceTimersByTimeAsync(250);
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const controller of controllers.splice(0)) controller.destroy(); vi.useRealTimers(); });

describe('recoverable post-run reminder', () => {
  it('recovers server clears on boot and stays passive during Play and modal transitions', async () => {
    const f = fixture(); await flush(); expect(f.label()).toBe('Rate 3 rooms'); expect(f.visible()).toBe(true);
    f.doc.body.dataset.appMode = 'play-world'; f.event(APP_MODE_CHANGED_EVENT); await flush();
    expect(f.visible()).toBe(true); expect(f.options.loadUnratedCount).toHaveBeenCalledTimes(1); expect(f.options.openUnrated).not.toHaveBeenCalled();
    f.elements.get('other-modal')!.classes.delete('hidden'); f.event(APP_MODE_CHANGED_EVENT); expect(f.visible()).toBe(false);
    f.elements.get('other-modal')!.classes.add('hidden'); f.event(APP_MODE_CHANGED_EVENT); expect(f.visible()).toBe(true);
    f.elements.get('btn-post-run-reminder')!.click(); expect(f.options.beforeOpen).toHaveBeenCalledOnce(); expect(f.options.openUnrated).toHaveBeenCalledOnce();
    f.doc.body.dataset.appMode = 'editor'; f.event(APP_MODE_CHANGED_EVENT); expect(f.visible()).toBe(false); expect(f.menu()).toBe(false);
    f.doc.body.dataset.appMode = 'world'; f.event(APP_MODE_CHANGED_EVENT); expect(f.visible()).toBe(true); expect(f.menu()).toBe(true);
  });
  it('honors dismissal while retaining the menu entry; a changed count restores the reminder', async () => {
    const f = fixture(); await flush(); f.elements.get('btn-post-run-reminder-dismiss')!.click();
    expect(f.visible()).toBe(false); expect(f.menu()).toBe(true);
    f.event(POST_RUN_RATING_SUBMITTED_EVENT); await flush(); expect(f.visible()).toBe(false);
    f.count(2); f.event(POST_RUN_RATING_SUBMITTED_EVENT); await flush(); expect(f.label()).toBe('Rate 2 rooms'); expect(f.visible()).toBe(true);
    f.count(0); f.event(POST_RUN_RATING_SUBMITTED_EVENT); await flush(); expect(f.visible()).toBe(false); expect(f.menu()).toBe(false);
  });
  it('rejects a late count from the previous account and never opens it after sign-out', async () => {
    const f = fixture(), late = deferred<number>(); f.options.loadUnratedCount.mockImplementationOnce(() => late.promise); await flush();
    f.account('b'); f.count(1); f.event('auth'); await flush(); expect(f.label()).toBe('Rate 1 room');
    late.resolve(99); await flush(); expect(f.label()).toBe('Rate 1 room');
    f.account(null); f.event('auth'); expect(f.menu()).toBe(false); f.elements.get('btn-auth-rate-clears')!.click();
    expect(f.options.openUnrated).not.toHaveBeenCalled(); await flush(); expect(f.label()).toBe('Save 2 clears');
  });
  it('recovers verified guest clears after reload, using the pending server count', async () => {
    const f = fixture(null, [record('saved')], 2); await flush(); expect(f.label()).toBe('Save 2 clears');
    f.elements.get('btn-post-run-reminder')!.click(); expect(f.options.signIn).toHaveBeenCalledOnce(); expect(f.options.openGuestHistory).not.toHaveBeenCalled();
    const reload = fixture(null, [record('saved')], 2); await flush(); expect(reload.visible()).toBe(true); expect(reload.label()).toBe('Save 2 clears');
  });
  it('does not promise a save for expired or already claimed modern browser records', async () => {
    const f = fixture(null, [record('saved')], 0); await flush(); expect(f.visible()).toBe(false); expect(f.options.signIn).not.toHaveBeenCalled();
    const legacy = fixture(null, [record()], 0); await flush(); expect(legacy.label()).toBe('Guest clears');
    legacy.elements.get('btn-post-run-reminder')!.click(); expect(legacy.options.openGuestHistory).toHaveBeenCalledOnce(); expect(legacy.options.signIn).not.toHaveBeenCalled();
  });
  it('keeps offline progress reviewable and retries immediately when the connection returns', async () => {
    const f = fixture(null, [record('saved')]); f.options.pending.mockRejectedValueOnce(new Error('offline'));
    await flush(); expect(f.label()).toBe('Guest clears'); expect(f.visible()).toBe(true);
    f.event('online'); await flush(); expect(f.label()).toBe('Save 2 clears'); expect(f.options.pending).toHaveBeenCalledTimes(2);
    expect(f.options.signIn).not.toHaveBeenCalled();
  });
  it('rejects a pending response from a replaced guest identity', async () => {
    const f = fixture(null, [record('saved')]), late = deferred<{ clears: []; totalClears: number }>();
    f.options.pending.mockImplementationOnce(() => late.promise); await flush();
    f.guest('g2'); f.options.pending.mockResolvedValue({ clears: [], totalClears: 0 }); f.event('auth'); await flush();
    late.resolve({ clears: [], totalClears: 99 }); await flush(); expect(f.visible()).toBe(false);
  });
  it('recovers a real clear during the session even when browser storage is unavailable', async () => {
    const f = fixture(null, [], 0); await flush(); expect(f.visible()).toBe(false);
    f.options.pending.mockRejectedValue(new Error('offline')); f.event(POST_RUN_GUEST_CLAIM_REQUEST_EVENT); await flush();
    expect(f.label()).toBe('Guest clears'); expect(f.visible()).toBe(true);
  });
  it('activates a focused reminder once with Space and consumes its key-up before game input', async () => {
    const f = fixture(); await flush(); f.doc.activeElement = f.elements.get('btn-post-run-reminder')!;
    const game = vi.fn(); f.win.addEventListener('keydown', game); f.win.addEventListener('keyup', game);
    for (const name of ['keydown', 'keyup']) f.win.dispatchEvent(Object.assign(new Event(name, { cancelable: true }), { key: ' ', code: 'Space', repeat: false }));
    expect(f.options.openUnrated).toHaveBeenCalledOnce(); expect(game).not.toHaveBeenCalled();
    f.doc.activeElement = null; f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: ' ', code: 'Space' })); expect(game).toHaveBeenCalledOnce();
  });
});
