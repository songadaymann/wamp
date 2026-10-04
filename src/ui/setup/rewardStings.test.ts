import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));
import { playSfx } from '../../audio/sfx';
import { GUEST_RUN_PROGRESS_CHANGED_EVENT, type GuestRunSaveResult } from '../../guestRooms/runService';
import { createPostRunClearReward, REWARD_STINGS_EVENT } from '../../progression/rewardStings';
import { RewardStingController } from './rewardStings';

const pending: GuestRunSaveResult = { clientRunId: 'clear-1', attemptId: null, status: 'queued', durable: true, reason: null };
function fixture() {
  vi.useFakeTimers();
  const elements = new Map<string, { textContent: string; classList: { contains(name: string): boolean; add(...names: string[]): void; remove(...names: string[]): void; toggle(name: string, force: boolean): void } }>();
  const doc = { getElementById: (id: string) => {
    if (!elements.has(id)) {
      const classes = new Set(['hidden']);
      elements.set(id, Object.assign({ textContent: '', setAttribute: vi.fn(), style: { setProperty: vi.fn(), removeProperty: vi.fn() } }, {
        classList: { contains: (name: string) => classes.has(name), add: (...names: string[]) => names.forEach(name => classes.add(name)),
          remove: (...names: string[]) => names.forEach(name => classes.delete(name)), toggle: (name: string, force: boolean) => force ? classes.add(name) : classes.delete(name) },
      }));
    }
    return elements.get(id);
  } };
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  const controller = new RewardStingController(doc as unknown as Document, win as unknown as Window); controller.init();
  const clear = (progress: GuestRunSaveResult | null | undefined = pending) => createPostRunClearReward({ contentType: 'room', contentTitle: 'A room', elapsedMs: 15000, deaths: 1, score: null, guestProgress: progress,
    bestRun: { rankingMode: 'time', displayName: 'Leader', elapsedMs: 3500, score: 100 } });
  const show = (rewards: ReturnType<typeof clear>[]) => win.dispatchEvent(new CustomEvent(REWARD_STINGS_EVENT, { detail: { rewards } }));
  const update = (progress: GuestRunSaveResult) => win.dispatchEvent(new CustomEvent(GUEST_RUN_PROGRESS_CHANGED_EVENT, { detail: progress }));
  return { controller, clear, show, update, elements };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe('guest clear feedback', () => {
  it('shows the run and best immediately; verification updates the same card without replaying the celebration', () => {
    const f = fixture(); f.show([f.clear()]);
    expect(f.elements.get('reward-sting-detail')?.textContent).toContain('0:15.0 · 1 death\nBest: Leader · 0:03.5 · 0:11.5 behind');
    expect(f.elements.get('reward-sting-guest-progress')?.textContent).toContain('Waiting to verify');
    f.update({ ...pending, clientRunId: 'another-run', status: 'saved' });
    expect(f.elements.get('reward-sting-guest-progress')?.textContent).toContain('Waiting');
    f.update({ ...pending, status: 'saved' });
    expect(f.elements.get('reward-sting-guest-progress')?.textContent).toBe('Verified clear · Sign in to earn XP');
    expect(playSfx).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2860);
    expect(f.elements.get('reward-sting-layer')?.classList.contains('hidden')).toBe(true);
    f.update({ ...pending, status: 'saved' });
    expect(f.elements.get('reward-sting-layer')?.classList.contains('hidden')).toBe(true); f.controller.destroy();
  });
  it('keeps late replies on their own queued reward and removes guest copy for account rewards', () => {
    const f = fixture();
    // Explicitly omit progress for an account reward.
    const account = f.clear(); delete account.guestProgress;
    f.show([account, f.clear()]);
    expect(f.elements.get('reward-sting-guest-progress')?.classList.contains('hidden')).toBe(true);
    f.update({ ...pending, status: 'unverified' }); vi.advanceTimersByTime(account.durationMs + 260);
    expect(f.elements.get('reward-sting-guest-progress')?.textContent).toContain('Sign in and replay');
    expect(f.elements.get('reward-sting-guest-progress')?.textContent).not.toContain('+20'); f.controller.destroy();
  });
  it('does not offer saved XP for a local fallback or a non-durable pending clear', () => {
    const f = fixture(); f.show([f.clear(null)]);
    expect(f.elements.get('reward-sting-guest-progress')?.textContent).toContain('Clear unverified');
    f.controller.destroy(); f.controller.init(); f.show([f.clear({ ...pending, durable: false })]);
    expect(f.elements.get('reward-sting-guest-progress')?.textContent).toContain('Keep this tab open'); f.controller.destroy();
  });
});
