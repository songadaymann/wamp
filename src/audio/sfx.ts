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
  status: 'played' | 'blocked' | 'missing' | 'cooldown' | 'capped' | 'error';
};

type AudioResumeDebugEntry = {
  at: number;
  trigger: string;
  status: 'no-context' | 'already-running' | 'resumed' | 'failed';
  stateBefore: string | null;
  stateAfter: string | null;
  errorName?: string;
  errorMessage?: string;
};

type AudioContextStateDebugEntry = {
  at: number;
  state: string;
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
const MAX_SFX_MEDIA_PLAYERS = 64;

type SfxAudioRoute = 'direct' | 'low-pass';

type SfxAudioPlayer = {
  audio: HTMLAudioElement;
  route: SfxAudioRoute;
  poolKey: string;
  mediaSourceNode: MediaElementAudioSourceNode | null;
  filterNode: BiquadFilterNode | null;
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
    path: 'assets/sfx/goals/game-fail.wav',
    volume: 0.34,
    playbackRate: 1.08,
    cooldownMs: 90,
  },
  'player-death': {
    path: 'assets/sfx/goals/game-fail.wav',
    volume: 0.58,
    playbackRate: 0.92,
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

function resolveAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedPath = path.replace(/^\/+/, '');
  const baseUrl = new URL(base, window.location.href);
  return new URL(normalizedPath, baseUrl).toString();
}

export class SfxController {
  private muted = false;
  private initialized = false;
  private userInteracted = false;
  private audioContext: AudioContext | null = null;
  private readonly assetUrlByPath = new Map<string, string>();
  private readonly idleAudioByPoolKey = new Map<string, SfxAudioPlayer[]>();
  private readonly audioPlayerByElement = new Map<HTMLAudioElement, SfxAudioPlayer>();
  private readonly activeAudio = new Set<HTMLAudioElement>();
  private readonly activeAudioByCue = new Map<SfxCue, Set<HTMLAudioElement>>();
  private readonly cleanupByAudio = new Map<HTMLAudioElement, () => void>();
  private readonly baseVolumeByAudio = new Map<HTMLAudioElement, number>();
  private readonly activeCueCounts = new Map<SfxCue, number>();
  private readonly lastPlayedAt = new Map<SfxCue, number>();
  private readonly history: SfxHistoryEntry[] = [];
  private lastResumeAttempt: AudioResumeDebugEntry | null = null;
  private lastAudioContextStateChange: AudioContextStateDebugEntry | null = null;
  private lastPlayError: SfxPlayErrorDebugEntry | null = null;
  private volume = 1;

  init(windowObj: Window = window): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    const markInteracted = () => {
      this.userInteracted = true;
      void this.resumeAudioContext('user-gesture');
    };

    const resumeAfterLifecycleEvent = (trigger: string) => {
      if (!this.userInteracted) {
        return;
      }
      void this.resumeAudioContext(trigger);
    };

    windowObj.addEventListener('pointerdown', markInteracted, { passive: true });
    windowObj.addEventListener('keydown', markInteracted, { passive: true });
    windowObj.addEventListener('touchstart', markInteracted, { passive: true });
    windowObj.addEventListener('focus', () => resumeAfterLifecycleEvent('window-focus'), { passive: true });
    windowObj.addEventListener('pageshow', () => resumeAfterLifecycleEvent('pageshow'), { passive: true });
    windowObj.document.addEventListener('visibilitychange', () => {
      if (!windowObj.document.hidden) {
        resumeAfterLifecycleEvent('visibilitychange-visible');
      }
    });

    for (const config of Object.values(SFX_CUES)) {
      if (!this.assetUrlByPath.has(config.path)) {
        this.assetUrlByPath.set(config.path, resolveAssetUrl(config.path));
      }
    }

    windowObj.get_sfx_debug_state = () => this.getDebugState();
    if (import.meta.env.DEV) {
      windowObj.play_sfx_debug = (cue: SfxCue, playbackOptions?: SfxPlaybackOptions) => {
        this.play(cue, playbackOptions);
      };
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
    for (const player of this.activeAudio) {
      const baseVolume = this.baseVolumeByAudio.get(player) ?? 0;
      player.volume = PhaserClamp(baseVolume * this.volume, 0, 1);
    }
  }

  getDebugState(): Record<string, unknown> {
    return {
      initialized: this.initialized,
      muted: this.muted,
      volume: this.volume,
      userInteracted: this.userInteracted,
      audioContextState: this.audioContext?.state ?? null,
      lastAudioContextStateChange: this.lastAudioContextStateChange,
      lastResumeAttempt: this.lastResumeAttempt,
      lastPlayError: this.lastPlayError,
      mediaPlayerPool: {
        cap: MAX_SFX_MEDIA_PLAYERS,
        total: this.audioPlayerByElement.size,
        active: this.activeAudio.size,
        idle: this.countIdleAudioPlayers(),
        idlePools: [...this.idleAudioByPoolKey.entries()]
          .filter(([, players]) => players.length > 0)
          .map(([poolKey, players]) => ({
            poolKey,
            count: players.length,
          })),
      },
      activeCount: this.activeAudio.size,
      activeCues: [...this.activeAudioByCue.entries()].map(([cue, players]) => ({
        cue,
        count: players.size,
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

    if (this.muted) {
      this.record(cue, 'blocked');
      return;
    }

    if (!this.assetUrlByPath.has(config.path)) {
      this.record(cue, 'missing');
      return;
    }

    if (config.allowOverlap === false && (this.activeCueCounts.get(cue) ?? 0) > 0) {
      this.record(cue, 'cooldown');
      return;
    }

    const route: SfxAudioRoute = (playbackOptions?.lowPassFrequencyHz ?? 0) > 0 ? 'low-pass' : 'direct';
    const audioPlayer = this.acquireAudioPlayer(config.path, route);
    if (!audioPlayer) {
      this.record(cue, 'capped');
      return;
    }

    const player = audioPlayer.audio;
    const baseVolume = PhaserClamp(
      config.volume * GLOBAL_SFX_VOLUME_MULTIPLIER * Math.max(0, playbackOptions?.volumeMultiplier ?? 1),
      0,
      1
    );
    this.baseVolumeByAudio.set(player, baseVolume);
    player.volume = PhaserClamp(baseVolume * this.volume, 0, 1);
    player.playbackRate = PhaserClamp(
      (config.playbackRate ?? 1) * Math.max(0.05, playbackOptions?.playbackRateMultiplier ?? 1),
      0.05,
      4
    );
    resetAudioPlayerCurrentTime(player);
    player.loop = Boolean(config.loop);

    try {
      if (route === 'low-pass' || audioPlayer.mediaSourceNode) {
        this.connectRoutedPlayback(audioPlayer, playbackOptions, route);
      }
    } catch (error) {
      this.disconnectRoutedAudioPlayer(audioPlayer);
      this.releaseAudioPlayer(audioPlayer);
      this.lastPlayError = {
        at: Date.now(),
        cue,
        userInteracted: this.userInteracted,
        audioContextState: this.audioContext?.state ?? null,
        ...normalizeAudioError(error),
      };
      this.record(cue, 'error');
      return;
    }

    this.activeAudio.add(player);
    const cuePlayers = this.activeAudioByCue.get(cue) ?? new Set<HTMLAudioElement>();
    cuePlayers.add(player);
    this.activeAudioByCue.set(cue, cuePlayers);
    this.activeCueCounts.set(cue, (this.activeCueCounts.get(cue) ?? 0) + 1);
    let fadeIntervalId: number | null = null;
    let trimTimeoutId: number | null = null;
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      if (trimTimeoutId !== null) {
        window.clearTimeout(trimTimeoutId);
        trimTimeoutId = null;
      }
      if (fadeIntervalId !== null) {
        window.clearInterval(fadeIntervalId);
        fadeIntervalId = null;
      }
      this.cleanupByAudio.delete(player);
      this.baseVolumeByAudio.delete(player);
      this.activeAudio.delete(player);
      const activeCuePlayers = this.activeAudioByCue.get(cue);
      activeCuePlayers?.delete(player);
      if (activeCuePlayers && activeCuePlayers.size === 0) {
        this.activeAudioByCue.delete(cue);
      }
      const nextCount = Math.max(0, (this.activeCueCounts.get(cue) ?? 1) - 1);
      if (nextCount === 0) {
        this.activeCueCounts.delete(cue);
      } else {
        this.activeCueCounts.set(cue, nextCount);
      }
      player.removeEventListener('ended', cleanup);
      player.removeEventListener('error', cleanup);
      this.disconnectRoutedAudioPlayer(audioPlayer);
      this.releaseAudioPlayer(audioPlayer);
    };
    this.cleanupByAudio.set(player, cleanup);
    player.addEventListener('ended', cleanup);
    player.addEventListener('error', cleanup);

    if ((config.trimAfterMs ?? 0) > 0) {
      trimTimeoutId = window.setTimeout(() => {
        trimTimeoutId = null;
        const fadeOutMs = Math.max(0, config.fadeOutMs ?? 0);
        if (fadeOutMs <= 0) {
          player.pause();
          cleanup();
          return;
        }

        const fadeStartedAt = performance.now();
        fadeIntervalId = window.setInterval(() => {
          const elapsed = performance.now() - fadeStartedAt;
          const progress = PhaserClamp(elapsed / fadeOutMs, 0, 1);
          const currentBaseVolume = this.baseVolumeByAudio.get(player) ?? baseVolume;
          player.volume = currentBaseVolume * this.volume * (1 - progress);
          if (progress >= 1) {
            player.pause();
            cleanup();
          }
        }, 30);
      }, config.trimAfterMs);
    }

    let playPromise: Promise<void> | undefined;
    try {
      playPromise = player.play();
    } catch (error) {
      player.pause();
      cleanup();
      this.lastPlayError = {
        at: Date.now(),
        cue,
        userInteracted: this.userInteracted,
        audioContextState: this.audioContext?.state ?? null,
        ...normalizeAudioError(error),
      };
      this.record(cue, this.userInteracted ? 'error' : 'blocked');
      return;
    }
    if (playPromise) {
      void playPromise
        .then(() => {
          this.record(cue, 'played');
        })
        .catch((error: unknown) => {
          player.pause();
          cleanup();
          this.lastPlayError = {
            at: Date.now(),
            cue,
            userInteracted: this.userInteracted,
            audioContextState: this.audioContext?.state ?? null,
            ...normalizeAudioError(error),
          };
          this.record(cue, this.userInteracted ? 'error' : 'blocked');
        });
      return;
    }

    this.record(cue, 'played');
  }

  stop(cue: SfxCue): void {
    const activeCuePlayers = this.activeAudioByCue.get(cue);
    if (!activeCuePlayers || activeCuePlayers.size === 0) {
      return;
    }

    for (const player of [...activeCuePlayers]) {
      player.pause();
      resetAudioPlayerCurrentTime(player);
      this.cleanupByAudio.get(player)?.();
    }
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

  private acquireAudioPlayer(path: string, route: SfxAudioRoute): SfxAudioPlayer | null {
    const poolKey = getAudioPoolKey(path, route);
    const idlePlayers = this.idleAudioByPoolKey.get(poolKey);
    const idlePlayer = idlePlayers?.pop();
    if (idlePlayer) {
      return idlePlayer;
    }

    const retargetedIdlePlayer = this.acquireRetargetedIdleAudioPlayer(path, route);
    if (retargetedIdlePlayer) {
      return retargetedIdlePlayer;
    }

    if (this.audioPlayerByElement.size >= MAX_SFX_MEDIA_PLAYERS) {
      return null;
    }

    const assetUrl = this.assetUrlByPath.get(path);
    if (!assetUrl) {
      return null;
    }

    const audio = new Audio(assetUrl);
    audio.preload = 'auto';
    const audioPlayer: SfxAudioPlayer = {
      audio,
      route,
      poolKey,
      mediaSourceNode: null,
      filterNode: null,
    };
    this.audioPlayerByElement.set(audio, audioPlayer);
    return audioPlayer;
  }

  private acquireRetargetedIdleAudioPlayer(path: string, route: SfxAudioRoute): SfxAudioPlayer | null {
    for (const players of this.idleAudioByPoolKey.values()) {
      const audioPlayer = players.pop();
      if (!audioPlayer) {
        continue;
      }

      this.retargetAudioPlayer(audioPlayer, path, route);
      return audioPlayer;
    }

    return null;
  }

  private retargetAudioPlayer(audioPlayer: SfxAudioPlayer, path: string, route: SfxAudioRoute): void {
    const assetUrl = this.assetUrlByPath.get(path);
    if (!assetUrl) {
      return;
    }

    audioPlayer.route = route;
    audioPlayer.poolKey = getAudioPoolKey(path, route);
    if (audioPlayer.audio.src !== assetUrl) {
      audioPlayer.audio.src = assetUrl;
      audioPlayer.audio.preload = 'auto';
      audioPlayer.audio.load();
    }
    resetAudioPlayerCurrentTime(audioPlayer.audio);
  }

  private releaseAudioPlayer(audioPlayer: SfxAudioPlayer): void {
    const player = audioPlayer.audio;
    player.loop = false;
    player.volume = 1;
    player.playbackRate = 1;
    resetAudioPlayerCurrentTime(player);

    const idlePlayers = this.idleAudioByPoolKey.get(audioPlayer.poolKey) ?? [];
    if (!idlePlayers.includes(audioPlayer)) {
      idlePlayers.push(audioPlayer);
    }
    this.idleAudioByPoolKey.set(audioPlayer.poolKey, idlePlayers);
  }

  private connectRoutedPlayback(
    audioPlayer: SfxAudioPlayer,
    playbackOptions: SfxPlaybackOptions | undefined,
    route: SfxAudioRoute
  ): void {
    const audioContext = this.getAudioContext();
    if (!audioContext) {
      return;
    }

    if (!audioPlayer.mediaSourceNode) {
      audioPlayer.mediaSourceNode = audioContext.createMediaElementSource(audioPlayer.audio);
    }

    if (route === 'direct') {
      audioPlayer.mediaSourceNode.connect(audioContext.destination);
      void this.resumeAudioContext('direct-routed-sfx');
      return;
    }

    if (!audioPlayer.filterNode) {
      audioPlayer.filterNode = audioContext.createBiquadFilter();
      audioPlayer.filterNode.type = 'lowpass';
    }

    audioPlayer.filterNode.frequency.value = Math.max(20, playbackOptions?.lowPassFrequencyHz ?? 1000);
    audioPlayer.filterNode.Q.value = Math.max(0.0001, playbackOptions?.lowPassQ ?? 0.9);
    audioPlayer.mediaSourceNode.connect(audioPlayer.filterNode);
    audioPlayer.filterNode.connect(audioContext.destination);
    void this.resumeAudioContext('lowpass-sfx');
  }

  private disconnectRoutedAudioPlayer(audioPlayer: SfxAudioPlayer): void {
    try {
      audioPlayer.mediaSourceNode?.disconnect();
    } catch {
      void 0;
    }
    try {
      audioPlayer.filterNode?.disconnect();
    } catch {
      void 0;
    }
  }

  private countIdleAudioPlayers(): number {
    let count = 0;
    for (const players of this.idleAudioByPoolKey.values()) {
      count += players.length;
    }
    return count;
  }

  private getAudioContext(): AudioContext | null {
    if (this.audioContext) {
      return this.audioContext;
    }

    const AudioContextCtor =
      window.AudioContext ??
      ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);
    if (!AudioContextCtor) {
      return null;
    }

    this.audioContext = new AudioContextCtor();
    this.lastAudioContextStateChange = {
      at: Date.now(),
      state: this.audioContext.state,
    };
    this.audioContext.addEventListener('statechange', () => {
      this.lastAudioContextStateChange = {
        at: Date.now(),
        state: this.audioContext?.state ?? 'unknown',
      };
    });
    return this.audioContext;
  }

  private async resumeAudioContext(trigger: string): Promise<void> {
    const stateBefore = this.audioContext?.state ?? null;
    if (!this.audioContext) {
      this.lastResumeAttempt = {
        at: Date.now(),
        trigger,
        status: 'no-context',
        stateBefore,
        stateAfter: null,
      };
      return;
    }

    if (this.audioContext.state === 'running') {
      this.lastResumeAttempt = {
        at: Date.now(),
        trigger,
        status: 'already-running',
        stateBefore,
        stateAfter: this.audioContext.state,
      };
      return;
    }

    try {
      await this.audioContext.resume();
      const stateAfter: string = this.audioContext.state;
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
        stateAfter: this.audioContext.state,
        ...normalizeAudioError(error),
      };
    }
  }
}

function getAudioPoolKey(path: string, route: SfxAudioRoute): string {
  return `${route}:${path}`;
}

function resetAudioPlayerCurrentTime(player: HTMLAudioElement): void {
  try {
    player.currentTime = 0;
  } catch {
    void 0;
  }
}

function PhaserClamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAudioError(error: unknown): { errorName: string; errorMessage: string } {
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
