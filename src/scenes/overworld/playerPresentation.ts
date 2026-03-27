import Phaser from 'phaser';
import {
  DEFAULT_PLAYER_ANIMATION_KEYS,
  type DefaultPlayerAnimationState,
} from '../../player/defaultPlayer';

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
  getQuicksandVisualSink(): number;
  getWeaponKnockbackUntil(): number;
  getIsClimbingLadder(): boolean;
  getIsWallSliding(): boolean;
  getWallContactSide(): -1 | 1 | 0;
  getWallJumpActive(): boolean;
  getIsCrouching(): boolean;
  getActiveCrateInteractionMode(): 'push' | 'pull' | null;
  getActiveCrateInteractionFacing(): -1 | 1 | null;
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

    playerSprite.setPosition(
      player.x,
      playerBody.bottom + this.options.playerVisualFeetOffset + this.host.getQuicksandVisualSink(),
    );

    const now = this.host.getCurrentTime();
    const facingLockedByWeaponKnockback = now < this.host.getWeaponKnockbackUntil();
    const wallContactSide = this.host.getWallContactSide();
    if (this.host.getIsWallSliding() && wallContactSide !== 0) {
      this.host.state.facing = wallContactSide;
    } else if (this.host.getActiveCrateInteractionFacing() !== null) {
      this.host.state.facing = this.host.getActiveCrateInteractionFacing()!;
    } else if (
      !facingLockedByWeaponKnockback &&
      Math.abs(playerBody.velocity.x) > this.options.facingVelocityThreshold
    ) {
      this.host.state.facing = playerBody.velocity.x < 0 ? -1 : 1;
    }
    playerSprite.setFlipX(this.host.state.facing < 0);

    const grounded = playerBody.blocked.down || playerBody.touching.down;
    if (!this.host.getIsClimbingLadder() && grounded && !this.host.state.wasGrounded) {
      this.host.state.landAnimationUntil = now + this.options.landingAnimationMs;
      this.host.playLandingDustFx(player.x, playerBody.bottom, this.host.state.facing);
    }

    const nextAnimation = this.getNextAnimationState({
      now,
      grounded,
      playerBody,
    });
    if (nextAnimation !== this.host.state.animationState) {
      this.host.state.animationState = nextAnimation;
      playerSprite.play(DEFAULT_PLAYER_ANIMATION_KEYS[nextAnimation], true);
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

    if (!input.grounded) {
      return input.playerBody.velocity.y < this.options.jumpRiseVelocityThreshold
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
      return Math.abs(input.playerBody.velocity.x) > this.options.crouchMoveVelocityThreshold
        ? 'crawl'
        : 'crouch';
    }

    if (input.now < this.host.state.landAnimationUntil) {
      return 'land';
    }

    if (Math.abs(input.playerBody.velocity.x) > this.options.runVelocityThreshold) {
      return 'run';
    }

    return 'idle';
  }
}
