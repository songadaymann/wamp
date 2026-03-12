type CueConfig = {
  path: string;
  volume: number;
  playbackRate?: number;
  cooldownMs?: number;
  allowOverlap?: boolean;
  trimAfterMs?: number;
  fadeOutMs?: number;
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
  | 'challenge-abandon'
  | 'time-up'
  | 'bounce'
  | 'jump'
  | 'land'
  | 'footstep'
  | 'ladder-climb'
  | 'respawn'
  | 'chat-send'
  | 'chat-receive';

type SfxHistoryEntry = {
  cue: SfxCue;
  at: number;
  status: 'played' | 'blocked' | 'missing' | 'cooldown' | 'error';
};

declare global {
  interface Window {
    get_sfx_debug_state?: () => Record<string, unknown>;
    play_sfx_debug?: (cue: SfxCue) => void;
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
    cooldownMs: 120,
    allowOverlap: false,
  },
  respawn: {
    path: 'assets/sfx/world/respawn.wav',
    volume: 0.52,
    cooldownMs: 120,
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
};

function resolveAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.replace(/^\/+/, '');
  return new URL(normalizedPath, `${window.location.origin}${normalizedBase}`).toString();
}

export class SfxController {
  private muted = false;
  private initialized = false;
  private userInteracted = false;
  private readonly baseAudioByPath = new Map<string, HTMLAudioElement>();
  private readonly activeAudio = new Set<HTMLAudioElement>();
  private readonly activeCueCounts = new Map<SfxCue, number>();
  private readonly lastPlayedAt = new Map<SfxCue, number>();
  private readonly history: SfxHistoryEntry[] = [];

  init(windowObj: Window = window): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    const markInteracted = () => {
      this.userInteracted = true;
    };

    windowObj.addEventListener('pointerdown', markInteracted, { passive: true });
    windowObj.addEventListener('keydown', markInteracted, { passive: true });
    windowObj.addEventListener('touchstart', markInteracted, { passive: true });

    for (const config of Object.values(SFX_CUES)) {
      const audio = new Audio(resolveAssetUrl(config.path));
      audio.preload = 'auto';
      this.baseAudioByPath.set(config.path, audio);
    }

    windowObj.get_sfx_debug_state = () => this.getDebugState();
    if (import.meta.env.DEV) {
      windowObj.play_sfx_debug = (cue: SfxCue) => {
        this.play(cue);
      };
    }
  }

  setMuted(value: boolean): void {
    this.muted = value;
  }

  isMuted(): boolean {
    return this.muted;
  }

  getDebugState(): Record<string, unknown> {
    return {
      initialized: this.initialized,
      muted: this.muted,
      userInteracted: this.userInteracted,
      activeCount: this.activeAudio.size,
      history: [...this.history],
    };
  }

  play(cue: SfxCue): void {
    const config = SFX_CUES[cue];
    if (!config) {
      this.record(cue, 'missing');
      return;
    }

    const now = performance.now();
    const cooldownMs = config.cooldownMs ?? 0;
    const lastPlayedAt = this.lastPlayedAt.get(cue) ?? -Infinity;
    if (now - lastPlayedAt < cooldownMs) {
      this.record(cue, 'cooldown');
      return;
    }
    this.lastPlayedAt.set(cue, now);

    if (this.muted) {
      this.record(cue, 'blocked');
      return;
    }

    const baseAudio = this.baseAudioByPath.get(config.path);
    if (!baseAudio) {
      this.record(cue, 'missing');
      return;
    }

    if (config.allowOverlap === false && (this.activeCueCounts.get(cue) ?? 0) > 0) {
      this.record(cue, 'cooldown');
      return;
    }

    const player = baseAudio.cloneNode() as HTMLAudioElement;
    const baseVolume = PhaserClamp(config.volume, 0, 1);
    player.volume = baseVolume;
    player.playbackRate = config.playbackRate ?? 1;
    player.currentTime = 0;

    this.activeAudio.add(player);
    this.activeCueCounts.set(cue, (this.activeCueCounts.get(cue) ?? 0) + 1);
    let fadeIntervalId: number | null = null;
    let trimTimeoutId: number | null = null;
    const cleanup = () => {
      if (trimTimeoutId !== null) {
        window.clearTimeout(trimTimeoutId);
        trimTimeoutId = null;
      }
      if (fadeIntervalId !== null) {
        window.clearInterval(fadeIntervalId);
        fadeIntervalId = null;
      }
      this.activeAudio.delete(player);
      const nextCount = Math.max(0, (this.activeCueCounts.get(cue) ?? 1) - 1);
      if (nextCount === 0) {
        this.activeCueCounts.delete(cue);
      } else {
        this.activeCueCounts.set(cue, nextCount);
      }
      player.removeEventListener('ended', cleanup);
      player.removeEventListener('error', cleanup);
    };
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
          player.volume = baseVolume * (1 - progress);
          if (progress >= 1) {
            player.pause();
            cleanup();
          }
        }, 30);
      }, config.trimAfterMs);
    }

    const playPromise = player.play();
    if (playPromise) {
      void playPromise
        .then(() => {
          this.record(cue, 'played');
        })
        .catch(() => {
          cleanup();
          this.record(cue, this.userInteracted ? 'error' : 'blocked');
        });
      return;
    }

    this.record(cue, 'played');
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

function PhaserClamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const globalSfxController = new SfxController();

export function initSfx(doc: Document = document, windowObj: Window = window): void {
  void doc;
  globalSfxController.init(windowObj);
}

export function playSfx(cue: SfxCue): void {
  globalSfxController.play(cue);
}
