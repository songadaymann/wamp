import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import {
  getDevicePerformanceMode,
  setDevicePerformanceMode,
} from '../../performance/devicePerformanceMode';
import type { PerformanceAdvisorSuggestion } from '../../performance/performanceAdvisor';
import { PerformanceSuggestionModalController } from './performanceSuggestionModal';

class FakeClassList {
  private readonly values = new Set<string>();

  constructor(...initialValues: string[]) {
    for (const value of initialValues) this.values.add(value);
  }

  add(...values: string[]): void {
    for (const value of values) this.values.add(value);
  }

  remove(...values: string[]): void {
    for (const value of values) this.values.delete(value);
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }
}

class FakeElement extends EventTarget {
  readonly classList: FakeClassList;
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  isConnected = true;

  constructor(
    initialClasses: string[] = [],
    private readonly onFocus?: (element: FakeElement) => void,
  ) {
    super();
    this.classList = new FakeClassList(...initialClasses);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  focus(): void {
    this.onFocus?.(this);
  }
}

class FakeMutationObserver {
  static readonly instances = new Set<FakeMutationObserver>();
  private connected = false;

  constructor(private readonly callback: MutationCallback) {
    FakeMutationObserver.instances.add(this);
  }

  observe(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
    FakeMutationObserver.instances.delete(this);
  }

  takeRecords(): MutationRecord[] {
    return [];
  }

  notify(): void {
    if (this.connected) {
      this.callback([], this as unknown as MutationObserver);
    }
  }

  static notifyAll(): void {
    for (const observer of FakeMutationObserver.instances) observer.notify();
  }

  static reset(): void {
    FakeMutationObserver.instances.clear();
  }
}

class FakeDocument extends EventTarget {
  readonly body: FakeElement;
  readonly elements = new Map<string, FakeElement>();
  visibilityState: DocumentVisibilityState = 'visible';
  activeElement: FakeElement | null;
  focused = true;

  constructor() {
    super();
    const focus = (element: FakeElement) => {
      this.activeElement = element;
    };
    this.body = new FakeElement([], focus);
    this.activeElement = this.body;
    this.elements.set(
      'performance-suggestion-modal',
      new FakeElement(['history-modal', 'hidden'], focus),
    );
    this.elements.set('btn-performance-suggestion-accept', new FakeElement([], focus));
    this.elements.set('btn-performance-suggestion-dismiss', new FakeElement([], focus));
    this.elements.set('auth-panel', new FakeElement());
    this.elements.set('busy-overlay', new FakeElement(['hidden']));
    this.body.dataset.appReady = 'true';
    this.body.dataset.appMode = 'play-world';
  }

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === '.history-modal') {
      return Array.from(this.elements.values()).filter((element) => {
        return element.classList.contains('history-modal');
      });
    }
    if (selector === '.pvp-modal[aria-modal="true"]') {
      return Array.from(this.elements.values()).filter((element) => {
        return (
          element.classList.contains('pvp-modal')
          && element.getAttribute('aria-modal') === 'true'
        );
      });
    }
    return [];
  }

  hasFocus(): boolean {
    return this.focused;
  }
}

class FakeWindow extends EventTarget {
  readonly MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver;

  setTimeout(handler: TimerHandler, delay?: number): number {
    return globalThis.setTimeout(handler, delay) as unknown as number;
  }

  clearTimeout(timerId: number): void {
    globalThis.clearTimeout(timerId);
  }
}

type TestScene = {
  suggestion: PerformanceAdvisorSuggestion | null;
  pauseRequests: boolean[];
  dismissRequests: number[];
  canPresent: boolean;
  getPerformanceAdvisorSuggestion: () => PerformanceAdvisorSuggestion | null;
  canPresentPerformanceAdvisorSuggestion: () => boolean;
  setPerformanceSuggestionPauseRequested: (requested: boolean) => void;
  dismissPerformanceAdvisorSuggestion: (suggestionId: number) => boolean;
};

function makeSuggestion(id = 1): PerformanceAdvisorSuggestion {
  return {
    id,
    reason: 'render-gpu-pressure',
    createdAtMs: performance.now(),
    expiresAtMs: performance.now() + 60_000,
    evidence: {
      type: 'render-buckets',
      consecutiveBucketCount: 3,
      approximateFps: 25,
      over50FrameCount: 4,
      criticalUpdateP95Ms: 30,
    },
  };
}

function makeScene(suggestion: PerformanceAdvisorSuggestion | null): TestScene {
  const scene: TestScene = {
    suggestion,
    pauseRequests: [],
    dismissRequests: [],
    canPresent: true,
    getPerformanceAdvisorSuggestion: () => scene.suggestion,
    canPresentPerformanceAdvisorSuggestion: () => scene.canPresent,
    setPerformanceSuggestionPauseRequested: (requested) => {
      scene.pauseRequests.push(requested);
    },
    dismissPerformanceAdvisorSuggestion: (suggestionId) => {
      scene.dismissRequests.push(suggestionId);
      if (scene.suggestion?.id !== suggestionId) return false;
      scene.suggestion = null;
      return true;
    },
  };
  return scene;
}

function createHarness(initialScene: TestScene, suggestion: PerformanceAdvisorSuggestion) {
  const doc = new FakeDocument();
  const windowObj = new FakeWindow();
  let scene: TestScene | null = initialScene;
  const game = {
    scene: {
      getScene: () => scene,
      isActive: () => scene !== null,
    },
  };
  const runtime = {
    suggestion: suggestion as PerformanceAdvisorSuggestion | null,
    dismissRequests: [] as number[],
    getSuggestion() {
      return this.suggestion;
    },
    dismissSuggestion(suggestionId: number) {
      this.dismissRequests.push(suggestionId);
      if (this.suggestion?.id !== suggestionId) return false;
      this.suggestion = null;
      return true;
    },
  };
  const cooldown = {
    dismiss: vi.fn(() => Date.now() + 86_400_000),
    isCoolingDown: vi.fn(() => false),
  };
  const controller = new PerformanceSuggestionModalController(
    game as never,
    runtime,
    cooldown,
    doc as unknown as Document,
    windowObj as unknown as Window,
  );

  return {
    controller,
    cooldown,
    doc,
    runtime,
    windowObj,
    setScene(nextScene: TestScene | null) {
      scene = nextScene;
    },
  };
}

function openInitialSuggestion(
  controller: PerformanceSuggestionModalController,
): void {
  controller.init();
  vi.advanceTimersByTime(0);
  expect(controller.isOpen()).toBe(true);
}

function addPvpModal(doc: FakeDocument): FakeElement {
  const modal = new FakeElement(['pvp-modal'], (element) => {
    doc.activeElement = element;
  });
  modal.setAttribute('aria-modal', 'true');
  doc.elements.set('test-pvp-modal', modal);
  modal.focus();
  FakeMutationObserver.notifyAll();
  return modal;
}

function removePvpModal(doc: FakeDocument, modal: FakeElement): void {
  modal.isConnected = false;
  doc.elements.delete('test-pvp-modal');
  FakeMutationObserver.notifyAll();
}

describe('PerformanceSuggestionModalController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMutationObserver.reset();
    vi.stubGlobal('HTMLElement', FakeElement);
    setDevicePerformanceMode('auto');
  });

  afterEach(() => {
    setDevicePerformanceMode('auto');
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeMutationObserver.reset();
  });

  it('clears pause ownership when the old scene disappears and pauses a later scene', () => {
    const suggestion = makeSuggestion();
    const firstScene = makeScene(suggestion);
    const harness = createHarness(firstScene, suggestion);
    openInitialSuggestion(harness.controller);
    expect(firstScene.pauseRequests).toEqual([true]);

    harness.setScene(null);
    harness.controller.forceClose();

    const replacementScene = makeScene(suggestion);
    harness.setScene(replacementScene);
    harness.windowObj.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(0);

    expect(harness.controller.isOpen()).toBe(true);
    expect(replacementScene.pauseRequests).toEqual([true]);
    harness.controller.destroy();
  });

  it('re-queries a live candidate after an editor app-mode detour', () => {
    const suggestion = makeSuggestion();
    const scene = makeScene(suggestion);
    const harness = createHarness(scene, suggestion);
    openInitialSuggestion(harness.controller);

    harness.controller.forceClose();
    harness.doc.body.dataset.appMode = 'editor';
    FakeMutationObserver.notifyAll();
    vi.advanceTimersByTime(250);
    expect(harness.controller.isOpen()).toBe(false);

    harness.doc.body.dataset.appMode = 'play-world';
    FakeMutationObserver.notifyAll();
    vi.advanceTimersByTime(250);

    expect(harness.controller.isOpen()).toBe(true);
    expect(scene.pauseRequests).toEqual([true, false, true]);
    harness.controller.destroy();
  });

  it('does not switch modes until the player accepts the suggestion', () => {
    const suggestion = makeSuggestion();
    const scene = makeScene(suggestion);
    const harness = createHarness(scene, suggestion);
    openInitialSuggestion(harness.controller);
    expect(getDevicePerformanceMode()).toBe('auto');

    harness.doc.getElementById('btn-performance-suggestion-accept')
      ?.dispatchEvent(new Event('click'));

    expect(getDevicePerformanceMode()).toBe('battery-saver');
    expect(harness.controller.isOpen()).toBe(false);
    expect(harness.cooldown.dismiss).not.toHaveBeenCalled();
    harness.controller.destroy();
  });

  it('records cooldown on dismissal and keeps stale IDs from dismissing a newer candidate', () => {
    const visibleSuggestion = makeSuggestion(7);
    const scene = makeScene(visibleSuggestion);
    const harness = createHarness(scene, visibleSuggestion);
    openInitialSuggestion(harness.controller);
    const newerSuggestion = makeSuggestion(8);
    scene.suggestion = newerSuggestion;
    harness.runtime.suggestion = newerSuggestion;

    harness.doc.getElementById('btn-performance-suggestion-dismiss')
      ?.dispatchEvent(new Event('click'));

    expect(harness.cooldown.dismiss).toHaveBeenCalledOnce();
    expect(scene.dismissRequests).toEqual([7]);
    expect(harness.runtime.dismissRequests).toEqual([7]);
    expect(scene.suggestion).toBe(newerSuggestion);
    expect(harness.runtime.suggestion).toBe(newerSuggestion);
    expect(getDevicePerformanceMode()).toBe('auto');
    harness.controller.destroy();
  });

  it('defers a suggestion queued behind an existing PvP invite', () => {
    const suggestion = makeSuggestion();
    const scene = makeScene(suggestion);
    const harness = createHarness(scene, suggestion);
    const pvpModal = addPvpModal(harness.doc);

    harness.controller.init();
    vi.advanceTimersByTime(500);

    expect(harness.controller.isOpen()).toBe(false);
    expect(scene.pauseRequests).toEqual([]);
    expect(scene.suggestion).toBe(suggestion);
    expect(harness.cooldown.dismiss).not.toHaveBeenCalled();
    expect(scene.dismissRequests).toEqual([]);
    expect(harness.runtime.dismissRequests).toEqual([]);

    removePvpModal(harness.doc, pvpModal);
    vi.advanceTimersByTime(250);

    expect(harness.controller.isOpen()).toBe(true);
    expect(scene.pauseRequests).toEqual([true]);
    harness.controller.destroy();
  });

  it('yields an open suggestion to a PvP invite without losing the candidate', () => {
    const suggestion = makeSuggestion();
    const scene = makeScene(suggestion);
    const harness = createHarness(scene, suggestion);
    openInitialSuggestion(harness.controller);

    const pvpModal = addPvpModal(harness.doc);

    expect(harness.controller.isOpen()).toBe(false);
    expect(harness.doc.activeElement).toBe(pvpModal);
    expect(scene.pauseRequests).toEqual([true, false]);
    expect(scene.suggestion).toBe(suggestion);
    expect(harness.cooldown.dismiss).not.toHaveBeenCalled();
    expect(scene.dismissRequests).toEqual([]);
    expect(harness.runtime.dismissRequests).toEqual([]);

    vi.advanceTimersByTime(250);
    expect(harness.controller.isOpen()).toBe(false);

    removePvpModal(harness.doc, pvpModal);
    vi.advanceTimersByTime(250);

    expect(harness.controller.isOpen()).toBe(true);
    expect(scene.pauseRequests).toEqual([true, false, true]);
    harness.controller.destroy();
  });

  it('stays deferred through a delayed same-room PvP setup', () => {
    const suggestion = makeSuggestion();
    const scene = makeScene(suggestion);
    const harness = createHarness(scene, suggestion);
    openInitialSuggestion(harness.controller);

    scene.canPresent = false;
    harness.controller.handlePvpSetupStateChanged(true);

    expect(harness.controller.isOpen()).toBe(false);
    expect(scene.pauseRequests).toEqual([true, false]);
    vi.advanceTimersByTime(1_000);
    expect(harness.controller.isOpen()).toBe(false);
    expect(scene.suggestion).toBe(suggestion);

    scene.canPresent = true;
    harness.controller.handlePvpSetupStateChanged(false);
    vi.advanceTimersByTime(250);

    expect(harness.controller.isOpen()).toBe(true);
    expect(scene.pauseRequests).toEqual([true, false, true]);
    harness.controller.destroy();
  });
});
