import { resolveSfxAssetUrl } from './assetUrl';
import { normalizeAudioError, sharedAudioEngine, type AudioEngine } from './engine';

type CueConfig = {
  path: string;
  volume: number;
  playbackRate?: number;
  cooldownMs?: number;
  allowOverlap?: boolean;
  loop?: boolean;
  trimAfterMs?: number;
  fadeOutMs?: number;
};

export type SfxPlaybackOptions = {
  volumeMultiplier?: number;
  playbackRateMultiplier?: number;
  ignoreCooldown?: boolean;
  lowPassFrequencyHz?: number;
  lowPassQ?: number;
};

export type SfxCue =
  | 'ui-click'
  | 'ui-hover'
  | 'ui-disabled'
  | 'collect'
  | 'collect-fruit'
  | 'collect-gem'
  | 'collect-key'
  | 'enemy-kill'
  | 'enemy-hit'
  | 'player-hurt'
  | 'player-death'
  | 'sword-slash'
  | 'gun-shot'
  | 'bullet-impact'
  | 'goal-start'
  | 'goal-checkpoint'
  | 'goal-success'
  | 'goal-fail'
  | 'music-slot-clear'
  | 'music-slot-clear-all'
  | 'music-phrase-place'
  | 'challenge-abandon'
  | 'time-up'
  | 'bounce'
  | 'jump'
  | 'land'
  | 'footstep'
  | 'ladder-climb'
  | 'respawn'
  | 'warp'
  | 'pressure-plate-down'
  | 'switch-block-toggle'
  | 'door-open'
  | 'treasure-open'
  | 'cage-open'
  | 'chat-send'
  | 'chat-receive'
  | 'progression-player-level-up'
  | 'progression-builder-level-up'
  | 'progression-curator-level-up'
  | 'progression-top-10'
  | 'progression-first-place';

type SfxHistoryEntry = {
  cue: SfxCue;
  at: number;
  status: 'played' | 'blocked' | 'missing' | 'cooldown' | 'capped' | 'late' | 'error';
};

type SfxPlayErrorDebugEntry = {
  at: number;
  cue: SfxCue;
  userInteracted: boolean;
  audioContextState: string | null;
  errorName: string;
  errorMessage: string;
};

// Music already runs through its own master gain, so SFX need a shared trim to
// stop common gameplay cues from sitting on top of the room mix.
const GLOBAL_SFX_VOLUME_MULTIPLIER = 0.55;
/** Effects sounding at once; a cue past this is skipped. */
const MAX_SFX_VOICES = 48;
// Played most in the first seconds of a run; loaded right after the first gesture (F023).
const HOT_GAMEPLAY_CUES: readonly SfxCue[] = ['jump', 'land', 'footstep', 'collect', 'player-hurt'];
/** The other short effects load in the background after that; the large progression stingers load when first played. */
const BACKGROUND_WARM_DELAY_MS = 1_500;
/**
 * A cue that waits for its sound to load or for the audio context to start plays once ready,
 * unless it would land too late to match the action. Movement, hit and click feedback must
 * be on time; a fanfare can arrive a moment late.
 */
const FEEDBACK_CUE_MAX_DELAY_MS = 120;
const DEFAULT_CUE_MAX_DELAY_MS = 1_500;
const MAX_PENDING_CUES = 16;
const FEEDBACK_CUES: ReadonlySet<SfxCue> = new Set<SfxCue>([
  'ui-click', 'ui-hover', 'ui-disabled', 'collect', 'collect-fruit', 'collect-gem', 'collect-key',
  'enemy-kill', 'enemy-hit', 'player-hurt', 'sword-slash', 'gun-shot', 'bullet-impact', 'bounce',
  'jump', 'land', 'footstep', 'ladder-climb', 'pressure-plate-down', 'switch-block-toggle',
  'chat-send', 'music-slot-clear', 'music-slot-clear-all', 'music-phrase-place',
]);

type SfxBuffer = {
  status: 'loading' | 'ready' | 'failed';
  buffer: AudioBuffer | null;
  loaded: Promise<void>;
};

type SfxVoice = {
  cue: SfxCue;
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode | null;
};

type PendingCue = {
  cue: SfxCue;
  options: SfxPlaybackOptions | undefined;
  requestedAt: number;
};

declare global {
  interface Window {
    get_sfx_debug_state?: () => Record<string, unknown>;
    play_sfx_debug?: (cue: SfxCue, playbackOptions?: SfxPlaybackOptions) => void;
  }
}

const SFX_CUES: Record<SfxCue, CueConfig> = {
  'ui-click': {
    path: 'assets/sfx/ui/ui-click.wav',
    volume: 0.45,
    cooldownMs: 30,
  },
  'ui-hover': {
    path: 'assets/sfx/ui/ui-hover.wav',
    volume: 0.18,
    playbackRate: 1.12,
    cooldownMs: 55,
  },
  'ui-disabled': {
    path: 'assets/sfx/goals/game-fail.wav',
    volume: 0.16,
    playbackRate: 1.12,
    cooldownMs: 120,
  },
  collect: {
    path: 'assets/sfx/pickups/coin-collect.wav',
    volume: 0.52,
    cooldownMs: 24,
  },
  'collect-fruit': {
    path: 'assets/sfx/pickups/fruit-collect.wav',
    volume: 0.48,
    cooldownMs: 24,
  },
  'collect-gem': {
    path: 'assets/sfx/pickups/gem-collect.wav',
    volume: 0.56,
    cooldownMs: 24,
  },
  'collect-key': {
    path: 'assets/sfx/pickups/key-collect.wav',
    volume: 0.58,
    cooldownMs: 24,
  },
  'enemy-kill': {
    path: 'assets/sfx/combat/enemy-kill.wav',
    volume: 0.6,
    cooldownMs: 40,
  },
  'enemy-hit': {
    path: 'assets/sfx/combat/enemy-kill.wav',
    volume: 0.4,
    playbackRate: 1.1,
    cooldownMs: 40,
  },
  'player-hurt': {
    path: 'assets/sfx/combat/player-hurt.wav',
    volume: 0.5,
    cooldownMs: 90,
  },
  'player-death': {
    path: 'assets/sfx/combat/player-death.wav',
    volume: 0.58,
    playbackRate: 1,
    cooldownMs: 120,
  },
  'sword-slash': {
    path: 'assets/sfx/combat/sword-slash.wav',
    volume: 0.58,
    cooldownMs: 40,
  },
  'gun-shot': {
    path: 'assets/sfx/combat/gun-shot.wav',
    volume: 0.58,
    cooldownMs: 40,
  },
  'bullet-impact': {
    path: 'assets/sfx/combat/enemy-kill.wav',
    volume: 0.34,
    playbackRate: 1.18,
    cooldownMs: 30,
  },
  'goal-start': {
    path: 'assets/sfx/goals/goal-checkpoint.wav',
    volume: 0.34,
    playbackRate: 1.02,
    cooldownMs: 60,
  },
  'goal-checkpoint': {
    path: 'assets/sfx/goals/goal-checkpoint.wav',
    volume: 0.5,
    cooldownMs: 60,
  },
  'music-slot-clear': {
    path: 'assets/sfx/music-editor/clear-slot.wav',
    volume: 0.42,
    playbackRate: 1.04,
    cooldownMs: 40,
  },
  'music-slot-clear-all': {
    path: 'assets/sfx/music-editor/clear-all-slots.wav',
    volume: 0.5,
    playbackRate: 0.98,
    cooldownMs: 55,
  },
  'music-phrase-place': {
    path: 'assets/sfx/music-editor/place-phrase.wav',
    volume: 0.34,
    playbackRate: 1.02,
    cooldownMs: 35,
  },
  'goal-success': {
    path: 'assets/sfx/goals/goal-success.wav',
    volume: 0.5,
    cooldownMs: 90,
  },
  'goal-fail': {
    path: 'assets/sfx/goals/game-fail.wav',
    volume: 0.48,
    cooldownMs: 90,
  },
  'challenge-abandon': {
    path: 'assets/sfx/goals/game-fail.wav',
    volume: 0.38,
    playbackRate: 1.05,
    cooldownMs: 90,
  },
  'time-up': {
    path: 'assets/sfx/goals/game-fail.wav',
    volume: 0.56,
    playbackRate: 1.15,
    cooldownMs: 90,
  },
  bounce: {
    path: 'assets/sfx/movement/bounce-pad.wav',
    volume: 0.56,
    cooldownMs: 60,
    trimAfterMs: 1000,
    fadeOutMs: 220,
  },
  jump: {
    path: 'assets/sfx/movement/jump.wav',
    volume: 0.48,
    cooldownMs: 50,
  },
  land: {
    path: 'assets/sfx/movement/land.wav',
    volume: 0.34,
    playbackRate: 0.95,
    cooldownMs: 70,
  },
  footstep: {
    path: 'assets/sfx/movement/footstep.wav',
    volume: 0.28,
    cooldownMs: 90,
  },
  'ladder-climb': {
    path: 'assets/sfx/movement/ladder-climb.wav',
    volume: 0.26,
    cooldownMs: 30,
    allowOverlap: false,
    loop: true,
  },
  respawn: {
    path: 'assets/sfx/world/respawn.wav',
    volume: 0.52,
    cooldownMs: 120,
  },
  warp: {
    path: 'assets/sfx/world/warp.wav',
    volume: 0.56,
    cooldownMs: 180,
  },
  'pressure-plate-down': {
    path: 'assets/sfx/world/pressure-plate-down.wav',
    volume: 0.42,
    cooldownMs: 45,
  },
  'switch-block-toggle': {
    path: 'assets/sfx/world/switch-block-toggle.wav',
    volume: 0.5,
    cooldownMs: 45,
  },
  'door-open': {
    path: 'assets/sfx/world/door-open.wav',
    volume: 0.5,
    cooldownMs: 90,
  },
  'treasure-open': {
    path: 'assets/sfx/world/treasure-open.wav',
    volume: 0.48,
    cooldownMs: 90,
  },
  'cage-open': {
    path: 'assets/sfx/world/cage-open.wav',
    volume: 0.52,
    cooldownMs: 90,
  },
  'chat-send': {
    path: 'assets/sfx/ui/ui-click.wav',
    volume: 0.28,
    playbackRate: 1.08,
    cooldownMs: 80,
  },
  'chat-receive': {
    path: 'assets/sfx/goals/goal-checkpoint.wav',
    volume: 0.24,
    playbackRate: 1.16,
    cooldownMs: 120,
  },
  'progression-player-level-up': {
    path: 'assets/sfx/progression/player-lvlUp.mp3',
    volume: 0.76,
    cooldownMs: 90,
    allowOverlap: false,
  },
  'progression-builder-level-up': {
    path: 'assets/sfx/progression/builder-lvlUp.mp3',
    volume: 0.78,
    cooldownMs: 90,
    allowOverlap: false,
  },
  'progression-curator-level-up': {
    path: 'assets/sfx/progression/curator-lvlUp.mp3',
    volume: 0.76,
    cooldownMs: 90,
    allowOverlap: false,
  },
  'progression-top-10': {
    path: 'assets/sfx/progression/leaderboard-top10.mp3',
    volume: 0.78,
    cooldownMs: 120,
    allowOverlap: false,
  },
  'progression-first-place': {
    path: 'assets/sfx/progression/leaderboard-1st-place.mp3',
    volume: 0.8,
    cooldownMs: 120,
    allowOverlap: false,
  },
};

/**
 * The files to try for a cue: the compressed format this browser reports first, then the
 * other one, then the compact MP3 fallback. A browser can claim a format its audio decoder lacks.
 */
function resolveAssetUrls(path: string): string[] {
  const base = import.meta.env.BASE_URL || '/';
  if (!path.endsWith('.wav')) {
    return [resolveSfxAssetUrl(path, base, window.location.href)];
  }
  const preferred = resolveCompressedSfxExtension();
  const fallback = preferred === '.ogg' ? '.m4a' : '.ogg';
  return [preferred, fallback, '.mp3'].map((extension) =>
    resolveSfxAssetUrl(path.replace(/\.wav$/, extension), base, window.location.href)
  );
}

function resolveCompressedSfxExtension(): '.ogg' | '.m4a' {
  const audio = document.createElement('audio');
  return audio.canPlayType('audio/ogg; codecs="vorbis"') ? '.ogg' : '.m4a';
}

/**
 * Effects play from decoded buffers on the shared Web Audio context, not from <audio>
 * elements. On iPhone a playing <audio> element switches the page to media playback, which
 * ignores the silent switch for music too (F229), and media elements start noticeably late
 * (F023). Buffers start within the context's output latency and follow the audio session.
 */
export class SfxController {
  private muted = false;
  private initialized = false;
  private readonly assetUrlsByPath = new Map<string, string[]>();
  private readonly buffers = new Map<string, SfxBuffer>();
  private readonly voices = new Set<SfxVoice>();
  private readonly voicesByCue = new Map<SfxCue, Set<SfxVoice>>();
  private pending: PendingCue[] = [];
  private output: GainNode | null = null;
  /** Which of a cue's formats last decoded here; later loads try it first. */
  private formatIndex = 0;
  private readonly lastPlayedAt = new Map<SfxCue, number>();
  private readonly history: SfxHistoryEntry[] = [];
  private lastPlayError: SfxPlayErrorDebugEntry | null = null;
  private volume = 1;

  constructor(private readonly engine: AudioEngine = sharedAudioEngine) {}

  init(windowObj: Window = window): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.engine.init(windowObj);
    // Hidden pages drop their effects rather than replaying them on return.
    this.engine.onHidden(() => {
      this.pending = [];
      for (const cue of [...this.voicesByCue.keys()]) this.stop(cue);
    });
    this.engine.onStateChange((state) => {
      if (state === 'running') this.flushPending();
    });
    // Just after the first gesture (not inside it), load the hot gameplay cues so the first
    // jump or pickup doesn't wait for its file to download, then the other short effects.
    this.engine.onFirstInteraction(() => {
      windowObj.setTimeout(() => this.warmCues(HOT_GAMEPLAY_CUES), 0);
      windowObj.setTimeout(() => this.warmRemainingCues(), BACKGROUND_WARM_DELAY_MS);
    });

    for (const config of Object.values(SFX_CUES)) {
      if (!this.assetUrlsByPath.has(config.path)) {
        this.assetUrlsByPath.set(config.path, resolveAssetUrls(config.path));
      }
    }

    windowObj.get_sfx_debug_state = () => this.getDebugState();
    if (import.meta.env.DEV) {
      windowObj.play_sfx_debug = (cue: SfxCue, playbackOptions?: SfxPlaybackOptions) => {
        this.play(cue, playbackOptions);
      };
    }
  }

  private warmCues(cues: readonly SfxCue[]): void {
    for (const cue of cues) {
      const config = SFX_CUES[cue];
      if (config) this.loadBuffer(config.path);
    }
  }

  /** One file at a time, so background loading never competes with a cue that is needed now. */
  private warmRemainingCues(): void {
    const paths = new Set(Object.values(SFX_CUES).map((config) => config.path).filter((path) => !path.endsWith('.mp3')));
    let chain = Promise.resolve();
    for (const path of paths) {
      chain = chain.then(() => this.loadBuffer(path)?.loaded);
    }
  }

  setMuted(value: boolean): void {
    this.muted = value;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(value: number): void {
    const nextVolume = PhaserClamp(Number.isFinite(value) ? value : 1, 0, 1);
    if (this.volume === nextVolume) {
      return;
    }

    this.volume = nextVolume;
    if (this.output) {
      this.output.gain.value = this.volume;
    }
  }

  getDebugState(): Record<string, unknown> {
    const bufferCounts = { ready: 0, loading: 0, failed: 0 };
    for (const entry of this.buffers.values()) bufferCounts[entry.status] += 1;
    return {
      initialized: this.initialized,
      muted: this.muted,
      volume: this.volume,
      ...this.engine.getDebugState(),
      lastPlayError: this.lastPlayError,
      voices: { cap: MAX_SFX_VOICES, active: this.voices.size },
      buffers: bufferCounts,
      pendingCount: this.pending.length,
      activeCount: this.voices.size,
      activeCues: [...this.voicesByCue.entries()].map(([cue, voices]) => ({
        cue,
        count: voices.size,
      })),
      history: [...this.history],
    };
  }

  play(cue: SfxCue, playbackOptions?: SfxPlaybackOptions): void {
    const config = SFX_CUES[cue];
    if (!config) {
      this.record(cue, 'missing');
      return;
    }

    if (this.engine.hidden) {
      this.record(cue, 'blocked');
      return;
    }

    const now = performance.now();
    const ignoreCooldown = playbackOptions?.ignoreCooldown ?? false;
    if (!ignoreCooldown) {
      const cooldownMs = config.cooldownMs ?? 0;
      const lastPlayedAt = this.lastPlayedAt.get(cue) ?? -Infinity;
      if (now - lastPlayedAt < cooldownMs) {
        this.record(cue, 'cooldown');
        return;
      }
      this.lastPlayedAt.set(cue, now);
    }

    // Muted or turned all the way down: don't spend a voice, or a download, on silence (F078).
    if (this.muted || this.volume <= 0 || (playbackOptions?.volumeMultiplier ?? 1) <= 0) {
      this.record(cue, 'blocked');
      return;
    }

    if (!this.assetUrlsByPath.has(config.path)) {
      this.record(cue, 'missing');
      return;
    }

    if (config.allowOverlap === false && this.isCueActiveOrPending(cue)) {
      this.record(cue, 'cooldown');
      return;
    }

    // Browsers refuse sound before the first gesture; don't start a context for it.
    const context = this.engine.userInteracted ? this.engine.getContext() : null;
    if (!context) {
      this.record(cue, 'blocked');
      return;
    }

    const entry = this.loadBuffer(config.path);
    if (!entry || entry.status === 'failed') {
      this.record(cue, 'error');
      return;
    }

    if (entry.status === 'ready' && entry.buffer && context.state === 'running') {
      this.startVoice(cue, playbackOptions, entry.buffer, context);
      return;
    }

    // Wait for the file or for the context to start, then play if it is still on time.
    if (context.state !== 'running') {
      void this.engine.resume('sfx');
    }
    if (this.pending.length >= MAX_PENDING_CUES) {
      this.record(cue, 'capped');
      return;
    }
    this.pending.push({ cue, options: playbackOptions, requestedAt: now });
  }

  stop(cue: SfxCue): void {
    this.pending = this.pending.filter((item) => item.cue !== cue);
    const cueVoices = this.voicesByCue.get(cue);
    if (!cueVoices) {
      return;
    }

    for (const voice of [...cueVoices]) {
      try {
        voice.source.stop();
      } catch {
        void 0;
      }
      this.finishVoice(voice);
    }
  }

  private isCueActiveOrPending(cue: SfxCue): boolean {
    return (this.voicesByCue.get(cue)?.size ?? 0) > 0 || this.pending.some((item) => item.cue === cue);
  }

  private loadBuffer(path: string): SfxBuffer | null {
    const existing = this.buffers.get(path);
    if (existing) {
      return existing;
    }

    const urls = this.assetUrlsByPath.get(path);
    const context = this.engine.getContext();
    if (!urls || !context) {
      return null;
    }

    const entry: SfxBuffer = { status: 'loading', buffer: null, loaded: Promise.resolve() };
    const formatIndex = Math.min(this.formatIndex, urls.length - 1);
    const ordered = [urls[formatIndex], ...urls.filter((_, index) => index !== formatIndex)];
    entry.loaded = fetchAndDecode(context, ordered).then(
      ({ buffer, url }) => {
        if (urls.length > 1) this.formatIndex = urls.indexOf(url);
        entry.status = 'ready';
        entry.buffer = buffer;
        this.flushPending();
      },
      () => {
        entry.status = 'failed';
        this.flushPending();
      }
    );
    this.buffers.set(path, entry);
    return entry;
  }

  /** Starts waiting cues that are ready, drops ones that would now be late. */
  private flushPending(): void {
    if (this.pending.length === 0) {
      return;
    }

    const context = this.engine.peekContext();
    const now = performance.now();
    const waiting: PendingCue[] = [];
    for (const item of this.pending) {
      const entry = this.buffers.get(SFX_CUES[item.cue].path);
      const maxDelayMs = FEEDBACK_CUES.has(item.cue) ? FEEDBACK_CUE_MAX_DELAY_MS : DEFAULT_CUE_MAX_DELAY_MS;
      if (!entry || entry.status === 'failed') {
        this.record(item.cue, 'error');
      } else if (now - item.requestedAt > maxDelayMs) {
        this.record(item.cue, 'late');
      } else if (entry.status === 'ready' && entry.buffer && context?.state === 'running') {
        this.startVoice(item.cue, item.options, entry.buffer, context);
      } else {
        waiting.push(item);
      }
    }
    this.pending = waiting;
  }

  private startVoice(
    cue: SfxCue,
    playbackOptions: SfxPlaybackOptions | undefined,
    buffer: AudioBuffer,
    context: AudioContext
  ): void {
    if (this.voices.size >= MAX_SFX_VOICES) {
      this.record(cue, 'capped');
      return;
    }

    const config = SFX_CUES[cue];
    const baseVolume = PhaserClamp(
      config.volume * GLOBAL_SFX_VOLUME_MULTIPLIER * Math.max(0, playbackOptions?.volumeMultiplier ?? 1),
      0,
      1
    );
    let voice: SfxVoice | null = null;
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = Boolean(config.loop);
      source.playbackRate.value = PhaserClamp(
        (config.playbackRate ?? 1) * Math.max(0.05, playbackOptions?.playbackRateMultiplier ?? 1),
        0.05,
        4
      );
      const gain = context.createGain();
      gain.gain.value = baseVolume;
      let filter: BiquadFilterNode | null = null;
      const lowPassFrequencyHz = playbackOptions?.lowPassFrequencyHz ?? 0;
      if (lowPassFrequencyHz > 0) {
        filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = Math.max(20, lowPassFrequencyHz);
        filter.Q.value = Math.max(0.0001, playbackOptions?.lowPassQ ?? 0.9);
        source.connect(filter);
        filter.connect(gain);
      } else {
        source.connect(gain);
      }
      gain.connect(this.getOutput(context));

      const startedVoice: SfxVoice = { cue, source, gain, filter };
      voice = startedVoice;
      source.onended = () => this.finishVoice(startedVoice);
      this.voices.add(startedVoice);
      const cueVoices = this.voicesByCue.get(cue) ?? new Set<SfxVoice>();
      cueVoices.add(startedVoice);
      this.voicesByCue.set(cue, cueVoices);
      source.start();

      if ((config.trimAfterMs ?? 0) > 0) {
        const fadeStart = context.currentTime + (config.trimAfterMs ?? 0) / 1000;
        const fadeSec = Math.max(0, config.fadeOutMs ?? 0) / 1000;
        if (fadeSec > 0) {
          gain.gain.setValueAtTime(baseVolume, fadeStart);
          gain.gain.linearRampToValueAtTime(0, fadeStart + fadeSec);
        }
        source.stop(fadeStart + fadeSec);
      }
    } catch (error) {
      if (voice) this.finishVoice(voice);
      this.lastPlayError = {
        at: Date.now(),
        cue,
        userInteracted: this.engine.userInteracted,
        audioContextState: context.state,
        ...normalizeAudioError(error),
      };
      this.record(cue, 'error');
      return;
    }

    this.record(cue, 'played');
  }

  private finishVoice(voice: SfxVoice): void {
    if (!this.voices.delete(voice)) {
      return;
    }
    const cueVoices = this.voicesByCue.get(voice.cue);
    cueVoices?.delete(voice);
    if (cueVoices && cueVoices.size === 0) {
      this.voicesByCue.delete(voice.cue);
    }
    voice.source.onended = null;
    for (const node of [voice.source, voice.filter, voice.gain]) {
      try {
        node?.disconnect();
      } catch {
        void 0;
      }
    }
  }

  /** The effects volume, between every voice and the engine's effects bus. */
  private getOutput(context: AudioContext): GainNode {
    if (!this.output || this.output.context !== context) {
      this.output = context.createGain();
      this.output.gain.value = this.volume;
      this.output.connect(this.engine.getSfxBus() ?? context.destination);
    }
    return this.output;
  }

  private record(cue: SfxCue, status: SfxHistoryEntry['status']): void {
    this.history.push({
      cue,
      status,
      at: Date.now(),
    });

    if (this.history.length > 40) {
      this.history.splice(0, this.history.length - 40);
    }
  }
}

/** Tries each file in turn until one downloads and decodes. */
async function fetchAndDecode(
  context: BaseAudioContext,
  urls: readonly string[]
): Promise<{ buffer: AudioBuffer; url: string }> {
  let lastError: unknown = new Error('No sound file to load.');
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load ${url} (${response.status}).`);
      }
      return { buffer: await decodeAudio(context, await response.arrayBuffer()), url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function decodeAudio(context: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Older Safari only supports the callback form; newer browsers also return a promise.
    const result = context.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    result?.then?.(resolve, reject);
  });
}

function PhaserClamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const globalSfxController = new SfxController();

export function initSfx(doc: Document = document, windowObj: Window = window): void {
  void doc;
  globalSfxController.init(windowObj);
}

export function playSfx(cue: SfxCue, playbackOptions?: SfxPlaybackOptions): void {
  globalSfxController.play(cue, playbackOptions);
}

export function stopSfx(cue: SfxCue): void {
  globalSfxController.stop(cue);
}
