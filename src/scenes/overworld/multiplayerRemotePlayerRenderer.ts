import Phaser from 'phaser';
import {
  ensureSceneAvatarPackLoaded,
  isSceneAvatarPackLoaded,
} from '../../player/avatar/dynamic';
import { resolvePlayerAvatarPack } from '../../player/avatar/runtime';
import { getMultiplayerModeDefinition } from '../../multiplayer/model';
import type {
  MultiplayerInstanceCombatEvent,
  MultiplayerInstancePlayerState,
  MultiplayerInstanceSnapshot,
  MultiplayerParticipantIdentity,
} from '../../multiplayer/model';
import type { WeaponHitResult } from './liveObjects';
import { PVP_HEART_HEAD_CLEARANCE_PX, PvpHeartDisplay } from './pvpHeartDisplay';
import {
  PVP_INVULNERABILITY_FX_DEPTH,
  syncPvpInvulnerabilityFx,
  syncPvpInvulnerabilitySpriteStyle,
} from './pvpInvulnerabilityFx';

interface MultiplayerRemotePlayerRendererOptions {
  scene: Phaser.Scene;
  playerWidth: number;
  playerHeight: number;
  presentCombatEvent: (event: MultiplayerInstanceCombatEvent, receivedAt: number) => void;
}

interface RemoteOpponent {
  identity: MultiplayerParticipantIdentity;
  roomId: string;
  hearts: number;
  invulnerableUntil: number;
  sprite: Phaser.GameObjects.Sprite;
  heartsDisplay: PvpHeartDisplay;
  invulnerabilityFx: Phaser.GameObjects.Graphics;
  targetX: number;
  targetY: number;
  velocityX: number;
  velocityY: number;
  facing: -1 | 1;
  animationState: MultiplayerInstancePlayerState['animationState'];
  action: MultiplayerInstancePlayerState['action'];
  actionDownward: boolean;
  actionUntil: number;
  sentAt: number;
  receivedAt: number;
  avatarLoadPending: boolean;
}

export class MultiplayerRemotePlayerRenderer {
  private opponent: RemoteOpponent | null = null;
  private lastCombatEventIds = new Set<string>();
  private readonly predictedTargetScratch = { x: 0, y: 0 };
  private readonly opponentBodyRectScratch = new Phaser.Geom.Rectangle();
  private readonly opponentHitRectScratch = new Phaser.Geom.Rectangle();
  private readonly remoteActionRectScratch = new Phaser.Geom.Rectangle();
  private readonly pointRectScratch = new Phaser.Geom.Rectangle();

  constructor(private readonly options: MultiplayerRemotePlayerRendererOptions) {}

  syncMatchSnapshot(snapshot: MultiplayerInstanceSnapshot | null, localUserId: string | null): void {
    if (!snapshot || snapshot.status === 'complete' || !localUserId) {
      this.clear();
      return;
    }

    const participant = snapshot.participants.find((candidate) => candidate.userId !== localUserId) ?? null;
    if (!participant) {
      this.clear();
      return;
    }

    this.ensureOpponent(participant, snapshot.roomId);
    if (this.opponent) {
      this.opponent.hearts = participant.hearts;
      this.opponent.invulnerableUntil = participant.invulnerableUntil;
      this.opponent.heartsDisplay.setHearts(participant.hearts);
    }
  }

  handlePeerState(state: MultiplayerInstancePlayerState): void {
    if (!this.opponent || state.userId !== this.opponent.identity.userId) {
      return;
    }

    const receivedAt = Date.now();
    const existingActionActive = Boolean(
      this.opponent.action && receivedAt < this.opponent.actionUntil,
    );
    this.opponent.targetX = state.x;
    this.opponent.targetY = state.y;
    this.opponent.velocityX = state.velocityX;
    this.opponent.velocityY = state.velocityY;
    this.opponent.facing = state.facing;
    this.opponent.animationState = state.animationState;
    if (state.action) {
      const keepExistingDownward = existingActionActive && this.opponent.action === state.action;
      this.opponent.action = state.action;
      this.opponent.actionUntil =
        receivedAt + Phaser.Math.Clamp(state.actionUntil - state.sentAt, 0, 1_000);
      this.opponent.actionDownward = keepExistingDownward ? this.opponent.actionDownward : false;
    } else if (!existingActionActive) {
      this.opponent.action = null;
      this.opponent.actionUntil = 0;
      this.opponent.actionDownward = false;
    }
    this.opponent.sentAt = state.sentAt;
    this.opponent.receivedAt = receivedAt;
    this.opponent.sprite.setFlipX(state.facing < 0);
    this.playOpponentAnimation(this.getLatchedAnimationState(state.animationState));
    this.syncOpponentVisibility();
  }

  handleCombatEvent(event: MultiplayerInstanceCombatEvent): void {
    if (!this.opponent || event.userId !== this.opponent.identity.userId) {
      return;
    }
    if (this.lastCombatEventIds.has(event.id)) {
      return;
    }

    if (this.lastCombatEventIds.size > 80) {
      this.lastCombatEventIds.clear();
    }
    this.lastCombatEventIds.add(event.id);
    const receivedAt = Date.now();
    this.opponent.targetX = event.x;
    this.opponent.targetY = event.y;
    this.opponent.receivedAt = receivedAt;
    this.opponent.facing = event.facing;
    this.opponent.action = event.source;
    this.opponent.actionDownward = event.downward;
    this.opponent.actionUntil = receivedAt + Math.max(180, event.durationMs);
    this.opponent.sprite.setFlipX(event.facing < 0);
    this.playOpponentAnimation(this.getLatchedAnimationState(this.opponent.animationState));
    this.options.presentCombatEvent(event, receivedAt);
  }

  update(_delta: number): void {
    if (this.opponent) {
      if (this.opponent.action && Date.now() > this.opponent.actionUntil) {
        this.opponent.action = null;
        this.opponent.actionDownward = false;
        this.playOpponentAnimation(this.opponent.animationState);
      }
      this.writePredictedTarget(this.opponent, this.predictedTargetScratch);
      const distance = Phaser.Math.Distance.Between(
        this.opponent.sprite.x,
        this.opponent.sprite.y,
        this.predictedTargetScratch.x,
        this.predictedTargetScratch.y,
      );
      const step = 0.68;
      if (distance > 56) {
        this.opponent.sprite.setPosition(
          this.predictedTargetScratch.x,
          this.predictedTargetScratch.y,
        );
      } else {
        this.opponent.sprite.x = Phaser.Math.Linear(
          this.opponent.sprite.x,
          this.predictedTargetScratch.x,
          step,
        );
        this.opponent.sprite.y = Phaser.Math.Linear(
          this.opponent.sprite.y,
          this.predictedTargetScratch.y,
          step,
        );
      }
      this.opponent.heartsDisplay.setPosition(
        this.opponent.sprite.x,
        this.getOpponentHeartY(this.opponent),
      );
      this.syncOpponentInvulnerability(this.opponent);
      this.ensureOpponentAvatarLoaded(this.opponent);
    }

  }

  getOpponentUserId(): string | null {
    return this.opponent?.identity.userId ?? null;
  }

  getOpponentBodyRect(): Phaser.Geom.Rectangle | null {
    if (!this.writeOpponentBodyRect(this.opponentBodyRectScratch)) {
      return null;
    }
    return this.opponentBodyRectScratch;
  }

  getOpponentHitRect(): Phaser.Geom.Rectangle | null {
    if (!this.writeOpponentBodyRect(this.opponentHitRectScratch)) {
      return null;
    }

    Phaser.Geom.Rectangle.Inflate(this.opponentHitRectScratch, 12, 8);
    return this.opponentHitRectScratch;
  }

  getRemoteActionDamageRect(): Phaser.Geom.Rectangle | null {
    if (!this.opponent || !this.opponent.action || Date.now() > this.opponent.actionUntil + 160) {
      return null;
    }

    const bodyRect = this.getOpponentBodyRect();
    if (!bodyRect) {
      return null;
    }

    if (this.opponent.action === 'gun') {
      const width = 88;
      const rect = this.remoteActionRectScratch.setTo(
        this.opponent.facing > 0 ? bodyRect.centerX : bodyRect.centerX - width,
        bodyRect.centerY - 12,
        width,
        24,
      );
      Phaser.Geom.Rectangle.Inflate(rect, 8, 4);
      return rect;
    }

    if (this.opponent.actionDownward) {
      const rect = this.remoteActionRectScratch.setTo(
        bodyRect.centerX - 12,
        bodyRect.bottom - 2,
        24,
        28,
      );
      Phaser.Geom.Rectangle.Inflate(rect, 14, 8);
      return rect;
    }

    const rect = this.remoteActionRectScratch.setTo(
      bodyRect.centerX + this.opponent.facing * 8 - 14,
      bodyRect.top + 2,
      28,
      bodyRect.height + 10,
    );
    Phaser.Geom.Rectangle.Inflate(rect, 14, 8);
    return rect;
  }

  getRemoteActionState(): {
    attackerUserId: string;
    action: NonNullable<MultiplayerInstancePlayerState['action']>;
    actionUntil: number;
  } | null {
    if (!this.opponent || !this.opponent.action || Date.now() > this.opponent.actionUntil + 160) {
      return null;
    }

    return {
      attackerUserId: this.opponent.identity.userId,
      action: this.opponent.action,
      actionUntil: this.opponent.actionUntil,
    };
  }

  getHitResultInRect(attackRect: Phaser.Geom.Rectangle): WeaponHitResult | null {
    const hitRect = this.getOpponentHitRect();
    if (!hitRect || !this.opponent || !Phaser.Geom.Intersects.RectangleToRectangle(attackRect, hitRect)) {
      return null;
    }

    return this.getOpponentHitResult();
  }

  getHitResultAtPoint(worldX: number, worldY: number): WeaponHitResult | null {
    this.pointRectScratch.setTo(worldX - 4, worldY - 3, 8, 6);
    return this.getHitResultInRect(this.pointRectScratch);
  }

  hasOpponent(): boolean {
    return this.opponent !== null;
  }

  writeOpponentCenter(target: { x: number; y: number }): boolean {
    if (!this.opponent) return false;
    target.x = this.opponent.sprite.x;
    target.y = this.opponent.sprite.y - this.options.playerHeight * 0.5;
    return true;
  }

  getDebugState(): Record<string, unknown> | null {
    if (!this.opponent) {
      return null;
    }

    return {
      userId: this.opponent.identity.userId,
      displayName: this.opponent.identity.displayName,
      roomId: this.opponent.roomId,
      hearts: this.opponent.hearts,
      invulnerableMs: Math.max(0, Math.round(this.opponent.invulnerableUntil - Date.now())),
      x: Math.round(this.opponent.sprite.x),
      y: Math.round(this.opponent.sprite.y),
      targetX: Math.round(this.opponent.targetX),
      targetY: Math.round(this.opponent.targetY),
      velocityX: Math.round(this.opponent.velocityX),
      velocityY: Math.round(this.opponent.velocityY),
      facing: this.opponent.facing,
      animationState: this.opponent.animationState,
      action: this.opponent.action,
      actionDownward: this.opponent.actionDownward,
      actionUntil: this.opponent.actionUntil,
      stateAgeMs: Math.max(0, Date.now() - this.opponent.receivedAt),
    };
  }

  clear(): void {
    if (this.opponent) {
      this.opponent.sprite.destroy();
      this.opponent.heartsDisplay.destroy();
      this.opponent.invulnerabilityFx.destroy();
      this.opponent = null;
    }
    this.lastCombatEventIds.clear();
  }

  destroy(): void {
    this.clear();
  }

  private ensureOpponent(identity: MultiplayerParticipantIdentity, roomId: string): void {
    if (this.opponent?.identity.userId === identity.userId) {
      this.opponent.identity = identity;
      this.opponent.roomId = roomId;
      return;
    }

    this.clear();
    const pack = resolvePlayerAvatarPack(null);
    const sprite = this.options.scene.add.sprite(0, 0, pack.idleTextureKey, pack.idleFrame);
    sprite.setOrigin(0.5, 1);
    sprite.setDepth(29);
    sprite.setAlpha(1);
    sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    sprite.play(pack.animationKeys.idle);
    sprite.setVisible(false);

    const heartsDisplay = new PvpHeartDisplay(this.options.scene, 30);
    heartsDisplay.setHearts(getMultiplayerModeDefinition('arena').startingLives);
    const invulnerabilityFx = this.options.scene.add.graphics();
    invulnerabilityFx.setDepth(PVP_INVULNERABILITY_FX_DEPTH);
    invulnerabilityFx.setVisible(false);

    this.opponent = {
      identity,
      roomId,
      hearts: getMultiplayerModeDefinition('arena').startingLives,
      invulnerableUntil: 0,
      sprite,
      heartsDisplay,
      invulnerabilityFx,
      targetX: 0,
      targetY: 0,
      velocityX: 0,
      velocityY: 0,
      facing: 1,
      animationState: 'idle',
      action: null,
      actionDownward: false,
      actionUntil: 0,
      sentAt: 0,
      receivedAt: 0,
      avatarLoadPending: false,
    };
    this.ensureOpponentAvatarLoaded(this.opponent);
  }

  private getOpponentHeartY(opponent: RemoteOpponent): number {
    const visualTop = opponent.sprite.y - opponent.sprite.displayHeight;
    const bodyTop = opponent.sprite.y - this.options.playerHeight;
    return Math.min(visualTop, bodyTop) - PVP_HEART_HEAD_CLEARANCE_PX;
  }

  private syncOpponentInvulnerability(opponent: RemoteOpponent): void {
    if (!opponent.sprite.visible) {
      opponent.invulnerabilityFx.clear();
      opponent.invulnerabilityFx.setVisible(false);
      opponent.sprite.setAlpha(1);
      opponent.sprite.clearTint();
      return;
    }

    const width = Math.max(18, this.options.playerWidth + 8);
    const height = Math.max(30, this.options.playerHeight + 14);
    syncPvpInvulnerabilityFx({
      graphics: opponent.invulnerabilityFx,
      centerX: opponent.sprite.x,
      bottomY: opponent.sprite.y,
      width,
      height,
      invulnerableUntil: opponent.invulnerableUntil,
    });
    syncPvpInvulnerabilitySpriteStyle(opponent.sprite, opponent.invulnerableUntil);
  }

  private ensureOpponentAvatarLoaded(opponent: RemoteOpponent): void {
    if (isSceneAvatarPackLoaded(this.options.scene, opponent.identity.avatarId)) {
      const pack = resolvePlayerAvatarPack(opponent.identity.avatarId);
      if (opponent.sprite.texture.key !== pack.idleTextureKey) {
        opponent.sprite.setTexture(pack.idleTextureKey, pack.idleFrame);
      }
      this.playOpponentAnimation(this.getLatchedAnimationState(opponent.animationState));
      return;
    }

    if (opponent.avatarLoadPending) {
      return;
    }

    opponent.avatarLoadPending = true;
    void ensureSceneAvatarPackLoaded(this.options.scene, opponent.identity.avatarId)
      .then(() => {
        opponent.avatarLoadPending = false;
        if (this.opponent?.identity.userId !== opponent.identity.userId) {
          return;
        }
        const pack = resolvePlayerAvatarPack(opponent.identity.avatarId);
        opponent.sprite.setTexture(pack.idleTextureKey, pack.idleFrame);
        this.playOpponentAnimation(this.getLatchedAnimationState(opponent.animationState));
        this.syncOpponentVisibility();
      })
      .catch(() => {
        opponent.avatarLoadPending = false;
      });
  }

  private playOpponentAnimation(animationState: MultiplayerInstancePlayerState['animationState']): void {
    if (!this.opponent) {
      return;
    }

    const pack = resolvePlayerAvatarPack(
      isSceneAvatarPackLoaded(this.options.scene, this.opponent.identity.avatarId)
        ? this.opponent.identity.avatarId
        : null,
    );
    const animationKey = pack.animationKeys[animationState];
    if (this.opponent.sprite.anims.currentAnim?.key !== animationKey) {
      this.opponent.sprite.play(animationKey, true);
    }
  }

  private getLatchedAnimationState(
    fallback: MultiplayerInstancePlayerState['animationState'],
  ): MultiplayerInstancePlayerState['animationState'] {
    if (!this.opponent?.action || Date.now() > this.opponent.actionUntil) {
      return fallback;
    }

    if (this.opponent.action === 'gun') {
      return 'gun-fire';
    }

    return this.opponent.actionDownward ? 'air-slash-down' : 'sword-slash';
  }

  private syncOpponentVisibility(): void {
    if (!this.opponent) {
      return;
    }

    const visible = this.opponent.receivedAt > 0;
    this.opponent.sprite.setVisible(visible);
    this.opponent.heartsDisplay.setVisible(visible);
    if (!visible) {
      this.opponent.invulnerabilityFx.clear();
      this.opponent.invulnerabilityFx.setVisible(false);
    }
  }

  private writePredictedTarget(
    opponent: RemoteOpponent,
    target: { x: number; y: number },
  ): void {
    const ageMs = Phaser.Math.Clamp(Date.now() - opponent.receivedAt, 0, 80);
    const ageSeconds = ageMs / 1000;
    target.x = opponent.targetX + opponent.velocityX * ageSeconds;
    target.y = opponent.targetY + opponent.velocityY * ageSeconds;
  }

  private writeOpponentBodyRect(target: Phaser.Geom.Rectangle): boolean {
    if (!this.opponent || !this.opponent.sprite.visible) {
      return false;
    }
    target.setTo(
      this.opponent.sprite.x - this.options.playerWidth * 0.5,
      this.opponent.sprite.y - this.options.playerHeight,
      this.options.playerWidth,
      this.options.playerHeight,
    );
    return true;
  }

  private getOpponentHitResult(): WeaponHitResult | null {
    if (!this.opponent) {
      return null;
    }

    return {
      roomId: this.opponent.roomId,
      enemyName: this.opponent.identity.displayName,
      x: this.opponent.sprite.x,
      y: this.opponent.sprite.y,
    };
  }

}
