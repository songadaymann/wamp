import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const feedback = vi.hoisted(() => ({ ready: false, busy: false, scene: {}, auth: { authenticated: false, user: null as { id: string } | null } }));
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth-changed', getAuthDebugState: () => feedback.auth }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}), createDefaultRoomSnapshot: vi.fn() }));
vi.mock('../../persistence/worldRepository', () => ({ createWorldRepository: () => ({}) }));
vi.mock('../appFeedback', () => ({ APP_READY_EVENT: 'app-ready', isAppReady: () => feedback.ready, isBusyOverlayVisible: () => feedback.busy }));
vi.mock('./sceneBridge', () => ({ getActiveOverworldScene: () => feedback.scene }));
vi.mock('../../settings/userSettings', () => ({ getGameSettings: () => ({ builderMode: 'beginner' }), updateGameSettings: vi.fn() }));

import { setAppMode } from '../appMode';
import { WelcomeModalController } from './welcomeModal';
import { createDefaultRoomRecord, createRoomSummaryFromRecord } from '../../persistence/roomModel';
import type { RoomRepository } from '../../persistence/roomRepository';
import { createStarterRoomSnapshot } from './firstSteps';

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

function fixture(repository?: RoomRepository, destinations = {}) {
  const modal = new Element();
  const close = new Element();
  const buttons = new Map(['btn-welcome-play', 'btn-welcome-build', 'btn-welcome-explore', 'welcome-modal-status'].map(id => [id, new Element()]));
  const doc = Object.assign(new EventTarget(), {
    body: { dataset: { appMode: 'world' } }, visibilityState: 'visible',
    getElementById: (id: string) => id === 'welcome-modal' ? modal : id === 'btn-welcome-close' ? close : buttons.get(id) ?? null,
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
    {
      loadWorldWindow: async () => ({ rooms: [{ id: '24,9', coordinates: { x: 24, y: 9 }, state: 'frontier' }] }),
      loadClaimableFrontierWindow: async () => ({ rooms: [{ id: '24,9', coordinates: { x: 24, y: 9 }, state: 'frontier' }] }),
    } as unknown as ConstructorParameters<typeof WelcomeModalController>[1], repository, storage, doc as unknown as Document, win as unknown as Window, destinations,
  );
  controller.init();
  return { controller, doc, win, values, close, buttons, visible: () => !modal.classList.contains('hidden') };
}

beforeEach(() => { vi.useFakeTimers(); feedback.ready = false; feedback.busy = false; feedback.scene = {}; feedback.auth = { authenticated: false, user: null }; });
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

describe('Welcome destination lifecycle', () => {
  const current = (id = '24,9', coordinates = { x: 24, y: 9 }) => {
    const record = createDefaultRoomRecord(id, coordinates);
    return { summary: createRoomSummaryFromRecord(record), draft: record.draft, published: record.published };
  };
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

  it('opens the real explorer and dismisses Welcome', () => {
    const explore = vi.fn(); const f = fixture(undefined, { explore });
    f.controller.open(); f.buttons.get('btn-welcome-explore')!.dispatchEvent(new Event('click'));
    expect(explore).toHaveBeenCalledOnce(); expect(f.visible()).toBe(false); f.controller.destroy();
  });

  it('starts one complete sequence despite a duplicate Play click', async () => {
    feedback.scene = { jumpToCoordinates: vi.fn(), playSelectedRoom: vi.fn() };
    const loadRoomCurrent = vi.fn(async (id: string, coordinates: { x: number; y: number }) => ({
      ...current(id, coordinates), published: { ...createStarterRoomSnapshot(id, coordinates), status: 'published', version: 3 },
    }));
    const f = fixture({ loadRoomCurrent } as unknown as RoomRepository); const start = vi.fn();
    f.win.addEventListener('room-sequence-start', start); f.controller.open();
    f.buttons.get('btn-welcome-play')!.dispatchEvent(new Event('click'));
    f.buttons.get('btn-welcome-play')!.dispatchEvent(new Event('click')); await flush();
    expect(loadRoomCurrent).toHaveBeenCalledTimes(6); expect(start).toHaveBeenCalledOnce();
    expect(f.visible()).toBe(false); f.controller.destroy();
  });

  it('keeps loading failures visible and cancels a closed pending Play', async () => {
    feedback.scene = { jumpToCoordinates: vi.fn(), playSelectedRoom: vi.fn() };
    const loadRoomCurrent = vi.fn(async () => current());
    const f = fixture({ loadRoomCurrent } as unknown as RoomRepository); const start = vi.fn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    f.win.addEventListener('room-sequence-start', start); f.controller.open();
    f.buttons.get('btn-welcome-play')!.dispatchEvent(new Event('click')); await flush();
    expect(f.visible()).toBe(true); expect(f.buttons.get('welcome-modal-status')!.textContent).toContain('unavailable');
    f.buttons.get('btn-welcome-play')!.dispatchEvent(new Event('click')); f.controller.close(true); await flush();
    expect(start).not.toHaveBeenCalled(); f.controller.destroy(); errors.mockRestore();
  });

  it('hands off a guest starter without forcing over recovered content', async () => {
    const openGuestDraftRoom = vi.fn(async () => true);
    feedback.scene = { jumpToCoordinates: vi.fn(async () => {}), openGuestDraftRoom };
    const localRooms = { loadRoom: vi.fn(async () => createDefaultRoomRecord('24,9', { x: 24, y: 9 })) };
    const saveDraft = vi.fn();
    const f = fixture({ loadRoomCurrent: async () => current(), saveDraft } as unknown as RoomRepository, { localRooms });
    f.controller.open(); f.buttons.get('btn-welcome-build')!.dispatchEvent(new Event('click')); await flush();
    expect(openGuestDraftRoom).toHaveBeenCalledWith(expect.objectContaining({ title: 'My First Room', goal: expect.objectContaining({ type: 'reach_exit' }) }), expect.any(Function), false);
    expect(saveDraft).not.toHaveBeenCalled(); expect(f.visible()).toBe(false); f.controller.destroy();
  });

  it('preserves an existing browser draft and a newly claimed frontier', async () => {
    const openGuestDraftRoom = vi.fn(); feedback.scene = { jumpToCoordinates: vi.fn(), openGuestDraftRoom };
    const record = createDefaultRoomRecord('24,9', { x: 24, y: 9 }); record.draft.title = 'Keep my work';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const localRooms = { loadRoom: async () => record };
    const f = fixture({ loadRoomCurrent: async () => current() } as unknown as RoomRepository, { localRooms });
    f.controller.open(); f.buttons.get('btn-welcome-build')!.dispatchEvent(new Event('click')); await flush();
    expect(openGuestDraftRoom).not.toHaveBeenCalled(); expect(record.draft.title).toBe('Keep my work');
    record.draft.title = null;
    const taken = current(); taken.summary.claimedAt = '2026-10-04T00:00:00Z';
    const g = fixture({ loadRoomCurrent: async () => taken } as unknown as RoomRepository, { localRooms });
    g.controller.open(); g.buttons.get('btn-welcome-build')!.dispatchEvent(new Event('click')); await flush();
    expect(openGuestDraftRoom).not.toHaveBeenCalled(); expect(g.buttons.get('welcome-modal-status')!.textContent).toContain('just taken');
    f.controller.destroy(); g.controller.destroy(); errors.mockRestore();
  });

  it('saves an account starter with the loaded draft conflict token', async () => {
    feedback.auth = { authenticated: true, user: { id: 'account' } };
    const saveDraft = vi.fn(async () => createDefaultRoomRecord());
    const openGuestDraftRoom = vi.fn(async () => true);
    feedback.scene = { jumpToCoordinates: vi.fn(async () => {}), openGuestDraftRoom };
    const record = current(); const localRooms = { loadRoom: async () => createDefaultRoomRecord() };
    const f = fixture({ loadRoomCurrent: async () => record, saveDraft } as unknown as RoomRepository, { localRooms });
    f.controller.open(); f.buttons.get('btn-welcome-build')!.dispatchEvent(new Event('click')); await flush();
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ title: 'My First Room' }), { baseUpdatedAt: record.draft.updatedAt });
    expect(openGuestDraftRoom).toHaveBeenCalledOnce(); f.controller.destroy();
  });

  it('cannot save or open a starter after Welcome closes during its load', async () => {
    const saveDraft = vi.fn(); const openGuestDraftRoom = vi.fn();
    feedback.scene = { jumpToCoordinates: vi.fn(), openGuestDraftRoom };
    let resolve!: (record: ReturnType<typeof current>) => void;
    const loadRoomCurrent = () => new Promise<ReturnType<typeof current>>(done => { resolve = done; });
    const f = fixture({ loadRoomCurrent, saveDraft } as unknown as RoomRepository, { localRooms: { loadRoom: async () => createDefaultRoomRecord() } });
    f.controller.open(); f.buttons.get('btn-welcome-build')!.dispatchEvent(new Event('click')); await flush();
    f.controller.close(true); resolve(current()); await flush();
    expect(saveDraft).not.toHaveBeenCalled(); expect(openGuestDraftRoom).not.toHaveBeenCalled(); f.controller.destroy();
  });
});
