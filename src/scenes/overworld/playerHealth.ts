import type Phaser from 'phaser';
import { PlayerHealth } from '../../player/health';
import { PvpHeartDisplay, PVP_HEART_HEAD_CLEARANCE_PX } from './pvpHeartDisplay';
import { syncPvpInvulnerabilitySpriteStyle } from './pvpInvulnerabilityFx';

interface PlayerHealthHost {
  scene: Phaser.Scene;
  getMaximumHearts(): unknown;
  isActive(): boolean;
  isPvpActive(): boolean;
  isDeathPending(): boolean;
  getCurrentTime(): number;
  getPlayerBody(): Phaser.Physics.Arcade.Body | null;
  getPlayerSprite(): Phaser.GameObjects.Sprite | null;
  onHurt(): void;
  onDisplayObjectsChanged(): void;
}

/** Owns room health and its presentation; PvP retains its separate server health. */
export class OverworldPlayerHealthController {
  private readonly health = new PlayerHealth();
  private display: PvpHeartDisplay | null = null;
  private styledSprite: Phaser.GameObjects.Sprite | null = null;

  constructor(private readonly host: PlayerHealthHost) {}

  refillForSpawn(): void {
    this.releaseSpriteStyle();
    this.health.reset(this.host.isActive() ? this.host.getMaximumHearts() : 1);
    this.sync();
  }

  absorbDamage(): boolean {
    if (!this.host.isActive() || !this.host.getPlayerBody()) return false;
    this.health.setMaximum(this.host.getMaximumHearts());
    const result = this.health.damage(this.host.getCurrentTime());
    if (result === 'hurt') this.host.onHurt();
    this.sync();
    return result !== 'death';
  }

  heal(): boolean {
    if (!this.host.isActive() || this.host.isDeathPending()) return false;
    this.health.setMaximum(this.host.getMaximumHearts());
    const healed = this.health.heal();
    this.sync();
    return healed;
  }

  die(): void {
    this.health.die();
    this.releaseSpriteStyle();
    this.display?.setVisible(false);
  }

  sync(): void {
    if (this.host.isPvpActive()) {
      this.display?.setVisible(false);
      // The PvP presenter now owns this sprite's tint and alpha.
      this.styledSprite = null;
      return;
    }
    const sprite = this.host.getPlayerSprite();
    const body = this.host.getPlayerBody();
    if (!this.host.isActive() || !sprite || !body || this.host.isDeathPending()) {
      this.display?.setVisible(false);
      this.releaseSpriteStyle();
      return;
    }
    this.health.setMaximum(this.host.getMaximumHearts());
    if (this.health.maximum > 1) {
      if (!this.display) {
        this.display = new PvpHeartDisplay(this.host.scene, 30);
        this.host.onDisplayObjectsChanged();
      }
      this.display.setHearts(this.health.current, this.health.maximum);
      // Compatible avatar frames include transparent space above their ~40px body.
      // Keep the icons above the visible head without following the full atlas height.
      const visualTop = sprite.y - Math.min(sprite.displayHeight, 44 * Math.abs(sprite.scaleY));
      this.display.setPosition(body.center.x, Math.min(visualTop, body.top) - PVP_HEART_HEAD_CLEARANCE_PX);
      this.display.setVisible(true);
    } else this.display?.setVisible(false);

    const now = this.host.getCurrentTime();
    if (now < this.health.invulnerableUntil) {
      syncPvpInvulnerabilitySpriteStyle(sprite, this.health.invulnerableUntil, now);
      this.styledSprite = sprite;
    } else this.releaseSpriteStyle();
  }

  describe() {
    return { current: this.health.current, maximum: this.health.maximum,
      invulnerableMs: Math.max(0, Math.round(this.health.invulnerableUntil - this.host.getCurrentTime())),
      enabled: this.host.isActive(), visible: this.host.isActive() && this.health.maximum > 1
        && !!this.host.getPlayerBody() && !!this.host.getPlayerSprite() && !this.host.isDeathPending() };
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return this.display ? [this.display.getGameObject()] : [];
  }

  reset(): void {
    this.releaseSpriteStyle();
    this.health.reset(1);
    this.display?.setVisible(false);
  }

  destroy(): void {
    this.reset();
    this.display?.destroy();
    this.display = null;
  }

  private releaseSpriteStyle(): void {
    if (this.styledSprite?.active) {
      this.styledSprite.setAlpha(1);
      this.styledSprite.clearTint();
    }
    this.styledSprite = null;
  }
}
