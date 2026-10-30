import { beginPendingDialog } from './pendingDialog';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGameplayPause, type GameplayPauseContext } from './gameplayPause';

class FakeElement {
  classes = new Set<string>();
  classList = { contains: (value: string) => this.classes.has(value),
    toggle: (value: string, force: boolean) => force ? this.classes.add(value) : this.classes.delete(value),
    add: (value: string) => this.classes.add(value) };
  textContent = '';
  isConnected = true;
  constructor(readonly modal = false) { if (modal) this.classes.add('hidden'); }
  getAttribute() { return null; }
  matches() { return this.modal; }
  querySelectorAll() { return []; }
}
function fixture() {
  const callbacks: MutationCallback[] = [];
  const observers: { disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('MutationObserver', class {
    disconnect = vi.fn(); observe = vi.fn();
    constructor(callback: MutationCallback) { callbacks.push(callback); observers.push(this); }
  });
  const menu = new FakeElement(), status = new FakeElement(), first = new FakeElement(true), second = new FakeElement(true);
  const modals = [first, second];
  const doc = Object.assign(new EventTarget(), { body: {}, visibilityState: 'visible',
    getElementById: (id: string) => id === 'auth-panel' ? menu : status, querySelectorAll: () => modals });
  const events = new EventEmitter(), request = vi.fn();
  const context: GameplayPauseContext = { playing: true, available: true, liveReason: null };
  const destroy = installGameplayPause(events, () => context, request, doc as unknown as Document);
  const mutate = () => callbacks[0]([], {} as MutationObserver);
  const frame = () => events.emit('prestep');
  return { menu, status, first, second, modals, doc, events, request, context, destroy, mutate, frame, callbacks, observers };
}
afterEach(() => vi.unstubAllGlobals());
describe('solo pause ownership', () => {
  it('stays paused through a menu-to-dialog handoff and nested dialogs until the last one closes', () => {
    const f = fixture();
    f.menu.classes.add('menu-open'); f.mutate(); expect(f.request.mock.calls).toEqual([[true]]);
    f.menu.classes.delete('menu-open'); f.first.classes.delete('hidden'); f.mutate();
    f.second.classes.delete('hidden'); f.mutate(); f.first.classes.add('hidden'); f.mutate();
    expect(f.request.mock.calls).toEqual([[true]]);
    f.second.classes.add('hidden'); f.mutate(); expect(f.request.mock.calls).toEqual([[true], [false]]);
    f.destroy();
  });
  it.each(['multiplayer', 'weekly-rush'] as const)('keeps %s live and reacts to policy changes even with the scene paused', liveReason => {
    const f = fixture(); f.menu.classes.add('menu-open'); f.mutate();
    f.context.liveReason = liveReason; f.frame();
    expect(f.request.mock.calls).toEqual([[true], [false]]);
    expect(f.status.textContent).toContain('keeps running');
    f.context.liveReason = null; f.frame(); expect(f.request).toHaveBeenLastCalledWith(true);
    f.context.playing = false; f.frame(); expect(f.request).toHaveBeenLastCalledWith(false);
    expect(f.status.textContent).toBe(''); f.destroy();
  });
  it('includes deferred dialogs, removal, background tabs and safe teardown', () => {
    // Observers: the menu, then the shared dialog watch (modalState): attributes, page additions.
    const f = fixture(), lazy = new FakeElement(true), added = f.callbacks[2];
    lazy.classes.delete('hidden'); f.modals.push(lazy);
    added([{ addedNodes: [lazy], removedNodes: [] }] as unknown as MutationRecord[], {} as MutationObserver);
    expect(f.request).toHaveBeenLastCalledWith(true);
    f.modals.pop(); lazy.isConnected = false;
    added([{ addedNodes: [], removedNodes: [lazy] }] as unknown as MutationRecord[], {} as MutationObserver);
    expect(f.request).toHaveBeenLastCalledWith(false);
    f.doc.visibilityState = 'hidden'; f.doc.dispatchEvent(new Event('visibilitychange'));
    expect(f.request).toHaveBeenLastCalledWith(true);
    f.context.available = false; f.frame(); expect(f.request).toHaveBeenLastCalledWith(false);
    const count = f.request.mock.calls.length; f.destroy(); f.frame(); f.mutate();
    expect(f.request.mock.calls).toHaveLength(count);
    expect(f.events.listenerCount('prestep')).toBe(0);
    f.observers.forEach(observer => expect(observer.disconnect).toHaveBeenCalledOnce());
  });
  it('explains signed-in ranking time while keeping a guest pause simple', () => {
    const f = fixture(); expect(f.status.textContent).toBe('Paused');
    f.context.ranked = true; f.frame(); expect(f.status.textContent).toContain('Ranking time includes breaks');
    f.destroy();
  });
  it('holds a menu pause through a deferred dialog download and releases a canceled load', () => {
    const f = fixture(); f.menu.classes.add('menu-open'); f.mutate();
    const release = beginPendingDialog(); f.menu.classes.delete('menu-open'); f.mutate();
    expect(f.request.mock.calls).toEqual([[true]]);
    release(); expect(f.request.mock.calls).toEqual([[true], [false]]); f.destroy();
  });

});
