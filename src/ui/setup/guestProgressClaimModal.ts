import { AUTH_SESSION_REFRESHED_EVENT, AUTH_STATE_CHANGED_EVENT, promptForSignIn } from '../../auth/client';
import { guestClaimAccountId, getGuestRunClaimService, GUEST_ACCOUNT_PROGRESS_EVENT, type GuestRunClaimService } from '../../guestRooms/runClaimService';
import { GUEST_RUN_CLAIM_KEY_PREFIX } from '../../guestRooms/runClaimJournal';
import { GUEST_RUN_FINISH_KEY_PREFIX } from '../../guestRooms/runFinishQueue';
import { resolveGuestRunReplayLink, type GuestRunReplayLink } from '../../guestRooms/runReplayLinks';
import { GUEST_RUN_PROGRESS_CHANGED_EVENT } from '../../guestRooms/runService';
import type { GuestRunClaimResponse, GuestRunSavedClear } from '../../guestRooms/runModel';
import { loadGuestRunProgress, type GuestRunProgressRecord } from '../../progression/guestRunProgress';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { APP_READY_EVENT } from '../appFeedback';
import { createModalLifecycle } from './modalLifecycle';
import { requestProfileInvalidation } from './profileEvents';

interface Options {
  service?: Pick<GuestRunClaimService, 'sync' | 'receipts' | 'markPresented' | 'history'>;
  account?: () => string | null;
  local?: () => GuestRunProgressRecord[];
  replay?: typeof resolveGuestRunReplayLink;
  invalidate?: typeof requestProfileInvalidation;
}

/** One auth/session surface covers email, wallet, magic-link return and cross-tab retries. */
export class GuestProgressClaimModalController {
  private readonly service;
  private readonly account;
  private readonly local;
  private readonly replay;
  private readonly invalidate;
  private readonly modal;
  private readonly title;
  private readonly meta;
  private readonly list;
  private readonly status;
  private readonly menu;
  private readonly closeButton;
  private readonly signInButton;
  private readonly lifecycle;
  private readonly invalidated = new Set<string>();
  private readonly queuedRuns = new Set<string>();
  private readonly legacySeen = new Map<string, string>();
  private syncTimer: number | null = null;
  private presentTimer: number | null = null;
  private syncing = false;
  private rerun = false;
  private presenting = false;
  private destroyed = false;
  private generation = 0;
  private visibleAccount: string | null = null;
  private syncError: string | null = null;

  constructor(private readonly doc: Document = document, private readonly win: Window = window, options: Options = {}) {
    this.service = options.service ?? getGuestRunClaimService(); this.account = options.account ?? guestClaimAccountId;
    this.local = options.local ?? (() => loadGuestRunProgress().records); this.replay = options.replay ?? resolveGuestRunReplayLink;
    this.invalidate = options.invalidate ?? requestProfileInvalidation;
    this.modal = doc.getElementById('guest-progress-modal'); this.title = doc.getElementById('guest-progress-title');
    this.meta = doc.getElementById('guest-progress-meta'); this.list = doc.getElementById('guest-progress-list');
    this.status = doc.getElementById('guest-progress-status'); this.menu = doc.getElementById('btn-auth-guest-progress');
    this.closeButton = doc.getElementById('btn-guest-progress-close'); this.signInButton = doc.getElementById('btn-guest-progress-signin');
    this.lifecycle = createModalLifecycle({ doc, modal: this.modal, onClose: () => this.close() });
  }

  init(): void {
    for (const name of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT]) this.win.addEventListener(name, this.onAuth);
    for (const name of ['focus', 'online']) this.win.addEventListener(name, this.onWake);
    this.win.addEventListener(GUEST_RUN_PROGRESS_CHANGED_EVENT, this.onRunProgress);
    this.win.addEventListener('storage', this.onStorage);
    this.win.addEventListener(GUEST_ACCOUNT_PROGRESS_EVENT, this.onReceipt);
    for (const name of [APP_MODE_CHANGED_EVENT, APP_READY_EVENT]) this.win.addEventListener(name, this.onMode);
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.menu?.addEventListener('click', this.onMenu); this.closeButton?.addEventListener('click', this.onClose);
    this.signInButton?.addEventListener('click', this.onSignIn); this.lifecycle.attach();
    this.scheduleSync(200);
  }

  destroy(): void {
    this.destroyed = true;
    for (const name of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT]) this.win.removeEventListener(name, this.onAuth);
    for (const name of ['focus', 'online']) this.win.removeEventListener(name, this.onWake);
    this.win.removeEventListener(GUEST_RUN_PROGRESS_CHANGED_EVENT, this.onRunProgress);
    this.win.removeEventListener('storage', this.onStorage); this.win.removeEventListener(GUEST_ACCOUNT_PROGRESS_EVENT, this.onReceipt);
    for (const name of [APP_MODE_CHANGED_EVENT, APP_READY_EVENT]) this.win.removeEventListener(name, this.onMode);
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.menu?.removeEventListener('click', this.onMenu); this.closeButton?.removeEventListener('click', this.onClose);
    this.signInButton?.removeEventListener('click', this.onSignIn); this.lifecycle.detach();
    if (this.syncTimer !== null) this.win.clearTimeout(this.syncTimer);
    if (this.presentTimer !== null) this.win.clearTimeout(this.presentTimer);
    this.close();
  }

  close(): void { this.generation++; this.lifecycle.hide(); this.visibleAccount = null; this.tryPresent(); }

  private readonly onClose = () => this.close();
  private readonly onSignIn = () => { this.close(); promptForSignIn('Sign in to save verified guest clears. Older browser-only clears can be replayed to earn XP.'); };
  private readonly onAuth = () => {
    if (this.lifecycle.isOpen() && this.visibleAccount !== this.account()) this.close();
    this.scheduleSync(200); // Same-account refreshes also recover a lost claim acknowledgement.
  };
  private readonly onWake = () => this.scheduleSync(200);
  private readonly onRunProgress = (event: Event) => {
    const progress = (event as CustomEvent<{ clientRunId?: string; status?: string }>).detail;
    if (!progress?.clientRunId) return;
    if (progress.status === 'queued') {
      // Flush emits the same queued status on failure; it must not replace the retry delay with a 200ms loop.
      if (this.queuedRuns.has(progress.clientRunId)) return;
      this.queuedRuns.add(progress.clientRunId);
      if (this.queuedRuns.size > 50) this.queuedRuns.delete(this.queuedRuns.values().next().value!);
    } else this.queuedRuns.delete(progress.clientRunId);
    this.scheduleSync(200);
  };
  private readonly onVisibility = () => { if (this.doc.visibilityState === 'visible') { this.scheduleSync(200); this.tryPresent(); } };
  private readonly onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || key?.startsWith(GUEST_RUN_CLAIM_KEY_PREFIX) || key?.startsWith(GUEST_RUN_FINISH_KEY_PREFIX)
      || key === 'wamp_guest_run_progress_v1') this.scheduleSync(200);
  };
  private readonly onReceipt = () => { this.invalidateReceipts(); this.tryPresent(); };
  private readonly onMode = () => {
    if (this.doc.body.dataset.appMode !== 'world' && this.lifecycle.isOpen()) this.close();
    this.tryPresent();
  };
  private readonly onMenu = () => {
    this.doc.getElementById('auth-panel')?.classList.remove('menu-open');
    if (!this.canPresent()) return;
    const receipt = this.service.receipts().find(value => value.clearsSaved > 0);
    if (receipt) { this.tryPresent(); return; }
    this.open(null);
    this.scheduleSync(0);
  };

  private scheduleSync(delay: number): void {
    if (this.destroyed) return;
    if (this.syncTimer !== null) this.win.clearTimeout(this.syncTimer);
    this.syncTimer = this.win.setTimeout(() => { this.syncTimer = null; void this.sync(); }, delay);
  }

  private async sync(): Promise<void> {
    if (this.destroyed || this.doc.visibilityState !== 'visible') return;
    if (this.syncing) { this.rerun = true; return; }
    this.syncing = true;
    try {
      const result = await this.service.sync();
      if (this.destroyed) return;
      this.syncError = result.error;
      this.invalidateReceipts();
      if (this.lifecycle.isOpen()) this.renderStatus();
      this.tryPresent();
      if (result.retry) this.scheduleSync(20000);
    } catch {
      this.syncError = 'Your progress is waiting for a connection. Keep your browser data while we retry.';
      if (!this.destroyed) { this.renderStatus(); this.scheduleSync(20000); }
    } finally {
      this.syncing = false;
      if (this.rerun && !this.destroyed) { this.rerun = false; this.scheduleSync(200); }
    }
  }

  private invalidateReceipts(): void {
    for (const receipt of this.service.receipts()) {
      if (receipt.clearsSaved > 0 && !this.invalidated.has(receipt.claimId)) {
        this.invalidated.add(receipt.claimId); this.invalidate(receipt.userId);
      }
      if (!receipt.clearsSaved) this.service.markPresented(receipt);
    }
  }

  private canPresent(): boolean {
    if (this.destroyed || !this.modal || this.doc.visibilityState !== 'visible' || this.doc.body.dataset.appReady !== 'true'
      || (typeof this.doc.hasFocus === 'function' && !this.doc.hasFocus())
      || this.doc.body.dataset.appMode !== 'world' || this.doc.getElementById('auth-panel')?.classList.contains('menu-open')) return false;
    if (['busy-overlay', 'reward-sting-layer', 'xp-receipt-layer'].some(id => {
      const element = this.doc.getElementById(id); return element && !element.classList.contains('hidden');
    })) return false;
    return !Array.from(this.doc.querySelectorAll<HTMLElement>('.history-modal, .pvp-modal[aria-modal="true"]'))
      .some(modal => modal !== this.modal && !modal.classList.contains('hidden') && modal.getAttribute('aria-hidden') !== 'true');
  }

  private tryPresent(): void {
    if (this.destroyed || this.lifecycle.isOpen() || this.presenting) return;
    if (this.presentTimer !== null) { this.win.clearTimeout(this.presentTimer); this.presentTimer = null; }
    const account = this.account();
    if (!account) return;
    const receipt = this.service.receipts().find(value => value.clearsSaved > 0);
    const legacy = this.local().filter(record => !record.guestProgress || record.guestProgress.status === 'unverified');
    const legacyKey = legacy.map(record => record.id).join('|');
    if (!receipt && (!legacy.length || this.legacySeen.get(account) === legacyKey)) return;
    if (!this.canPresent()) {
      this.presentTimer = this.win.setTimeout(() => { this.presentTimer = null; this.tryPresent(); }, 300);
      return;
    }
    if (!receipt) { this.legacySeen.set(account, legacyKey); this.open(null); return; }
    this.presenting = true;
    const present = () => {
      if (!this.canPresent() || this.lifecycle.isOpen() || this.account() !== receipt.userId) return;
      if (this.service.markPresented(receipt)) {
        this.legacySeen.set(account, legacyKey); this.open(receipt);
      }
    };
    // Prevent two browser tabs from showing the same receipt at the same time.
    const locks = this.win.navigator?.locks;
    void (locks ? locks.request(`wamp-guest-receipt:${receipt.claimId}`, present) : Promise.resolve().then(present))
      .catch(() => present())
      .finally(() => { this.presenting = false; this.tryPresent(); });
  }

  private open(receipt: GuestRunClaimResponse | null): void {
    if (!this.lifecycle.show()) return;
    this.visibleAccount = this.account();
    const generation = ++this.generation;
    if (this.title) this.title.textContent = receipt ? `We saved ${receipt.clearsSaved} clear${receipt.clearsSaved === 1 ? '' : 's'}${receipt.pxpAwarded ? ` (+${receipt.pxpAwarded} XP)` : ''}` : 'Guest clears';
    if (this.meta) this.meta.textContent = receipt?.pxpAwarded === 0
      ? 'These room versions already earned their clear XP. Replay signed in to compete on the leaderboard.'
      : 'Verified clears earn account XP once per room version. Replay signed in to compete on the leaderboard.';
    this.signInButton?.classList.toggle('hidden', Boolean(this.visibleAccount)); this.renderStatus();
    if (this.list) this.list.textContent = 'Loading saved clears…';
    this.closeButton?.focus();
    void this.renderHistory(generation, this.visibleAccount);
  }

  private renderStatus(): void {
    if (this.status) { this.status.textContent = this.syncError ?? ''; this.status.classList.toggle('hidden', !this.syncError); }
  }

  private async renderHistory(generation: number, account: string | null): Promise<void> {
    let clears: GuestRunSavedClear[] = [];
    let count = 0;
    if (account) {
      try { const history = await this.service.history(); clears = history?.clears ?? []; count = history?.totalClears ?? 0; }
      catch { if (this.current(generation, account) && this.status) { this.status.textContent = 'Saved account history is unavailable. Your awarded XP is safe; try again when connected.'; this.status.classList.remove('hidden'); } }
    }
    if (!this.current(generation, account) || !this.list) return;
    this.list.textContent = '';
    if (clears.length) {
      const heading = this.doc.createElement('p'); heading.textContent = `Saved to this account: ${count} clear${count === 1 ? '' : 's'}${count > clears.length ? ` (showing the latest ${clears.length})` : ''}.`; this.list.appendChild(heading);
    }
    const saved = new Set(clears.map(clear => clear.attemptId));
    const rows: Array<{ target: GuestRunSavedClear | GuestRunProgressRecord; label: string }> = clears.map(target => ({ target, label: 'Saved to account' }));
    for (const target of this.local()) {
      if (target.guestProgress?.attemptId && saved.has(target.guestProgress.attemptId)) continue;
      rows.push({ target, label: target.guestProgress?.status === 'queued' ? 'Waiting for a connection'
        : target.guestProgress?.status === 'saved' ? Date.parse(target.completedAt) < Date.now() - 14 * 86400000
          ? 'Claim window ended — replay signed in to earn XP' : account ? 'Verified guest clear — account transfer will retry automatically' : 'Guest clear — sign in within 14 days to save eligible progress'
          : 'Browser-only clear — replay signed in to earn XP' });
    }
    if (!rows.length) this.list.textContent = 'No guest clears yet. Complete a published room to get started.';
    for (const { target, label } of rows) {
      const row = this.doc.createElement('div'); row.className = 'guest-progress-row';
      const title = this.doc.createElement('strong'); title.textContent = target.contentTitle || `${target.contentType === 'room' ? 'Room' : 'Expanded room'} ${target.contentId}`;
      const detail = this.doc.createElement('p'); detail.textContent = `${label} · Version ${target.version}`;
      row.appendChild(title); row.appendChild(detail); this.list.appendChild(row);
      void this.replay(target).then(link => {
        if (!this.current(generation, account)) return;
        this.appendReplay(row, link);
      }).catch(() => { if (this.current(generation, account)) this.appendReplay(row, null); });
    }
  }

  private current(generation: number, account: string | null): boolean {
    return !this.destroyed && generation === this.generation && this.lifecycle.isOpen() && this.account() === account;
  }
  private appendReplay(row: HTMLElement, link: GuestRunReplayLink | null): void {
    const element = this.doc.createElement(link ? 'a' : 'span');
    element.textContent = link?.label ?? 'Room unavailable';
    if (link) { (element as HTMLAnchorElement).href = link.href; element.className = 'bar-btn bar-btn-small'; }
    row.appendChild(element);
  }
}
