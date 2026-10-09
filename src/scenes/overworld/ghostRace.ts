import Phaser from 'phaser';
import { hasCoopPressurePlates } from '../../placedObjects/coopPressurePlates';
import { ensureSceneAvatarPackLoaded } from '../../player/avatar/dynamic';
import type { ResolvedPlayerAvatarPack } from '../../player/avatar/model';
import { GhostRacePlayback, buildRunGhost, supportsGhostRace, type GhostRaceChoice, type RunGhost } from '../../runs/ghostRace';
import { getGhostStorage, loadLocalGhostBest, saveLocalGhostBest } from '../../runs/localGhostBest';
import { loadRaceGhost, subscribeGhostBestUpdates } from '../../runs/ghostRepository';
import type { RankedRunVerificationTrace } from '../../runs/verificationTrace';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import type { GoalRunState } from './goalRuns';

export interface GhostRaceInfo {
  name: string;
  elapsedMs: number;
}

interface GhostRaceOptions {
  scene: Phaser.Scene;
  getRun(): GoalRunState | null;
  getMode(): string;
  getUserId(): string | null;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  onDisplayObjectsChanged(): void;
  onRaceInfoChanged(info: GhostRaceInfo | null): void;
  showStatus?: (message: string) => void;
}
/** One presentation-only sprite. It never enters Arcade, presence, combat or objective collections. */
export class OverworldGhostRaceController {
  private playback: GhostRacePlayback | null = null;
  private choice: GhostRaceChoice = 'off';
  private targetVersion = 0;
  private targetRoom: Pick<RoomSnapshot, 'id' | 'version' | 'goal' | 'coordinates'> | null = null;
  private unsubscribe: (() => void) | null = null;
  private identity: string | null = null;
  private generation = 0;
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private footerGhost: RunGhost | null = null;
  private pack: ResolvedPlayerAvatarPack | null = null;
  private position: { x: number; y: number; atMs: number } | null = null;
  private readonly guestCandidates = new WeakMap<object, RunGhost>();
  private refreshRequest: AbortController | null = null;
  constructor(private readonly options: GhostRaceOptions) {}

  select(ghost: RunGhost | null, choice: GhostRaceChoice, room: Pick<RoomSnapshot, 'id' | 'version' | 'goal' | 'coordinates'> & Partial<Pick<RoomSnapshot, 'placedObjects'>>): void {
    this.clear();
    if (choice === 'off' || (ghost && ghost.roomId !== room.id) || !supportsGhostRace(room.goal)
      || hasCoopPressurePlates(room.placedObjects ?? [])) return;
    this.choice = choice; this.targetVersion = room.version; this.targetRoom = room;
    this.identity = this.options.getUserId();
    this.unsubscribe = subscribeGhostBestUpdates(room.id, () => {
      if (this.options.getRun()?.result === 'active') void this.refreshAfterRestart();
    });
    if (ghost) this.setRecording(ghost);
    else void this.refreshRecording();
  }
  private setRecording(ghost: RunGhost | null): void {
    const changed = Boolean(this.sprite);
    this.generation++; this.sprite?.destroy();
    this.sprite = null; this.pack = null; this.position = null;
    this.updateRaceInfo(null);
    this.playback = ghost ? new GhostRacePlayback(ghost) : null;
    if (changed) this.options.onDisplayObjectsChanged();
    if (!ghost) return;
    const generation = this.generation;
    void ensureSceneAvatarPackLoaded(this.options.scene, ghost.avatarId).then(pack => {
      if (generation !== this.generation || !this.playback) return;
      this.pack = pack;
      this.sprite = this.options.scene.add.sprite(0, 0, pack.idleTextureKey, pack.idleFrame)
        .setOrigin(0.5, 1).setAlpha(0.42).setTint(0x70e5ff).setDepth(24).setVisible(false);
      this.sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      this.options.onDisplayObjectsChanged();
    }).catch(() => { if (generation === this.generation) this.clear(); });
  }
  update(): void {
    const run = this.options.getRun(), ghost = this.playback?.ghost;
    if (run?.cooperative) { this.clear(); return; }
    if (this.options.getMode() !== 'play' || this.identity !== this.options.getUserId()) { this.clear(); return; }
    const visible = Boolean(run && ghost && run.roomId === ghost.roomId && run.roomVersion === this.targetVersion
      && run.qualificationState === 'qualified');
    this.sprite?.setVisible(visible);
    this.updateRaceInfo(visible && this.sprite && ghost ? ghost : null);
    if (!visible || !run || !this.playback) { this.position = null; return; }
    const p = this.playback.sample(Math.min(run.elapsedMs, this.playback.ghost.elapsedMs));
    const origin = this.options.getRoomOrigin({ x: p.roomX, y: p.roomY });
    const x = origin.x + p.x, y = origin.y + p.y;
    this.position = { x, y, atMs: Math.round(run.elapsedMs) };
    this.sprite?.setPosition(x, y);
    if (this.sprite && this.pack) {
      if (Math.abs(p.vx) > 1) this.sprite.setFlipX(p.vx < 0);
      const state = p.grounded ? (Math.abs(p.vx) > 5 ? 'run' : 'idle') : (p.vy < 0 ? 'jump-rise' : 'jump-fall');
      const animation = this.pack.animationKeys[state];
      if (this.sprite.anims.currentAnim?.key !== animation) this.sprite.play(animation, true);
    }
  }
  private updateRaceInfo(ghost: RunGhost | null): void {
    if (this.footerGhost === ghost) return;
    this.footerGhost = ghost;
    this.options.onRaceInfoChanged(ghost ? {
      name: `${this.choice === 'top' ? '#1 ' : ''}${ghost.displayName}`,
      elapsedMs: ghost.elapsedMs,
    } : null);
  }
  captureGuest(run: GoalRunState | null, trace: RankedRunVerificationTrace, avatarId: string): void {
    if (!run || run.cooperative || this.options.getUserId() || !supportsGhostRace(run.goal)) return;
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
    const run = this.options.getRun();
    if (!run || run.roomId !== this.targetRoom?.id || run.roomVersion !== this.targetVersion) return;
    await this.refreshRecording(run);
  }
  private async refreshRecording(expectedRun?: GoalRunState): Promise<void> {
    const room = this.targetRoom, choice = this.choice;
    if (!room || choice === 'off' || this.options.getMode() !== 'play') return;
    this.refreshRequest?.abort();
    const request = this.refreshRequest = new AbortController(), generation = this.generation;
    const identity = this.options.getUserId();
    const current = () => this.refreshRequest === request && !request.signal.aborted && generation === this.generation
      && this.options.getMode() === 'play' && (!expectedRun || this.options.getRun() === expectedRun)
      && this.options.getUserId() === identity && this.targetRoom === room;
    try {
      const ghost = choice === 'personal' && !identity
        ? loadLocalGhostBest(getGhostStorage(), room.id, room.version)
        : await loadRaceGhost(room.id, room.version, room.coordinates, choice, request.signal);
      if (!current()) return;
      this.setRecording(ghost);
      if (!ghost) this.options.showStatus?.('Ghost recording unavailable. Playing on your own.');
    } catch {
      if (current()) this.options.showStatus?.(this.playback
        ? 'Ghost could not refresh. Racing the previous recording.'
        : 'Ghost could not load. Playing on your own.');
    }
  }
  clear(): void {
    const changed = Boolean(this.sprite);
    this.refreshRequest?.abort(); this.refreshRequest = null;
    this.unsubscribe?.(); this.unsubscribe = null; this.targetRoom = null;
    this.generation++; this.sprite?.destroy();
    this.sprite = null; this.pack = null; this.position = null;
    this.updateRaceInfo(null);
    this.playback = null; this.choice = 'off'; this.identity = this.options.getUserId();
    if (changed) this.options.onDisplayObjectsChanged();
  }
  getDebugSnapshot() {
    return { choice: this.choice, attemptId: this.playback?.ghost.attemptId ?? null,
      visible: this.sprite?.visible ?? false, position: this.position,
      elapsedMs: this.playback?.ghost.elapsedMs ?? null, hasPhysicsBody: Boolean(this.sprite?.body) };
  }
}
