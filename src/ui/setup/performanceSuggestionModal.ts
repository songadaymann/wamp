import Phaser from 'phaser';
import {
  getDevicePerformanceMode,
  setDevicePerformanceMode,
} from '../../performance/devicePerformanceMode';
import type {
  PerformanceAdvisorSuggestion,
  PerformanceAdvisorSuggestionEvent,
} from '../../performance/performanceAdvisor';
import {
  performanceAdvisorCooldownStore,
  type PerformanceAdvisorCooldownStore,
} from '../../performance/performanceAdvisorCooldown';
import {
  performanceAdvisorRuntime,
  subscribePerformanceAdvisorSuggestionEvents,
} from '../../performance/performanceAdvisorRuntime';
import { APP_READY_EVENT } from '../appFeedback';
import { createModalLifecycle } from './modalLifecycle';
import {
  getActiveOverworldScene,
  getOverworldScene,
} from './sceneBridge';

const SAFE_OPEN_POLL_MS = 250;

let activePerformanceSuggestionModalController: PerformanceSuggestionModalController | null = null;

export function getPerformanceSuggestionModalController(): PerformanceSuggestionModalController | null {
  return activePerformanceSuggestionModalController;
}

type PerformanceSuggestionElements = {
  modal: HTMLElement | null;
  acceptButton: HTMLButtonElement | null;
  dismissButton: HTMLButtonElement | null;
  authPanel: HTMLElement | null;
  busyOverlay: HTMLElement | null;
};

type PerformanceSuggestionRuntime = Pick<
  typeof performanceAdvisorRuntime,
  'getSuggestion' | 'dismissSuggestion'
>;

type PerformanceSuggestionCooldownStore = Pick<
  PerformanceAdvisorCooldownStore,
  'dismiss' | 'isCoolingDown'
>;

export class PerformanceSuggestionModalController {
  private readonly elements: PerformanceSuggestionElements;
  private readonly lifecycle: ReturnType<typeof createModalLifecycle>;
  private unsubscribeSuggestionEvents: (() => void) | null = null;
  private pendingSuggestion: PerformanceAdvisorSuggestion | null = null;
  private visibleSuggestionId: number | null = null;
  private presentationTimer: number | null = null;
  private presentationGeneration = 0;
  private previousFocus: HTMLElement | null = null;
  private scenePauseRequested = false;
  private appModeObserver: MutationObserver | null = null;
  private initialized = false;

  private readonly handleAcceptClick = () => {
    if (this.visibleSuggestionId === null) {
      return;
    }

    // Close local UI before selecting the mode. The mode change synchronously
    // clears the advisor suggestion and emits a second lifecycle event.
    this.forceClose();
    setDevicePerformanceMode('battery-saver');
  };

  private readonly handleDismissClick = () => {
    this.dismissByUser();
  };

  private readonly handleVisibilityChange = () => {
    if (this.doc.visibilityState !== 'visible') {
      this.clearPresentationTimer();
      return;
    }

    this.syncCurrentSuggestion();
  };

  private readonly handleWindowFocus = () => {
    this.syncCurrentSuggestion();
  };

  private readonly handleAppReady = () => {
    this.syncCurrentSuggestion();
  };

  private readonly handleAppModeChange = () => {
    if (this.hasVisiblePvpModal()) {
      if (this.visibleSuggestionId !== null) {
        this.deferForBlockingSurface();
      } else if (this.pendingSuggestion !== null) {
        this.schedulePresentation(SAFE_OPEN_POLL_MS, this.presentationGeneration);
      }
      return;
    }

    this.syncCurrentSuggestion();
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly advisorRuntime: PerformanceSuggestionRuntime = performanceAdvisorRuntime,
    private readonly cooldownStore: PerformanceSuggestionCooldownStore = performanceAdvisorCooldownStore,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      modal: this.doc.getElementById('performance-suggestion-modal'),
      acceptButton: this.doc.getElementById(
        'btn-performance-suggestion-accept',
      ) as HTMLButtonElement | null,
      dismissButton: this.doc.getElementById(
        'btn-performance-suggestion-dismiss',
      ) as HTMLButtonElement | null,
      authPanel: this.doc.getElementById('auth-panel'),
      busyOverlay: this.doc.getElementById('busy-overlay'),
    };
    this.lifecycle = createModalLifecycle({
      doc: this.doc,
      modal: this.elements.modal,
      onClose: () => this.dismissByUser(),
    });
  }

  init(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    activePerformanceSuggestionModalController = this;
    this.elements.acceptButton?.addEventListener('click', this.handleAcceptClick);
    this.elements.dismissButton?.addEventListener('click', this.handleDismissClick);
    this.lifecycle.attach();
    this.doc.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.windowObj.addEventListener('focus', this.handleWindowFocus);
    this.windowObj.addEventListener(APP_READY_EVENT, this.handleAppReady);
    const MutationObserverCtor = (
      this.windowObj as Window & { MutationObserver?: typeof MutationObserver }
    ).MutationObserver;
    if (typeof MutationObserverCtor === 'function') {
      const observer = new MutationObserverCtor(this.handleAppModeChange);
      observer.observe(this.doc.body, {
        attributes: true,
        attributeFilter: ['data-app-mode'],
        childList: true,
      });
      this.appModeObserver = observer;
    }
    this.unsubscribeSuggestionEvents = subscribePerformanceAdvisorSuggestionEvents(
      (event) => this.handleSuggestionEvent(event),
      this.windowObj,
    );
    this.syncCurrentSuggestion();
  }

  destroy(): void {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;
    if (activePerformanceSuggestionModalController === this) {
      activePerformanceSuggestionModalController = null;
    }
    this.elements.acceptButton?.removeEventListener('click', this.handleAcceptClick);
    this.elements.dismissButton?.removeEventListener('click', this.handleDismissClick);
    this.lifecycle.detach();
    this.doc.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.windowObj.removeEventListener('focus', this.handleWindowFocus);
    this.windowObj.removeEventListener(APP_READY_EVENT, this.handleAppReady);
    this.appModeObserver?.disconnect();
    this.appModeObserver = null;
    this.unsubscribeSuggestionEvents?.();
    this.unsubscribeSuggestionEvents = null;
    this.forceClose();
  }

  /** Close without recording a user dismissal or extending the cooldown. */
  forceClose(): void {
    this.closePresentation(true);
  }

  private closePresentation(restoreFocus: boolean): void {
    this.presentationGeneration += 1;
    this.clearPresentationTimer();
    this.pendingSuggestion = null;
    this.visibleSuggestionId = null;

    const wasOpen = this.lifecycle.isOpen();
    this.lifecycle.hide();
    this.setScenePauseRequested(false);
    if (wasOpen && restoreFocus) {
      this.restorePreviousFocus();
    } else {
      this.previousFocus = null;
    }
  }

  isOpen(): boolean {
    return this.lifecycle.isOpen();
  }

  /**
   * Editor navigation closes every world modal before the body app-mode changes.
   * Keep a live advisor candidate queued so returning to play can present it
   * without requiring another pressure incident or suggestion event.
   */
  deferForAppModeTransition(): void {
    const suggestion = this.getCurrentSuggestion() ?? this.pendingSuggestion;
    this.forceClose();
    if (!this.initialized || !suggestion) {
      return;
    }

    this.queueSuggestion(suggestion, SAFE_OPEN_POLL_MS);
  }

  handlePvpSetupStateChanged(inProgress: boolean): void {
    if (!this.initialized) {
      return;
    }
    if (!inProgress) {
      this.syncCurrentSuggestion();
      return;
    }

    const suggestion = this.getCurrentSuggestion() ?? this.pendingSuggestion;
    this.forceClose();
    if (suggestion) {
      this.queueSuggestion(suggestion, SAFE_OPEN_POLL_MS);
    }
  }

  private deferForBlockingSurface(): void {
    const suggestion = this.getCurrentSuggestion() ?? this.pendingSuggestion;
    // A PvP prompt focuses its own primary action before the mutation observer
    // runs. Do not restore the element that was focused before this suggestion,
    // or the background prompt would steal focus back from the PvP dialog.
    this.closePresentation(false);
    if (!this.initialized || !suggestion) {
      return;
    }

    this.queueSuggestion(suggestion, SAFE_OPEN_POLL_MS);
  }

  private handleSuggestionEvent(event: PerformanceAdvisorSuggestionEvent): void {
    if (event.type === 'suggestion-created') {
      this.queueSuggestion(event.suggestion);
      return;
    }

    if (
      this.pendingSuggestion?.id !== event.suggestionId
      && this.visibleSuggestionId !== event.suggestionId
    ) {
      return;
    }

    this.forceClose();
  }

  private queueSuggestion(
    suggestion: PerformanceAdvisorSuggestion,
    presentationDelayMs = 0,
  ): void {
    if (
      this.cooldownStore.isCoolingDown(Date.now())
      || getDevicePerformanceMode() !== 'auto'
    ) {
      this.forceClose();
      this.dismissAdvisorSuggestion(suggestion.id);
      return;
    }

    if (this.visibleSuggestionId === suggestion.id) {
      return;
    }

    this.forceClose();
    this.pendingSuggestion = suggestion;
    this.presentationGeneration += 1;
    this.schedulePresentation(presentationDelayMs, this.presentationGeneration);
  }

  private syncCurrentSuggestion(): void {
    if (!this.initialized) {
      return;
    }

    const generationBeforeQuery = this.presentationGeneration;
    const suggestion = this.getCurrentSuggestion();
    if (generationBeforeQuery !== this.presentationGeneration) {
      return;
    }

    if (!suggestion) {
      if (this.pendingSuggestion || this.visibleSuggestionId !== null) {
        this.forceClose();
      }
      return;
    }

    if (
      this.pendingSuggestion?.id === suggestion.id
      || this.visibleSuggestionId === suggestion.id
    ) {
      if (this.pendingSuggestion && this.presentationTimer === null) {
        this.schedulePresentation(0, this.presentationGeneration);
      }
      return;
    }

    this.queueSuggestion(suggestion);
  }

  private getCurrentSuggestion(): PerformanceAdvisorSuggestion | null {
    const scene = getOverworldScene(this.game);
    if (scene?.getPerformanceAdvisorSuggestion) {
      return scene.getPerformanceAdvisorSuggestion();
    }
    return this.advisorRuntime.getSuggestion();
  }

  private schedulePresentation(delayMs: number, generation: number): void {
    this.clearPresentationTimer();
    const suggestion = this.pendingSuggestion;
    if (!suggestion || this.doc.visibilityState !== 'visible') {
      return;
    }

    const remainingMs = suggestion.expiresAtMs - performance.now();
    if (remainingMs <= 0) {
      this.forceClose();
      return;
    }

    this.presentationTimer = this.windowObj.setTimeout(() => {
      this.presentationTimer = null;
      this.tryPresent(generation);
    }, Math.min(Math.max(0, delayMs), remainingMs));
  }

  private tryPresent(generation: number): void {
    if (generation !== this.presentationGeneration) {
      return;
    }

    const pending = this.pendingSuggestion;
    if (!pending) {
      return;
    }

    const suggestion = this.getCurrentSuggestion();
    if (generation !== this.presentationGeneration) {
      return;
    }
    if (!suggestion || suggestion.id !== pending.id) {
      this.forceClose();
      return;
    }

    const nowMs = performance.now();
    if (nowMs >= suggestion.expiresAtMs) {
      this.forceClose();
      return;
    }
    if (this.cooldownStore.isCoolingDown(Date.now())) {
      this.forceClose();
      this.dismissAdvisorSuggestion(suggestion.id);
      return;
    }
    if (getDevicePerformanceMode() !== 'auto') {
      this.forceClose();
      return;
    }

    if (!this.canPresent()) {
      const remainingMs = suggestion.expiresAtMs - nowMs;
      this.schedulePresentation(
        Math.max(16, Math.min(SAFE_OPEN_POLL_MS, remainingMs)),
        generation,
      );
      return;
    }

    this.present(suggestion);
  }

  private canPresent(): boolean {
    if (
      this.doc.visibilityState !== 'visible'
      || this.doc.body.dataset.appReady !== 'true'
      || this.doc.body.dataset.appMode !== 'play-world'
      || (typeof this.doc.hasFocus === 'function' && !this.doc.hasFocus())
      || (this.elements.busyOverlay && !this.elements.busyOverlay.classList.contains('hidden'))
      || this.elements.authPanel?.classList.contains('menu-open')
      || this.hasVisiblePvpModal()
      || this.hasBlockingModal()
    ) {
      return false;
    }

    const scene = getActiveOverworldScene(this.game);
    return scene?.canPresentPerformanceAdvisorSuggestion?.() === true;
  }

  private hasBlockingModal(): boolean {
    return Array.from(this.doc.querySelectorAll<HTMLElement>('.history-modal')).some((modal) => {
      return modal !== this.elements.modal && !modal.classList.contains('hidden');
    });
  }

  private hasVisiblePvpModal(): boolean {
    return Array.from(
      this.doc.querySelectorAll<HTMLElement>('.pvp-modal[aria-modal="true"]'),
    ).some((modal) => {
      return (
        modal.isConnected
        && !modal.classList.contains('hidden')
        && modal.getAttribute('aria-hidden') !== 'true'
      );
    });
  }

  private present(suggestion: PerformanceAdvisorSuggestion): void {
    this.clearPresentationTimer();
    this.pendingSuggestion = null;
    this.visibleSuggestionId = suggestion.id;
    const activeElement = this.doc.activeElement;
    this.previousFocus = activeElement instanceof HTMLElement ? activeElement : null;

    if (!this.setScenePauseRequested(true) || !this.lifecycle.show()) {
      this.forceClose();
      return;
    }

    this.elements.acceptButton?.focus({ preventScroll: true });
  }

  private dismissByUser(): void {
    const suggestionId = this.visibleSuggestionId;
    if (suggestionId === null) {
      this.forceClose();
      return;
    }

    this.forceClose();
    // Cooldown uses epoch time so it remains meaningful across page reloads.
    this.cooldownStore.dismiss(Date.now());
    this.dismissAdvisorSuggestion(suggestionId);
  }

  private dismissAdvisorSuggestion(suggestionId: number): void {
    const scene = getOverworldScene(this.game);
    if (scene?.dismissPerformanceAdvisorSuggestion?.(suggestionId) === true) {
      return;
    }
    this.advisorRuntime.dismissSuggestion(suggestionId);
  }

  private setScenePauseRequested(requested: boolean): boolean {
    if (!requested) {
      // A Phaser scene can disappear between showing and closing the modal.
      // Clear our local ownership even when there is no longer a bridge to
      // notify, otherwise the next scene would be treated as already paused.
      const wasRequested = this.scenePauseRequested;
      this.scenePauseRequested = false;
      if (wasRequested) {
        getOverworldScene(this.game)?.setPerformanceSuggestionPauseRequested?.(false);
      }
      return true;
    }

    if (requested === this.scenePauseRequested) {
      return true;
    }

    const scene = getOverworldScene(this.game);
    if (!scene?.setPerformanceSuggestionPauseRequested) {
      return false;
    }

    scene.setPerformanceSuggestionPauseRequested(requested);
    this.scenePauseRequested = requested;
    return true;
  }

  private restorePreviousFocus(): void {
    const previousFocus = this.previousFocus;
    this.previousFocus = null;
    if (!previousFocus?.isConnected) {
      return;
    }

    previousFocus.focus({ preventScroll: true });
  }

  private clearPresentationTimer(): void {
    if (this.presentationTimer === null) {
      return;
    }

    this.windowObj.clearTimeout(this.presentationTimer);
    this.presentationTimer = null;
  }
}
