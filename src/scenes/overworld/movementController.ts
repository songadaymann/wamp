import Phaser from 'phaser';
import { playSfx, stopSfx } from '../../audio/sfx';
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
} from '../../config';
import type {
  RoomCoordinates,
  RoomSnapshot,
} from '../../persistence/roomModel';
import {
  consumeTouchAction,
  getTouchInputState,
} from '../../ui/mobile/touchControls';
import {
  isDynamicArcadeBody,
  type ArcadeObjectBody,
  type LoadedRoomObject,
} from './liveObjects';
import { liveObjectBlocksPlayerMovement } from './playerCollisionObjects';
import {
  bodyIsBlockedInGravityDirection,
  getBodyVelocityAlongVector,
  getGravityRightVector,
  getGravityVector,
  setBodyVelocityAlongVector,
  type DirectionVector,
  type PlayerGravityDirection,
  type SpecialTilePlayerEnvironment,
} from './specialTiles';

const CRATE_PULL_DRAG_COMPENSATION_SCALE = 2.25;
const SINGLE_TILE_GAP_ASSIST_MAX_DROP_PX = 4;
const SINGLE_TILE_GAP_ASSIST_FOOT_PROBE_PX = 1;
const SINGLE_TILE_GAP_ASSIST_HORIZONTAL_PAD_PX = 1;
const WATER_MOVE_FACTOR = 0.62;
const WATER_SWIM_KICK_VELOCITY = -168;
const WATER_MAX_GRAVITY_SPEED = 118;
const WATER_GRAVITY_FACTOR = 0.35;
const WIND_PUSH_ACCELERATION = 980;
const WIND_MAX_SPEED = 280;
const CONVEYOR_SPEED = 48;
const ICE_COAST_FACTOR = 0.985;
const ICE_ACCELERATION = 900;
const STICKY_MOVE_FACTOR = 0.48;
const STICKY_JUMP_FACTOR = 0.72;
const RUNTIME_OBJECT_SUPPORT_MAX_UPWARD_SPEED = -60;
const RUNTIME_OBJECT_SUPPORT_HOVER_TOLERANCE_PX = 8;
const RUNTIME_OBJECT_SUPPORT_PENETRATION_TOLERANCE_PX = 5;
const RUNTIME_OBJECT_SUPPORT_EDGE_INSET_PX = 1;
const BUTT_STOMP_FALL_SPEED = 520;
const BUTT_STOMP_FLIP_MS = 190;
const BUTT_STOMP_IMPACT_GRACE_MS = 120;

export interface OverworldCrateInteraction {
  crateBody: Phaser.Physics.Arcade.Body;
  mode: 'push' | 'pull';
  moveDirectionX: -1 | 1;
  facing: -1 | 1;
  gravityDirection: PlayerGravityDirection;
}

interface DirectionalGravityControls {
  tangentInput: number;
  crouchHeld: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  horizontalInput: number;
  verticalInput: number;
}

export interface OverworldMovementControllerState {
  isCrouching: boolean;
  isButtStomping: boolean;
  buttStompFlipUntil: number;
  buttStompImpactGraceUntil: number;
  activeCrateInteractionMode: 'push' | 'pull' | null;
  activeCrateInteractionFacing: -1 | 1 | null;
  weaponKnockbackVelocityX: number;
  weaponKnockbackUntil: number;
  ladderClimbSfxPlaying: boolean;
  coyoteTime: number;
  jumpBuffered: boolean;
  jumpBufferTime: number;
  wallContactSide: -1 | 1 | 0;
  wallContactGraceSide: -1 | 1 | 0;
  wallContactGraceUntil: number;
  isWallSliding: boolean;
  wallJumpLockUntil: number;
  wallJumpActive: boolean;
  wallJumpDirection: -1 | 1 | 0;
  wallJumpChainActive: boolean;
  isClimbingLadder: boolean;
  activeLadderKey: string | null;
}

interface OverworldMovementControllerHost {
  state: OverworldMovementControllerState;
  getCurrentTime(): number;
  getPlayer(): Phaser.GameObjects.Rectangle | null;
  getPlayerBody(): Phaser.Physics.Arcade.Body | null;
  getSpecialTileEnvironment(): Readonly<SpecialTilePlayerEnvironment>;
  getPlayerFacing(): -1 | 1;
  getCurrentRoomCoordinates(): RoomCoordinates;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  isSolidTerrainAtWorldPoint(room: RoomSnapshot, worldX: number, worldY: number): boolean;
  getExternalLaunchGraceUntil(): number;
  shouldForceFullBodyHitbox(): boolean;
  getPushableLiveObjectsInBounds(
    bounds: Phaser.Geom.Rectangle,
    paddingX?: number,
    paddingY?: number,
  ): Iterable<LoadedRoomObject>;
  getRuntimeSolidLiveObjectsInBounds(
    bounds: Phaser.Geom.Rectangle,
    paddingX?: number,
    paddingY?: number,
  ): Iterable<LoadedRoomObject>;
  getArcadeBodyBounds(body: ArcadeObjectBody): Phaser.Geom.Rectangle;
  getCursors(): Phaser.Types.Input.Keyboard.CursorKeys;
  getWasd(): {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  findOverlappingLadder(): LoadedRoomObject | null;
  playJumpDustFx(x: number, y: number, facing: -1 | 1): void;
  syncPlayerPickupSensor(): void;
}

interface OverworldMovementControllerOptions {
  playerWidth: number;
  playerHeight: number;
  playerStandingHeight: number;
  playerCrouchHeight: number;
  playerPushHeight: number;
  playerSpeed: number;
  crawlSpeed: number;
  cratePushSpeed: number;
  cratePullSpeed: number;
  crateInteractionMaxGap: number;
  coyoteMs: number;
  jumpBufferMs: number;
  wallJumpBufferMs: number;
  wallContactGraceMs: number;
  jumpVelocity: number;
  wallSlideMaxFallSpeed: number;
  wallJumpVelocityX: number;
  wallJumpVelocityY: number;
  wallJumpInputLockMs: number;
  ladderClimbSpeed: number;
  quicksandMoveFactor: number;
  quicksandJumpFactor: number;
  weaponKnockbackMs: number;
}

export interface OverworldMovementStepResult {
  grounded: boolean;
  downHeld: boolean;
  horizontalInput: number;
  verticalInput: number;
  jumpPressed: boolean;
}

export class OverworldMovementController {
  constructor(
    private readonly host: OverworldMovementControllerHost,
    private readonly options: OverworldMovementControllerOptions,
  ) {}

  reset(): void {
    this.host.state.coyoteTime = 0;
    this.host.state.jumpBuffered = false;
    this.host.state.jumpBufferTime = 0;
    this.host.state.isCrouching = false;
    this.clearButtStompState();
    this.clearCrateInteractionState();
    this.host.state.weaponKnockbackVelocityX = 0;
    this.host.state.weaponKnockbackUntil = 0;
    this.setPlayerLadderState(null);
    this.resetWallMovementState();
    this.setLadderClimbSfxPlaying(false);
  }

  handleNoPlayerRuntime(): void {
    this.clearCrateInteractionState();
    this.resetWallMovementState();
    this.clearButtStompState();
  }

  handlePlayerCreated(): void {
    this.host.state.isCrouching = false;
    this.clearButtStompState();
    this.clearCrateInteractionState();
    this.host.state.weaponKnockbackVelocityX = 0;
    this.host.state.weaponKnockbackUntil = 0;
    this.setPlayerLadderState(null);
    this.resetWallMovementState();
    this.syncPlayerHitbox();
    this.setLadderClimbSfxPlaying(false);
  }

  handlePlayerDestroyed(): void {
    this.host.state.isCrouching = false;
    this.clearButtStompState();
    this.clearCrateInteractionState();
    this.host.state.weaponKnockbackVelocityX = 0;
    this.host.state.weaponKnockbackUntil = 0;
    this.setPlayerLadderState(null);
    this.resetWallMovementState();
    this.setLadderClimbSfxPlaying(false);
  }

  handleRespawnReset(): void {
    this.host.state.isCrouching = false;
    this.clearButtStompState();
    this.clearCrateInteractionState();
    this.host.state.weaponKnockbackVelocityX = 0;
    this.host.state.weaponKnockbackUntil = 0;
    this.setPlayerLadderState(null);
    this.resetWallMovementState();
    this.syncPlayerHitbox();
    this.setLadderClimbSfxPlaying(false);
  }

  resetTransientPlayState(): void {
    this.host.state.isCrouching = false;
    this.clearButtStompState();
    this.clearCrateInteractionState();
    this.resetWallMovementState();
    this.syncPlayerHitbox();
  }

  refreshPlayerHitbox(): void {
    this.syncPlayerHitbox();
  }

  clearLadderState(): void {
    this.setPlayerLadderState(null);
  }

  applyWeaponKnockback(velocityX: number): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return;
    }

    this.host.state.weaponKnockbackVelocityX = velocityX;
    this.host.state.weaponKnockbackUntil = this.host.getCurrentTime() + this.options.weaponKnockbackMs;
    playerBody.setVelocityX(velocityX);
  }

  handleButtStompImpact(bounceVelocity: number): void {
    const playerBody = this.host.getPlayerBody();
    this.clearButtStompState();
    this.host.state.isCrouching = false;
    if (!playerBody) {
      return;
    }

    playerBody.setVelocityY(Math.min(playerBody.velocity.y, bounceVelocity));
    this.syncPlayerHitbox(false);
  }

  updateMovement(delta: number, inQuicksand: boolean): OverworldMovementStepResult {
    const player = this.host.getPlayer();
    const playerBody = this.host.getPlayerBody();
    if (!player || !playerBody) {
      return {
        grounded: false,
        downHeld: false,
        horizontalInput: 0,
        verticalInput: 0,
        jumpPressed: false,
      };
    }

    const touchInput = getTouchInputState();
    const touchLeft = touchInput.active && touchInput.moveX <= -0.28;
    const touchRight = touchInput.active && touchInput.moveX >= 0.28;
    const touchUp = touchInput.active && touchInput.moveY <= -0.42;
    const touchDown = touchInput.active && touchInput.moveY >= 0.42;
    const cursors = this.host.getCursors();
    const wasd = this.host.getWasd();
    const left = cursors.left.isDown || wasd.A.isDown || touchLeft;
    const right = cursors.right.isDown || wasd.D.isDown || touchRight;
    const horizontalInput = (right ? 1 : 0) - (left ? 1 : 0);
    const touchJumpPressed = consumeTouchAction('jump');
    const overlappingLadder = this.host.findOverlappingLadder();
    const touchClimbUpHeld = overlappingLadder !== null && touchUp;
    const upHeld = cursors.up.isDown || wasd.W.isDown || touchClimbUpHeld;
    const downHeld = cursors.down.isDown || wasd.S.isDown || touchDown;
    const verticalInput = (downHeld ? 1 : 0) - (upHeld ? 1 : 0);
    const upPressed =
      Phaser.Input.Keyboard.JustDown(cursors.up) ||
      Phaser.Input.Keyboard.JustDown(wasd.W);
    const downPressed =
      Phaser.Input.Keyboard.JustDown(cursors.down) ||
      Phaser.Input.Keyboard.JustDown(wasd.S);
    const leftPressed =
      Phaser.Input.Keyboard.JustDown(cursors.left) ||
      Phaser.Input.Keyboard.JustDown(wasd.A);
    const rightPressed =
      Phaser.Input.Keyboard.JustDown(cursors.right) ||
      Phaser.Input.Keyboard.JustDown(wasd.D);
    const spacePressed =
      Phaser.Input.Keyboard.JustDown(cursors.space!) ||
      touchJumpPressed;
    const spaceHeld = cursors.space!.isDown || touchInput.jumpHeld;
    const stayOnLadder =
      overlappingLadder !== null &&
      !spacePressed &&
      (verticalInput !== 0 || (this.host.state.isClimbingLadder && !left && !right));
    const jumpedOffLadder = this.host.state.isClimbingLadder && spacePressed;
    const specialEnvironment = this.host.getSpecialTileEnvironment();
    const playerGravityDirection = specialEnvironment.gravityDirection;
    playerBody.setAllowGravity(playerGravityDirection === 'down');

    if (playerGravityDirection !== 'down') {
      this.clearButtStompState();
      const directionalControls = this.resolveDirectionalGravityControls(playerGravityDirection, {
        horizontalInput,
        verticalInput,
        left,
        right,
        upHeld,
        downHeld,
        upPressed,
        downPressed,
        leftPressed,
        rightPressed,
        spacePressed,
        spaceHeld,
        touchLeft,
        touchRight,
        touchUp,
        touchDown,
      });
      return this.updateDirectionalGravityMovement({
        delta,
        inQuicksand,
        player,
        playerBody,
        specialEnvironment,
        controls: directionalControls,
      });
    }

    if (stayOnLadder && overlappingLadder) {
      this.setPlayerLadderState(overlappingLadder);
      const ladderDeltaX = overlappingLadder.sprite.x - (player.x ?? playerBody.center.x);
      playerBody.setVelocityX(Phaser.Math.Clamp(ladderDeltaX * 12, -45, 45));
      playerBody.setVelocityY(verticalInput * this.options.ladderClimbSpeed);
      this.host.state.coyoteTime = 0;
      this.host.state.jumpBuffered = false;
      this.host.state.jumpBufferTime = 0;
      this.host.state.isCrouching = false;
      this.clearButtStompState();
      this.clearCrateInteractionState();
      this.resetWallMovementState();
      this.syncPlayerHitbox();
      return {
        grounded: false,
        downHeld,
        horizontalInput,
        verticalInput,
        jumpPressed: spacePressed || upPressed,
      };
    }

    if (this.host.state.isClimbingLadder) {
      this.setPlayerLadderState(null);
    }

    let grounded =
      playerBody.blocked.down ||
      playerBody.touching.down ||
      this.isSupportedBySolidRuntimeObject(playerBody);
    if (
      this.shouldApplySingleTileGapAssist(horizontalInput, downHeld, spacePressed, inQuicksand, grounded) &&
      this.tryApplySingleTileGapAssist(horizontalInput, grounded)
    ) {
      grounded = true;
    }
    if (grounded) {
      this.clearButtStompState({ keepImpactGrace: true });
    } else if (specialEnvironment.inWater || inQuicksand) {
      this.clearButtStompState();
    } else if (
      !this.host.state.isButtStomping &&
      !this.host.state.isClimbingLadder &&
      (downPressed || touchDown)
    ) {
      this.startButtStomp(playerBody);
    }

    const crateInteraction =
      !inQuicksand && (grounded || specialEnvironment.inWater) && horizontalInput !== 0
        ? this.findCrateInteraction(horizontalInput, downHeld, specialEnvironment.gravityDirection)
        : null;
    this.syncCrateInteractionState(crateInteraction);
    const standingHitboxFits =
      !grounded ||
      playerBody.height >= this.options.playerStandingHeight ||
      this.canPlayerFitHitbox(this.options.playerStandingHeight);
    const wantsCrouch = grounded && downHeld && !crateInteraction;
    this.host.state.isCrouching =
      wantsCrouch ||
      (grounded && !standingHitboxFits) ||
      (this.host.state.isCrouching && !standingHitboxFits);
    this.syncPlayerHitbox(grounded && playerBody.velocity.y >= 0);
    const canWallAttach =
      !grounded &&
      crateInteraction === null &&
      !this.host.state.isCrouching &&
      !this.host.state.isButtStomping;
    this.updateWallMovementState(horizontalInput, grounded, canWallAttach);
    if (grounded) {
      this.host.state.coyoteTime = this.options.coyoteMs;
    } else {
      this.host.state.coyoteTime = Math.max(0, this.host.state.coyoteTime - delta);
    }

    const buttStompInFlipPause = this.isButtStompInFlipPause();
    if (crateInteraction) {
      const moveSpeed =
        crateInteraction.mode === 'push' ? this.options.cratePushSpeed : this.options.cratePullSpeed;
      this.applyCrateInteraction(playerBody, crateInteraction, moveSpeed, delta);
    } else {
      if (buttStompInFlipPause) {
        playerBody.setVelocityX(0);
      } else if (this.host.getCurrentTime() < this.host.state.weaponKnockbackUntil) {
        playerBody.setVelocityX(this.host.state.weaponKnockbackVelocityX);
      } else if (
        this.host.getCurrentTime() < this.host.state.wallJumpLockUntil &&
        this.host.state.wallJumpDirection !== 0
      ) {
        playerBody.setVelocityX(this.host.state.wallJumpDirection * this.options.wallJumpVelocityX);
      } else {
        this.host.state.weaponKnockbackVelocityX = 0;
        const moveSpeedBase = this.host.state.isCrouching ? this.options.crawlSpeed : this.options.playerSpeed;
        const moveSpeed =
          inQuicksand
            ? moveSpeedBase * this.options.quicksandMoveFactor
            : specialEnvironment.inWater
              ? moveSpeedBase * WATER_MOVE_FACTOR
              : specialEnvironment.onSticky
                ? moveSpeedBase * STICKY_MOVE_FACTOR
                : moveSpeedBase;
        if (specialEnvironment.onIce && grounded && !left && !right) {
          playerBody.setVelocityX(playerBody.velocity.x * ICE_COAST_FACTOR);
        } else if (specialEnvironment.onIce && grounded && (left || right)) {
          const targetVelocityX = left ? -moveSpeed : moveSpeed;
          const deltaSeconds = Math.max(delta / 1000, 1 / 60);
          playerBody.setVelocityX(
            Phaser.Math.Linear(
              playerBody.velocity.x,
              targetVelocityX,
              Phaser.Math.Clamp(ICE_ACCELERATION * deltaSeconds / Math.max(1, moveSpeed), 0, 1),
            ),
          );
        } else if (left) {
          playerBody.setVelocityX(-moveSpeed);
        } else if (right) {
          playerBody.setVelocityX(moveSpeed);
        } else {
          playerBody.setVelocityX(0);
        }
      }
    }

    const jumpPressed =
      !this.host.state.isCrouching &&
      !this.host.state.isButtStomping &&
      (spacePressed || (upPressed && overlappingLadder === null));
    const specialJumpVelocity =
      specialEnvironment.inWater
        ? WATER_SWIM_KICK_VELOCITY
        : inQuicksand
          ? this.options.jumpVelocity * this.options.quicksandJumpFactor
          : specialEnvironment.onSticky
            ? this.options.jumpVelocity * STICKY_JUMP_FACTOR
            : this.options.jumpVelocity;

    if (jumpedOffLadder) {
      playerBody.setVelocityY(specialJumpVelocity);
      this.host.playJumpDustFx(player.x ?? playerBody.center.x, playerBody.bottom, this.host.getPlayerFacing());
      this.host.state.jumpBuffered = false;
      this.host.state.jumpBufferTime = 0;
      this.host.state.coyoteTime = 0;
      this.resetWallMovementState();
    } else {
      if (jumpPressed) {
        if (specialEnvironment.inWater) {
          playerBody.setVelocityY(WATER_SWIM_KICK_VELOCITY);
          this.host.playJumpDustFx(player.x ?? playerBody.center.x, playerBody.bottom, this.host.getPlayerFacing());
          this.host.state.jumpBuffered = false;
          this.host.state.jumpBufferTime = 0;
          this.host.state.coyoteTime = 0;
        } else if (!this.tryPerformWallJump(player, playerBody)) {
          this.host.state.jumpBuffered = true;
          this.host.state.jumpBufferTime =
            !grounded && this.host.state.coyoteTime <= 0
              ? this.options.wallJumpBufferMs
              : this.options.jumpBufferMs;
        }
      }

      if (this.host.state.jumpBuffered && this.tryPerformWallJump(player, playerBody)) {
        // Wall-jump buffering lets the player press jump just before reaching the next wall.
      } else if (this.host.state.jumpBuffered && this.host.state.coyoteTime > 0) {
        playerBody.setVelocityY(specialJumpVelocity);
        this.host.playJumpDustFx(player.x ?? playerBody.center.x, playerBody.bottom, this.host.getPlayerFacing());
        this.host.state.jumpBuffered = false;
        this.host.state.jumpBufferTime = 0;
        this.host.state.coyoteTime = 0;
        this.host.state.wallJumpActive = false;
        this.host.state.wallJumpDirection = 0;
        this.host.state.wallJumpLockUntil = 0;
        this.clearWallContactState();
        this.host.state.wallJumpChainActive = false;
      }

      if (this.host.state.jumpBufferTime > 0) {
        this.host.state.jumpBufferTime -= delta;
        if (this.host.state.jumpBufferTime <= 0) {
          this.host.state.jumpBuffered = false;
        }
      }

      const jumpHeld = upHeld || cursors.space!.isDown || touchInput.jumpHeld;
      if (
        !jumpHeld &&
        playerBody.velocity.y < 0 &&
        this.host.getCurrentTime() >= this.host.getExternalLaunchGraceUntil()
      ) {
        playerBody.setVelocityY(playerBody.velocity.y * (inQuicksand ? 0.84 : 0.85));
      }
    }

    if (
      this.host.state.isWallSliding &&
      playerBody.velocity.y > this.options.wallSlideMaxFallSpeed
    ) {
      playerBody.setVelocityY(this.options.wallSlideMaxFallSpeed);
    }
    if (this.host.state.isButtStomping) {
      this.updateButtStompVelocity(playerBody);
    }

    if (inQuicksand && grounded) {
      playerBody.setVelocityY(Math.max(playerBody.velocity.y, 4));
    }
    if (specialEnvironment.inWater) {
      playerBody.setVelocityY(Math.min(playerBody.velocity.y, WATER_MAX_GRAVITY_SPEED));
    }
    if (grounded && specialEnvironment.conveyorX !== 0) {
      playerBody.setVelocityX(playerBody.velocity.x + specialEnvironment.conveyorX * CONVEYOR_SPEED);
    }
    if (specialEnvironment.windX !== 0) {
      const windDelta = specialEnvironment.windX * WIND_PUSH_ACCELERATION * Math.max(delta / 1000, 1 / 60);
      playerBody.setVelocityX(
        Phaser.Math.Clamp(playerBody.velocity.x + windDelta, -WIND_MAX_SPEED, WIND_MAX_SPEED),
      );
    }

    this.syncPlayerHitbox(grounded && playerBody.velocity.y >= 0);

    return {
      grounded,
      downHeld,
      horizontalInput,
      verticalInput,
      jumpPressed: spacePressed || upPressed,
    };
  }

  private updateDirectionalGravityMovement(input: {
    delta: number;
    inQuicksand: boolean;
    player: Phaser.GameObjects.Rectangle;
    playerBody: Phaser.Physics.Arcade.Body;
    specialEnvironment: SpecialTilePlayerEnvironment;
    controls: DirectionalGravityControls;
  }): OverworldMovementStepResult {
    const {
      delta,
      inQuicksand,
      player,
      playerBody,
      specialEnvironment,
      controls,
    } = input;
    const gravityDirection = specialEnvironment.gravityDirection;
    const gravityVector = getGravityVector(gravityDirection);
    const rightVector = getGravityRightVector(gravityDirection);
    const deltaSeconds = Math.max(delta / 1000, 1 / 60);

    this.setPlayerLadderState(null);
    this.host.state.isCrouching = false;
    this.clearButtStompState();
    this.clearCrateInteractionState();
    this.syncPlayerHitbox();

    const gravityScale = specialEnvironment.inWater ? WATER_GRAVITY_FACTOR : 1;
    const gravityVelocity = getBodyVelocityAlongVector(playerBody, gravityVector);
    const maxGravitySpeed = specialEnvironment.inWater ? WATER_MAX_GRAVITY_SPEED : 500;
    setBodyVelocityAlongVector(
      playerBody,
      gravityVector,
      Phaser.Math.Clamp(
        gravityVelocity + this.options.jumpVelocity * -1 * gravityScale * deltaSeconds * 2.5,
        -500,
        maxGravitySpeed,
      ),
    );

    const grounded = bodyIsBlockedInGravityDirection(playerBody, gravityDirection);
    if (grounded) {
      this.host.state.coyoteTime = this.options.coyoteMs;
    } else {
      this.host.state.coyoteTime = Math.max(0, this.host.state.coyoteTime - delta);
    }

    const crateInteraction =
      !inQuicksand && (grounded || specialEnvironment.inWater) && controls.tangentInput !== 0
        ? this.findCrateInteraction(controls.tangentInput, controls.crouchHeld, gravityDirection)
        : null;
    this.syncCrateInteractionState(crateInteraction);
    this.host.state.isCrouching = grounded && controls.crouchHeld && !crateInteraction;
    this.syncPlayerHitbox();
    const canWallAttach =
      !grounded &&
      crateInteraction === null &&
      !this.host.state.isCrouching &&
      !specialEnvironment.inWater;
    this.updateWallMovementState(controls.tangentInput, grounded, canWallAttach, gravityDirection);

    const moveSpeedBase = this.host.state.isCrouching
      ? this.options.crawlSpeed
      : specialEnvironment.inWater
      ? this.options.playerSpeed * WATER_MOVE_FACTOR
      : specialEnvironment.onSticky
        ? this.options.playerSpeed * STICKY_MOVE_FACTOR
        : this.options.playerSpeed;
    if (crateInteraction) {
      const moveSpeed =
        crateInteraction.mode === 'push' ? this.options.cratePushSpeed : this.options.cratePullSpeed;
      this.applyCrateInteraction(playerBody, crateInteraction, moveSpeed, delta);
    } else {
      if (
        this.host.getCurrentTime() < this.host.state.wallJumpLockUntil &&
        this.host.state.wallJumpDirection !== 0
      ) {
        setBodyVelocityAlongVector(
          playerBody,
          rightVector,
          this.host.state.wallJumpDirection * this.options.wallJumpVelocityX,
        );
      } else {
        const targetTangentVelocity = controls.tangentInput * moveSpeedBase;
        const currentTangentVelocity = getBodyVelocityAlongVector(playerBody, rightVector);
        if (specialEnvironment.onIce && grounded) {
          const nextTangentVelocity =
            controls.tangentInput === 0
              ? currentTangentVelocity * ICE_COAST_FACTOR
              : Phaser.Math.Linear(
                  currentTangentVelocity,
                  targetTangentVelocity,
                  Phaser.Math.Clamp(ICE_ACCELERATION * deltaSeconds / Math.max(1, moveSpeedBase), 0, 1),
                );
          setBodyVelocityAlongVector(playerBody, rightVector, nextTangentVelocity);
        } else {
          setBodyVelocityAlongVector(playerBody, rightVector, targetTangentVelocity);
        }
      }
    }

    const jumpPressed = !this.host.state.isCrouching && controls.jumpPressed;
    const performGravityJump = () => {
      const launchVelocity =
        specialEnvironment.inWater
          ? WATER_SWIM_KICK_VELOCITY
          : specialEnvironment.onSticky
            ? this.options.jumpVelocity * STICKY_JUMP_FACTOR
            : this.options.jumpVelocity;
      setBodyVelocityAlongVector(playerBody, gravityVector, launchVelocity);
      this.host.playJumpDustFx(player.x ?? playerBody.center.x, playerBody.bottom, this.host.getPlayerFacing());
      this.host.state.jumpBuffered = false;
      this.host.state.jumpBufferTime = 0;
      this.host.state.coyoteTime = 0;
      this.host.state.wallJumpActive = false;
      this.host.state.wallJumpDirection = 0;
      this.host.state.wallJumpLockUntil = 0;
      this.clearWallContactState();
      this.host.state.wallJumpChainActive = false;
    };

    if (jumpPressed) {
      if (specialEnvironment.inWater) {
        performGravityJump();
      } else if (!this.tryPerformWallJump(player, playerBody, gravityDirection)) {
        this.host.state.jumpBuffered = true;
        this.host.state.jumpBufferTime =
          !grounded && this.host.state.coyoteTime <= 0
            ? this.options.wallJumpBufferMs
            : this.options.jumpBufferMs;
      }
    }

    if (
      this.host.state.jumpBuffered &&
      !specialEnvironment.inWater &&
      this.tryPerformWallJump(player, playerBody, gravityDirection)
    ) {
      // Wall-jump buffering lets the player press jump just before reaching the next wall.
    } else if (this.host.state.jumpBuffered && this.host.state.coyoteTime > 0) {
      performGravityJump();
    }

    if (this.host.state.jumpBufferTime > 0) {
      this.host.state.jumpBufferTime -= delta;
      if (this.host.state.jumpBufferTime <= 0) {
        this.host.state.jumpBuffered = false;
      }
    }

    const currentNormalVelocity = getBodyVelocityAlongVector(playerBody, gravityVector);
    if (
      !controls.jumpHeld &&
      currentNormalVelocity < 0 &&
      this.host.getCurrentTime() >= this.host.getExternalLaunchGraceUntil()
    ) {
      setBodyVelocityAlongVector(playerBody, gravityVector, currentNormalVelocity * 0.86);
    }

    if (this.host.state.isWallSliding) {
      const wallSlideGravityVelocity = getBodyVelocityAlongVector(playerBody, gravityVector);
      if (wallSlideGravityVelocity > this.options.wallSlideMaxFallSpeed) {
        setBodyVelocityAlongVector(
          playerBody,
          gravityVector,
          this.options.wallSlideMaxFallSpeed,
        );
      }
    }

    if (grounded && specialEnvironment.conveyorX !== 0) {
      playerBody.setVelocityX(playerBody.velocity.x + specialEnvironment.conveyorX * CONVEYOR_SPEED);
    }
    if (specialEnvironment.windX !== 0) {
      const windDelta = specialEnvironment.windX * WIND_PUSH_ACCELERATION * deltaSeconds;
      playerBody.setVelocityX(
        Phaser.Math.Clamp(playerBody.velocity.x + windDelta, -WIND_MAX_SPEED, WIND_MAX_SPEED),
      );
    }

    this.syncPlayerHitbox();

    return {
      grounded,
      downHeld: controls.crouchHeld,
      horizontalInput: controls.horizontalInput,
      verticalInput: controls.verticalInput,
      jumpPressed: controls.jumpPressed,
    };
  }

  private resolveDirectionalGravityControls(
    gravityDirection: PlayerGravityDirection,
    input: {
      horizontalInput: number;
      verticalInput: number;
      left: boolean;
      right: boolean;
      upHeld: boolean;
      downHeld: boolean;
      upPressed: boolean;
      downPressed: boolean;
      leftPressed: boolean;
      rightPressed: boolean;
      spacePressed: boolean;
      spaceHeld: boolean;
      touchLeft: boolean;
      touchRight: boolean;
      touchUp: boolean;
      touchDown: boolean;
    },
  ): DirectionalGravityControls {
    switch (gravityDirection) {
      case 'up':
        return {
          tangentInput: -input.horizontalInput,
          crouchHeld: input.upHeld,
          jumpPressed: input.spacePressed || input.downPressed || input.touchDown,
          jumpHeld: input.spaceHeld || input.downHeld,
          horizontalInput: input.horizontalInput,
          verticalInput: input.verticalInput,
        };
      case 'left':
        return {
          tangentInput: -input.verticalInput,
          crouchHeld: input.left,
          jumpPressed: input.spacePressed || input.rightPressed || input.touchRight,
          jumpHeld: input.spaceHeld || input.right,
          horizontalInput: -input.verticalInput,
          verticalInput: input.verticalInput,
        };
      case 'right':
        return {
          tangentInput: input.verticalInput,
          crouchHeld: input.right,
          jumpPressed: input.spacePressed || input.leftPressed || input.touchLeft,
          jumpHeld: input.spaceHeld || input.left,
          horizontalInput: input.verticalInput,
          verticalInput: input.verticalInput,
        };
      case 'down':
      default:
        return {
          tangentInput: input.horizontalInput,
          crouchHeld: input.downHeld,
          jumpPressed: input.spacePressed || input.upPressed || input.touchUp,
          jumpHeld: input.spaceHeld || input.upHeld,
          horizontalInput: input.horizontalInput,
          verticalInput: input.verticalInput,
        };
    }
  }

  syncLadderClimbSfx(verticalInput: number): void {
    const playerBody = this.host.getPlayerBody();
    const shouldPlay =
      Boolean(playerBody) &&
      this.host.state.isClimbingLadder &&
      verticalInput !== 0 &&
      Math.abs(playerBody?.velocity.y ?? 0) > 6;
    this.setLadderClimbSfxPlaying(shouldPlay);
  }

  private resetWallMovementState(): void {
    this.clearWallContactState();
    this.host.state.wallJumpLockUntil = 0;
    this.host.state.wallJumpActive = false;
    this.host.state.wallJumpDirection = 0;
    this.host.state.wallJumpChainActive = false;
  }

  private clearButtStompState(options: { keepImpactGrace?: boolean } = {}): void {
    const wasButtStomping = this.host.state.isButtStomping;
    this.host.state.isButtStomping = false;
    this.host.state.buttStompFlipUntil = 0;
    if (options.keepImpactGrace && wasButtStomping) {
      this.host.state.buttStompImpactGraceUntil =
        this.host.getCurrentTime() + BUTT_STOMP_IMPACT_GRACE_MS;
    } else if (!options.keepImpactGrace) {
      this.host.state.buttStompImpactGraceUntil = 0;
    }
  }

  private startButtStomp(playerBody: Phaser.Physics.Arcade.Body): void {
    this.host.state.isButtStomping = true;
    this.host.state.buttStompFlipUntil = this.host.getCurrentTime() + BUTT_STOMP_FLIP_MS;
    this.host.state.buttStompImpactGraceUntil = 0;
    this.host.state.jumpBuffered = false;
    this.host.state.jumpBufferTime = 0;
    this.host.state.coyoteTime = 0;
    this.host.state.isCrouching = false;
    this.clearCrateInteractionState();
    this.resetWallMovementState();
    this.updateButtStompVelocity(playerBody);
  }

  private isButtStompInFlipPause(now = this.host.getCurrentTime()): boolean {
    return this.host.state.isButtStomping && now < this.host.state.buttStompFlipUntil;
  }

  private updateButtStompVelocity(playerBody: Phaser.Physics.Arcade.Body): void {
    if (this.isButtStompInFlipPause()) {
      playerBody.setAllowGravity(false);
      playerBody.setVelocityY(0);
      return;
    }

    playerBody.setAllowGravity(true);
    this.applyButtStompVelocity(playerBody);
  }

  private applyButtStompVelocity(playerBody: Phaser.Physics.Arcade.Body): void {
    if (playerBody.velocity.y < BUTT_STOMP_FALL_SPEED) {
      playerBody.setVelocityY(BUTT_STOMP_FALL_SPEED);
    }
  }

  private clearWallContactState(): void {
    this.host.state.wallContactSide = 0;
    this.host.state.wallContactGraceSide = 0;
    this.host.state.wallContactGraceUntil = 0;
    this.host.state.isWallSliding = false;
  }

  private tryPerformWallJump(
    player: Phaser.GameObjects.Rectangle,
    playerBody: Phaser.Physics.Arcade.Body,
    gravityDirection: PlayerGravityDirection = 'down',
  ): boolean {
    const wallJumpSourceSide = this.host.state.wallContactSide;
    if (wallJumpSourceSide === 0) {
      return false;
    }

    const wallJumpDirection = (wallJumpSourceSide === -1 ? 1 : -1) as -1 | 1;
    setBodyVelocityAlongVector(
      playerBody,
      getGravityRightVector(gravityDirection),
      wallJumpDirection * this.options.wallJumpVelocityX,
    );
    setBodyVelocityAlongVector(
      playerBody,
      getGravityVector(gravityDirection),
      this.options.wallJumpVelocityY,
    );
    this.host.playJumpDustFx(
      player.x ?? playerBody.center.x,
      playerBody.bottom,
      this.host.getPlayerFacing(),
    );
    this.host.state.jumpBuffered = false;
    this.host.state.jumpBufferTime = 0;
    this.host.state.coyoteTime = 0;
    this.clearWallContactState();
    this.host.state.wallJumpLockUntil =
      this.host.getCurrentTime() + this.options.wallJumpInputLockMs;
    this.host.state.wallJumpActive = true;
    this.host.state.wallJumpDirection = wallJumpDirection;
    this.host.state.wallJumpChainActive = true;
    return true;
  }

  private getTouchingWallSide(gravityDirection: PlayerGravityDirection = 'down'): -1 | 1 | 0 {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return 0;
    }

    const rightVector = getGravityRightVector(gravityDirection);
    if (rightVector.x !== 0) {
      const touchingLeft = playerBody.blocked.left || playerBody.touching.left;
      const touchingRight = playerBody.blocked.right || playerBody.touching.right;
      if (touchingLeft === touchingRight) {
        return 0;
      }

      return touchingLeft ? (-rightVector.x as -1 | 1) : (rightVector.x as -1 | 1);
    }

    const touchingUp = playerBody.blocked.up || playerBody.touching.up;
    const touchingDown = playerBody.blocked.down || playerBody.touching.down;
    if (touchingUp === touchingDown) {
      return 0;
    }

    return touchingUp ? (-rightVector.y as -1 | 1) : (rightVector.y as -1 | 1);
  }

  private getWallContactSide(
    horizontalInput: number,
    gravityDirection: PlayerGravityDirection = 'down',
  ): -1 | 1 | 0 {
    const touchingWallSide = this.getTouchingWallSide(gravityDirection);
    if (touchingWallSide === 0) {
      return 0;
    }

    if (horizontalInput < 0 && touchingWallSide === -1) {
      return -1;
    }
    if (horizontalInput > 0 && touchingWallSide === 1) {
      return 1;
    }
    if (horizontalInput === 0) {
      return touchingWallSide;
    }
    if (this.host.state.wallJumpChainActive) {
      return touchingWallSide;
    }

    return 0;
  }

  private updateWallMovementState(
    horizontalInput: number,
    grounded: boolean,
    canWallAttach: boolean,
    gravityDirection: PlayerGravityDirection = 'down',
  ): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody || grounded || this.host.state.isClimbingLadder) {
      this.resetWallMovementState();
      return;
    }

    const gravityVelocity = getBodyVelocityAlongVector(
      playerBody,
      getGravityVector(gravityDirection),
    );
    if (this.host.state.wallJumpActive && gravityVelocity >= 0) {
      this.host.state.wallJumpActive = false;
      this.host.state.wallJumpDirection = 0;
    }

    const rawWallContactSide = canWallAttach
      ? this.getWallContactSide(horizontalInput, gravityDirection)
      : 0;
    const now = this.host.getCurrentTime();
    if (rawWallContactSide !== 0) {
      this.host.state.wallContactGraceSide = rawWallContactSide;
      this.host.state.wallContactGraceUntil = now + this.options.wallContactGraceMs;
    }

    const hasWallContactGrace =
      this.host.state.wallContactGraceSide !== 0 &&
      now <= this.host.state.wallContactGraceUntil;
    const wallContactSide = rawWallContactSide !== 0
      ? rawWallContactSide
      : hasWallContactGrace
        ? this.host.state.wallContactGraceSide
        : 0;
    this.host.state.wallContactSide = wallContactSide;
    this.host.state.isWallSliding = rawWallContactSide !== 0 && gravityVelocity >= 0;

    if (this.host.state.isWallSliding) {
      this.host.state.wallJumpActive = false;
      this.host.state.wallJumpDirection = 0;
    } else if (!this.host.state.wallJumpActive && this.host.getCurrentTime() >= this.host.state.wallJumpLockUntil) {
      this.host.state.wallJumpDirection = 0;
    }
  }

  private setPlayerLadderState(ladder: LoadedRoomObject | null): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      this.host.state.isClimbingLadder = false;
      this.host.state.activeLadderKey = null;
      this.resetWallMovementState();
      this.setLadderClimbSfxPlaying(false);
      return;
    }

    const nextKey = ladder?.key ?? null;
    if (
      this.host.state.activeLadderKey === nextKey &&
      this.host.state.isClimbingLadder === Boolean(ladder)
    ) {
      return;
    }

    const enteringLadder = ladder !== null && !this.host.state.isClimbingLadder;
    this.host.state.isClimbingLadder = ladder !== null;
    this.host.state.activeLadderKey = nextKey;
    playerBody.setAllowGravity(!ladder);
    if (!ladder) {
      this.setLadderClimbSfxPlaying(false);
    } else {
      this.resetWallMovementState();
    }

    if (enteringLadder) {
      this.clearButtStompState();
      playerBody.setVelocityY(0);
    }
  }

  private syncPlayerHitbox(useGroundedProfile?: boolean): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return;
    }

    const groundedProfile =
      useGroundedProfile ??
      Boolean((playerBody.blocked.down || playerBody.touching.down) && playerBody.velocity.y >= 0);
    const nextHeight = this.getPlayerHitboxHeight(playerBody, groundedProfile);
    const previousBottom = playerBody.bottom;
    const nextIsPushProfile = this.isPushHitboxProfile(nextHeight, groundedProfile);
    const currentIsPushProfile = this.isCurrentPushHitboxProfile(playerBody);
    if (playerBody.width !== this.options.playerWidth || playerBody.height !== nextHeight) {
      playerBody.setSize(this.options.playerWidth, nextHeight, false);
      playerBody.setOffset(0, this.options.playerStandingHeight - nextHeight);
      if (nextIsPushProfile || currentIsPushProfile) {
        playerBody.y = previousBottom - nextHeight;
        playerBody.updateCenter();
      }
    }
    this.host.syncPlayerPickupSensor();
  }

  private isPushHitboxProfile(height: number, groundedProfile: boolean): boolean {
    return groundedProfile &&
      this.host.state.activeCrateInteractionMode === 'push' &&
      height === this.options.playerPushHeight;
  }

  private isCurrentPushHitboxProfile(playerBody: Phaser.Physics.Arcade.Body): boolean {
    return playerBody.height === this.options.playerPushHeight &&
      playerBody.offset.y === this.options.playerStandingHeight - this.options.playerPushHeight;
  }

  private getPlayerHitboxHeight(playerBody: Phaser.Physics.Arcade.Body, groundedProfile: boolean): number {
    if (this.host.state.isCrouching) {
      return this.options.playerCrouchHeight;
    }

    if (this.host.shouldForceFullBodyHitbox()) {
      return this.options.playerStandingHeight;
    }

    if (groundedProfile && this.host.state.activeCrateInteractionMode === 'push') {
      return this.options.playerPushHeight;
    }

    if (!groundedProfile) {
      return this.options.playerHeight;
    }

    return playerBody.height >= this.options.playerStandingHeight ||
      this.canPlayerFitHitbox(this.options.playerStandingHeight, playerBody)
      ? this.options.playerStandingHeight
      : this.options.playerHeight;
  }

  private clearCrateInteractionState(): void {
    this.host.state.activeCrateInteractionMode = null;
    this.host.state.activeCrateInteractionFacing = null;
  }

  private setLadderClimbSfxPlaying(playing: boolean): void {
    if (this.host.state.ladderClimbSfxPlaying === playing) {
      return;
    }

    this.host.state.ladderClimbSfxPlaying = playing;
    if (playing) {
      playSfx('ladder-climb');
      return;
    }

    stopSfx('ladder-climb');
  }

  private shouldApplySingleTileGapAssist(
    horizontalInput: number,
    downHeld: boolean,
    spacePressed: boolean,
    inQuicksand: boolean,
    grounded: boolean,
  ): boolean {
    return (
      horizontalInput !== 0 &&
      !downHeld &&
      !spacePressed &&
      !inQuicksand &&
      !this.host.state.isClimbingLadder &&
      (grounded || this.host.state.coyoteTime > 0)
    );
  }

  private tryApplySingleTileGapAssist(horizontalInput: number, grounded: boolean): boolean {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody || (!grounded && this.host.state.coyoteTime <= 0)) {
      return false;
    }

    if (playerBody.velocity.y < -1) {
      return false;
    }

    const direction = horizontalInput > 0 ? 1 : -1;
    const room = this.host.getRoomSnapshotForCoordinates(this.host.getCurrentRoomCoordinates());
    if (!room) {
      return false;
    }

    const origin = this.host.getRoomOrigin(room.coordinates);
    const localBottomY = playerBody.bottom - origin.y;
    const floorTileY = Math.floor((localBottomY + SINGLE_TILE_GAP_ASSIST_FOOT_PROBE_PX) / TILE_SIZE);
    if (floorTileY < 0 || floorTileY >= ROOM_HEIGHT) {
      return false;
    }

    const floorTopY = origin.y + floorTileY * TILE_SIZE;
    const dropDistance = playerBody.bottom - floorTopY;
    if (dropDistance < -1 || dropDistance > SINGLE_TILE_GAP_ASSIST_MAX_DROP_PX) {
      return false;
    }

    const minTileX = Math.floor(
      (playerBody.left - origin.x - SINGLE_TILE_GAP_ASSIST_HORIZONTAL_PAD_PX) / TILE_SIZE,
    );
    const maxTileX = Math.floor(
      (playerBody.right - origin.x + SINGLE_TILE_GAP_ASSIST_HORIZONTAL_PAD_PX) / TILE_SIZE,
    );
    for (let gapTileX = minTileX; gapTileX <= maxTileX; gapTileX += 1) {
      if (!this.isOneTileTerrainGap(room, origin, gapTileX, floorTileY, direction, floorTopY)) {
        continue;
      }

      this.snapPlayerToGapAssistFloor(playerBody, floorTopY);
      return true;
    }

    return false;
  }

  private isOneTileTerrainGap(
    room: RoomSnapshot,
    origin: { x: number; y: number },
    gapTileX: number,
    floorTileY: number,
    direction: -1 | 1,
    floorTopY: number,
  ): boolean {
    const behindTileX = gapTileX - direction;
    const landingTileX = gapTileX + direction;
    if (
      gapTileX < 0 ||
      gapTileX >= ROOM_WIDTH ||
      behindTileX < 0 ||
      behindTileX >= ROOM_WIDTH ||
      landingTileX < 0 ||
      landingTileX >= ROOM_WIDTH
    ) {
      return false;
    }

    return (
      !this.isSolidTerrainTileAtFoot(room, origin, gapTileX, floorTileY, floorTopY) &&
      this.isSolidTerrainTileAtFoot(room, origin, behindTileX, floorTileY, floorTopY) &&
      this.isSolidTerrainTileAtFoot(room, origin, landingTileX, floorTileY, floorTopY)
    );
  }

  private isSolidTerrainTileAtFoot(
    room: RoomSnapshot,
    origin: { x: number; y: number },
    tileX: number,
    tileY: number,
    floorTopY: number,
  ): boolean {
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      return false;
    }

    const worldX = origin.x + tileX * TILE_SIZE + TILE_SIZE / 2;
    return this.host.isSolidTerrainAtWorldPoint(
      room,
      worldX,
      floorTopY + SINGLE_TILE_GAP_ASSIST_FOOT_PROBE_PX,
    );
  }

  private snapPlayerToGapAssistFloor(
    playerBody: Phaser.Physics.Arcade.Body,
    floorTopY: number,
  ): void {
    const velocityX = playerBody.velocity.x;
    if (Math.abs(playerBody.bottom - floorTopY) > 0.01) {
      playerBody.reset(playerBody.center.x, floorTopY - playerBody.height / 2);
      playerBody.setVelocityX(velocityX);
    }
    if (playerBody.velocity.y > 0) {
      playerBody.setVelocityY(0);
    }
  }

  private applyCrateInteraction(
    playerBody: Phaser.Physics.Arcade.Body,
    crateInteraction: OverworldCrateInteraction,
    moveSpeed: number,
    delta: number,
  ): void {
    const tangentVector = getGravityRightVector(crateInteraction.gravityDirection);
    setBodyVelocityAlongVector(
      playerBody,
      tangentVector,
      crateInteraction.moveDirectionX * moveSpeed,
    );
    setBodyVelocityAlongVector(
      crateInteraction.crateBody,
      tangentVector,
      this.getCrateInteractionTangentVelocity(crateInteraction, moveSpeed, delta),
    );
  }

  private getCrateInteractionTangentVelocity(
    crateInteraction: OverworldCrateInteraction,
    moveSpeed: number,
    delta: number,
  ): number {
    if (crateInteraction.mode !== 'pull') {
      return crateInteraction.moveDirectionX * moveSpeed;
    }

    // Pulling does not have push contact to keep the crate coupled, so offset its drag for the next physics step.
    const tangentVector = getGravityRightVector(crateInteraction.gravityDirection);
    const tangentDrag = tangentVector.x !== 0
      ? crateInteraction.crateBody.drag.x
      : crateInteraction.crateBody.drag.y;
    const dragCompensation =
      Math.max(0, tangentDrag) *
      Math.min(Math.max(delta, 0), 50) /
      1000 *
      CRATE_PULL_DRAG_COMPENSATION_SCALE;
    return crateInteraction.moveDirectionX * (moveSpeed + dragCompensation);
  }

  private syncCrateInteractionState(crateInteraction: OverworldCrateInteraction | null): void {
    if (!crateInteraction) {
      this.clearCrateInteractionState();
      return;
    }

    this.host.state.activeCrateInteractionMode = crateInteraction.mode;
    this.host.state.activeCrateInteractionFacing = crateInteraction.facing;
  }

  private bodyBoundsCouldOverlap(
    body: ArcadeObjectBody,
    bounds: Phaser.Geom.Rectangle,
    paddingX = 0,
    paddingY = paddingX,
  ): boolean {
    return (
      body.right >= bounds.left - paddingX &&
      body.left <= bounds.right + paddingX &&
      body.bottom >= bounds.top - paddingY &&
      body.top <= bounds.bottom + paddingY
    );
  }

  private canPlayerFitHitbox(height: number, playerBody = this.host.getPlayerBody()): boolean {
    if (!playerBody) {
      return true;
    }

    const room = this.host.getRoomSnapshotForCoordinates(this.host.getCurrentRoomCoordinates());
    const nextTop = playerBody.bottom - height;
    const currentTop = playerBody.bottom - playerBody.height;
    const candidateBounds = new Phaser.Geom.Rectangle(
      playerBody.center.x - this.options.playerWidth * 0.5,
      nextTop,
      this.options.playerWidth,
      height,
    );
    const addedHeadroomBounds = new Phaser.Geom.Rectangle(
      candidateBounds.left + 1,
      nextTop,
      Math.max(0, candidateBounds.width - 2),
      Math.max(0, currentTop - nextTop),
    );

    if (room) {
      const sampleXs = [candidateBounds.centerX, candidateBounds.left + 1, candidateBounds.right - 1];
      if (sampleXs.some((sampleX) => this.host.isSolidTerrainAtWorldPoint(room, sampleX, nextTop + 1))) {
        return false;
      }
    }

    if (addedHeadroomBounds.width <= 0 || addedHeadroomBounds.height <= 0) {
      return true;
    }

    for (const liveObject of this.host.getRuntimeSolidLiveObjectsInBounds(addedHeadroomBounds)) {
      const objectBody = this.getEnabledSolidRuntimeObjectBody(liveObject);
      if (!objectBody || !this.bodyBoundsCouldOverlap(objectBody, addedHeadroomBounds)) {
        continue;
      }

      const objectBounds = this.host.getArcadeBodyBounds(objectBody);
      if (
        addedHeadroomBounds.width > 0 &&
        addedHeadroomBounds.height > 0 &&
        this.rectanglesStrictlyOverlap(addedHeadroomBounds, objectBounds)
      ) {
        return false;
      }
    }

    return true;
  }

  private getEnabledSolidRuntimeObjectBody(liveObject: LoadedRoomObject): ArcadeObjectBody | null {
    if (
      !liveObjectBlocksPlayerMovement(liveObject) ||
      !liveObject.sprite.active ||
      !liveObject.sprite.body
    ) {
      return null;
    }

    const body = liveObject.sprite.body as ArcadeObjectBody;
    return body.enable ? body : null;
  }

  private isSupportedBySolidRuntimeObject(playerBody: Phaser.Physics.Arcade.Body): boolean {
    if (playerBody.velocity.y < RUNTIME_OBJECT_SUPPORT_MAX_UPWARD_SPEED) {
      return false;
    }

    const playerBounds = this.host.getArcadeBodyBounds(playerBody);
    const playerLeft = playerBounds.left + RUNTIME_OBJECT_SUPPORT_EDGE_INSET_PX;
    const playerRight = playerBounds.right - RUNTIME_OBJECT_SUPPORT_EDGE_INSET_PX;

    for (const liveObject of this.host.getRuntimeSolidLiveObjectsInBounds(
      playerBounds,
      RUNTIME_OBJECT_SUPPORT_EDGE_INSET_PX,
      Math.max(
        RUNTIME_OBJECT_SUPPORT_HOVER_TOLERANCE_PX,
        RUNTIME_OBJECT_SUPPORT_PENETRATION_TOLERANCE_PX,
      ),
    )) {
      const objectBody = this.getEnabledSolidRuntimeObjectBody(liveObject);
      if (!objectBody) {
        continue;
      }

      if (
        objectBody.right <= playerLeft + RUNTIME_OBJECT_SUPPORT_EDGE_INSET_PX ||
        objectBody.left >= playerRight - RUNTIME_OBJECT_SUPPORT_EDGE_INSET_PX ||
        objectBody.top < playerBounds.bottom - RUNTIME_OBJECT_SUPPORT_PENETRATION_TOLERANCE_PX ||
        objectBody.top > playerBounds.bottom + RUNTIME_OBJECT_SUPPORT_HOVER_TOLERANCE_PX
      ) {
        continue;
      }

      const objectBounds = this.host.getArcadeBodyBounds(objectBody);
      const horizontalOverlap =
        playerRight > objectBounds.left + RUNTIME_OBJECT_SUPPORT_EDGE_INSET_PX &&
        playerLeft < objectBounds.right - RUNTIME_OBJECT_SUPPORT_EDGE_INSET_PX;
      if (!horizontalOverlap) {
        continue;
      }

      const footDistanceFromTop = playerBounds.bottom - objectBounds.top;
      const nearTopSurface =
        footDistanceFromTop >= -RUNTIME_OBJECT_SUPPORT_HOVER_TOLERANCE_PX &&
        footDistanceFromTop <= RUNTIME_OBJECT_SUPPORT_PENETRATION_TOLERANCE_PX;
      const playerIsAboveSurface = playerBounds.top < objectBounds.top;
      if (nearTopSurface && playerIsAboveSurface) {
        return true;
      }
    }

    return false;
  }

  private rectanglesStrictlyOverlap(
    first: Phaser.Geom.Rectangle,
    second: Phaser.Geom.Rectangle,
  ): boolean {
    const minimumOverlap = 0.5;
    return (
      first.left < second.right - minimumOverlap &&
      first.right > second.left + minimumOverlap &&
      first.top < second.bottom - minimumOverlap &&
      first.bottom > second.top + minimumOverlap
    );
  }

  private findCrateInteraction(
    tangentInput: number,
    crouchHeld: boolean,
    gravityDirection: PlayerGravityDirection,
  ): OverworldCrateInteraction | null {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody || tangentInput === 0) {
      return null;
    }

    const moveDirectionX = tangentInput > 0 ? 1 : -1;
    const gravityVector = getGravityVector(gravityDirection);
    const tangentVector = getGravityRightVector(gravityDirection);
    const playerBounds = this.host.getArcadeBodyBounds(playerBody);
    const playerTangent = this.projectBodyBounds(playerBounds, tangentVector);
    const playerGravity = this.projectBodyBounds(playerBounds, gravityVector);
    let bestInteraction: OverworldCrateInteraction | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    const pullGapLimit =
      this.host.state.activeCrateInteractionMode === 'pull'
        ? this.options.crateInteractionMaxGap + Math.max(6, playerTangent.size * 0.5)
        : this.options.crateInteractionMaxGap;
    const broadphasePadding = pullGapLimit + 6;

    for (const liveObject of this.host.getPushableLiveObjectsInBounds(
      playerBounds,
      broadphasePadding,
      broadphasePadding,
    )) {
      const candidateBody = liveObject.sprite.body as ArcadeObjectBody | null;
      if (
        !liveObject.sprite.active ||
        !isDynamicArcadeBody(candidateBody) ||
        !candidateBody.enable ||
        !this.bodyBoundsCouldOverlap(
          candidateBody,
          playerBounds,
          broadphasePadding,
          broadphasePadding,
        )
      ) {
        continue;
      }

      const crateBody = candidateBody;
      const crateBounds = this.host.getArcadeBodyBounds(crateBody);
      const crateTangent = this.projectBodyBounds(crateBounds, tangentVector);
      const crateGravity = this.projectBodyBounds(crateBounds, gravityVector);
      const gravityAxisOverlap =
        Math.min(playerGravity.max, crateGravity.max) -
        Math.max(playerGravity.min, crateGravity.min);
      if (gravityAxisOverlap < Math.min(8, playerGravity.size * 0.5)) {
        continue;
      }

      let mode: 'push' | 'pull' | null = null;
      let gap = Number.POSITIVE_INFINITY;
      let facing: -1 | 1 = this.resolveSpriteFacingForGravity(gravityDirection, moveDirectionX);

      if (moveDirectionX > 0) {
        const pushGap = crateTangent.min - playerTangent.max;
        const pullGap = playerTangent.min - crateTangent.max;
        if (pushGap >= -6 && pushGap <= this.options.crateInteractionMaxGap) {
          mode = 'push';
          gap = Math.abs(pushGap);
          facing = this.resolveSpriteFacingForGravity(gravityDirection, moveDirectionX);
        } else if (crouchHeld && pullGap >= -6 && pullGap <= pullGapLimit) {
          mode = 'pull';
          gap = Math.abs(pullGap);
          facing = this.resolveSpriteFacingForGravity(gravityDirection, -moveDirectionX);
        }
      } else {
        const pushGap = playerTangent.min - crateTangent.max;
        const pullGap = crateTangent.min - playerTangent.max;
        if (pushGap >= -6 && pushGap <= this.options.crateInteractionMaxGap) {
          mode = 'push';
          gap = Math.abs(pushGap);
          facing = this.resolveSpriteFacingForGravity(gravityDirection, moveDirectionX);
        } else if (crouchHeld && pullGap >= -6 && pullGap <= pullGapLimit) {
          mode = 'pull';
          gap = Math.abs(pullGap);
          facing = this.resolveSpriteFacingForGravity(gravityDirection, -moveDirectionX);
        }
      }

      if (!mode || gap >= bestGap) {
        continue;
      }

      bestGap = gap;
      bestInteraction = {
        crateBody,
        mode,
        moveDirectionX,
        facing,
        gravityDirection,
      };
    }

    return bestInteraction;
  }

  private projectBodyBounds(
    bounds: Phaser.Geom.Rectangle,
    vector: DirectionVector,
  ): { min: number; max: number; size: number } {
    const center = bounds.centerX * vector.x + bounds.centerY * vector.y;
    const halfSize = vector.x !== 0 ? bounds.width * 0.5 : bounds.height * 0.5;
    return {
      min: center - halfSize,
      max: center + halfSize,
      size: halfSize * 2,
    };
  }

  private resolveSpriteFacingForGravity(
    gravityDirection: PlayerGravityDirection,
    tangentDirection: number,
  ): -1 | 1 {
    const tangentFacing = tangentDirection < 0 ? -1 : 1;
    return gravityDirection === 'left' || gravityDirection === 'right'
      ? (tangentFacing === 1 ? -1 : 1)
      : tangentFacing;
  }
}
