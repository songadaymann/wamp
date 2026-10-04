import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstStepsSummaryController } from './firstStepsSummary';
const auth = vi.hoisted(() => ({ authenticated: false }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth', getAuthDebugState: () => auth, promptForSignIn: vi.fn() }));
vi.mock('../../guestRooms/runService', () => ({ GUEST_RUN_PROGRESS_CHANGED_EVENT: 'progress' }));
vi.mock('../../progression/postRunRatingEvents', () => ({ POST_RUN_GUEST_CLAIM_REQUEST_EVENT: 'clear', POST_RUN_RATING_REQUEST_EVENT: 'rating' }));

class Element extends EventTarget {
  textContent = '';
  private readonly classes = new Set(['hidden']);
  readonly classList = { contains: (name: string) => this.classes.has(name), add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name), toggle: (name: string, hidden: boolean) => hidden ? this.classes.add(name) : this.classes.delete(name) };
  setAttribute(): void {} focus(): void {}
}
function fixture() {
  auth.authenticated = false;
  const elements = new Map<string, Element>();
  const doc = Object.assign(new EventTarget(), { getElementById: (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!;
  } });
  const win = new EventTarget(); const explore = vi.fn(), build = vi.fn();
  const controller = new FirstStepsSummaryController({ explore, build }, doc as unknown as Document, win as unknown as Window);
  controller.init();
  controller.reset([1, 2, 3].map(x => ({ roomId: `${x},0`, roomCoordinates: { x, y: 0 }, roomVersion: 10 })));
  const clear = (id: string, status = 'saved', version = 10) => win.dispatchEvent(new CustomEvent('clear', { detail: {
    contentType: 'room', contentId: id, version, guestProgress: { clientRunId: id, status, durable: true, reason: null, attemptId: null },
  } }));
  const text = (id: string) => elements.get(`first-steps-summary-${id}`)!.textContent;
  return { controller, win, elements, clear, text, explore, build };
}
afterEach(() => vi.restoreAllMocks());

describe('First Steps actual-clear summary', () => {
  it('does not award completion for skipped rooms or clears from another room/version', () => {
    const f = fixture(); f.clear('7,0'); f.clear('1,0', 'saved', 9); f.controller.finish();
    expect(f.text('count')).toBe('0 of 3 rooms cleared.'); expect(f.text('progress')).not.toContain('XP');
    expect(f.elements.get('btn-first-steps-save')!.classList.contains('hidden')).toBe(true); f.controller.destroy();
  });
  it('deduplicates replays and separates verified, queued and unverified clears', () => {
    const f = fixture(); f.clear('1,0'); f.clear('1,0', 'unverified'); f.clear('2,0', 'queued'); f.clear('3,0', 'unverified'); f.controller.finish();
    expect(f.text('count')).toBe('3 of 3 rooms cleared.'); expect(f.text('progress')).toContain('1 verified clear');
    expect(f.text('progress')).toContain('1 clear waiting to verify'); expect(f.text('progress')).toContain('replay after sign-in');
    expect(f.text('progress')).not.toMatch(/\+\d+|earned/); f.controller.destroy();
  });
  it('updates a queued clear after verification and removes Save Progress on sign-in', () => {
    const f = fixture(); f.clear('1,0', 'queued'); f.controller.finish();
    f.win.dispatchEvent(new CustomEvent('progress', { detail: { clientRunId: '1,0', status: 'saved', durable: true } }));
    expect(f.text('progress')).toContain('1 verified clear');
    auth.authenticated = true; f.win.dispatchEvent(new Event('auth'));
    expect(f.elements.get('btn-first-steps-save')!.classList.contains('hidden')).toBe(true); f.controller.destroy();
  });
  it('resets counts for a new run and offers the real Explore and Build actions', () => {
    const f = fixture(); f.clear('1,0'); f.controller.reset([]); f.controller.finish();
    expect(f.text('count')).toBe('0 of 0 rooms cleared.');
    f.elements.get('btn-first-steps-explore')!.dispatchEvent(new Event('click')); expect(f.explore).toHaveBeenCalledOnce();
    f.elements.get('btn-first-steps-build')!.dispatchEvent(new Event('click')); expect(f.build).toHaveBeenCalledOnce(); f.controller.destroy();
  });
});
