import type Phaser from 'phaser';
import { getAssistSpeed, isAssistRequested, subscribeAssistSettings } from '../../settings/assistSettings';
import { markRunAssisted } from './assistedRun';
import type { GoalRunState } from './goalRuns';
import type { ActiveExpandedRoomRunState } from './expandedRoomRuns';
interface AssistHost {
  available(): boolean;
  getRoomRun(): GoalRunState | null;
  getExpandedRun(): ActiveExpandedRoomRunState | null;
  clearTrace(): void;
  renderHud(): void;
}
/** Installs scaling before the scene clock and Arcade Physics advance each frame. */
export class OverworldAssistRuntime {
  speed = 1;
  private frameElapsedMs = 0;
  private sleeping = false;
  private readonly unsubscribe: () => void;
  constructor(private readonly scene: Phaser.Scene, private readonly host: AssistHost) {
    scene.events.on('preupdate', this.tick);
    scene.events.on('sleep', this.sleep);
    scene.events.on('wake', this.wake);
    this.unsubscribe = subscribeAssistSettings(this.sync);
    this.sync();
  }
  isActive(): boolean { return isAssistRequested() && !this.sleeping && this.host.available(); }
  describe() { return { active: this.isActive(), speed: this.speed, frameElapsedMs: this.frameElapsedMs }; }
  private tick = (_time: number, delta: number): void => { this.sync(); this.frameElapsedMs += Math.max(0, delta); };
  private sync = (): void => {
    const active = this.isActive();
    const roomChanged = active && markRunAssisted(this.host.getRoomRun());
    const expandedChanged = active && markRunAssisted(this.host.getExpandedRun());
    if (roomChanged || expandedChanged) { this.host.clearTrace(); this.host.renderHud(); }
    this.applySpeed(active ? getAssistSpeed() : 1);
  };
  private applySpeed(speed: number): void {
    if (this.speed === speed) return;
    this.speed = speed;
    this.scene.physics.world.timeScale = 1 / speed;
    this.scene.time.timeScale = speed;
    this.scene.tweens.timeScale = speed;
    this.scene.anims.globalTimeScale = speed;
  }
  private sleep = (): void => { this.sleeping = true; this.applySpeed(1); };
  private wake = (): void => { this.sleeping = false; this.sync(); };
  destroy(): void {
    this.unsubscribe();
    this.scene.events.off('preupdate', this.tick);
    this.scene.events.off('sleep', this.sleep);
    this.scene.events.off('wake', this.wake);
    this.applySpeed(1);
  }
}
