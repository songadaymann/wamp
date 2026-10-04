import { AUTH_SESSION_REFRESHED_EVENT, AUTH_STATE_CHANGED_EVENT, getAuthDebugState, promptForSignIn } from '../../auth/client';
import { GUEST_ACCOUNT_PROGRESS_EVENT } from '../../guestRooms/runClaimService';
import { captureGuestRunIdentity, createGuestRunRepository, type GuestRunRecoveryIdentity } from '../../guestRooms/runRepository';
import type { GuestRunClearListResponse } from '../../guestRooms/runModel';
import { GUEST_RUN_PROGRESS_CHANGED_EVENT } from '../../guestRooms/runService';
import { loadGuestRunProgress, type GuestRunProgressRecord } from '../../progression/guestRunProgress';
import { POST_RUN_GUEST_CLAIM_REQUEST_EVENT, POST_RUN_RATING_REQUEST_EVENT, POST_RUN_RATING_SUBMITTED_EVENT } from '../../progression/postRunRatingEvents';
import { createRunRepository } from '../../runs/runRepository';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { APP_READY_EVENT } from '../appFeedback';

interface Options {
  openUnrated: () => void;
  openGuestHistory: () => void;
  beforeOpen: () => void;
  account?: () => string | null;
  identity?: () => GuestRunRecoveryIdentity;
  local?: () => GuestRunProgressRecord[];
  loadUnratedCount?: () => Promise<number>;
  pending?: (identity: GuestRunRecoveryIdentity) => Promise<GuestRunClearListResponse>;
  signIn?: typeof promptForSignIn;
}
type Reminder = { kind: 'rate' | 'save' | 'history'; count: number; identity: string };
const REFRESH_INTERVAL = 20_000;
const AUTH_EVENTS = [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT];
const PROGRESS_EVENTS = [POST_RUN_RATING_REQUEST_EVENT, POST_RUN_RATING_SUBMITTED_EVENT,
  GUEST_RUN_PROGRESS_CHANGED_EVENT, GUEST_ACCOUNT_PROGRESS_EVENT];

/** A recoverable entry into existing flows, without interrupting a run with a modal. */
export class PostRunReminderController {
  private readonly account;
  private readonly identity;
  private readonly local;
  private readonly loadUnratedCount;
  private readonly pending;
  private readonly signIn;
  private readonly root;
  private readonly action;
  private readonly dismiss;
  private readonly menu;
  private readonly blockedKeys = new Set<string>();
  private observer: MutationObserver | null = null;
  private timer: number | null = null;
  private generation = 0;
  private destroyed = false;
  private lastRefresh = 0;
  private currentIdentity = '';
  private reminder: Reminder | null = null;
  private dismissed = '';
  private sessionGuestClear = false;

  constructor(private readonly options: Options, private readonly doc: Document = document, private readonly win: Window = window) {
    this.account = options.account ?? (() => { const auth = getAuthDebugState(); return auth.authenticated ? auth.user?.id ?? null : null; });
    this.identity = options.identity ?? captureGuestRunIdentity;
    this.local = options.local ?? (() => loadGuestRunProgress().records);
    const runs = createRunRepository();
    this.loadUnratedCount = options.loadUnratedCount ?? (async () => {
      const response = await runs.loadRoomDiscovery(null, 'unrated', 1);
      if (Number.isInteger(response.totalCount) && response.totalCount! >= 0) return response.totalCount!;
      // Support an older API during deployment only when the result is already the complete list.
      if (!response.nextCursor) return response.results.length;
      throw new Error('Unrated count is not available yet.');
    });
    this.pending = options.pending ?? createGuestRunRepository().listPending;
    this.signIn = options.signIn ?? promptForSignIn;
    this.root = doc.getElementById('post-run-reminder'); this.action = doc.getElementById('btn-post-run-reminder');
    this.dismiss = doc.getElementById('btn-post-run-reminder-dismiss'); this.menu = doc.getElementById('btn-auth-rate-clears');
  }

  init(): void {
    this.action?.addEventListener('click', this.onOpen); this.menu?.addEventListener('click', this.onOpen);
    this.dismiss?.addEventListener('click', this.onDismiss);
    for (const name of AUTH_EVENTS) this.win.addEventListener(name, this.onAuth);
    for (const name of PROGRESS_EVENTS) this.win.addEventListener(name, this.onProgress);
    for (const name of [APP_MODE_CHANGED_EVENT, APP_READY_EVENT, 'focus', 'online']) this.win.addEventListener(name, this.onWake);
    this.win.addEventListener(POST_RUN_GUEST_CLAIM_REQUEST_EVENT, this.onGuestClear);
    this.win.addEventListener('storage', this.onStorage); this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.win.addEventListener('keydown', this.onKeydown, true); this.win.addEventListener('keyup', this.onKeyup, true);
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => this.render());
      this.observer.observe(this.doc.body, { attributes: true, attributeFilter: ['data-app-mode', 'data-app-ready'] });
      for (const element of this.doc.querySelectorAll('.history-modal, .pvp-modal, #auth-panel, #busy-overlay, #reward-sting-layer, #xp-receipt-layer')) {
        this.observer.observe(element, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
      }
    }
    this.schedule(true);
  }

  destroy(): void {
    this.destroyed = true; this.generation++; this.observer?.disconnect();
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.action?.removeEventListener('click', this.onOpen); this.menu?.removeEventListener('click', this.onOpen);
    this.dismiss?.removeEventListener('click', this.onDismiss);
    for (const name of AUTH_EVENTS) this.win.removeEventListener(name, this.onAuth);
    for (const name of PROGRESS_EVENTS) this.win.removeEventListener(name, this.onProgress);
    for (const name of [APP_MODE_CHANGED_EVENT, APP_READY_EVENT, 'focus', 'online']) this.win.removeEventListener(name, this.onWake);
    this.win.removeEventListener(POST_RUN_GUEST_CLAIM_REQUEST_EVENT, this.onGuestClear);
    this.win.removeEventListener('storage', this.onStorage); this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.win.removeEventListener('keydown', this.onKeydown, true); this.win.removeEventListener('keyup', this.onKeyup, true);
    this.reminder = null; this.render();
  }

  private readonly onAuth = () => {
    this.generation++; this.currentIdentity = ''; this.reminder = null; this.dismissed = ''; this.sessionGuestClear = false;
    this.render(); this.schedule(true);
  };
  private readonly onProgress = () => this.schedule(true);
  private readonly onGuestClear = () => { this.sessionGuestClear = true; this.schedule(true); };
  private readonly onWake = (event?: Event) => { this.render(); this.schedule(event?.type === 'online'); };
  private readonly onVisibility = () => { if (this.doc.visibilityState === 'visible') this.onWake(); };
  private readonly onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || key === 'wamp_guest_run_progress_v1' || key?.includes('guest')) this.onAuth();
  };
  private readonly onDismiss = () => { this.dismissed = this.reminderKey(); this.render(); this.dismiss?.blur(); };
  private readonly onOpen = (event: Event) => {
    // The account menu's outside-click listener must not close a newly opened sign-in prompt.
    event.stopPropagation();
    if (!this.reminder || this.destroyed || this.reminder.identity !== this.identityKey()) return;
    this.doc.getElementById('auth-panel')?.classList.remove('menu-open');
    this.options.beforeOpen();
    if (this.reminder.kind === 'rate') this.options.openUnrated();
    else if (this.reminder.kind === 'save') this.signIn('Sign in within 14 days to save your verified guest clears. New clears can earn XP.');
    else this.options.openGuestHistory();
  };
  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    const active = this.doc.activeElement;
    if (!active || (active !== this.action && active !== this.dismiss && active !== this.menu && active.id !== 'btn-auth-guest-progress')) return;
    this.blockedKeys.add(event.code); event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) (active as HTMLElement).click();
  };
  private readonly onKeyup = (event: KeyboardEvent) => {
    if (!this.blockedKeys.delete(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };

  private identityKey(): string {
    const account = this.account();
    if (account) return `account:${account}`;
    const identity = this.identity();
    // Recovery tokens stay in memory and in request headers, never in the DOM or logs.
    return `guest:${identity.guestUserId}:${identity.recoveryToken}`;
  }
  private schedule(force: boolean, delay = 200): void {
    if (this.destroyed) return;
    if (!force && this.currentIdentity === this.identityKey() && Date.now() - this.lastRefresh < REFRESH_INTERVAL) return;
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.timer = this.win.setTimeout(() => { this.timer = null; void this.refresh(); }, delay);
  }
  private async refresh(): Promise<void> {
    if (this.destroyed || this.doc.visibilityState !== 'visible') return;
    const account = this.account();
    const identity = account ? null : this.identity();
    const key = this.identityKey();
    if (key !== this.currentIdentity) { this.reminder = null; this.dismissed = ''; this.currentIdentity = key; }
    const generation = ++this.generation;
    this.lastRefresh = Date.now();
    const local = account ? [] : this.local();
    const reviewLocal = local.some(record => !record.guestProgress || record.guestProgress.status !== 'saved');
    if (!account && (reviewLocal || this.sessionGuestClear)) this.reminder = { kind: 'history', count: 0, identity: key };
    this.render();
    try {
      const count = account ? await this.loadUnratedCount() : (await this.pending(identity!)).totalClears;
      if (this.destroyed || generation !== this.generation || key !== this.identityKey()) return;
      if (!Number.isInteger(count) || count < 0) throw new Error('Invalid progress count.');
      this.reminder = count > 0 ? { kind: account ? 'rate' : 'save', count, identity: key }
        : !account && reviewLocal ? { kind: 'history', count: 0, identity: key } : null;
      this.render();
    } catch {
      if (this.destroyed || generation !== this.generation || key !== this.identityKey()) return;
      // Offline browser records can be reviewed; they do not establish claimable clears or XP.
      if (!account && (local.length || this.sessionGuestClear)) this.reminder = { kind: 'history', count: 0, identity: key };
      this.render(); this.schedule(true, REFRESH_INTERVAL);
    }
  }
  private reminderKey(): string {
    return this.reminder ? `${this.reminder.identity}:${this.reminder.kind}:${this.reminder.count}` : '';
  }
  private render(): void {
    const value = this.reminder;
    const label = value?.kind === 'rate' ? `Rate ${value.count} ${value.count === 1 ? 'room' : 'rooms'}`
      : value?.kind === 'save' ? `Save ${value.count} ${value.count === 1 ? 'clear' : 'clears'}` : 'Guest clears';
    if (this.action && this.action.textContent !== label) this.action.textContent = label;
    if (this.menu && this.menu.textContent !== label) this.menu.textContent = label;
    const mode = this.doc.body.dataset.appMode;
    this.menu?.classList.toggle('hidden', value?.kind !== 'rate' || this.destroyed || (mode !== 'world' && mode !== 'play-world'));
    const blocked = this.doc.getElementById('auth-panel')?.classList.contains('menu-open')
      || ['busy-overlay', 'reward-sting-layer', 'xp-receipt-layer'].some(id => {
        const element = this.doc.getElementById(id); return element && !element.classList.contains('hidden');
      })
      || Array.from(this.doc.querySelectorAll('.history-modal, .pvp-modal[aria-modal="true"]')).some(element =>
        !element.classList.contains('hidden') && element.getAttribute('aria-hidden') !== 'true');
    const visible = !this.destroyed && value && this.dismissed !== this.reminderKey() && !blocked
      && this.doc.body.dataset.appReady === 'true' && (mode === 'world' || mode === 'play-world');
    this.root?.classList.toggle('hidden', !visible);
  }
}
