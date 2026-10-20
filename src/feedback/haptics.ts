import { getHapticsEnabled, subscribeComfortSettings } from '../settings/comfortSettings';
import { hasBlockingModalOpen } from '../ui/modalState';

export type HapticCue = 'jump' | 'collect' | 'hit' | 'damage' | 'goal';
const cues: Record<HapticCue, { pattern: number | number[]; priority: number }> = {
  jump: { pattern: 5, priority: 0 },
  collect: { pattern: 8, priority: 0 },
  hit: { pattern: 15, priority: 1 },
  damage: { pattern: [20, 30, 20], priority: 2 },
  goal: { pattern: [30, 40, 60], priority: 3 },
};
const MIN_INTERVAL_MS = 80;

interface HapticsEnvironment {
  available(): boolean;
  enabled(): boolean;
  active(): boolean;
  now(): number;
  vibrate(pattern: number | number[]): boolean;
}

/** Local gameplay feedback. Bursts coalesce; stronger cues can replace weaker ones. */
export class HapticFeedbackController {
  private protectedUntil = 0;
  private vibratingUntil = 0;
  private priority = -1;

  constructor(private readonly environment: HapticsEnvironment) {}

  play(cue: HapticCue): boolean {
    const env = this.environment;
    if (!env.available() || !env.enabled() || !env.active()) {
      this.cancel();
      return false;
    }
    const { pattern, priority } = cues[cue];
    const now = env.now();
    if (now < this.protectedUntil && priority <= this.priority) return false;
    const duration = typeof pattern === 'number' ? pattern : pattern.reduce((sum, ms) => sum + ms, 0);
    this.protectedUntil = now + Math.max(MIN_INTERVAL_MS, duration);
    this.priority = priority;
    try {
      // A browser can reject vibration even when the method exists.
      const accepted = env.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
      if (accepted) this.vibratingUntil = now + duration;
      return accepted;
    } catch {
      return false;
    }
  }

  cancel(): void {
    const active = this.vibratingUntil > this.environment.now();
    this.protectedUntil = 0;
    this.vibratingUntil = 0;
    this.priority = -1;
    if (active) {
      try { this.environment.vibrate(0); } catch { /* Feedback never interrupts play. */ }
    }
  }
}

export function isHapticsAvailable(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
    && typeof navigator.vibrate === 'function' && window.top === window.self
    && window.matchMedia('(pointer: coarse)').matches;
}

let controller: HapticFeedbackController | null = null;
let releaseListeners: (() => void) | null = null;

/** Register cancellation only when a supported device first reaches gameplay feedback. */
export function playHaptic(cue: HapticCue): void {
  if (!isHapticsAvailable()) { controller?.cancel(); return; }
  if (!controller) {
    controller = new HapticFeedbackController({
      available: isHapticsAvailable,
      enabled: getHapticsEnabled,
      active: () => document.visibilityState === 'visible' && document.hasFocus()
        && document.body.dataset.appMode === 'play-world'
        && navigator.userActivation?.hasBeenActive !== false
        && !document.getElementById('auth-panel')?.classList.contains('menu-open')
        && !hasBlockingModalOpen(),
      now: () => performance.now(),
      vibrate: pattern => navigator.vibrate(pattern),
    });
    const cancel = () => controller?.cancel();
    const visibility = () => { if (document.visibilityState !== 'visible') cancel(); };
    const unsubscribe = subscribeComfortSettings(settings => { if (!settings.haptics) cancel(); });
    const modeObserver = new MutationObserver(() => {
      if (document.body.dataset.appMode !== 'play-world') cancel();
    });
    modeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-app-mode'] });
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    releaseListeners = () => {
      unsubscribe();
      modeObserver.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pagehide', cancel);
    };
  }
  controller.play(cue);
}

export function destroyHaptics(): void {
  controller?.cancel();
  controller = null;
  releaseListeners?.();
  releaseListeners = null;
}

if (import.meta.hot) import.meta.hot.dispose(destroyHaptics);
