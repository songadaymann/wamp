import Phaser from 'phaser';
import {
  type DefaultPlayerAnimationState,
} from '../../player/defaultPlayer';
import { resolveActivePlayerAvatarPack } from '../../player/avatar/runtime';
import {
  bodyIsBlockedInGravityDirection,
  getBodyVelocityAlongVector,
  getGravityAngle,
  getGravityRightVector,
  getGravityVector,
  type PlayerGravityDirection,
  type SpecialTilePlayerEnvironment,
} from './specialTiles';

export interface OverworldPlayerPresentationControllerState {
  animationState: DefaultPlayerAnimationState;
  facing: -1 | 1;
  wasGrounded: boolean;
  landAnimationUntil: number;
}

interface OverworldPlayerPresentationControllerHost {
  state: OverworldPlayerPresentationControllerState;
  getCurrentTime(): number;
  getPlayer(): Phaser.GameObjects.Rectangle | null;
  getPlayerBody(): Phaser.Physics.Arcade.Body | null;
  getPlayerSprite(): Phaser.GameObjects.Sprite | null;
  getPlayerPickupSensor(): Phaser.GameObjects.Rectangle | null;
  getPlayerPickupSensorBody(): Phaser.Physics.Arcade.Body | null;
  getSpecialTileEnvironment(): SpecialTilePlayerEnvironment;
  getLastMovementInput(): { horizontalInput: number; verticalInput: number };
  getQuicksandVisualSink(): number;
  getWeaponKnockbackUntil(): number;
  getIsClimbingLadder(): boolean;
  getIsWallSliding(): boolean;
  getWallContactSide(): -1 | 1 | 0;
  getWallJumpActive(): boolean;
  getIsCrouching(): boolean;
  getIsButtStomping(): boolean;
  getButtStompFlipUntil(): number;
  getActiveCrateInteractionMode(): 'push' | 'pull' | null;
  getActiveCrateInteractionFacing(): -1 | 1 | null;
  getGroundedOverride(): boolean | null;
  getCurrentAttackAnimation(now: number): DefaultPlayerAnimationState | null;
  playLandingDustFx(x: number, y: number, facing: -1 | 1): void;
}

interface OverworldPlayerPresentationControllerOptions {
  playerPickupSensorExtraHeight: number;
  playerVisualFeetOffset: number;
  landingAnimationMs: number;
  facingVelocityThreshold: number;
  jumpRiseVelocityThreshold: number;
  crouchMoveVelocityThreshold: number;
  runVelocityThreshold: number;
}

export class OverworldPlayerPresentationController {
  constructor(
    private readonly host: OverworldPlayerPresentationControllerHost,
    private readonly options: OverworldPlayerPresentationControllerOptions,
  ) {}

  reset(): void {
    this.host.state.animationState = 'idle';
    this.host.state.facing = 1;
    this.host.state.wasGrounded = false;
    this.host.state.landAnimationUntil = 0;
  }

  handlePlayerCreated(): void {
    this.host.state.animationState = 'idle';
    this.host.state.facing = 1;
    this.host.state.wasGrounded = true;
    this.host.state.landAnimationUntil = 0;
    this.syncPlayerVisual();
  }

  handlePlayerDestroyed(): void {
    this.host.state.landAnimationUntil = 0;
    this.host.state.wasGrounded = false;
  }

  handleRespawned(): void {
    this.host.state.wasGrounded = false;
    this.syncPlayerVisual();
  }

  resetTransientPlayState(): void {
    this.host.state.landAnimationUntil = 0;
  }

  syncPlayerVisual(): void {
    const player = this.host.getPlayer();
    const playerBody = this.host.getPlayerBody();
    const playerSprite = this.host.getPlayerSprite();
    if (!player || !playerBody || !playerSprite) {
      return;
    }

    this.syncPlayerPickupSensor();

    const specialEnvironment = this.host.getSpecialTileEnvironment();
    const gravityDirection = specialEnvironment.gravityDirection;
    const visualOffset = this.options.playerVisualFeetOffset + this.host.getQuicksandVisualSink();
    playerSprite.setRotation(getGravityAngle(gravityDirection));
    switch (gravityDirection) {
      case 'up':
        this.setPlayerSpritePixelPosition(playerSprite, playerBody.center.x, playerBody.top - visualOffset);
        break;
      case 'left':
        this.setPlayerSpritePixelPosition(playerSprite, playerBody.left - visualOffset, playerBody.center.y);
        break;
      case 'right':
        this.setPlayerSpritePixelPosition(playerSprite, playerBody.right + visualOffset, playerBody.center.y);
        break;
      case 'down':
      default:
        this.setPlayerSpritePixelPosition(playerSprite, player.x, playerBody.bottom + visualOffset);
        break;
    }

    const now = this.host.getCurrentTime();
    const facingLockedByWeaponKnockback = now < this.host.getWeaponKnockbackUntil();
    const wallContactSide = this.host.getWallContactSide();
    const tangentVelocity = getBodyVelocityAlongVector(playerBody, getGravityRightVector(gravityDirection));
    if (this.host.getIsWallSliding() && wallContactSide !== 0) {
      this.host.state.facing = wallContactSide;
    } else if (this.host.getActiveCrateInteractionFacing() !== null) {
      this.host.state.facing = this.host.getActiveCrateInteractionFacing()!;
    } else if (
      !facingLockedByWeaponKnockback &&
      Math.abs(tangentVelocity) > this.options.facingVelocityThreshold
    ) {
      this.host.state.facing = this.resolveSpriteFacingForGravity(gravityDirection, tangentVelocity);
    }
    playerSprite.setFlipX(this.host.state.facing < 0);

    const grounded =
      this.host.getGroundedOverride() ??
      bodyIsBlockedInGravityDirection(playerBody, gravityDirection);
    if (!this.host.getIsClimbingLadder() && grounded && !this.host.state.wasGrounded) {
      this.host.state.landAnimationUntil = now + this.options.landingAnimationMs;
      this.host.playLandingDustFx(player.x, playerBody.bottom, this.host.state.facing);
    }

    const nextAnimation = this.getNextAnimationState({
      now,
      grounded,
      playerBody,
      specialEnvironment,
    });
    const playerAvatarPack = resolveActivePlayerAvatarPack();
    const nextAnimationKey = playerAvatarPack.animationKeys[nextAnimation];
    if (
      nextAnimation !== this.host.state.animationState ||
      playerSprite.anims.currentAnim?.key !== nextAnimationKey
    ) {
      this.host.state.animationState = nextAnimation;
      playerSprite.play(nextAnimationKey, true);
    }

    this.host.state.wasGrounded = grounded;
  }

  syncPlayerPickupSensor(): void {
    const playerBody = this.host.getPlayerBody();
    const playerPickupSensor = this.host.getPlayerPickupSensor();
    const playerPickupSensorBody = this.host.getPlayerPickupSensorBody();
    if (!playerBody || !playerPickupSensor || !playerPickupSensorBody) {
      return;
    }

    const sensorWidth = playerBody.width;
    const sensorHeight = playerBody.height + this.options.playerPickupSensorExtraHeight;
    const sensorX = playerBody.center.x;
    const sensorY = playerBody.bottom - sensorHeight * 0.5;
    playerPickupSensor.setSize(sensorWidth, sensorHeight);
    playerPickupSensor.setPosition(sensorX, sensorY);
    playerPickupSensorBody.setSize(sensorWidth, sensorHeight, true);
    playerPickupSensorBody.reset(sensorX, sensorY);
  }

  private getNextAnimationState(input: {
    now: number;
    grounded: boolean;
    playerBody: Phaser.Physics.Arcade.Body;
    specialEnvironment: SpecialTilePlayerEnvironment;
  }): DefaultPlayerAnimationState {
    const activeAttackAnimation = this.host.getCurrentAttackAnimation(input.now);
    if (activeAttackAnimation) {
      return activeAttackAnimation;
    }

    if (this.host.getIsClimbingLadder()) {
      return 'ladder-climb';
    }

    if (this.host.getIsWallSliding()) {
      return 'wall-slide';
    }

    if (this.host.getWallJumpActive()) {
      return 'wall-jump';
    }

    if (this.host.getIsButtStomping()) {
      return input.now < this.host.getButtStompFlipUntil()
        ? 'butt-stomp-flip'
        : 'crouch';
    }

    if (!input.grounded) {
      const gravityVelocity = getBodyVelocityAlongVector(
        input.playerBody,
        getGravityVector(input.specialEnvironment.gravityDirection),
      );
      return gravityVelocity < this.options.jumpRiseVelocityThreshold
        ? 'jump-rise'
        : 'jump-fall';
    }

    if (this.host.getActiveCrateInteractionMode() === 'push') {
      return 'push';
    }

    if (this.host.getActiveCrateInteractionMode() === 'pull') {
      return 'pull';
    }

    if (this.host.getIsCrouching()) {
      const tangentVelocity = getBodyVelocityAlongVector(
        input.playerBody,
        getGravityRightVector(input.specialEnvironment.gravityDirection),
      );
      return Math.abs(tangentVelocity) > this.options.crouchMoveVelocityThreshold
        ? 'crawl'
        : 'crouch';
    }

    if (input.now < this.host.state.landAnimationUntil) {
      return 'land';
    }

    const tangentVelocity = getBodyVelocityAlongVector(
      input.playerBody,
      getGravityRightVector(input.specialEnvironment.gravityDirection),
    );
    const lastMovementInput = this.host.getLastMovementInput();
    const movingOnlyFromSurface =
      lastMovementInput.horizontalInput === 0 &&
      (
        input.specialEnvironment.conveyorX !== 0 ||
        input.specialEnvironment.onIce ||
        input.specialEnvironment.windX !== 0
      );
    if (movingOnlyFromSurface) {
      return 'idle';
    }

    if (Math.abs(tangentVelocity) > this.options.runVelocityThreshold) {
      return 'run';
    }

    return 'idle';
  }

  private setPlayerSpritePixelPosition(
    playerSprite: Phaser.GameObjects.Sprite,
    x: number,
    y: number,
  ): void {
    playerSprite.setPosition(Math.round(x), Math.round(y));
  }

  private resolveSpriteFacingForGravity(
    gravityDirection: PlayerGravityDirection,
    tangentVelocity: number,
  ): -1 | 1 {
    const tangentFacing = tangentVelocity < 0 ? -1 : 1;
    return gravityDirection === 'left' || gravityDirection === 'right'
      ? (tangentFacing === 1 ? -1 : 1)
      : tangentFacing;
  }
}
