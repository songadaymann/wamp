import {
  getDevicePerformanceMode,
  subscribeDevicePerformanceMode,
} from './devicePerformanceMode';
import {
  RuntimePerformanceAdvisor,
  type PerformanceAdvisorSuggestion,
  type PerformanceAdvisorSuggestionEvent,
} from './performanceAdvisor';
import {
  performanceAdvisorCooldownStore,
  type PerformanceAdvisorCooldownStore,
} from './performanceAdvisorCooldown';

export const PERFORMANCE_ADVISOR_SUGGESTION_EVENT =
  'wamp:performance-advisor-suggestion';

type PerformanceAdvisorSuggestionListener = (
  event: PerformanceAdvisorSuggestionEvent,
) => void;

interface PerformanceAdvisorRuntimeOptions {
  readonly monotonicNow?: () => number;
  readonly wallNow?: () => number;
  readonly eventTarget?: EventTarget | null;
  readonly cooldownStore?: Pick<PerformanceAdvisorCooldownStore, 'isCoolingDown'>;
}

/**
 * Page-lifetime owner for advisor state. Keeping this above Phaser scenes makes
 * the one-suggestion-per-session rule survive scene shutdowns and editor trips.
 */
export class PerformanceAdvisorRuntime {
  readonly advisor: RuntimePerformanceAdvisor;

  private readonly monotonicNow: () => number;
  private readonly wallNow: () => number;
  private readonly eventTarget: EventTarget | null;
  private readonly cooldownStore: Pick<PerformanceAdvisorCooldownStore, 'isCoolingDown'>;
  private readonly unsubscribeMode: () => void;

  constructor(options: PerformanceAdvisorRuntimeOptions = {}) {
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.wallNow = options.wallNow ?? (() => Date.now());
    this.eventTarget = options.eventTarget === undefined
      ? (typeof window === 'undefined' ? null : window)
      : options.eventTarget;
    this.cooldownStore = options.cooldownStore ?? performanceAdvisorCooldownStore;
    this.advisor = new RuntimePerformanceAdvisor({
      startedAtMs: this.monotonicNow(),
      mode: getDevicePerformanceMode(),
      eligible: false,
      onSuggestionEvent: (event) => this.forwardSuggestionEvent(event),
    });
    this.unsubscribeMode = subscribeDevicePerformanceMode(({ mode }) => {
      this.advisor.setMode(mode, this.monotonicNow());
    });
  }

  getSuggestion(): PerformanceAdvisorSuggestion | null {
    return this.advisor.getSuggestion(this.monotonicNow());
  }

  dismissSuggestion(suggestionId: number): boolean {
    const suggestion = this.advisor.getSuggestion(this.monotonicNow());
    if (!suggestion || suggestion.id !== suggestionId) {
      return false;
    }
    this.advisor.dismissSuggestion(this.monotonicNow());
    return true;
  }

  destroy(): void {
    this.unsubscribeMode();
    this.advisor.setEligibility(false, this.monotonicNow());
  }

  private forwardSuggestionEvent(event: PerformanceAdvisorSuggestionEvent): void {
    if (
      event.type === 'suggestion-created'
      && this.cooldownStore.isCoolingDown(this.wallNow())
    ) {
      this.advisor.clearSuggestion('manual', event.suggestion.createdAtMs);
      return;
    }
    if (!this.eventTarget || typeof CustomEvent === 'undefined') {
      return;
    }
    this.eventTarget.dispatchEvent(new CustomEvent<PerformanceAdvisorSuggestionEvent>(
      PERFORMANCE_ADVISOR_SUGGESTION_EVENT,
      { detail: event },
    ));
  }
}

export function subscribePerformanceAdvisorSuggestionEvents(
  listener: PerformanceAdvisorSuggestionListener,
  target: EventTarget = window,
): () => void {
  const handleEvent = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }
    listener(event.detail as PerformanceAdvisorSuggestionEvent);
  };
  target.addEventListener(PERFORMANCE_ADVISOR_SUGGESTION_EVENT, handleEvent);
  return () => {
    target.removeEventListener(PERFORMANCE_ADVISOR_SUGGESTION_EVENT, handleEvent);
  };
}

export const performanceAdvisorRuntime = new PerformanceAdvisorRuntime();
