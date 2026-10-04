import { afterEach, describe, expect, it, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ scene: {} }));
const auth = vi.hoisted(() => ({ id: 'a' }));
vi.mock('phaser', () => ({ default: {} }));
vi.mock('./sceneBridge', () => ({ getActiveOverworldScene: () => bridge.scene }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth', getAuthDebugState: () => ({ user: { id: auth.id } }) }));
import { RoomSequenceController } from './roomSequenceController';
import type { RoomSequenceStartDetail } from './roomSequenceEvents';

function fixture() {
  auth.id = 'a';
  const buttons = new Map<string, EventTarget>();
  const doc = { body: { dataset: {} }, getElementById: (id: string) => {
    if (!buttons.has(id)) buttons.set(id, Object.assign(new EventTarget(), { textContent: '', disabled: false, classList: { toggle: vi.fn() }, setAttribute: vi.fn() }));
    return buttons.get(id);
  } };
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  const summary = { reset: vi.fn(), finish: vi.fn() };
  const ratingModal = { openForSequence: vi.fn(async () => {}), close: vi.fn() };
  const controller = new RoomSequenceController({} as never, { close: vi.fn() } as never,
    { open: vi.fn(async () => {}) } as never, { close: vi.fn() }, doc as unknown as Document, win as unknown as Window, summary, ratingModal);
  controller.init();
  const detail: RoomSequenceStartDetail = { kind: 'welcome', mode: 'play', sourceLabel: 'First Steps', kickerLabel: 'First Steps', forceGoalIntro: true,
    entries: [1, 2].map(x => ({ roomId: `${x},0`, roomCoordinates: { x, y: 0 }, roomVersion: 1 })) };
  return { controller, detail, summary, buttons, win, ratingModal };
}
afterEach(() => vi.restoreAllMocks());
describe('Sequence navigation lifecycle', () => {
  it('opens the exact expanded rating target and advances after its saved rating', async () => {
    vi.useFakeTimers();
    try {
      bridge.scene = { jumpToCoordinates: vi.fn(async () => {}) };
      const f = fixture(); f.detail.mode = 'rate'; f.detail.kind = 'explore';
      Object.assign(f.detail.entries[0], { expandedRoomId: 'native', expandedRoomVersion: 3 });
      await f.controller.start(f.detail); expect(f.ratingModal.openForSequence).toHaveBeenCalledWith(f.detail.entries[0]);
      f.win.dispatchEvent(new CustomEvent('post-run-rating-submitted', { detail: { contentType:'expanded_room',contentId:'native',expandedRoomId:'native' } }));
      await vi.advanceTimersByTimeAsync(500); expect(f.ratingModal.openForSequence).toHaveBeenLastCalledWith(f.detail.entries[1]); f.controller.destroy();
    } finally { vi.useRealTimers(); }
  });
  it('discards a personal rating queue on account change before navigation returns', async () => {
    let resolve!: () => void;
    bridge.scene = { jumpToCoordinates: () => new Promise<void>(done => { resolve = done; }) };
    const f = fixture(); f.detail.mode = 'rate'; const loading = f.controller.start(f.detail);
    auth.id = 'b'; f.win.dispatchEvent(new Event('auth')); resolve(); await loading;
    expect(f.ratingModal.openForSequence).not.toHaveBeenCalled(); expect(f.ratingModal.close).toHaveBeenCalled(); f.controller.destroy();
  });
  it('cannot start a room after Stop while its navigation is pending', async () => {
    let resolve!: () => void; const playSelectedRoom = vi.fn();
    bridge.scene = { jumpToCoordinates: () => new Promise<void>(done => { resolve = done; }), playSelectedRoom, returnToWorld: vi.fn() };
    const f = fixture(); const pending = f.controller.start(f.detail); f.controller.stop(); resolve(); await pending;
    expect(playSelectedRoom).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it('prevents an older navigation from clearing a newer run or starting the wrong room', async () => {
    const resolvers: (() => void)[] = []; const playSelectedRoom = vi.fn();
    bridge.scene = { jumpToCoordinates: () => new Promise<void>(done => resolvers.push(done)), playSelectedRoom };
    const f = fixture(); const old = f.controller.start(f.detail); const newer = f.controller.start(f.detail);
    resolvers[0](); await old; expect(playSelectedRoom).not.toHaveBeenCalled();
    resolvers[1](); await newer; expect(playSelectedRoom).toHaveBeenCalledExactlyOnceWith({ forceGoalIntro: true }); f.controller.destroy();
  });
  it('finishes First Steps in Browse with a summary instead of calling skips clears', async () => {
    const returnToWorld = vi.fn(); bridge.scene = { jumpToCoordinates: vi.fn(async () => {}), playSelectedRoom: vi.fn(), returnToWorld };
    const f = fixture(); await f.controller.start(f.detail);
    f.buttons.get('btn-room-sequence-next')!.dispatchEvent(new Event('click'));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    f.buttons.get('btn-room-sequence-next')!.dispatchEvent(new Event('click'));
    expect(returnToWorld).toHaveBeenCalledOnce(); expect(f.summary.finish).toHaveBeenCalledOnce(); f.controller.destroy();
  });

  it('routes mobile Stop through the sequence and prevents the normal toggle from running twice', async () => {
    const returnToWorld = vi.fn(); bridge.scene = { jumpToCoordinates: vi.fn(async () => {}), playSelectedRoom: vi.fn(), returnToWorld };
    const f = fixture(); const toggle = vi.fn(); f.buttons.get('btn-mobile-world-stop')!.addEventListener('click', toggle);
    await f.controller.start(f.detail); f.buttons.get('btn-mobile-world-stop')!.dispatchEvent(new Event('click'));
    expect(returnToWorld).toHaveBeenCalledOnce(); expect(toggle).not.toHaveBeenCalled(); expect(f.summary.finish).not.toHaveBeenCalled(); f.controller.destroy();
  });
});
