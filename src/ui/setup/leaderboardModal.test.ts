import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: true, user: { id: 'me' } }) }));
vi.mock('./globalLeaderboardPanel', () => ({ GlobalLeaderboardPanelController: class { setActive() {} } }));
import { LeaderboardModalController } from './leaderboardModal';

class Item extends EventTarget {
  classes = new Set<string>(); attributes = new Map<string, string>(); dataset: Record<string, string> = {};
  disabled = false; textContent = ''; className = ''; value = '';
  classList = { contains: (c: string) => this.classes.has(c), add: (c: string) => this.classes.add(c), remove: (c: string) => this.classes.delete(c),
    toggle: (c: string, on = !this.classes.has(c)) => { if (on) this.classes.add(c); else this.classes.delete(c); return on; } };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  replaceChildren() {} appendChild<T>(child: T) { return child; }
}
const button = (data: Record<string, string>) => Object.assign(new Item(), { dataset: data });
function fixture() {
  const stars = ['1', '2', '3', '4', '5'].map(roomQualityStars => button({ roomQualityStars }));
  const difficulties = ['easy', 'medium', 'hard', 'extreme'].map(roomDifficulty => button({ roomDifficulty }));
  const rushModes = ['hard:weekly', 'easy:selected', 'hard:selected'].map(roomRushLeaderboardMode => button({ roomRushLeaderboardMode }));
  const items = new Map<string, Item>();
  const get = (id: string) => { if (!items.has(id)) items.set(id, new Item()); return items.get(id)!; };
  const doc = Object.assign(new EventTarget(), {
    getElementById: get,
    querySelectorAll: (selector: string) => selector.includes('quality') ? stars
      : selector.includes('difficulty') ? difficulties : selector.includes('room-rush-modes') ? rushModes : [],
    createElement: () => new Item(),
  });
  const leaderboard = new LeaderboardModalController({} as never, {} as never, {} as never, {} as never, doc as unknown as Document, {} as never);
  const state = leaderboard as unknown as Record<string, unknown> & { render(): void; renderRoomPanel(): void };
  return { stars, difficulties, rushModes, get, state };
}
function roomBoard(rating: { stars: number | null; vote: string | null; canVote: boolean; needsRun: boolean }) {
  return {
    roomVersion: 2, entries: [], rankingMode: 'time', trophy: null, viewerBest: null, viewerRank: null,
    quality: { adjustedAverage: 4, counts: { oneStar: 0, twoStar: 0, threeStar: 1, fourStar: 2, fiveStar: 3 } },
    viewerRating: { qualityStars: rating.stars },
    difficulty: { totalVotes: 1, consensus: 'medium', counts: { easy: 0, medium: 1, hard: 0, extreme: 0 }, viewerVote: rating.vote,
      viewerCanVote: rating.canVote, viewerSignedIn: true, viewerNeedsRun: rating.needsRun },
  };
}
const pressed = (items: Item[]) => items.map(item => item.getAttribute('aria-pressed') === 'true' && item.classes.has('active'));

describe('Leaderboard shows your own rating and the open tab (F464)', () => {
  it('marks the stars and difficulty you gave, for sight and screen readers', () => {
    const f = fixture();
    Object.assign(f.state, { roomLoaded: true, currentPublishedVersion: 2, roomLeaderboard: roomBoard({ stars: 3, vote: 'medium', canVote: true, needsRun: false }) });
    f.state.renderRoomPanel();
    expect(pressed(f.stars)).toEqual([false, false, true, false, false]);
    expect(f.stars.map(item => item.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false']);
    expect(pressed(f.difficulties)).toEqual([false, true, false, false]);
    expect(f.get('leaderboard-room-difficulty-status').textContent).toBe('Your current rating: 3 stars · Medium.');
  });

  it('keeps a carried-forward rating marked while the buttons wait for a new run', () => {
    const f = fixture();
    Object.assign(f.state, { roomLoaded: true, currentPublishedVersion: 2, roomLeaderboard: roomBoard({ stars: 5, vote: null, canVote: false, needsRun: true }) });
    f.state.renderRoomPanel();
    expect(f.stars.every(item => item.disabled)).toBe(true);
    expect(pressed(f.stars)).toEqual([false, false, false, false, true]);
    expect(pressed(f.difficulties)).toEqual([false, false, false, false]);
  });

  it('presses the tab whose panel is on screen, after an unavailable tab falls back', () => {
    const f = fixture();
    Object.assign(f.state, { activeTab: 'room', roomContext: null, selectedRoomRushMode: 'easy:selected' });
    f.state.render();
    const tabs = ['room', 'course', 'room-rush', 'global'].map(tab => f.get(`btn-leaderboard-tab-${tab}`).getAttribute('aria-pressed'));
    expect(tabs).toEqual(['false', 'false', 'false', 'true']);
    expect(f.get('leaderboard-global-panel').classes.has('hidden')).toBe(false);
    expect(pressed(f.rushModes)).toEqual([false, true, false]);
  });
});
