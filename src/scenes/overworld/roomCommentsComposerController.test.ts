import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/client', () => ({ getAuthDebugState: vi.fn() }));
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));
vi.mock('../../roomComments/client', () => ({ submitRoomComment: vi.fn() }));

import type { RoomSnapshot } from '../../persistence/roomModel';
import { RoomCommentsComposerController } from './roomCommentsComposerController';

function createHarness(options: {
  authenticated?: boolean;
  schoolManaged?: boolean;
  room?: RoomSnapshot | null;
} = {}) {
  const doc = new TestDocument();
  const host = doc.createElement('main');
  doc.body.append(host);
  const focusCanvas = vi.fn();
  const showTransientStatus = vi.fn();
  const submitComment = vi.fn().mockResolvedValue({ comment: {} });
  const playSubmitSound = vi.fn();
  let room = options.room === undefined ? createRoom() : options.room;
  const controller = new RoomCommentsComposerController({
    document: doc as never,
    getHost: () => host as never,
    focusCanvas,
    getRenderableRoom: () => room,
    getPlayerCommentPosition: () => ({ x: 23, y: 45 }),
    showTransientStatus,
    getAuthState: () => ({
      authenticated: options.authenticated ?? true,
      user: (options.authenticated ?? true) ? { id: 'user-a' } : null,
      schoolManaged: options.schoolManaged ?? false,
    }),
    submitComment,
    playSubmitSound,
  });
  controller.initialize();

  return {
    controller,
    doc,
    focusCanvas,
    showTransientStatus,
    submitComment,
    playSubmitSound,
    setRoom(nextRoom: RoomSnapshot | null) { room = nextRoom; },
    input: () => doc.getElementById('room-comment-input'),
    root: () => doc.getElementById('room-comment-composer'),
    form: () => doc.getByClass('room-comment-composer-form'),
    cancel: () => doc.getByClass('room-comment-cancel'),
    submit: () => doc.getByClass('room-comment-submit'),
    counter: () => doc.getByClass('room-comment-counter'),
  };
}

describe('RoomCommentsComposerController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates one composer, focuses it, updates its counter, and closes with Escape', () => {
    const harness = createHarness();
    harness.controller.initialize();

    expect(harness.doc.getAllById('room-comment-composer')).toHaveLength(1);
    expect(harness.controller.open()).toBe(true);
    expect(harness.root().classList.contains('hidden')).toBe(false);
    expect(harness.input().focused).toBe(true);

    harness.input().value = 'hello';
    harness.input().emit('input');
    expect(harness.counter().textContent).toBe('5/220');

    harness.input().emit('keydown', { key: 'Escape' });
    expect(harness.controller.isOpen()).toBe(false);
    expect(harness.root().classList.contains('hidden')).toBe(true);
    expect(harness.focusCanvas).toHaveBeenCalledOnce();
  });

  it('keeps the existing room, authentication, and classroom open guards', () => {
    const noRoom = createHarness({ room: null });
    expect(noRoom.controller.open()).toBe(false);
    expect(noRoom.showTransientStatus).toHaveBeenCalledWith(
      'Play a published room to leave a comment.',
    );

    const guest = createHarness({ authenticated: false });
    expect(guest.controller.open()).toBe(false);
    expect(guest.showTransientStatus).toHaveBeenCalledWith('Sign in to comment on rooms.');

    const classroom = createHarness({ schoolManaged: true });
    expect(classroom.controller.open()).toBe(false);
    expect(classroom.showTransientStatus).toHaveBeenCalledWith(
      'Classroom accounts cannot comment on rooms.',
    );
  });

  it('normalizes and submits the exact room, version, position, and body once', async () => {
    const harness = createHarness();
    harness.controller.open();
    harness.input().value = '  hello   comments  ';

    harness.form().emit('submit');
    await flushMicrotasks();

    expect(harness.submitComment).toHaveBeenCalledOnce();
    expect(harness.submitComment).toHaveBeenCalledWith('4,2', { x: 4, y: 2 }, {
      roomVersion: 7,
      position: { x: 23, y: 45 },
      body: 'hello comments',
    });
    expect(harness.playSubmitSound).toHaveBeenCalledOnce();
    expect(harness.showTransientStatus).toHaveBeenCalledWith('Comment submitted for review.');
    expect(harness.controller.getDebugSnapshot()).toEqual({
      composerOpen: false,
      submitting: false,
    });
  });

  it('disables controls while submitting and preserves failures for correction', async () => {
    const pending = deferred<unknown>();
    const harness = createHarness();
    harness.submitComment.mockReturnValueOnce(pending.promise);
    harness.controller.open();
    harness.input().value = 'keep me';

    harness.form().emit('submit');
    await Promise.resolve();
    expect(harness.submit().textContent).toBe('Submitting...');
    expect(harness.input().disabled).toBe(true);
    expect(harness.cancel().disabled).toBe(true);

    pending.reject(new Error('Safety write failed.'));
    await flushMicrotasks();
    expect(harness.showTransientStatus).toHaveBeenCalledWith('Safety write failed.');
    expect(harness.controller.isOpen()).toBe(true);
    expect(harness.input().value).toBe('keep me');
    expect(harness.input().disabled).toBe(false);
  });

  it('cleans up on mode exit and destroys all DOM ownership', () => {
    const harness = createHarness();
    harness.controller.open();
    harness.input().value = 'discard';
    harness.setRoom(null);

    harness.controller.update();
    expect(harness.controller.isOpen()).toBe(false);
    expect(harness.root().classList.contains('hidden')).toBe(true);
    expect(harness.input().value).toBe('');
    expect(harness.focusCanvas).not.toHaveBeenCalled();

    harness.controller.destroy();
    expect(harness.doc.getAllById('room-comment-composer')).toHaveLength(0);
  });
});

class TestClassList {
  private readonly names = new Set<string>();

  setFrom(value: string): void {
    this.names.clear();
    for (const name of value.split(/\s+/).filter(Boolean)) this.names.add(name);
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.names.has(name);
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    return enabled;
  }
}

class TestElement {
  readonly classList = new TestClassList();
  readonly children: TestElement[] = [];
  id = '';
  value = '';
  textContent = '';
  disabled = false;
  focused = false;
  parent: TestElement | null = null;
  private readonly listeners = new Map<string, Set<(event: TestEvent) => void>>();

  constructor(readonly tagName: string) {}

  set className(value: string) {
    this.classList.setFrom(value);
  }

  append(...children: TestElement[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  addEventListener(type: string, listener: (event: TestEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: TestEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, init: Partial<TestEvent> = {}): void {
    const event = { type, key: '', preventDefault: vi.fn(), ...init };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    this.focused = true;
  }

  blur(): void {
    this.focused = false;
  }

  reset(): void {
    for (const child of walk(this)) {
      if (child.tagName === 'textarea') child.value = '';
    }
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }
}

interface TestEvent {
  type: string;
  key: string;
  preventDefault: ReturnType<typeof vi.fn>;
}

class TestDocument {
  readonly body = new TestElement('body');

  createElement(tagName: string): TestElement {
    return new TestElement(tagName);
  }

  getElementById(id: string): TestElement {
    const element = this.getAllById(id)[0];
    if (!element) throw new Error(`Missing test element #${id}`);
    return element;
  }

  getAllById(id: string): TestElement[] {
    return Array.from(walk(this.body)).filter((element) => element.id === id);
  }

  getByClass(name: string): TestElement {
    const element = Array.from(walk(this.body)).find((candidate) => candidate.classList.contains(name));
    if (!element) throw new Error(`Missing test element .${name}`);
    return element;
  }
}

function* walk(root: TestElement): Generator<TestElement> {
  yield root;
  for (const child of root.children) yield* walk(child);
}

function createRoom(): RoomSnapshot {
  return {
    id: '4,2',
    coordinates: { x: 4, y: 2 },
    version: 7,
    status: 'published',
  } as RoomSnapshot;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
