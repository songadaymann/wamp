import { AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, getAuthDebugState } from '../../auth/client';
import type { GlobalLeaderboardEntry, GlobalLeaderboardResponse, GlobalLeaderboardWindow } from '../../runs/model';
import type { RunRepository } from '../../runs/runRepository';
import { createProfileTriggerElement } from './profileEvents';

/** Owns window selection, fresh viewer reads and cancellation independently of room tabs. */
export class GlobalLeaderboardPanelController {
  private readonly weekButton: HTMLButtonElement | null;
  private readonly allButton: HTMLButtonElement | null;
  private readonly refreshButton: HTMLButtonElement | null;
  private readonly summary: HTMLElement | null;
  private readonly viewer: HTMLElement | null;
  private readonly list: HTMLElement | null;
  private visible = false;
  private selected: GlobalLeaderboardWindow | null = null;
  private userId: string | null = null;
  private response: GlobalLeaderboardResponse | null = null;
  private error: string | null = null;
  private loading = false;
  private generation = 0;
  private abort: AbortController | null = null;
  private rolloverTimer: ReturnType<typeof setTimeout> | null = null;
  private rolloverAt: number | null = null;

  constructor(
    private readonly repository: Pick<RunRepository, 'loadGlobalLeaderboard'>,
    private readonly doc: Document = document,
    private readonly events: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
    private readonly identity: () => string | null = () => getAuthDebugState().user?.id ?? null,
  ) {
    this.weekButton = doc.getElementById('btn-leaderboard-global-week') as HTMLButtonElement | null;
    this.allButton = doc.getElementById('btn-leaderboard-global-all') as HTMLButtonElement | null;
    this.refreshButton = doc.getElementById('btn-leaderboard-global-refresh') as HTMLButtonElement | null;
    this.summary = doc.getElementById('leaderboard-global-summary');
    this.viewer = doc.getElementById('leaderboard-global-viewer');
    this.list = doc.getElementById('leaderboard-global-list');
    this.weekButton?.addEventListener('click', this.selectWeek);
    this.allButton?.addEventListener('click', this.selectAll);
    this.refreshButton?.addEventListener('click', this.handleRefresh);
    events.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleIdentity);
    events.addEventListener(AUTH_SESSION_REFRESHED_EVENT, this.handleIdentity);
    events.addEventListener('focus', this.handleWake);
    doc.addEventListener('visibilitychange', this.handleWake);
  }

  private readonly selectWeek = () => this.select('week');
  private readonly selectAll = () => this.select('all');
  private readonly handleRefresh = () => { void this.refresh(); };
  private readonly handleWake = () => {
    if (this.visible && !this.doc.hidden && this.rolloverAt !== null && Date.now() >= this.rolloverAt) {
      void this.refresh();
    }
  };
  private readonly handleIdentity = () => {
    // Session refreshes can change the cookie before the public auth-state event.
    const next = this.identity();
    if (next !== this.userId) this.selected = null;
    this.userId = next;
    this.response = null;
    this.cancel();
    if (this.visible) void this.refresh();
  };

  setActive(active: boolean): void {
    if (active === this.visible) return;
    this.visible = active;
    if (!active) { this.cancel(); return; }
    const next = this.identity();
    if (next !== this.userId) this.selected = null;
    this.userId = next;
    // Returning from another tab always gets a fresh score and current week.
    void this.refresh();
  }

  close(): void {
    this.visible = false;
    this.cancel();
    this.response = null;
    this.error = null;
  }

  destroy(): void {
    this.close();
    this.weekButton?.removeEventListener('click', this.selectWeek);
    this.allButton?.removeEventListener('click', this.selectAll);
    this.refreshButton?.removeEventListener('click', this.handleRefresh);
    this.events.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.handleIdentity);
    this.events.removeEventListener(AUTH_SESSION_REFRESHED_EVENT, this.handleIdentity);
    this.events.removeEventListener('focus', this.handleWake);
    this.doc.removeEventListener('visibilitychange', this.handleWake);
  }

  private select(window: GlobalLeaderboardWindow): void {
    this.selected = window;
    if (this.visible) void this.refresh();
  }

  private cancel(): void {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.loading = false;
    if (this.rolloverTimer !== null) clearTimeout(this.rolloverTimer);
    this.rolloverTimer = null;
    this.rolloverAt = null;
  }

  private async refresh(): Promise<void> {
    this.cancel();
    if (!this.visible) return;
    const generation = this.generation;
    const userId = this.userId;
    const abort = new AbortController();
    this.abort = abort;
    const current = () => this.visible && generation === this.generation && userId === this.identity();
    this.loading = true;
    this.response = null;
    this.error = null;
    this.render();
    try {
      let initial: GlobalLeaderboardResponse | null = null;
      if (this.selected === null) {
        if (userId !== null) {
          initial = await this.repository.loadGlobalLeaderboard(25, 'all', abort.signal);
          if (!current()) return;
        }
        this.selected = initial?.viewerEntry && initial.viewerEntry.rank <= 50 ? 'all' : 'week';
      }
      const response = this.selected === 'all' && initial ? initial
        : await this.repository.loadGlobalLeaderboard(25, this.selected, abort.signal);
      if (!current()) return;
      this.response = response;
      if (this.selected === 'week' && response.period && response.serverTime) {
        const delay = Math.max(50, Date.parse(response.period.endsAt) - Date.parse(response.serverTime) + 50);
        this.rolloverAt = Date.now() + delay;
        this.rolloverTimer = setTimeout(() => { if (current()) void this.refresh(); }, delay);
      }
    } catch (error) {
      if (!current()) return;
      this.error = error instanceof Error ? error.message : 'Could not load leaderboard.';
    } finally {
      if (current()) {
        this.loading = false;
        this.abort = null;
        this.render();
      }
    }
  }

  private render(): void {
    if (!this.summary || !this.viewer || !this.list) return;
    for (const [button, window] of [[this.weekButton, 'week'], [this.allButton, 'all']] as const) {
      button?.classList.toggle('active', this.selected === window);
      button?.setAttribute('aria-pressed', String(this.selected === window));
    }
    if (this.refreshButton) this.refreshButton.disabled = this.loading;
    this.list.replaceChildren();
    this.viewer.replaceChildren();
    this.viewer.classList.add('hidden');
    if (this.loading) { this.summary.textContent = 'Loading leaderboard…'; return; }
    if (this.error) { this.summary.textContent = this.error.includes('Try Refresh') ? this.error : `${this.error} Try Refresh.`; return; }
    const response = this.response;
    const weekly = this.selected === 'week';
    const reset = response?.period ? new Date(response.period.endsAt).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', timeZone: 'UTC',
    }) : '';
    this.summary.textContent = weekly ? `Resets ${reset}, 00:00 UTC.`
      : 'All-time publishing and challenge points.';
    if (this.userId !== null) {
      this.viewer.classList.remove('hidden');
      const viewer = response?.viewerEntry;
      this.viewer.textContent = viewer ? `You: #${viewer.rank} · ${this.points(viewer)} pts` : weekly
        ? 'No points this week yet.' : 'No points yet.';
      const next = response?.viewerNext;
      if (viewer && next) {
        this.viewer.appendChild(this.cell('leaderboard-viewer', ` · ${next.pointsToPass} pts to pass `));
        this.viewer.appendChild(createProfileTriggerElement(this.doc, next.userId, next.userDisplayName, 'leaderboard-viewer'));
      } else if (viewer?.rank === 1) this.viewer.appendChild(this.cell('leaderboard-viewer', ' · You lead!'));
    }
    if (!response?.entries.length) {
      this.list.appendChild(this.cell('leaderboard-empty', weekly ? 'No points this week yet.' : 'No global points yet.'));
      return;
    }
    for (const entry of response.entries) {
      const row = this.doc.createElement('div');
      row.className = `history-version-row leaderboard-row leaderboard-global-row${weekly ? ' leaderboard-week-row' : ''}`;
      row.appendChild(this.cell('leaderboard-rank', `#${entry.rank}`));
      row.appendChild(createProfileTriggerElement(this.doc, entry.userId, entry.userDisplayName, 'leaderboard-primary', 'div'));
      row.appendChild(this.cell('leaderboard-primary leaderboard-points', `${this.points(entry)} pts`));
      if (!weekly) {
        row.appendChild(this.cell('leaderboard-secondary', `${entry.completedRuns} clears`));
        row.appendChild(this.cell('leaderboard-secondary', `${entry.totalRoomsPublished} rooms`));
      }
      this.list.appendChild(row);
    }
  }

  private points(entry: GlobalLeaderboardEntry): number {
    return this.selected === 'week' ? entry.pointsInWindow ?? 0 : entry.totalPoints;
  }
  private cell(className: string, text: string): HTMLElement {
    const cell = this.doc.createElement('span');
    cell.className = className;
    cell.textContent = text;
    return cell;
  }
}
