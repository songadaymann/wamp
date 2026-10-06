import Phaser from 'phaser';
import { ensureSceneAvatarPackLoaded } from '../../player/avatar/dynamic';
import type { ResolvedPlayerAvatarPack } from '../../player/avatar/model';
import { GhostRacePlayback, buildRunGhost, supportsGhostRace, type GhostRaceChoice, type RunGhost } from '../../runs/ghostRace';
import { getGhostStorage, loadLocalGhostBest, saveLocalGhostBest } from '../../runs/localGhostBest';
import { loadRaceGhost } from '../../runs/ghostRepository';
import type { RankedRunVerificationTrace } from '../../runs/verificationTrace';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import type { GoalRunState } from './goalRuns';

interface GhostRaceOptions {
  scene: Phaser.Scene;
  getRun(): GoalRunState | null;
  getMode(): string;
  getUserId(): string | null;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  onDisplayObjectsChanged(): void;
  showStatus?: (message: string) => void;
}
/** One presentation-only sprite. It never enters Arcade, presence, combat or objective collections. */
export class OverworldGhostRaceController {
  private playback: GhostRacePlayback | null = null;
  private choice: GhostRaceChoice = 'off';
  private targetVersion = 0;
  private identity: string | null = null;
  private generation = 0;
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private label: Phaser.GameObjects.Text | null = null;
  private pack: ResolvedPlayerAvatarPack | null = null;
  private position: { x: number; y: number; atMs: number } | null = null;
  private readonly guestCandidates = new WeakMap<object, RunGhost>();
  private refreshRequest: AbortController | null = null;
  constructor(private readonly options: GhostRaceOptions) {}

  select(ghost: RunGhost | null, choice: GhostRaceChoice, room: Pick<RoomSnapshot, 'id' | 'version' | 'goal'>): void {
    this.clear();
    if (!ghost || ghost.roomId !== room.id || !supportsGhostRace(room.goal)) return;
    this.playback = new GhostRacePlayback(ghost); this.choice = choice; this.targetVersion = room.version;
    this.identity = this.options.getUserId();
    const generation = this.generation;
    void ensureSceneAvatarPackLoaded(this.options.scene, ghost.avatarId).then(pack => {
      if (generation !== this.generation || !this.playback) return;
      this.pack = pack;
      this.sprite = this.options.scene.add.sprite(0, 0, pack.idleTextureKey, pack.idleFrame)
        .setOrigin(0.5, 1).setAlpha(0.42).setTint(0x70e5ff).setDepth(24).setVisible(false);
      this.sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      this.label = this.options.scene.add.text(0, 0,
        `${choice === 'top' ? '#1 ' + ghost.displayName : 'Your best'} · ${(ghost.elapsedMs / 1000).toFixed(2)}s`,
        { fontFamily: 'Courier New', fontSize: '11px', color: '#70e5ff', backgroundColor: '#050505',
          padding: { x: 4, y: 2 } }).setOrigin(0.5, 1).setDepth(25).setVisible(false);
      this.options.onDisplayObjectsChanged();
    }).catch(() => { if (generation === this.generation) this.clear(); });
  }
  update(): void {
    const run = this.options.getRun(), ghost = this.playback?.ghost;
    if (this.options.getMode() !== 'play' || this.identity !== this.options.getUserId()) { this.clear(); return; }
    const visible = Boolean(run && ghost && run.roomId === ghost.roomId && run.roomVersion === this.targetVersion
      && run.qualificationState === 'qualified');
    this.sprite?.setVisible(visible); this.label?.setVisible(visible);
    if (!visible || !run || !this.playback) { this.position = null; return; }
    const p = this.playback.sample(Math.min(run.elapsedMs, this.playback.ghost.elapsedMs));
    const origin = this.options.getRoomOrigin({ x: p.roomX, y: p.roomY });
    const x = origin.x + p.x, y = origin.y + p.y;
    this.position = { x, y, atMs: Math.round(run.elapsedMs) };
    this.sprite?.setPosition(x, y);
    this.label?.setPosition(x, y - 30);
    if (this.sprite && this.pack) {
      if (Math.abs(p.vx) > 1) this.sprite.setFlipX(p.vx < 0);
      const state = p.grounded ? (Math.abs(p.vx) > 5 ? 'run' : 'idle') : (p.vy < 0 ? 'jump-rise' : 'jump-fall');
      const animation = this.pack.animationKeys[state];
      if (this.sprite.anims.currentAnim?.key !== animation) this.sprite.play(animation, true);
    }
  }
  captureGuest(run: GoalRunState | null, trace: RankedRunVerificationTrace, avatarId: string): void {
    if (!run || this.options.getUserId() || !supportsGhostRace(run.goal)) return;
    const ghost = buildRunGhost({ attemptId: run.attemptId ?? 'guest', roomId: run.roomId,
      roomVersion: run.roomVersion, displayName: 'Your best', avatarId, elapsedMs: Math.round(run.elapsedMs) }, trace);
    if (ghost) this.guestCandidates.set(run, ghost);
  }
  confirmGuest(run: object & { attemptId: string | null; guestProgress?: { status: string } }): void {
    const ghost = this.guestCandidates.get(run);
    if (!ghost || run.guestProgress?.status !== 'saved') return;
    this.guestCandidates.delete(run);
    saveLocalGhostBest(getGhostStorage(), { ...ghost, attemptId: run.attemptId ?? ghost.attemptId },
      (run as GoalRunState).deaths);
  }
  async refreshAfterRestart(): Promise<void> {
    const run = this.options.getRun(), choice = this.choice;
    if (!run || !this.playback || choice === 'off' || this.options.getMode() !== 'play'
      || run.roomId !== this.playback.ghost.roomId || run.roomVersion !== this.targetVersion) return;
    this.refreshRequest?.abort();
    const request = this.refreshRequest = new AbortController(), generation = this.generation;
    const identity = this.options.getUserId();
    const current = () => this.refreshRequest === request && !request.signal.aborted && generation === this.generation
      && this.options.getMode() === 'play' && this.options.getRun() === run && this.options.getUserId() === identity;
    try {
      const ghost = choice === 'personal' && !identity
        ? loadLocalGhostBest(getGhostStorage(), run.roomId, run.roomVersion)
        : await loadRaceGhost(run.roomId, run.roomVersion, run.roomCoordinates, choice, request.signal);
      if (!current()) return;
      this.select(ghost, choice, { id: run.roomId, version: run.roomVersion, goal: run.goal });
      if (!ghost) this.options.showStatus?.('Ghost recording unavailable. Playing on your own.');
    } catch {
      if (current()) this.options.showStatus?.('Ghost could not refresh. Racing the previous recording.');
    }
  }
  clear(): void {
    const changed = Boolean(this.sprite || this.label);
    this.refreshRequest?.abort(); this.refreshRequest = null;
    this.generation++; this.sprite?.destroy(); this.label?.destroy();
    this.sprite = null; this.label = null; this.pack = null; this.position = null;
    this.playback = null; this.choice = 'off'; this.identity = this.options.getUserId();
    if (changed) this.options.onDisplayObjectsChanged();
  }
  getDebugSnapshot() {
    return { choice: this.choice, attemptId: this.playback?.ghost.attemptId ?? null,
      visible: this.sprite?.visible ?? false, position: this.position,
      elapsedMs: this.playback?.ghost.elapsedMs ?? null, hasPhysicsBody: Boolean(this.sprite?.body) };
  }
}
