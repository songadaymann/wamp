import type { RuntimePlayerReader } from './runtimeContext';
import Phaser from 'phaser';
import {
  type DefaultPlayerAnimationState,
} from '../../player/defaultPlayer';
import { resolveActivePlayerAvatarPack } from '../../player/avatar/runtime';
import type { OverworldMovementPresentationState } from './movementController';
import { playPlayerAnimationIfReady } from './playerAnimation';
import { PlayerBodyFeedback } from './playerBodyFeedback';
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
  runtime: RuntimePlayerReader;
  getSpecialTileEnvironment(): Readonly<SpecialTilePlayerEnvironment>;
  getLastMovementInput(): { horizontalInput: number; verticalInput: number };
  getQuicksandVisualSink(): number;
  getMovementPresentationState(): Readonly<OverworldMovementPresentationState>;
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
  private readonly bodyFeedback = new PlayerBodyFeedback();
  private baseScaleX = 1;
  private baseScaleY = 1;

  constructor(
    private readonly host: OverworldPlayerPresentationControllerHost,
    private readonly options: OverworldPlayerPresentationControllerOptions,
  ) {}

  reset(): void {
    this.resetBodyFeedback();
    this.host.state.animationState = 'idle';
    this.host.state.facing = 1;
    this.host.state.wasGrounded = false;
    this.host.state.landAnimationUntil = 0;
  }

  handlePlayerCreated(): void {
    const sprite = this.host.runtime.playerSprite;
    this.baseScaleX = sprite?.scaleX ?? 1;
    this.baseScaleY = sprite?.scaleY ?? 1;
    this.resetBodyFeedback();
    this.host.state.animationState = 'idle';
    this.host.state.facing = 1;
    this.host.state.wasGrounded = true;
    this.host.state.landAnimationUntil = 0;
    this.syncPlayerVisual(false);
  }

  handlePlayerDestroyed(): void {
    this.resetBodyFeedback();
    this.host.state.landAnimationUntil = 0;
    this.host.state.wasGrounded = false;
  }

  describeBodyFeedback() {
    return this.bodyFeedback.describe();
  }

  handleRespawned(): void {
    this.resetBodyFeedback();
    this.host.state.wasGrounded = false;
    this.syncPlayerVisual(false);
  }

  resetTransientPlayState(): void {
    this.resetBodyFeedback();
    this.host.state.landAnimationUntil = 0;
  }

  syncPlayerVisual(sampleBodyFeedback = true): void {
    const player = this.host.runtime.player;
    const playerBody = this.host.runtime.playerBody;
    const playerSprite = this.host.runtime.playerSprite;
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
        // Arcade updates the game object's X in postUpdate; its body is already current here.
        this.setPlayerSpritePixelPosition(playerSprite, playerBody.center.x, playerBody.bottom + visualOffset);
        break;
    }

    const now = this.host.getCurrentTime();
    const movement = this.host.getMovementPresentationState();
    const facingLockedByWeaponKnockback = now < movement.weaponKnockbackUntil;
    const wallContactSide = movement.wallContactSide;
    const tangentVelocity = getBodyVelocityAlongVector(playerBody, getGravityRightVector(gravityDirection));
    const heldDirection = this.host.getLastMovementInput().horizontalInput;
    if (movement.isWallSliding && wallContactSide !== 0) {
      this.host.state.facing = wallContactSide;
    } else if (movement.activeCrateInteractionFacing !== null) {
      this.host.state.facing = movement.activeCrateInteractionFacing;
    } else if (!facingLockedByWeaponKnockback && heldDirection !== 0) {
      // Sliding and wall contact can reverse velocity while a key is held.
      // The sprite keeps the key direction, so a failed climb slides backwards.
      this.host.state.facing = this.resolveSpriteFacingForGravity(gravityDirection, heldDirection);
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
    const gravity = getGravityVector(gravityDirection);
    // Arcade settles the reset body's offsets in preUpdate. Its immediate reset
    // geometry must not become the apex for a subsequent short spawn drop.
    const feedback = sampleBodyFeedback ? this.bodyFeedback.sample({
      now,
      grounded,
      climbing: movement.isClimbingLadder,
      gravityDirection,
      positionAlongGravity: playerBody.center.x * gravity.x + playerBody.center.y * gravity.y
        + (Math.abs(gravity.x) * playerBody.width + Math.abs(gravity.y) * playerBody.height) * 0.5,
      velocityAlongGravity: getBodyVelocityAlongVector(playerBody, gravity),
    }) : { landed: false, scaleX: 1, scaleY: 1 };
    playerSprite.setScale(this.baseScaleX * feedback.scaleX, this.baseScaleY * feedback.scaleY);
    if (feedback.landed) {
      this.host.state.landAnimationUntil = now + this.options.landingAnimationMs;
      this.host.playLandingDustFx(player.x, playerBody.bottom, this.host.state.facing);
    }

    const nextAnimation = this.getNextAnimationState({
      now,
      grounded,
      playerBody,
      specialEnvironment,
      movement,
    });
    const playerAvatarPack = resolveActivePlayerAvatarPack();
    const nextAnimationKey = playerAvatarPack.animationKeys[nextAnimation];
    if (
      nextAnimation !== this.host.state.animationState ||
      playerSprite.anims.currentAnim?.key !== nextAnimationKey
    ) {
      this.host.state.animationState = nextAnimation;
      playPlayerAnimationIfReady(playerSprite, nextAnimationKey, true);
    }

    this.host.state.wasGrounded = grounded;
  }

  private resetBodyFeedback(): void {
    this.bodyFeedback.reset();
    this.host.runtime.playerSprite?.setScale(this.baseScaleX, this.baseScaleY);
  }

  syncPlayerPickupSensor(): void {
    const playerBody = this.host.runtime.playerBody;
    const playerPickupSensor = this.host.runtime.playerPickupSensor;
    const playerPickupSensorBody = this.host.runtime.playerPickupSensorBody;
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
    movement: Readonly<OverworldMovementPresentationState>;
  }): DefaultPlayerAnimationState {
    const activeAttackAnimation = this.host.getCurrentAttackAnimation(input.now);
    if (activeAttackAnimation) {
      return activeAttackAnimation;
    }

    if (input.movement.isClimbingLadder) {
      return 'ladder-climb';
    }

    if (input.movement.isWallSliding) {
      return 'wall-slide';
    }

    if (input.movement.wallJumpActive) {
      return 'wall-jump';
    }

    if (input.movement.isButtStomping) {
      return input.now < input.movement.buttStompFlipUntil
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

    if (input.movement.activeCrateInteractionMode === 'push') {
      return 'push';
    }

    if (input.movement.activeCrateInteractionMode === 'pull') {
      return 'pull';
    }

    if (input.movement.isCrouching) {
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

    // A crest or steep face can cancel velocity for a frame while the key is
    // still held. Keep the run cycle instead of flickering back to idle.
    if (lastMovementInput.horizontalInput !== 0) {
      return 'run';
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
