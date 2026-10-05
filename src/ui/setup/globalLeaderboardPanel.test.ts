import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth', AUTH_SESSION_REFRESHED_EVENT: 'session', getAuthDebugState: () => ({ user: null }) }));
import { GlobalLeaderboardPanelController } from './globalLeaderboardPanel';
import type { GlobalLeaderboardEntry, GlobalLeaderboardResponse } from '../../runs/model';
import { globalLeaderboardWeek } from '../../runs/globalLeaderboardWindow';

class Element extends EventTarget {
  classes = new Set<string>(); classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name), toggle: (name: string, force: boolean) => force ? this.classes.add(name) : this.classes.delete(name) };
  private text = ''; children: Element[] = []; disabled = false; className = ''; type = ''; title = '';
  set textContent(value: string) { this.text = value; this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  setAttribute = vi.fn(); replaceChildren() { this.text = ''; this.children = []; }
  appendChild(child: Element) { this.children.push(child); return child; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
const entry: GlobalLeaderboardEntry = { rank: 40, userId: 'actor', userDisplayName: 'Actor', totalPoints: 99999, pointsInWindow: 20, totalScore: 0, totalRoomsPublished: 1, completedRuns: 100, failedRuns: 0, abandonedRuns: 0, pvpWins: 0, pvpLosses: 0, pvpDraws: 0, bestScore: 0, fastestClearMs: null, updatedAt: '2026-10-05T18:00:00.000Z' };
const controllers: GlobalLeaderboardPanelController[] = [];
function response(): GlobalLeaderboardResponse { return { window: 'week', period: globalLeaderboardWeek(new Date()), serverTime: new Date().toISOString(), entries: [entry], viewerEntry: entry, viewerNext: { userId: 'above', userDisplayName: 'Above', pointsToPass: 5 } }; }
function fixture(id: string | null = null, rank = 99) {
  const elements = new Map<string, Element>(); const get = (key: string) => { if (!elements.has(key)) elements.set(key, new Element()); return elements.get(key)!; };
  const doc = Object.assign(new EventTarget(), { hidden: false, getElementById: get, createElement: () => new Element() });
  const win = new EventTarget(); let userId = id;
  const repository = { loadGlobalLeaderboard: vi.fn(async (_limit: number, window = 'all', _signal?: AbortSignal): Promise<GlobalLeaderboardResponse> => window === 'week' ? response() : { entries: [], viewerEntry: userId ? { ...entry, rank } : null }) };
  const controller = new GlobalLeaderboardPanelController(repository, doc as unknown as Document, win, () => userId);
  controllers.push(controller); return { controller, repository, get, doc, win, account: (id: string | null) => { userId = id; win.dispatchEvent(new Event('auth')); } };
}
const tick = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T18:00:00.000Z')); });
afterEach(() => { for (const controller of controllers.splice(0)) controller.destroy(); vi.useRealTimers(); });
describe('global leaderboard window lifecycle', () => {
  it('defaults guests and outside-top-50 viewers to weekly points, retaining the lifetime default for top 50', async () => {
    const guest = fixture(); guest.controller.setActive(true); await tick();
    expect(guest.repository.loadGlobalLeaderboard.mock.calls.map(call => call[1])).toEqual(['week']);
    for (const [rank, expected] of [[50, 'all'], [51, 'week']] as const) {
      const f = fixture('actor', rank); f.controller.setActive(true); await tick();
      expect(f.get(`btn-leaderboard-global-${expected}`).classes.has('active')).toBe(true);
    }
    const f = fixture('actor'); f.controller.setActive(true); await tick();
    expect(f.get('leaderboard-global-viewer').textContent).toBe('You: #40 · 20 pts · 5 pts to pass Above');
    expect(f.get('leaderboard-global-list').textContent).not.toContain('99999');
    expect(f.get('leaderboard-global-list').textContent).not.toContain('100 clears');
  });
  it('makes failed reads retryable and ignores an old window after a rapid switch', async () => {
    const f = fixture(); f.repository.loadGlobalLeaderboard.mockRejectedValueOnce(new Error('offline'));
    f.controller.setActive(true); await tick(); expect(f.get('leaderboard-global-summary').textContent).toContain('Try Refresh');
    expect(f.get('btn-leaderboard-global-refresh').disabled).toBe(false);
    let resolve!: (value: GlobalLeaderboardResponse) => void;
    f.repository.loadGlobalLeaderboard.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.get('btn-leaderboard-global-refresh').click(); const oldSignal = f.repository.loadGlobalLeaderboard.mock.calls.at(-1)?.[2];
    f.get('btn-leaderboard-global-all').click(); await tick(); resolve(response()); await tick();
    expect(oldSignal?.aborted).toBe(true); expect(f.get('btn-leaderboard-global-all').classes.has('active')).toBe(true);
    expect(f.get('leaderboard-global-summary').textContent).toContain('All-time');
  });
  it('cancels closed reads and resets the selected window and viewer after an account change', async () => {
    const f = fixture('actor', 1); f.controller.setActive(true); await tick();
    expect(f.get('btn-leaderboard-global-all').classes.has('active')).toBe(true);
    f.account(null); await tick(); expect(f.get('btn-leaderboard-global-week').classes.has('active')).toBe(true);
    expect(f.get('leaderboard-global-viewer').textContent).toBe('');
    let resolve!: (value: GlobalLeaderboardResponse) => void;
    f.repository.loadGlobalLeaderboard.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.get('btn-leaderboard-global-refresh').click(); f.controller.close(); resolve(response()); await tick();
    expect(f.get('leaderboard-global-list').textContent).toBe('');
  });
  it('refreshes at the Monday UTC boundary while open', async () => {
    vi.setSystemTime(new Date('2026-10-04T23:59:59.900Z'));
    const f = fixture(); f.controller.setActive(true); await tick(); expect(f.repository.loadGlobalLeaderboard).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.repository.loadGlobalLeaderboard).toHaveBeenCalledTimes(2);
    expect(f.get('leaderboard-global-summary').textContent).toContain('Oct 12');
  });
});
