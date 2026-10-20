export type AudioResumeDebugEntry = {
  at: number;
  trigger: string;
  status: 'no-context' | 'already-running' | 'resumed' | 'failed';
  stateBefore: string | null;
  stateAfter: string | null;
  errorName?: string;
  errorMessage?: string;
};

export type AudioContextStateDebugEntry = {
  at: number;
  state: string;
};

/** One line of the audio lifecycle log: page hide/show, context state changes and resumes. */
export type AudioLifecycleLogEntry = {
  at: number;
  event: string;
  state: string | null;
};

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * iPhone (Safari 16.4+): music and effects both follow the silent switch and mix with
 * the player's own music, the way native games behave. Without this, Web Audio music
 * and HTMLAudio effects follow different silent-switch rules.
 */
export const AUDIO_SESSION_TYPE = 'ambient';

/** Automatic resumes after an interruption, per window, before waiting for a gesture. */
const MAX_INTERRUPTION_RESUMES = 3;
const INTERRUPTION_RESUME_WINDOW_MS = 10_000;
/**
 * After the page comes back, iPhone Safari can refuse or ignore the first resume while it
 * is still ending its own interruption, so music stayed off until the next tab switch
 * (F229). Try again shortly after, while the page stays visible and audio is not running.
 */
const RETURN_RESUME_RETRY_DELAYS_MS = [300, 1_000, 3_000] as const;
const LIFECYCLE_LOG_LIMIT = 40;
/**
 * iPhone Safari counts a tap as a gesture when the finger lifts (touchend, pointerup, click),
 * so a resume started on touchstart or pointerdown alone can be refused.
 */
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown'] as const;

/**
 * The one Web Audio context the game shares. Music and routed sound effects play into
 * their own buses, both feed one master, and the context follows one lifecycle:
 * unlocked by the first gesture, suspended while the page is hidden, and resumed when
 * it is visible again or after a phone call, Siri or another app interrupts it.
 */
export class AudioEngine {
  private initialized = false;
  private interacted = false;
  private lifecycleDocument: Pick<Document, 'hidden'> | null = null;
  private context: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private readonly hiddenListeners = new Set<() => void>();
  private readonly firstInteractionListeners = new Set<() => void>();
  private readonly interactionListeners = new Set<() => void>();
  private readonly stateListeners = new Set<(state: string) => void>();
  private readonly lifecycleLog: AudioLifecycleLogEntry[] = [];
  private returnRetryTimers: number[] = [];
  private lifecycleWindow: Window | null = null;
  private audioSessionType: string | null = null;
  private interruptionResumes: number[] = [];
  private lastResumeAttempt: AudioResumeDebugEntry | null = null;
  private lastStateChange: AudioContextStateDebugEntry | null = null;

  init(windowObj: Window = window): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.lifecycleDocument = windowObj.document;
    this.lifecycleWindow = windowObj;
    this.audioSessionType = setAudioSessionType(windowObj.navigator as AudioSessionNavigator | undefined);
    const markInteracted = () => {
      for (const listener of this.interactionListeners) listener();
      const first = !this.interacted;
      this.interacted = true;
      void this.resume('user-gesture');
      if (first) {
        for (const listener of this.firstInteractionListeners) listener();
        this.firstInteractionListeners.clear();
      }
    };
    const resumeAfterLifecycleEvent = (trigger: string) => {
      if (this.interacted) {
        void this.resume(trigger);
      }
    };

    // Capture, so the context unlocks before the game's own handlers play their first sound.
    for (const name of GESTURE_EVENTS) {
      windowObj.addEventListener(name, markInteracted, { passive: true, capture: true });
    }
    windowObj.addEventListener('focus', () => resumeAfterLifecycleEvent('window-focus'), { passive: true });
    windowObj.addEventListener('pageshow', () => resumeAfterLifecycleEvent('pageshow'), { passive: true });
    windowObj.document.addEventListener('visibilitychange', () => {
      if (windowObj.document.hidden) {
        this.log('page-hidden');
        this.clearReturnRetries();
        for (const listener of this.hiddenListeners) listener();
        this.suspend();
      } else {
        this.log('page-visible');
        resumeAfterLifecycleEvent('visibilitychange-visible');
        if (this.interacted) this.scheduleReturnRetries();
      }
    });
  }

  get userInteracted(): boolean {
    return this.interacted;
  }

  get hidden(): boolean {
    return Boolean(this.lifecycleDocument?.hidden);
  }

  /** Runs once after the player's first tap, click or key (or now, if that already happened). */
  onFirstInteraction(listener: () => void): void {
    if (this.interacted) listener();
    else this.firstInteractionListeners.add(listener);
  }

  /** Reuses the engine's gesture listeners for work needed after a cancelled navigation. */
  onInteraction(listener: () => void): void {
    this.interactionListeners.add(listener);
  }

  /** Runs when the page is hidden, just before the context suspends. */
  onHidden(listener: () => void): void {
    this.hiddenListeners.add(listener);
  }

  /** Runs on every context state change ('running', 'suspended', Safari's 'interrupted'). */
  onStateChange(listener: (state: string) => void): void {
    this.stateListeners.add(listener);
  }

  /** The context if one exists; never creates it. */
  peekContext(): AudioContext | null {
    return this.context;
  }

  getContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }

    const audioWindow = window as AudioWindow;
    const AudioContextCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null;
    if (!AudioContextCtor) {
      return null;
    }

    const context = new AudioContextCtor();
    const master = context.createGain();
    master.connect(context.destination);
    const musicBus = context.createGain();
    musicBus.connect(master);
    const sfxBus = context.createGain();
    sfxBus.connect(master);
    this.context = context;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.lastStateChange = { at: Date.now(), state: context.state };
    context.addEventListener('statechange', () => this.handleStateChange(context));
    if (this.hidden) this.suspend();
    return context;
  }

  getMusicBus(): GainNode | null {
    return this.getContext() ? this.musicBus : null;
  }

  /** The music bus if the context exists; never creates it. */
  peekMusicBus(): GainNode | null {
    return this.musicBus;
  }

  getSfxBus(): GainNode | null {
    return this.getContext() ? this.sfxBus : null;
  }

  suspend(): void {
    if (this.context?.state === 'running') {
      void this.context.suspend().catch(() => void 0);
    }
  }

  async resume(trigger: string): Promise<void> {
    if (this.hidden) {
      this.suspend();
      return;
    }
    const context = this.context;
    const stateBefore = context?.state ?? null;
    if (!context) {
      this.lastResumeAttempt = { at: Date.now(), trigger, status: 'no-context', stateBefore, stateAfter: null };
      return;
    }

    if (context.state === 'running') {
      this.lastResumeAttempt = { at: Date.now(), trigger, status: 'already-running', stateBefore, stateAfter: context.state };
      return;
    }

    try {
      await context.resume();
      if (this.hidden) {
        await context.suspend();
        return;
      }
      const stateAfter: string = context.state;
      this.lastResumeAttempt = {
        at: Date.now(),
        trigger,
        status: stateAfter === 'running' ? 'resumed' : 'failed',
        stateBefore,
        stateAfter,
      };
    } catch (error) {
      this.lastResumeAttempt = {
        at: Date.now(),
        trigger,
        status: 'failed',
        stateBefore,
        stateAfter: context.state,
        ...normalizeAudioError(error),
      };
    }
    const attempt = this.lastResumeAttempt;
    if (attempt?.trigger === trigger) {
      this.log(`resume ${trigger}: ${attempt.status}${attempt.errorName ? ` (${attempt.errorName})` : ''}`);
    }
  }

  getDebugState(): {
    userInteracted: boolean;
    audioContextState: string | null;
    audioSessionType: string | null;
    lastAudioContextStateChange: AudioContextStateDebugEntry | null;
    lastResumeAttempt: AudioResumeDebugEntry | null;
    lifecycleLog: AudioLifecycleLogEntry[];
  } {
    return {
      userInteracted: this.interacted,
      audioContextState: this.context?.state ?? null,
      audioSessionType: this.audioSessionType,
      lastAudioContextStateChange: this.lastStateChange,
      lastResumeAttempt: this.lastResumeAttempt,
      lifecycleLog: [...this.lifecycleLog],
    };
  }

  private log(event: string): void {
    this.lifecycleLog.push({ at: Date.now(), event, state: this.context?.state ?? null });
    if (this.lifecycleLog.length > LIFECYCLE_LOG_LIMIT) {
      this.lifecycleLog.splice(0, this.lifecycleLog.length - LIFECYCLE_LOG_LIMIT);
    }
  }

  private scheduleReturnRetries(): void {
    const windowObj = this.lifecycleWindow;
    this.clearReturnRetries();
    if (!windowObj || !this.context) return;
    RETURN_RESUME_RETRY_DELAYS_MS.forEach((delayMs, index) => {
      const timer = windowObj.setTimeout(() => {
        const state: string | null = this.context?.state ?? null;
        if (this.hidden || state === null || state === 'running' || state === 'closed') return;
        void this.resume(`return-retry-${index + 1}`);
      }, delayMs);
      this.returnRetryTimers.push(timer);
    });
  }

  private clearReturnRetries(): void {
    for (const timer of this.returnRetryTimers) this.lifecycleWindow?.clearTimeout(timer);
    this.returnRetryTimers = [];
  }

  private handleStateChange(context: AudioContext): void {
    // Safari reports 'interrupted', which the DOM types do not list.
    const state: string = context.state;
    this.lastStateChange = { at: Date.now(), state };
    this.log(`state ${state}`);
    for (const listener of this.stateListeners) listener(state);
    if ((state !== 'suspended' && state !== 'interrupted') || !this.interacted || this.hidden) {
      return;
    }
    const now = Date.now();
    this.interruptionResumes = this.interruptionResumes.filter((at) => now - at < INTERRUPTION_RESUME_WINDOW_MS);
    if (this.interruptionResumes.length >= MAX_INTERRUPTION_RESUMES) {
      return;
    }
    this.interruptionResumes.push(now);
    void this.resume(`statechange-${state}`);
  }
}

/** Returns the session type in effect afterwards, or null where the browser has no audio session API. */
function setAudioSessionType(navigator: AudioSessionNavigator | undefined): string | null {
  const session = navigator?.audioSession;
  if (!session) {
    return null;
  }
  if (session.type === 'auto') {
    try {
      session.type = AUDIO_SESSION_TYPE;
    } catch {
      void 0;
    }
  }
  return session.type;
}

export function normalizeAudioError(error: unknown): { errorName: string; errorMessage: string } {
  if (error instanceof Error) {
    return {
      errorName: error.name || 'Error',
      errorMessage: error.message || '',
    };
  }

  if (typeof error === 'object' && error !== null) {
    const value = error as { name?: unknown; message?: unknown };
    return {
      errorName: typeof value.name === 'string' ? value.name : 'UnknownError',
      errorMessage: typeof value.message === 'string' ? value.message : '',
    };
  }

  return {
    errorName: 'UnknownError',
    errorMessage: typeof error === 'string' ? error : '',
  };
}

export const sharedAudioEngine = new AudioEngine();
