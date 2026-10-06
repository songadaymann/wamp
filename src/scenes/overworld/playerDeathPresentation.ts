import type Phaser from 'phaser';

/** Owns only the death sprite's visibility and respawn fade. */
export class OverworldPlayerDeathPresentation {
  private fade: Phaser.Tweens.Tween | null = null;

  constructor(private readonly scene: Phaser.Scene,
    private readonly getSprite: () => Phaser.GameObjects.Sprite | null) {}

  hide(): void {
    this.detach();
    this.getSprite()?.setVisible(false);
  }

  restore(): void {
    this.detach();
    this.getSprite()?.setVisible(true).setAlpha(1);
  }

  fadeIn(duration: number): void {
    this.restore();
    const sprite = this.getSprite();
    if (!sprite) return;
    sprite.setAlpha(0);
    this.fade = this.scene.tweens.add({ targets: sprite, alpha: 1, duration });
  }

  /** Player replacement stops the old tween while preserving the pending respawn. */
  detach(): void {
    this.fade?.stop();
    this.fade = null;
  }
}
