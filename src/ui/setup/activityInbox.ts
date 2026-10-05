import { AUTH_SESSION_REFRESHED_EVENT, AUTH_STATE_CHANGED_EVENT, getAuthDebugState, type AuthDebugState } from '../../auth/client';
import { activityDescription, type ActivityResponse, type BuilderActivity } from '../../activity/model';
import { createActivityRepository, type ActivityRepository } from '../../activity/repository';
import { createModalLifecycle } from './modalLifecycle';

export class ActivityInboxController {
  private readonly modal;
  private readonly bell;
  private readonly count;
  private readonly closeButton;
  private readonly more;
  private readonly retry;
  private readonly list;
  private readonly status;
  private readonly catchup;
  private readonly weekly;
  private readonly dethrone;
  private readonly daily;
  private readonly save;
  private readonly preferencesStatus;
  private readonly lifecycle;
  private userId: string | null = null;
  private generation = 0;
  private destroyed = false;
  private busy = false;
  private saving = false;
  private before: number | null = null;
  private lastLoaded = 0;
  private latest: ActivityResponse | null = null;
  private returnFocus: HTMLElement | null = null;
  private timer: number | null = null;
  private pendingEmailLink = false;
  constructor(private readonly doc: Document = document, private readonly win: Window = window,
    private readonly repository: ActivityRepository = createActivityRepository(), private readonly auth: () => AuthDebugState = getAuthDebugState) {
    this.modal = doc.getElementById('activity-modal'); this.bell = doc.getElementById('btn-activity-open');
    this.count = doc.getElementById('activity-unread-count'); this.closeButton = doc.getElementById('btn-activity-close');
    this.more = doc.getElementById('btn-activity-more') as HTMLButtonElement | null;
    this.retry = doc.getElementById('btn-activity-retry'); this.list = doc.getElementById('activity-list');
    this.status = doc.getElementById('activity-status'); this.catchup = doc.getElementById('activity-catchup');
    this.weekly = doc.getElementById('activity-weekly-digest') as HTMLInputElement | null;
    this.dethrone = doc.getElementById('activity-dethrone-alerts') as HTMLInputElement | null;
    this.daily = doc.getElementById('activity-daily-features') as HTMLInputElement | null;
    this.save = doc.getElementById('btn-activity-save') as HTMLButtonElement | null;
    this.preferencesStatus = doc.getElementById('activity-preferences-status');
    this.lifecycle = createModalLifecycle({ doc, modal: this.modal, onClose: () => this.close() });
  }
  init(): void {
    this.pendingEmailLink = new URLSearchParams(this.win.location.search).get('activity') === '1';
    for (const name of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT]) this.win.addEventListener(name, this.onAuth);
    for (const name of ['focus', 'online']) this.win.addEventListener(name, this.onWake);
    this.doc.addEventListener('visibilitychange', this.onWake);
    this.win.addEventListener('activity-open-request', this.onOpen);
    this.bell?.addEventListener('click', this.onOpen); this.closeButton?.addEventListener('click', this.onClose);
    this.retry?.addEventListener('click', this.onRetry); this.more?.addEventListener('click', this.onMore);
    this.save?.addEventListener('click', this.onSave); this.catchup?.addEventListener('click', this.onOpen);
    this.doc.addEventListener('keydown', this.onKeydown, true); this.lifecycle.attach(); this.syncAuth(this.auth());
    this.timer = this.win.setInterval(() => this.onWake(), 60000);
  }
  destroy(): void {
    this.destroyed = true;
    for (const name of [AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT]) this.win.removeEventListener(name, this.onAuth);
    for (const name of ['focus', 'online']) this.win.removeEventListener(name, this.onWake);
    this.doc.removeEventListener('visibilitychange', this.onWake); this.win.removeEventListener('activity-open-request', this.onOpen);
    this.bell?.removeEventListener('click', this.onOpen); this.closeButton?.removeEventListener('click', this.onClose);
    this.retry?.removeEventListener('click', this.onRetry); this.more?.removeEventListener('click', this.onMore);
    this.save?.removeEventListener('click', this.onSave); this.catchup?.removeEventListener('click', this.onOpen);
    this.doc.removeEventListener('keydown', this.onKeydown, true); this.lifecycle.detach();
    if (this.timer !== null) this.win.clearInterval(this.timer);
    this.close(false); this.userId = null; this.renderBadge(0);
  }
  private readonly onAuth = (event: Event) => this.syncAuth(event instanceof CustomEvent ? event.detail as AuthDebugState : this.auth());
  private readonly onWake = () => { if (this.doc.visibilityState !== 'hidden' && !this.lifecycle.isOpen() && Date.now() - this.lastLoaded >= 60000) void this.refresh(); };
  private readonly onOpen = () => {
    if (!this.userId || this.destroyed) return;
    this.returnFocus = this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : this.bell;
    this.generation++; this.busy = false; this.before = null; this.list?.replaceChildren();
    this.lifecycle.show(); this.closeButton?.focus(); void this.refresh(true);
  };
  private readonly onClose = () => this.close();
  private readonly onRetry = () => { void this.refresh(true); };
  private readonly onMore = () => { if (this.before !== null) void this.refresh(true, this.before); };
  private readonly onSave = () => { void this.savePreferences(); };
  private readonly onKeydown = (event: KeyboardEvent) => {
    if (!this.lifecycle.isOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); }
    if (event.key !== 'Tab') return;
    const elements = Array.from(this.modal?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') ?? [])
      .filter(element => element.getClientRects().length > 0);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && this.doc.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && this.doc.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  private syncAuth(state: AuthDebugState): void {
    const next = state.authenticated && state.source === 'session' ? state.user?.id ?? null : null;
    if (next !== this.userId) {
      this.close(false); this.userId = next; this.latest = null; this.busy = false; this.saving = false;
      this.lastLoaded = 0; this.list?.replaceChildren(); this.renderBadge(0);
    }
    this.bell?.classList.toggle('hidden', !next); this.catchup?.classList.toggle('hidden', !next);
    if (next && this.pendingEmailLink) { this.pendingEmailLink = false; this.onOpen(); return; }
    if (next && Date.now() - this.lastLoaded >= 60000 && !this.lifecycle.isOpen()) void this.refresh();
  }
  private close(focus = true): void {
    this.generation++; this.lifecycle.hide(); this.busy = false; this.saving = false;
    if (focus && this.returnFocus?.isConnected) this.returnFocus.focus(); this.returnFocus = null;
  }
  private valid(userId: string, generation: number): boolean { return !this.destroyed && this.userId === userId && this.generation === generation; }
  private async refresh(show = false, before?: number): Promise<void> {
    if (!this.userId || this.busy || this.destroyed) return;
    const userId = this.userId, generation = this.generation;
    this.busy = true; if (show) this.message('Loading activity…');
    if (this.more) this.more.disabled = true;
    try {
      const response = await this.repository.load(before);
      if (!this.valid(userId, generation)) return;
      this.lastLoaded = Date.now(); this.latest = response; this.renderBadge(response.unreadCount);
      if (!show || !this.lifecycle.isOpen()) return;
      if (!before) { this.list?.replaceChildren(); this.renderPreferences(response); }
      this.renderEntries(response.entries); this.before = response.nextBefore;
      this.more?.classList.toggle('hidden', this.before === null);
      this.message(this.list?.children.length ? '' : 'No activity yet. Confirmed clears, ratings and approved comments will appear here.');
      // A read acknowledges this snapshot only; a newer event stays unread.
      if (!before) {
        await this.repository.markSeen(response.latestId);
        if (this.valid(userId, generation)) this.renderBadge(0);
      }
    } catch {
      if (!this.valid(userId, generation)) return;
      if (show) this.message('Activity could not load. Try again when you’re online.', true);
      else { this.bell?.setAttribute('title', 'Activity could not refresh. Open to retry.'); }
    } finally {
      if (this.valid(userId, generation)) { this.busy = false; if (this.more) this.more.disabled = false; }
    }
  }
  private message(message: string, error = false): void {
    if (this.status) this.status.textContent = message;
    this.retry?.classList.toggle('hidden', !error);
  }
  private renderBadge(count: number): void {
    if (this.count) { this.count.textContent = count > 99 ? '99+' : String(count); this.count.classList.toggle('hidden', count === 0); }
    this.bell?.setAttribute('aria-label', count ? `Activity, ${count} unread` : 'Open Activity');
    this.bell?.setAttribute('title', 'Activity');
    if (this.catchup) { this.catchup.textContent = count ? `${count} new room activities — Open Activity` : 'Open Activity'; this.catchup.classList.toggle('hidden', !this.userId || count === 0); }
  }
  private renderEntries(entries: BuilderActivity[]): void {
    for (const entry of entries) {
      const row = this.doc.createElement('li'); row.className = 'activity-row';
      const link = this.doc.createElement('a'); link.href = entry.contentPath; link.textContent = activityDescription(entry);
      const time = this.doc.createElement('div'); time.className = 'history-modal-meta';
      time.textContent = `v${entry.contentVersion} · ${new Date(entry.createdAt).toLocaleString()}`;
      row.append(link, time); this.list?.append(row);
    }
  }
  private renderPreferences(response: ActivityResponse): void {
    if (this.weekly) { this.weekly.checked = response.preferences.weeklyDigest; this.weekly.disabled = !response.preferences.emailAvailable; }
    if (this.dethrone) { this.dethrone.checked = response.preferences.dethroneAlerts; this.dethrone.disabled = !response.preferences.emailAvailable; }
    if (this.daily) { this.daily.checked = Boolean(response.preferences.dailyFeatures); this.daily.disabled = !response.preferences.emailAvailable; }
    if (this.save) this.save.disabled = !response.preferences.emailAvailable;
    if (this.preferencesStatus) this.preferencesStatus.textContent = response.preferences.emailAvailable
      ? 'Weekly: Monday, noon UTC. Lost #1: at most once per UTC day.' : 'Sign in with an email account to receive activity emails.';
  }
  private async savePreferences(): Promise<void> {
    if (!this.userId || this.saving || !this.latest?.preferences.emailAvailable) return;
    const userId = this.userId, generation = this.generation;
    this.saving = true; if (this.save) this.save.disabled = true;
    try {
      const preferences = await this.repository.savePreferences({ weeklyDigest: Boolean(this.weekly?.checked), dethroneAlerts: Boolean(this.dethrone?.checked), dailyFeatures: Boolean(this.daily?.checked) });
      if (!this.valid(userId, generation)) return;
      if (this.latest) this.latest.preferences = preferences;
      if (this.preferencesStatus) this.preferencesStatus.textContent = 'Email preferences saved.';
    } catch {
      if (this.valid(userId, generation) && this.preferencesStatus) this.preferencesStatus.textContent = 'Preferences were not saved. Try again.';
    } finally {
      if (this.valid(userId, generation)) { this.saving = false; if (this.save) this.save.disabled = false; }
    }
  }
}
