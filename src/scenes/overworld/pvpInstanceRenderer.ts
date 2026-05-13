import Phaser from 'phaser';
import {
  ensureSceneAvatarPackLoaded,
  isSceneAvatarPackLoaded,
} from '../../player/avatar/dynamic';
import { resolvePlayerAvatarPack } from '../../player/avatar/runtime';
import type {
  PvpMatchCombatEvent,
  PvpMatchPlayerState,
  PvpMatchSnapshot,
  PvpParticipantIdentity,
} from '../../pvp/model';
import type { WeaponHitResult } from './liveObjects';

interface PvpInstanceRendererOptions {
  scene: Phaser.Scene;
  playerWidth: number;
  playerHeight: number;
  presentCombatEvent: (event: PvpMatchCombatEvent, receivedAt: number) => void;
  onDisplayObjectsChanged?: () => void;
}

interface RemoteOpponent {
  identity: PvpParticipantIdentity;
  roomId: string;
  hearts: number;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  velocityX: number;
  velocityY: number;
  facing: -1 | 1;
  animationState: PvpMatchPlayerState['animationState'];
  action: PvpMatchPlayerState['action'];
  actionDownward: boolean;
  actionUntil: number;
  sentAt: number;
  receivedAt: number;
  avatarLoadPending: boolean;
}

export class PvpInstanceRenderer {
  private opponent: RemoteOpponent | null = null;
  private lastCombatEventIds = new Set<string>();

  constructor(private readonly options: PvpInstanceRendererOptions) {}

  syncMatchSnapshot(snapshot: PvpMatchSnapshot | null, localUserId: string | null): void {
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
      this.opponent.label.setText(this.formatHearts(participant.hearts));
    }
  }

  handlePeerState(state: PvpMatchPlayerState): void {
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

  handleCombatEvent(event: PvpMatchCombatEvent): void {
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
      const predicted = this.getPredictedTarget(this.opponent);
      const distance = Phaser.Math.Distance.Between(
        this.opponent.sprite.x,
        this.opponent.sprite.y,
        predicted.x,
        predicted.y,
      );
      const step = 0.68;
      if (distance > 56) {
        this.opponent.sprite.setPosition(predicted.x, predicted.y);
      } else {
        this.opponent.sprite.x = Phaser.Math.Linear(this.opponent.sprite.x, predicted.x, step);
        this.opponent.sprite.y = Phaser.Math.Linear(this.opponent.sprite.y, predicted.y, step);
      }
      this.opponent.label.setPosition(this.opponent.sprite.x, this.opponent.sprite.y - 28);
      this.ensureOpponentAvatarLoaded(this.opponent);
    }

  }

  getOpponentUserId(): string | null {
    return this.opponent?.identity.userId ?? null;
  }

  getOpponentBodyRect(): Phaser.Geom.Rectangle | null {
    if (!this.opponent || !this.opponent.sprite.visible) {
      return null;
    }

    return new Phaser.Geom.Rectangle(
      this.opponent.sprite.x - this.options.playerWidth * 0.5,
      this.opponent.sprite.y - this.options.playerHeight,
      this.options.playerWidth,
      this.options.playerHeight,
    );
  }

  getOpponentHitRect(): Phaser.Geom.Rectangle | null {
    const rect = this.getOpponentBodyRect();
    if (!rect) {
      return null;
    }

    Phaser.Geom.Rectangle.Inflate(rect, 12, 8);
    return rect;
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
      const rect = new Phaser.Geom.Rectangle(
        this.opponent.facing > 0 ? bodyRect.centerX : bodyRect.centerX - width,
        bodyRect.centerY - 12,
        width,
        24,
      );
      Phaser.Geom.Rectangle.Inflate(rect, 8, 4);
      return rect;
    }

    if (this.opponent.actionDownward) {
      const rect = new Phaser.Geom.Rectangle(
        bodyRect.centerX - 12,
        bodyRect.bottom - 2,
        24,
        28,
      );
      Phaser.Geom.Rectangle.Inflate(rect, 14, 8);
      return rect;
    }

    const rect = new Phaser.Geom.Rectangle(
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
    action: NonNullable<PvpMatchPlayerState['action']>;
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
    const pointRect = new Phaser.Geom.Rectangle(worldX - 4, worldY - 3, 8, 6);
    return this.getHitResultInRect(pointRect);
  }

  getOpponentCenter(): { x: number; y: number } | null {
    return this.opponent
      ? {
          x: this.opponent.sprite.x,
          y: this.opponent.sprite.y - this.options.playerHeight * 0.5,
        }
      : null;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    const objects: Phaser.GameObjects.GameObject[] = [];
    if (this.opponent) {
      objects.push(this.opponent.sprite, this.opponent.label);
    }
    return objects;
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
      this.opponent.label.destroy();
      this.opponent = null;
    }
    this.lastCombatEventIds.clear();
    this.options.onDisplayObjectsChanged?.();
  }

  destroy(): void {
    this.clear();
  }

  private ensureOpponent(identity: PvpParticipantIdentity, roomId: string): void {
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

    const label = this.options.scene.add.text(0, -28, this.formatHearts(3), {
      fontFamily: 'Courier New',
      fontSize: '11px',
      color: '#ff3f5f',
      stroke: '#050505',
      strokeThickness: 4,
      padding: { x: 4, y: 2 },
    });
    label.setOrigin(0.5, 1);
    label.setDepth(30);
    label.setVisible(false);

    this.opponent = {
      identity,
      roomId,
      hearts: 3,
      sprite,
      label,
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
    this.options.onDisplayObjectsChanged?.();
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

  private playOpponentAnimation(animationState: PvpMatchPlayerState['animationState']): void {
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
    fallback: PvpMatchPlayerState['animationState'],
  ): PvpMatchPlayerState['animationState'] {
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
    this.opponent.label.setVisible(visible);
  }

  private getPredictedTarget(opponent: RemoteOpponent): { x: number; y: number } {
    const ageMs = Phaser.Math.Clamp(Date.now() - opponent.receivedAt, 0, 80);
    const ageSeconds = ageMs / 1000;
    return {
      x: opponent.targetX + opponent.velocityX * ageSeconds,
      y: opponent.targetY + opponent.velocityY * ageSeconds,
    };
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

  private formatHearts(hearts: number): string {
    return hearts > 0 ? '♥'.repeat(hearts) : '0♥';
  }
}
