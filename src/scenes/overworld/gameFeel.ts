export const KILL_HITSTOP_MS = 50;
export const PLAYER_DEATH_BEAT_MS = 180;
export const PLAYER_RESPAWN_FADE_MS = 120;

interface GameFeelHost {
  canApplyFeedback(): boolean;
  isPvpActive(): boolean;
  isPhysicsPaused(): boolean;
  pausePhysics(): void;
  resumePhysics(): void;
  hidePlayer(): void;
  restorePlayerVisual(): void;
  fadeInPlayer(durationMs: number): void;
}

/** Real-time feedback never pauses the scene clock or owns another system's pause. */
export class OverworldGameFeelController {
  private phase: 'none' | 'hitstop' | 'death' = 'none';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ownsPhysicsPause = false;
  private pendingFade = false;
  private suppressNextRespawnCue = false;
  private generation = 0;
  private bufferedCombat = { swordPressed: false, gunPressed: false };
  private hitstopCount = 0;
  private lastHitstop: { startedAt: number; completedAt: number | null; heldMs: number | null } | null = null;

  constructor(private readonly host: GameFeelHost) {}

  isHoldingPhysics(): boolean { return this.phase !== 'none'; }
  isDeathPending(): boolean { return this.phase === 'death'; }
  describe() {
    return { phase: this.phase, pendingRespawnFade: this.pendingFade,
      hitstopCount: this.hitstopCount, lastHitstop: this.lastHitstop ? { ...this.lastHitstop } : null };
  }

  bufferCombatInput(input: { swordPressed: boolean; gunPressed: boolean }): void {
    if (this.phase !== 'hitstop') return;
    this.bufferedCombat.swordPressed ||= input.swordPressed;
    this.bufferedCombat.gunPressed ||= input.gunPressed;
  }

  consumeCombatInput(input: { swordPressed: boolean; gunPressed: boolean }) {
    const merged = { swordPressed: input.swordPressed || this.bufferedCombat.swordPressed,
      gunPressed: input.gunPressed || this.bufferedCombat.gunPressed };
    this.bufferedCombat = { swordPressed: false, gunPressed: false };
    return merged;
  }

  hitstop(): void {
    if (!this.host.canApplyFeedback() || this.host.isPvpActive() || this.isDeathPending()) return;
    this.cancelTimer();
    this.phase = 'hitstop';
    this.hitstopCount += 1;
    const startedAt = performance.now();
    this.lastHitstop = { startedAt, completedAt: null, heldMs: null };
    this.pausePhysics();
    this.schedule(KILL_HITSTOP_MS, () => {
      const completedAt = performance.now();
      this.lastHitstop = { startedAt, completedAt, heldMs: completedAt - startedAt };
      this.phase = 'none';
      this.releasePhysics();
    });
  }

  deathBeat(afterBeat: () => void): void {
    if (this.isDeathPending()) return;
    this.cancelTimer();
    this.bufferedCombat = { swordPressed: false, gunPressed: false };
    this.suppressNextRespawnCue = true;
    if (!this.host.canApplyFeedback() || this.host.isPvpActive()) {
      this.phase = 'none';
      this.releasePhysics();
      afterBeat();
      return;
    }
    this.phase = 'death';
    this.pendingFade = true;
    this.pausePhysics();
    this.host.hidePlayer();
    this.schedule(PLAYER_DEATH_BEAT_MS, () => {
      this.phase = 'none';
      try { afterBeat(); } finally { this.releasePhysics(); }
    });
  }

  /** Called after either a cached reset or an asynchronously loaded player spawn. */
  playerAvailable(): void {
    if (!this.pendingFade) return;
    this.pendingFade = false;
    this.host.fadeInPlayer(PLAYER_RESPAWN_FADE_MS);
  }

  shouldPlayRespawnCue(): boolean {
    const allowed = !this.suppressNextRespawnCue;
    this.suppressNextRespawnCue = false;
    return allowed;
  }

  reset(): void {
    this.cancelTimer();
    this.phase = 'none';
    this.pendingFade = false;
    this.suppressNextRespawnCue = false;
    this.bufferedCombat = { swordPressed: false, gunPressed: false };
    this.releasePhysics();
    this.host.restorePlayerVisual();
    this.hitstopCount = 0;
    this.lastHitstop = null;
  }

  private pausePhysics(): void {
    if (this.ownsPhysicsPause || this.host.isPhysicsPaused()) return;
    this.ownsPhysicsPause = true;
    this.host.pausePhysics();
  }

  private releasePhysics(): void {
    if (!this.ownsPhysicsPause) return;
    this.ownsPhysicsPause = false;
    this.host.resumePhysics();
  }

  private cancelTimer(): void {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number, callback: () => void): void {
    const generation = this.generation;
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.timer = null;
      callback();
    }, delay);
  }
}
