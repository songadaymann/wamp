import Phaser from 'phaser';
import { playSfx } from '../../audio/sfx';
import type { PvpMatchSnapshot } from '../../pvp/model';
import { showPvpDamageFlashOverlay } from '../../ui/setup/pvpModal';
import { DEFAULT_PLAYER_VISUAL_FEET_OFFSET } from '../../player/defaultPlayer';
import { PVP_HEART_HEAD_CLEARANCE_PX, PvpHeartDisplay } from './pvpHeartDisplay';
import {
  PVP_INVULNERABILITY_FX_DEPTH,
  syncPvpInvulnerabilityFx,
  syncPvpInvulnerabilitySpriteStyle,
} from './pvpInvulnerabilityFx';

interface PvpLocalPlayerBody {
  center: { x: number };
  top: number;
  bottom: number;
}

interface OverworldPvpLocalPresentationControllerHost {
  scene: Phaser.Scene;
  playerWidth: number;
  playerStandingHeight: number;
  getPlayerSprite: () => Phaser.GameObjects.Sprite | null;
  onDisplayObjectsChanged?: () => void;
}

export class OverworldPvpLocalPresentationController {
  private heartDisplay: PvpHeartDisplay | null = null;
  private invulnerabilityFx: Phaser.GameObjects.Graphics | null = null;

  constructor(private readonly host: OverworldPvpLocalPresentationControllerHost) {}

  sync(input: {
    snapshot: PvpMatchSnapshot | null;
    localUserId: string | null;
    playerPresent: boolean;
    playerBody: PvpLocalPlayerBody | null;
  }): void {
    const { snapshot, localUserId, playerBody } = input;
    const playerSprite = this.host.getPlayerSprite();
    if (
      !snapshot ||
      snapshot.status === 'complete' ||
      !localUserId ||
      !input.playerPresent ||
      !playerBody
    ) {
      this.destroy();
      return;
    }

    const local = snapshot.participants.find((participant) => participant.userId === localUserId);
    if (!local) {
      this.destroy();
      return;
    }

    if (!this.heartDisplay) {
      this.heartDisplay = new PvpHeartDisplay(this.host.scene, 30);
      this.host.onDisplayObjectsChanged?.();
    }

    this.heartDisplay.setHearts(local.hearts);
    const visualTop = playerSprite
      ? playerSprite.y - playerSprite.displayHeight
      : playerBody.top;
    this.heartDisplay.setPosition(
      playerBody.center.x,
      Math.min(visualTop, playerBody.top) - PVP_HEART_HEAD_CLEARANCE_PX,
    );
    this.heartDisplay.setVisible(true);
    this.syncInvulnerability(playerBody, playerSprite, local.invulnerableUntil);
  }

  playDamageFeedback(previousHearts: number, nextHearts: number): void {
    const scene = this.host.scene;
    const lostHearts = Math.max(1, previousHearts - nextHearts);
    playSfx('player-hurt', { ignoreCooldown: true });
    showPvpDamageFlashOverlay();
    scene.cameras.main.flash(150, 255, 32, 42, false);
    scene.cameras.main.shake(110, 0.0045 + lostHearts * 0.0015);
    const playerSprite = this.host.getPlayerSprite();
    if (playerSprite) {
      playerSprite.setTintFill(0xff4f5f);
      scene.time.delayedCall(90, () => {
        this.host.getPlayerSprite()?.clearTint();
      });
    }
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    const ignored: Phaser.GameObjects.GameObject[] = [];
    if (this.heartDisplay) {
      ignored.push(this.heartDisplay.getGameObject());
    }
    if (this.invulnerabilityFx) {
      ignored.push(this.invulnerabilityFx);
    }
    return ignored;
  }

  destroy(): void {
    if (!this.heartDisplay) {
      return;
    }
    this.heartDisplay.destroy();
    this.heartDisplay = null;
    this.destroyInvulnerabilityFx();
    this.host.onDisplayObjectsChanged?.();
  }

  private syncInvulnerability(
    playerBody: PvpLocalPlayerBody,
    playerSprite: Phaser.GameObjects.Sprite | null,
    invulnerableUntil: number,
  ): void {
    if (!playerSprite) {
      this.destroyInvulnerabilityFx();
      return;
    }
    if (!this.invulnerabilityFx) {
      this.invulnerabilityFx = this.host.scene.add.graphics();
      this.invulnerabilityFx.setDepth(PVP_INVULNERABILITY_FX_DEPTH);
      this.invulnerabilityFx.setVisible(false);
      this.host.onDisplayObjectsChanged?.();
    }

    syncPvpInvulnerabilityFx({
      graphics: this.invulnerabilityFx,
      centerX: playerBody.center.x,
      bottomY: playerBody.bottom + DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
      width: Math.max(18, this.host.playerWidth + 8),
      height: Math.max(30, this.host.playerStandingHeight + 8),
      invulnerableUntil,
    });
    syncPvpInvulnerabilitySpriteStyle(playerSprite, invulnerableUntil);
  }

  private destroyInvulnerabilityFx(): void {
    const playerSprite = this.host.getPlayerSprite();
    if (playerSprite) {
      playerSprite.setAlpha(1);
      playerSprite.clearTint();
    }
    if (!this.invulnerabilityFx) {
      return;
    }
    this.invulnerabilityFx.destroy();
    this.invulnerabilityFx = null;
  }
}
