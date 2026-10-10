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
  private interruptionResumes: number[] = [];
  private lastResumeAttempt: AudioResumeDebugEntry | null = null;
  private lastStateChange: AudioContextStateDebugEntry | null = null;

  init(windowObj: Window = window): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.lifecycleDocument = windowObj.document;
    setAudioSessionType(windowObj.navigator as AudioSessionNavigator | undefined);
    const markInteracted = () => {
      this.interacted = true;
      void this.resume('user-gesture');
    };
    const resumeAfterLifecycleEvent = (trigger: string) => {
      if (this.interacted) {
        void this.resume(trigger);
      }
    };

    windowObj.addEventListener('pointerdown', markInteracted, { passive: true });
    windowObj.addEventListener('keydown', markInteracted, { passive: true });
    windowObj.addEventListener('touchstart', markInteracted, { passive: true });
    windowObj.addEventListener('focus', () => resumeAfterLifecycleEvent('window-focus'), { passive: true });
    windowObj.addEventListener('pageshow', () => resumeAfterLifecycleEvent('pageshow'), { passive: true });
    windowObj.document.addEventListener('visibilitychange', () => {
      if (windowObj.document.hidden) {
        for (const listener of this.hiddenListeners) listener();
        this.suspend();
      } else {
        resumeAfterLifecycleEvent('visibilitychange-visible');
      }
    });
  }

  get userInteracted(): boolean {
    return this.interacted;
  }

  get hidden(): boolean {
    return Boolean(this.lifecycleDocument?.hidden);
  }

  /** Runs when the page is hidden, just before the context suspends. */
  onHidden(listener: () => void): void {
    this.hiddenListeners.add(listener);
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
  }

  getDebugState(): {
    userInteracted: boolean;
    audioContextState: string | null;
    lastAudioContextStateChange: AudioContextStateDebugEntry | null;
    lastResumeAttempt: AudioResumeDebugEntry | null;
  } {
    return {
      userInteracted: this.interacted,
      audioContextState: this.context?.state ?? null,
      lastAudioContextStateChange: this.lastStateChange,
      lastResumeAttempt: this.lastResumeAttempt,
    };
  }

  private handleStateChange(context: AudioContext): void {
    // Safari reports 'interrupted', which the DOM types do not list.
    const state: string = context.state;
    this.lastStateChange = { at: Date.now(), state };
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

function setAudioSessionType(navigator: AudioSessionNavigator | undefined): void {
  const session = navigator?.audioSession;
  if (!session || session.type !== 'auto') {
    return;
  }
  try {
    session.type = AUDIO_SESSION_TYPE;
  } catch {
    void 0;
  }
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
