import { afterEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ authenticated: false, source: null as string | null, user: null as { id: string } | null }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth', AUTH_SESSION_REFRESHED_EVENT: 'session',
  getAuthDebugState: () => ({ ...auth }), promptForSignIn: vi.fn() }));
vi.mock('../../guestRooms/runService', () => ({ GUEST_RUN_PROGRESS_CHANGED_EVENT: 'guest-progress' }));
vi.mock('../../progression/guestRunProgress', () => ({ loadGuestRunProgress: () => ({ records: [] }), recordGuestRunClear: vi.fn() }));
import { DailyRoomController } from './dailyRoom';
import type { DailyPick, DailyResponse } from '../../daily/model';
import { POST_RUN_GUEST_CLAIM_REQUEST_EVENT, POST_RUN_RATING_REQUEST_EVENT } from '../../progression/postRunRatingEvents';
class Element extends EventTarget {
  classes = new Set(['hidden']); classList = { contains: (name: string) => this.classes.has(name), add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name), toggle: (name: string, force: boolean) => force ? this.classes.add(name) : this.classes.delete(name) };
  textContent = ''; href = ''; isConnected = true; children: Element[] = [];
  focus = vi.fn(); setAttribute = vi.fn(); replaceChildren() { this.children = []; } append(...elements: Element[]) { this.children.push(...elements); }
}
const pick: DailyPick = { date: '2026-10-22', targetKey: 'room:0,0', contentType: 'room', contentId: '0,0', version: 3, roomId: '0,0', roomVersion: 3,
  coordinates: { x: 0, y: 0 }, title: 'Lava Gauntlet', builderUserId: 'builder', builderDisplayName: 'Builder', cellCount: 1, legacyCourseId: null,
  playPath: '/r/0/0?from=share&daily=2026-10-22', available: true };
const daily = (value: DailyPick): DailyResponse => ({ date: value.date, resetsAt: '2999-01-01T00:00:00.000Z', pick: value, recentPicks: [value],
  leaderboard: [], rankingMode: 'time', viewer: null, bonusPxp: 5 });
const controllers: DailyRoomController[] = [];
function fixture(response = daily(pick)) {
  const elements = new Map<string, Element>(); const get = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  const doc = Object.assign(new EventTarget(), { body: { dataset: { appMode: 'world', appReady: 'true' } }, activeElement: null, visibilityState: 'visible',
    getElementById: get, createElement: () => new Element() });
  const win = Object.assign(new EventTarget(), { location: { search: '' }, localStorage: { getItem: () => null, setItem: () => {} },
    setInterval: () => 1, clearInterval: () => {} });
  const repository = { load: vi.fn(async () => response) };
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  const controller = new DailyRoomController(doc as unknown as Document, win as unknown as Window, repository);
  controller.init(); controllers.push(controller);
  const emit = (name: string, detail?: unknown) => win.dispatchEvent(new CustomEvent(name, { detail }));
  return { get, win, repository, emit };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const signIn = (id: string) => Object.assign(auth, { authenticated: true, source: 'session', user: { id } });
afterEach(() => { for (const c of controllers.splice(0)) c.destroy(); Object.assign(auth, { authenticated: false, source: null, user: null }); vi.unstubAllGlobals(); });

describe('Room of the Day reloads (F331)', () => {
  it('reloads for a new viewer only, not for repeated auth renders and session refreshes', async () => {
    const f = fixture(); await tick(); expect(f.repository.load).toHaveBeenCalledOnce();
    for (const name of ['auth', 'session', 'auth', 'auth']) f.emit(name);
    await tick(); expect(f.repository.load).toHaveBeenCalledOnce();
    signIn('p1'); f.emit('auth'); await tick(); expect(f.repository.load).toHaveBeenCalledTimes(2);
    f.emit('session'); f.emit('auth'); await tick(); expect(f.repository.load).toHaveBeenCalledTimes(2);
    Object.assign(auth, { authenticated: false, source: null, user: null }); f.emit('auth'); await tick();
    expect(f.repository.load).toHaveBeenCalledTimes(3);
  });

  it('re-renders guest runs and claims from local progress without a reload', async () => {
    const f = fixture(); await tick();
    f.emit('guest-progress'); f.emit(POST_RUN_GUEST_CLAIM_REQUEST_EVENT, {});
    f.emit(POST_RUN_RATING_REQUEST_EVENT, { contentType: 'room', contentId: '0,0', version: 3 });
    await tick(); expect(f.repository.load).toHaveBeenCalledOnce();
    expect(f.get('daily-room-progress').textContent).toBe('Beaten 0 of the last 7');
  });

  it('reloads after a signed-in finish of today\'s exact level only', async () => {
    signIn('p1'); const f = fixture(); await tick();
    f.emit(POST_RUN_RATING_REQUEST_EVENT, { contentType: 'room', contentId: '1,0', version: 3 }); await tick();
    f.emit(POST_RUN_RATING_REQUEST_EVENT, { contentType: 'room', contentId: '0,0', version: 2 }); await tick();
    expect(f.repository.load).toHaveBeenCalledOnce();
    f.emit(POST_RUN_RATING_REQUEST_EVENT, { contentType: 'room', contentId: '0,0', version: 3 }); await tick();
    expect(f.repository.load).toHaveBeenCalledTimes(2);
  });

  it('matches an Expanded Room pick by its id or its legacy course id', async () => {
    signIn('p1');
    const f = fixture(daily({ ...pick, targetKey: 'expanded_room:course:level', contentType: 'expanded_room', contentId: 'course:level', version: 7, legacyCourseId: 'level' }));
    await tick();
    f.emit(POST_RUN_RATING_REQUEST_EVENT, { contentType: 'room', contentId: 'course:level', version: 7 }); await tick();
    expect(f.repository.load).toHaveBeenCalledOnce();
    f.emit(POST_RUN_RATING_REQUEST_EVENT, { contentType: 'course', contentId: 'level', version: 7 }); await tick();
    f.emit(POST_RUN_RATING_REQUEST_EVENT, { contentType: 'expanded_room', contentId: 'other', expandedRoomId: 'course:level', version: 7 }); await tick();
    expect(f.repository.load).toHaveBeenCalledTimes(3);
  });
});
