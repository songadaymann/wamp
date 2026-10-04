import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const feedback = vi.hoisted(() => ({ ready: false, busy: false }));
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth-changed', getAuthDebugState: () => ({ authenticated: false }) }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}), createDefaultRoomSnapshot: vi.fn() }));
vi.mock('../../persistence/worldRepository', () => ({ createWorldRepository: () => ({}) }));
vi.mock('../appFeedback', () => ({ APP_READY_EVENT: 'app-ready', isAppReady: () => feedback.ready, isBusyOverlayVisible: () => feedback.busy }));
vi.mock('./sceneBridge', () => ({ getActiveOverworldScene: () => ({}) }));
vi.mock('../../settings/userSettings', () => ({ getGameSettings: () => ({ builderMode: 'beginner' }), updateGameSettings: vi.fn() }));

import { setAppMode } from '../appMode';
import { WelcomeModalController } from './welcomeModal';

class Element extends EventTarget {
  private readonly classes = new Set(['hidden']);
  readonly classList = {
    add: (...values: string[]) => values.forEach(value => this.classes.add(value)),
    remove: (...values: string[]) => values.forEach(value => this.classes.delete(value)),
    contains: (value: string) => this.classes.has(value),
    toggle: (value: string, force: boolean) => force ? this.classes.add(value) : this.classes.delete(value),
  };
  readonly dataset: Record<string, string> = {};
  setAttribute(): void {}
  toggleAttribute(): void {}
  textContent = '';
}

function fixture() {
  const modal = new Element();
  const close = new Element();
  const doc = Object.assign(new EventTarget(), {
    body: { dataset: { appMode: 'world' } }, visibilityState: 'visible',
    getElementById: (id: string) => id === 'welcome-modal' ? modal : id === 'btn-welcome-close' ? close : null,
    querySelector: () => null, querySelectorAll: () => [],
  });
  const win = Object.assign(new EventTarget(), {
    setTimeout, clearTimeout, requestAnimationFrame: () => 0, location: { search: '', pathname: '/' },
  });
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    clear: () => values.clear(), key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  const controller = new WelcomeModalController(
    {} as ConstructorParameters<typeof WelcomeModalController>[0],
    undefined, undefined, storage, doc as unknown as Document, win as unknown as Window,
  );
  controller.init();
  return { controller, doc, win, values, close, visible: () => !modal.classList.contains('hidden') };
}

beforeEach(() => { vi.useFakeTimers(); feedback.ready = false; feedback.busy = false; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Welcome first-visit timing', () => {
  it('waits through auth during boot and shared-link play, then appears after Stop', () => {
    const f = fixture();
    f.win.dispatchEvent(new Event('auth-changed'));
    vi.advanceTimersByTime(1600);
    expect(f.visible()).toBe(false);
    feedback.ready = true;
    f.win.dispatchEvent(new Event('app-ready'));
    setAppMode('play-world');
    vi.advanceTimersByTime(1600);
    expect(f.visible()).toBe(false);
    setAppMode('world');
    vi.advanceTimersByTime(540);
    expect(f.visible()).toBe(true);
    f.controller.destroy();
  });

  it('synchronously defers an open Welcome on Play without marking it dismissed', () => {
    feedback.ready = true;
    const f = fixture();
    vi.advanceTimersByTime(540);
    expect(f.visible()).toBe(true);
    setAppMode('play-world');
    expect(f.visible()).toBe(false);
    expect(f.values.get('wamp_welcome_modal_seen_v1')).toBeUndefined();
    vi.advanceTimersByTime(1600);
    expect(f.visible()).toBe(false);
    setAppMode('world');
    vi.advanceTimersByTime(540);
    expect(f.visible()).toBe(true);
    f.controller.destroy();
  });

  it('retains normal home onboarding and never reopens a dismissed Welcome', () => {
    feedback.ready = true;
    const f = fixture();
    vi.advanceTimersByTime(540);
    expect(f.visible()).toBe(true);
    f.close.dispatchEvent(new Event('click'));
    expect(f.values.get('wamp_welcome_modal_seen_v1')).toBe('1');
    setAppMode('play-world');
    setAppMode('world');
    f.win.dispatchEvent(new Event('auth-changed'));
    vi.advanceTimersByTime(1600);
    expect(f.visible()).toBe(false);
    f.controller.destroy();
  });

  it('does not schedule or reopen after destruction on later mode/auth events', () => {
    feedback.ready = true;
    const f = fixture();
    f.controller.destroy();
    setAppMode('world');
    f.win.dispatchEvent(new Event('auth-changed'));
    vi.advanceTimersByTime(1600);
    expect(f.visible()).toBe(false);
  });
});
