import Phaser from 'phaser';
import { playSfx, stopSfx } from '../../audio/sfx';
import {
  isPushableObjectConfig,
  isSolidRuntimeObjectConfig,
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

const CRATE_PULL_DRAG_COMPENSATION_SCALE = 2.25;
const SINGLE_TILE_GAP_ASSIST_MAX_DROP_PX = 4;
const SINGLE_TILE_GAP_ASSIST_FOOT_PROBE_PX = 1;
const SINGLE_TILE_GAP_ASSIST_HORIZONTAL_PAD_PX = 1;

export interface OverworldCrateInteraction {
  crateBody: Phaser.Physics.Arcade.Body;
  mode: 'push' | 'pull';
  moveDirectionX: -1 | 1;
  facing: -1 | 1;
}

export interface OverworldMovementControllerState {
  isCrouching: boolean;
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
  getPlayerFacing(): -1 | 1;
  getCurrentRoomCoordinates(): RoomCoordinates;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  isSolidTerrainAtWorldPoint(room: RoomSnapshot, worldX: number, worldY: number): boolean;
  getExternalLaunchGraceUntil(): number;
  shouldForceFullBodyHitbox(): boolean;
  getLoadedLiveObjects(): Iterable<LoadedRoomObject>;
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
  }

  handlePlayerCreated(): void {
    this.host.state.isCrouching = false;
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
    this.clearCrateInteractionState();
    this.host.state.weaponKnockbackVelocityX = 0;
    this.host.state.weaponKnockbackUntil = 0;
    this.setPlayerLadderState(null);
    this.resetWallMovementState();
    this.setLadderClimbSfxPlaying(false);
  }

  handleRespawnReset(): void {
    this.host.state.isCrouching = false;
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
    const spacePressed =
      Phaser.Input.Keyboard.JustDown(cursors.space!) ||
      touchJumpPressed;
    const stayOnLadder =
      overlappingLadder !== null &&
      !spacePressed &&
      (verticalInput !== 0 || (this.host.state.isClimbingLadder && !left && !right));
    const jumpedOffLadder = this.host.state.isClimbingLadder && spacePressed;

    if (stayOnLadder && overlappingLadder) {
      this.setPlayerLadderState(overlappingLadder);
      const ladderDeltaX = overlappingLadder.sprite.x - (player.x ?? playerBody.center.x);
      playerBody.setVelocityX(Phaser.Math.Clamp(ladderDeltaX * 12, -45, 45));
      playerBody.setVelocityY(verticalInput * this.options.ladderClimbSpeed);
      this.host.state.coyoteTime = 0;
      this.host.state.jumpBuffered = false;
      this.host.state.jumpBufferTime = 0;
      this.host.state.isCrouching = false;
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

    let grounded = playerBody.blocked.down || playerBody.touching.down;
    if (
      this.shouldApplySingleTileGapAssist(horizontalInput, downHeld, spacePressed, inQuicksand, grounded) &&
      this.tryApplySingleTileGapAssist(horizontalInput, grounded)
    ) {
      grounded = true;
    }

    const crateInteraction =
      !inQuicksand && grounded && horizontalInput !== 0
        ? this.findCrateInteraction(horizontalInput, downHeld)
        : null;
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
      !this.host.state.isCrouching;
    this.updateWallMovementState(horizontalInput, grounded, canWallAttach);
    if (grounded) {
      this.host.state.coyoteTime = this.options.coyoteMs;
    } else {
      this.host.state.coyoteTime = Math.max(0, this.host.state.coyoteTime - delta);
    }

    if (crateInteraction) {
      const moveSpeed =
        crateInteraction.mode === 'push' ? this.options.cratePushSpeed : this.options.cratePullSpeed;
      this.host.state.activeCrateInteractionMode = crateInteraction.mode;
      this.host.state.activeCrateInteractionFacing = crateInteraction.facing;
      playerBody.setVelocityX(crateInteraction.moveDirectionX * moveSpeed);
      crateInteraction.crateBody.setVelocityX(
        this.getCrateInteractionVelocityX(crateInteraction, moveSpeed, delta)
      );
    } else {
      this.clearCrateInteractionState();
      if (this.host.getCurrentTime() < this.host.state.weaponKnockbackUntil) {
        playerBody.setVelocityX(this.host.state.weaponKnockbackVelocityX);
      } else if (
        this.host.getCurrentTime() < this.host.state.wallJumpLockUntil &&
        this.host.state.wallJumpDirection !== 0
      ) {
        playerBody.setVelocityX(this.host.state.wallJumpDirection * this.options.wallJumpVelocityX);
      } else {
        this.host.state.weaponKnockbackVelocityX = 0;
        const moveSpeedBase = this.host.state.isCrouching ? this.options.crawlSpeed : this.options.playerSpeed;
        const moveSpeed = inQuicksand ? moveSpeedBase * this.options.quicksandMoveFactor : moveSpeedBase;
        if (left) {
          playerBody.setVelocityX(-moveSpeed);
        } else if (right) {
          playerBody.setVelocityX(moveSpeed);
        } else {
          playerBody.setVelocityX(0);
        }
      }
    }

    const jumpPressed =
      !this.host.state.isCrouching && (spacePressed || (upPressed && overlappingLadder === null));

    if (jumpedOffLadder) {
      playerBody.setVelocityY(
        inQuicksand ? this.options.jumpVelocity * this.options.quicksandJumpFactor : this.options.jumpVelocity,
      );
      this.host.playJumpDustFx(player.x ?? playerBody.center.x, playerBody.bottom, this.host.getPlayerFacing());
      this.host.state.jumpBuffered = false;
      this.host.state.jumpBufferTime = 0;
      this.host.state.coyoteTime = 0;
      this.resetWallMovementState();
    } else {
      if (jumpPressed) {
        if (!this.tryPerformWallJump(player, playerBody)) {
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
        playerBody.setVelocityY(
          inQuicksand ? this.options.jumpVelocity * this.options.quicksandJumpFactor : this.options.jumpVelocity,
        );
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

    if (inQuicksand && grounded) {
      playerBody.setVelocityY(Math.max(playerBody.velocity.y, 4));
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

  private clearWallContactState(): void {
    this.host.state.wallContactSide = 0;
    this.host.state.wallContactGraceSide = 0;
    this.host.state.wallContactGraceUntil = 0;
    this.host.state.isWallSliding = false;
  }

  private tryPerformWallJump(
    player: Phaser.GameObjects.Rectangle,
    playerBody: Phaser.Physics.Arcade.Body,
  ): boolean {
    const wallJumpSourceSide = this.host.state.wallContactSide;
    if (wallJumpSourceSide === 0) {
      return false;
    }

    const wallJumpDirection = (wallJumpSourceSide === -1 ? 1 : -1) as -1 | 1;
    playerBody.setVelocityX(wallJumpDirection * this.options.wallJumpVelocityX);
    playerBody.setVelocityY(this.options.wallJumpVelocityY);
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

  private getTouchingWallSide(): -1 | 1 | 0 {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return 0;
    }

    const touchingLeft = playerBody.blocked.left || playerBody.touching.left;
    const touchingRight = playerBody.blocked.right || playerBody.touching.right;
    if (touchingLeft === touchingRight) {
      return 0;
    }

    return touchingLeft ? -1 : 1;
  }

  private getWallContactSide(horizontalInput: number): -1 | 1 | 0 {
    const touchingWallSide = this.getTouchingWallSide();
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

  private updateWallMovementState(horizontalInput: number, grounded: boolean, canWallAttach: boolean): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody || grounded || this.host.state.isClimbingLadder) {
      this.resetWallMovementState();
      return;
    }

    if (this.host.state.wallJumpActive && playerBody.velocity.y >= 0) {
      this.host.state.wallJumpActive = false;
      this.host.state.wallJumpDirection = 0;
    }

    const rawWallContactSide = canWallAttach ? this.getWallContactSide(horizontalInput) : 0;
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
    this.host.state.isWallSliding = rawWallContactSide !== 0 && playerBody.velocity.y >= 0;

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
    if (playerBody.width !== this.options.playerWidth || playerBody.height !== nextHeight) {
      playerBody.setSize(this.options.playerWidth, nextHeight, false);
      playerBody.setOffset(0, this.options.playerStandingHeight - nextHeight);
    }
    this.host.syncPlayerPickupSensor();
  }

  private getPlayerHitboxHeight(playerBody: Phaser.Physics.Arcade.Body, groundedProfile: boolean): number {
    if (this.host.state.isCrouching) {
      return this.options.playerCrouchHeight;
    }

    if (this.host.shouldForceFullBodyHitbox()) {
      return this.options.playerStandingHeight;
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

  private getCrateInteractionVelocityX(
    crateInteraction: OverworldCrateInteraction,
    moveSpeed: number,
    delta: number,
  ): number {
    if (crateInteraction.mode !== 'pull') {
      return crateInteraction.moveDirectionX * moveSpeed;
    }

    // Pulling does not have push contact to keep the crate coupled, so offset its drag for the next physics step.
    const dragCompensation =
      Math.max(0, crateInteraction.crateBody.drag.x) *
      Math.min(Math.max(delta, 0), 50) /
      1000 *
      CRATE_PULL_DRAG_COMPENSATION_SCALE;
    return crateInteraction.moveDirectionX * (moveSpeed + dragCompensation);
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

    for (const liveObject of this.host.getLoadedLiveObjects()) {
      if (
        !isSolidRuntimeObjectConfig(liveObject.config) ||
        !liveObject.sprite.active ||
        !liveObject.sprite.body
      ) {
        continue;
      }

      const objectBounds = this.host.getArcadeBodyBounds(liveObject.sprite.body as ArcadeObjectBody);
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

  private findCrateInteraction(horizontalInput: number, downHeld: boolean): OverworldCrateInteraction | null {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody || horizontalInput === 0) {
      return null;
    }

    const moveDirectionX = horizontalInput > 0 ? 1 : -1;
    const playerBounds = this.host.getArcadeBodyBounds(playerBody);
    let bestInteraction: OverworldCrateInteraction | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    for (const liveObject of this.host.getLoadedLiveObjects()) {
      if (
        !isPushableObjectConfig(liveObject.config) ||
        !liveObject.sprite.active ||
        !isDynamicArcadeBody(liveObject.sprite.body as ArcadeObjectBody | null)
      ) {
        continue;
      }

      const crateBody = liveObject.sprite.body as Phaser.Physics.Arcade.Body;
      const crateBounds = this.host.getArcadeBodyBounds(crateBody);
      const verticalOverlap =
        Math.min(playerBounds.bottom, crateBounds.bottom) -
        Math.max(playerBounds.top, crateBounds.top);
      if (verticalOverlap < Math.min(8, playerBounds.height * 0.5)) {
        continue;
      }

      let mode: 'push' | 'pull' | null = null;
      let gap = Number.POSITIVE_INFINITY;
      let facing: -1 | 1 = moveDirectionX;
      const pullGapLimit =
        this.host.state.activeCrateInteractionMode === 'pull'
          ? this.options.crateInteractionMaxGap + Math.max(6, playerBounds.width * 0.5)
          : this.options.crateInteractionMaxGap;

      if (moveDirectionX > 0) {
        const pushGap = crateBounds.left - playerBounds.right;
        const pullGap = playerBounds.left - crateBounds.right;
        if (pushGap >= -6 && pushGap <= this.options.crateInteractionMaxGap) {
          mode = 'push';
          gap = Math.abs(pushGap);
          facing = 1;
        } else if (downHeld && pullGap >= -6 && pullGap <= pullGapLimit) {
          mode = 'pull';
          gap = Math.abs(pullGap);
          facing = -1;
        }
      } else {
        const pushGap = playerBounds.left - crateBounds.right;
        const pullGap = crateBounds.left - playerBounds.right;
        if (pushGap >= -6 && pushGap <= this.options.crateInteractionMaxGap) {
          mode = 'push';
          gap = Math.abs(pushGap);
          facing = -1;
        } else if (downHeld && pullGap >= -6 && pullGap <= pullGapLimit) {
          mode = 'pull';
          gap = Math.abs(pullGap);
          facing = 1;
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
      };
    }

    return bestInteraction;
  }
}
