import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth-changed', AUTH_SESSION_REFRESHED_EVENT: 'session-refreshed', promptForSignIn: vi.fn() }));
vi.mock('../../guestRooms/runClaimService', () => ({ guestClaimAccountId: () => null, getGuestRunClaimService: () => ({}), GUEST_ACCOUNT_PROGRESS_EVENT: 'receipt' }));
vi.mock('../../guestRooms/runReplayLinks', () => ({ resolveGuestRunReplayLink: vi.fn() }));
import { promptForSignIn } from '../../auth/client';
import { GuestProgressClaimModalController } from './guestProgressClaimModal';
import type { GuestRunClaimResponse, GuestRunClaimedListResponse } from '../../guestRooms/runModel';
import type { GuestRunProgressRecord } from '../../progression/guestRunProgress';

class Element extends EventTarget {
  readonly classes = new Set(['hidden']);
  readonly classList = { add: (...v: string[]) => v.forEach(s => this.classes.add(s)), remove: (...v: string[]) => v.forEach(s => this.classes.delete(s)),
    contains: (s: string) => this.classes.has(s), toggle: (s: string, force: boolean) => force ? this.classes.add(s) : this.classes.delete(s) };
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  private text = '';
  get textContent(): string { return this.text + this.children.map(c => c.textContent).join(' '); }
  set textContent(value: string) { this.text = value; this.children.length = 0; }
  setAttribute(k: string, v: string) { this.attributes.set(k, v); }
  getAttribute(k: string) { return this.attributes.get(k) ?? null; }
  appendChild(value: Element) { this.children.push(value); return value; }
  focus = vi.fn(); className = ''; href = '';
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const receipt = (id = 'claim', amount = 20): GuestRunClaimResponse => ({ claimId: id, userId: 'account', clearsSaved: 1, pxpAwarded: amount, remainingClears: 0 });
const legacy: GuestRunProgressRecord = { id: 'legacy', contentType: 'room', contentId: '10,0', contentTitle: 'Old clear', version: 1,
  elapsedMs: 1000, deaths: 0, score: null, potentialPxp: 999999, completedAt: new Date().toISOString() };

function fixture() {
  const elements = new Map(['guest-progress-modal', 'guest-progress-title', 'guest-progress-meta', 'guest-progress-list', 'guest-progress-status',
    'btn-auth-guest-progress', 'btn-guest-progress-close', 'btn-guest-progress-signin', 'auth-panel', 'busy-overlay', 'reward-sting-layer', 'xp-receipt-layer', 'other-modal'].map(id => [id, new Element()]));
  const doc = Object.assign(new EventTarget(), { body: { dataset: { appMode: 'world', appReady: 'true' } }, visibilityState: 'visible', hasFocus: () => true,
    getElementById: (id: string) => elements.get(id) ?? null, createElement: () => new Element(),
    querySelectorAll: () => [elements.get('guest-progress-modal'), elements.get('other-modal')] });
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout, navigator: {} });
  let account: string | null = null;
  let receipts: GuestRunClaimResponse[] = [];
  let records: GuestRunProgressRecord[] = [];
  const service = { sync: vi.fn(async () => ({ retry: false, error: null as string | null })), receipts: () => receipts,
    markPresented: vi.fn((value: GuestRunClaimResponse) => { receipts = receipts.filter(entry => entry !== value); return true; }),
    history: vi.fn(async (): Promise<GuestRunClaimedListResponse | null> => ({ userId: account!, clears: [], totalClears: 0 })) };
  const invalidate = vi.fn(() => true);
  const replay = vi.fn(async () => ({ href: '/r/10/0', label: 'Replay' }));
  const controller = new GuestProgressClaimModalController(doc as unknown as Document, win as unknown as Window,
    { service, account: () => account, local: () => records, replay, invalidate });
  controller.init();
  const event = (name: string) => win.dispatchEvent(new Event(name));
  return { controller, doc, win, service, invalidate, replay, event, elements, visible: () => !elements.get('guest-progress-modal')!.classList.contains('hidden'),
    account: (id: string | null = 'account') => { account = id; }, receipts: (values: GuestRunClaimResponse[]) => { receipts = values; },
    records: (values: GuestRunProgressRecord[]) => { records = values; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('guest account claim lifecycle', () => {
  it('does not create a rapid retry loop from repeated queued-finish notifications', async () => {
    const f = fixture();
    const progress = () => f.win.dispatchEvent(Object.assign(new Event('wamp:guest-run-progress-changed'), { detail: { clientRunId: 'run', status: 'queued' } }));
    f.service.sync.mockImplementation(async () => { progress(); return { retry: true, error: 'Offline' }; });
    progress(); await vi.advanceTimersByTimeAsync(200); await vi.advanceTimersByTimeAsync(19999);
    expect(f.service.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(f.service.sync).toHaveBeenCalledTimes(2); f.controller.destroy();
  });
  it('syncs on boot, all auth/session notifications and same-account focus/visibility refresh', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(200); expect(f.service.sync).toHaveBeenCalledTimes(1);
    f.account();
    for (const event of ['auth-changed', 'session-refreshed', 'focus', 'online']) {
      f.event(event); await vi.advanceTimersByTimeAsync(200);
    }
    f.doc.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(200);
    expect(f.service.sync).toHaveBeenCalledTimes(6); f.controller.destroy();
  });

  it('holds a trustworthy receipt through boot and play, shows it after Stop, and never replays it on focus', async () => {
    const f = fixture(); f.account(); f.receipts([receipt()]); f.doc.body.dataset.appReady = 'false';
    await vi.advanceTimersByTimeAsync(800); expect(f.visible()).toBe(false); expect(f.service.markPresented).not.toHaveBeenCalled();
    f.doc.body.dataset.appReady = 'true'; f.doc.body.dataset.appMode = 'play-world'; f.event('wamp:app-ready');
    await vi.advanceTimersByTimeAsync(800); expect(f.visible()).toBe(false);
    f.doc.body.dataset.appMode = 'world'; f.event('wamp:app-mode-changed'); await vi.advanceTimersByTimeAsync(0);
    expect(f.visible()).toBe(true); expect(f.elements.get('guest-progress-title')!.textContent).toBe('We saved 1 clear (+20 XP)');
    expect(f.invalidate).toHaveBeenCalledTimes(1); f.controller.close(); f.event('focus'); await vi.advanceTimersByTimeAsync(1000);
    expect(f.visible()).toBe(false); expect(f.service.markPresented).toHaveBeenCalledTimes(1); f.controller.destroy();
  });

  it('waits for the auth menu, other dialogs, busy work and reward sting instead of stacking', async () => {
    const f = fixture(); f.account(); f.receipts([receipt()]); f.elements.get('auth-panel')!.classList.add('menu-open');
    await vi.advanceTimersByTimeAsync(500); expect(f.visible()).toBe(false);
    f.elements.get('auth-panel')!.classList.remove('menu-open'); f.elements.get('other-modal')!.classList.remove('hidden');
    await vi.advanceTimersByTimeAsync(500); expect(f.visible()).toBe(false);
    f.elements.get('other-modal')!.classList.add('hidden'); f.elements.get('reward-sting-layer')!.classList.remove('hidden');
    await vi.advanceTimersByTimeAsync(500); expect(f.visible()).toBe(false);
    f.elements.get('reward-sting-layer')!.classList.add('hidden'); f.elements.get('busy-overlay')!.classList.remove('hidden');
    await vi.advanceTimersByTimeAsync(500); expect(f.visible()).toBe(false);
    f.elements.get('busy-overlay')!.classList.add('hidden'); await vi.advanceTimersByTimeAsync(500); expect(f.visible()).toBe(true); f.controller.destroy();
  });

  it('retries failed syncs at a bounded interval and waits for a hidden tab to return', async () => {
    const f = fixture(); f.service.sync.mockResolvedValue({ retry: true, error: 'waiting' });
    await vi.advanceTimersByTimeAsync(200); await vi.advanceTimersByTimeAsync(19999); expect(f.service.sync).toHaveBeenCalledTimes(1);
    f.doc.visibilityState = 'hidden'; await vi.advanceTimersByTimeAsync(1000); expect(f.service.sync).toHaveBeenCalledTimes(1);
    f.doc.visibilityState = 'visible'; f.doc.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(200);
    expect(f.service.sync).toHaveBeenCalledTimes(2); f.controller.destroy();
  });

  it('ignores unrelated storage, and retries guest queue/receipt changes from another tab', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(200);
    const storage = (key: string) => f.win.dispatchEvent(Object.assign(new Event('storage'), { key }));
    storage('editor-setting'); await vi.advanceTimersByTimeAsync(200); expect(f.service.sync).toHaveBeenCalledTimes(1);
    storage('wamp_guest_claim_v1:claim'); await vi.advanceTimersByTimeAsync(200); expect(f.service.sync).toHaveBeenCalledTimes(2);
    storage('wamp_guest_run_finish_v1:run'); await vi.advanceTimersByTimeAsync(200); expect(f.service.sync).toHaveBeenCalledTimes(3); f.controller.destroy();
  });

  it('preserves legacy history with replay links and never displays browser-authored XP as an award', async () => {
    const f = fixture(); f.account(); f.records([legacy]); await vi.advanceTimersByTimeAsync(200);
    expect(f.visible()).toBe(true); expect(f.elements.get('guest-progress-list')!.textContent).toContain('Browser-only clear — replay signed in to earn XP');
    expect(f.elements.get('guest-progress-list')!.textContent).toContain('Replay');
    expect(f.elements.get('guest-progress-list')!.textContent).not.toContain('999999'); expect(f.service.markPresented).not.toHaveBeenCalled();
    f.controller.close(); f.event('session-refreshed'); await vi.advanceTimersByTimeAsync(500); expect(f.visible()).toBe(false); f.controller.destroy();
  });

  it('closes on account change and rejects late history/replay rendering for the previous account', async () => {
    const f = fixture(); const history = deferred<GuestRunClaimedListResponse>(); f.account(); f.receipts([receipt()]);
    f.service.history.mockReturnValue(history.promise); await vi.advanceTimersByTimeAsync(200); expect(f.visible()).toBe(true);
    f.account('other'); f.event('auth-changed'); expect(f.visible()).toBe(false);
    history.resolve({ userId: 'account', totalClears: 1, clears: [{ attemptId: 'old', contentType: 'room', contentId: '10,0', contentTitle: 'Private previous history', version: 1, completedAt: new Date().toISOString(), elapsedMs: 1000, deaths: 0 }] });
    await vi.advanceTimersByTimeAsync(0); expect(f.elements.get('guest-progress-list')!.textContent).not.toContain('Private previous history'); f.controller.destroy();
  });

  it('opens local history manually for a guest and returns to the existing sign-in UI', async () => {
    const f = fixture(); f.records([legacy]); f.elements.get('auth-panel')!.classList.add('menu-open');
    f.elements.get('btn-auth-guest-progress')!.dispatchEvent(new Event('click')); await vi.advanceTimersByTimeAsync(0);
    expect(f.visible()).toBe(true); expect(f.elements.get('btn-guest-progress-signin')!.classList.contains('hidden')).toBe(false);
    f.elements.get('btn-guest-progress-signin')!.dispatchEvent(new Event('click')); expect(f.visible()).toBe(false); expect(promptForSignIn).toHaveBeenCalled(); f.controller.destroy();
  });

  it('retires empty receipts quietly and gives duplicate-version clears an accurate zero-XP receipt', async () => {
    const f = fixture(); f.account(); f.receipts([{ ...receipt('empty', 0), clearsSaved: 0 }, receipt('duplicate', 0)]);
    await vi.advanceTimersByTimeAsync(200); expect(f.visible()).toBe(true); expect(f.service.markPresented).toHaveBeenCalledTimes(2);
    expect(f.elements.get('guest-progress-title')!.textContent).toBe('We saved 1 clear');
    expect(f.elements.get('guest-progress-meta')!.textContent).toContain('already earned their clear XP'); f.controller.destroy();
  });

  it('coalesces account switches while syncing, then resyncs for the new account', async () => {
    const f = fixture(); const sync = deferred<{ retry: boolean; error: string | null }>(); f.account(); f.service.sync.mockReturnValueOnce(sync.promise);
    await vi.advanceTimersByTimeAsync(200); f.account('other'); f.event('auth-changed'); await vi.advanceTimersByTimeAsync(200);
    expect(f.service.sync).toHaveBeenCalledTimes(1); sync.resolve({ retry: false, error: null }); await vi.advanceTimersByTimeAsync(200);
    expect(f.service.sync).toHaveBeenCalledTimes(2); f.controller.destroy();
  });

  it('stops pending retries, listeners and late work after destruction', async () => {
    const f = fixture(); const sync = deferred<{ retry: boolean; error: string | null }>(); f.service.sync.mockReturnValue(sync.promise);
    await vi.advanceTimersByTimeAsync(200); f.controller.destroy(); f.account(); f.receipts([receipt()]); sync.resolve({ retry: true, error: null });
    f.event('focus'); f.event('auth-changed'); await vi.advanceTimersByTimeAsync(30000);
    expect(f.visible()).toBe(false); expect(f.service.sync).toHaveBeenCalledTimes(1); expect(f.invalidate).not.toHaveBeenCalled();
  });
});
