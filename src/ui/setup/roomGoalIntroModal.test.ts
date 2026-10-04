import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';

const layout = vi.hoisted(() => ({ touchPrimary: false }));
vi.mock('../deviceLayout', () => ({
  getDeviceLayoutState: () => layout,
  DEVICE_LAYOUT_CHANGED_EVENT: 'device-layout-changed',
}));

import { RoomGoalIntroModalController } from './roomGoalIntroModal';

class Element extends EventTarget {
  private classes = new Set(['hidden']);
  readonly classList = {
    add: (value: string) => this.classes.add(value),
    remove: (value: string) => this.classes.delete(value),
    contains: (value: string) => this.classes.has(value),
    toggle: (value: string, force: boolean) => force ? this.classes.add(value) : this.classes.delete(value),
  };
  readonly dataset: Record<string, string> = {};
  children: Element[] = [];
  textContent = '';
  className = '';
  setAttribute(): void {}
  focus(): void {}
  append(...children: Element[]): void { this.children.push(...children); }
  replaceChildren(...children: Element[]): void { this.children = children; }
}

const controllers: RoomGoalIntroModalController[] = [];
function fixture(blockedStorage = false) {
  const ids = ['room-goal-intro-modal', 'room-goal-intro-title', 'room-goal-intro-meta',
    'room-goal-intro-body', 'room-goal-intro-copy', 'room-goal-intro-controls', 'btn-room-goal-intro-start'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const doc = Object.assign(new EventTarget(), {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => new Element(),
  });
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => { if (blockedStorage) throw Error('blocked'); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (blockedStorage) throw Error('blocked'); values.set(key, value); },
  } as Storage;
  const win = new EventTarget();
  const controller = new RoomGoalIntroModalController(storage, doc as unknown as Document, win as Window);
  controller.init();
  controllers.push(controller);
  const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 });
  room.status = 'published';
  room.goal = { type: 'reach_exit', exit: { x: 80, y: 80 }, timeLimitMs: null };
  const open = (onStart: () => void) => controller.open({ room, titleText: 'A room', metaText: 'Reach exit', bodyText: 'Find the flag.', onStart });
  const start = () => elements.get('btn-room-goal-intro-start')?.dispatchEvent(new Event('click'));
  return { controller, doc, win, values, elements, room, open, start };
}

beforeEach(() => { layout.touchPrimary = false; });
afterEach(() => { controllers.splice(0).forEach(controller => controller.destroy()); vi.unstubAllGlobals(); });

describe('controls before first play', () => {
  it('keeps Start pending and acknowledges controls only once when the visible intro starts', () => {
    const f = fixture(), start = vi.fn();
    f.open(start);
    expect(start).not.toHaveBeenCalled();
    expect(f.values.size).toBe(0);
    f.start();
    f.start();
    expect(start).toHaveBeenCalledOnce();
    expect(f.values.get('wamp:play-controls-seen:v1:keyboard')).toBe('1');
    expect(f.controller.shouldShowForRoom(f.room)).toBe(false);
    expect(f.controller.shouldShowForRoom({ ...f.room, version: 2 })).toBe(true);
  });

  it('covers goal-less rooms and old seen goal versions until controls have been acknowledged', () => {
    const f = fixture();
    f.values.set('everybodys-platformer:room-goal-intro-seen:v1:1,2:1', '1');
    expect(f.controller.shouldShowForRoom(f.room)).toBe(true);
    expect(f.controller.shouldShowForRoom({ ...f.room, goal: null })).toBe(true);
    expect(f.controller.openControlsIfNeeded(vi.fn())).toBe(true);
    expect(f.elements.get('room-goal-intro-copy')?.classList.contains('hidden')).toBe(true);
    f.start();
    expect(f.controller.shouldShowForRoom({ ...f.room, goal: null })).toBe(false);
    expect(f.controller.openControlsIfNeeded(vi.fn())).toBe(false);
  });

  it('cancels a forced close without starting or persisting an acknowledgement', () => {
    const f = fixture(), first = vi.fn(), second = vi.fn();
    f.controller.openControlsIfNeeded(first);
    f.controller.forceClose();
    f.start();
    expect(first).not.toHaveBeenCalled();
    expect(f.values.size).toBe(0);
    expect(f.controller.openControlsIfNeeded(second)).toBe(true);
    f.start();
    expect(second).toHaveBeenCalledOnce();
  });

  it('keeps a later published goal unseen after starting a goal-less room', () => {
    const f = fixture(), goal = f.room.goal;
    f.room.goal = null;
    f.open(vi.fn()); f.start();
    expect(f.values.get('wamp:play-controls-seen:v1:keyboard')).toBe('1');
    expect(f.values.get('everybodys-platformer:room-goal-intro-seen:v1:1,2:1')).toBeUndefined();
    f.room.goal = goal;
    expect(f.controller.shouldShowForRoom(f.room)).toBe(true);
  });

  it('keeps the original continuation on duplicate requests and discards it on destruction', () => {
    const f = fixture(), first = vi.fn(), duplicate = vi.fn();
    f.controller.openControlsIfNeeded(first);
    f.controller.openControlsIfNeeded(duplicate);
    f.start();
    expect(first).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
    const next = fixture(), stale = vi.fn();
    next.controller.openControlsIfNeeded(stale);
    next.controller.destroy();
    next.start();
    expect(stale).not.toHaveBeenCalled();
    expect(next.values.size).toBe(0);
  });

  it('refreshes actual input hints and requires an independent acknowledgement for touch', () => {
    const f = fixture();
    f.open(vi.fn()); f.start();
    layout.touchPrimary = true;
    f.win.dispatchEvent(new Event('device-layout-changed'));
    expect(f.elements.get('room-goal-intro-controls')?.dataset.playControlsInput).toBe('touch');
    expect(f.controller.shouldShowForRoom(f.room)).toBe(true);
    f.controller.openControlsIfNeeded(vi.fn()); f.start();
    expect(f.values.get('wamp:play-controls-seen:v1:touch')).toBe('1');
    layout.touchPrimary = false;
    expect(f.controller.shouldShowForRoom(f.room)).toBe(false);
  });

  it('starts safely with blocked storage and remembers the acknowledgement for this document', () => {
    const f = fixture(true), start = vi.fn();
    f.controller.openControlsIfNeeded(start); f.start();
    expect(start).toHaveBeenCalledOnce();
    expect(f.controller.openControlsIfNeeded(vi.fn())).toBe(false);
    vi.stubGlobal('window', Object.defineProperty({}, 'localStorage', { get: () => { throw Error('blocked'); } }));
    expect(() => new RoomGoalIntroModalController(undefined, f.doc as unknown as Document, f.win as Window)).not.toThrow();
  });
});
