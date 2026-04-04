import Phaser from 'phaser';
import { playSfx, stopSfx } from '../../audio/sfx';
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
  isWallSliding: boolean;
  wallJumpLockUntil: number;
  wallJumpActive: boolean;
  wallJumpDirection: -1 | 1 | 0;
  wallJumpBlockedSide: -1 | 1 | 0;
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
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  isSolidTerrainAtWorldPoint(room: RoomSnapshot, worldX: number, worldY: number): boolean;
  getExternalLaunchGraceUntil(): number;
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
  playerCrouchHeight: number;
  playerSpeed: number;
  crawlSpeed: number;
  cratePushSpeed: number;
  cratePullSpeed: number;
  crateInteractionMaxGap: number;
  coyoteMs: number;
  jumpBufferMs: number;
  wallJumpBufferMs: number;
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
  verticalInput: number;
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
        verticalInput: 0,
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
    const touchClimbUpHeld = overlappingLadder !== null && (touchUp || touchInput.jumpHeld);
    const upHeld = cursors.up.isDown || wasd.W.isDown || touchClimbUpHeld;
    const downHeld = cursors.down.isDown || wasd.S.isDown || touchDown;
    const verticalInput = (downHeld ? 1 : 0) - (upHeld ? 1 : 0);
    const touchJumpUsedForLadder = touchJumpPressed && overlappingLadder !== null;
    const upPressed =
      Phaser.Input.Keyboard.JustDown(cursors.up) ||
      Phaser.Input.Keyboard.JustDown(wasd.W) ||
      touchJumpUsedForLadder;
    const spacePressed =
      Phaser.Input.Keyboard.JustDown(cursors.space!) ||
      (touchJumpPressed && !touchJumpUsedForLadder);
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
        verticalInput,
      };
    }

    if (this.host.state.isClimbingLadder) {
      this.setPlayerLadderState(null);
    }

    const grounded = playerBody.blocked.down || playerBody.touching.down;
    const crateInteraction =
      !inQuicksand && grounded && horizontalInput !== 0
        ? this.findCrateInteraction(horizontalInput, downHeld)
        : null;
    const wantsCrouch = grounded && downHeld && !crateInteraction;
    this.host.state.isCrouching = wantsCrouch || (this.host.state.isCrouching && !this.canPlayerStandUp());
    this.syncPlayerHitbox();
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
      crateInteraction.crateBody.setVelocityX(crateInteraction.moveDirectionX * moveSpeed);
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
        this.host.state.wallJumpBlockedSide = 0;
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

    return {
      grounded,
      downHeld,
      verticalInput,
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
    this.clearWallSlideState();
    this.host.state.wallJumpLockUntil = 0;
    this.host.state.wallJumpActive = false;
    this.host.state.wallJumpDirection = 0;
    this.host.state.wallJumpBlockedSide = 0;
    this.host.state.wallJumpChainActive = false;
  }

  private clearWallSlideState(): void {
    this.host.state.wallContactSide = 0;
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
    this.clearWallSlideState();
    this.host.state.wallJumpLockUntil =
      this.host.getCurrentTime() + this.options.wallJumpInputLockMs;
    this.host.state.wallJumpActive = true;
    this.host.state.wallJumpDirection = wallJumpDirection;
    this.host.state.wallJumpBlockedSide = wallJumpSourceSide;
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
    if (
      rawWallContactSide !== 0 &&
      this.host.state.wallJumpBlockedSide !== 0 &&
      rawWallContactSide !== this.host.state.wallJumpBlockedSide
    ) {
      this.host.state.wallJumpBlockedSide = 0;
    }

    const wallContactSide =
      rawWallContactSide !== 0 && rawWallContactSide === this.host.state.wallJumpBlockedSide
        ? 0
        : rawWallContactSide;
    this.host.state.wallContactSide = wallContactSide;
    this.host.state.isWallSliding = wallContactSide !== 0 && playerBody.velocity.y >= 0;

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

  private syncPlayerHitbox(): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return;
    }

    const nextHeight = this.host.state.isCrouching
      ? this.options.playerCrouchHeight
      : this.options.playerHeight;
    if (playerBody.height !== nextHeight) {
      playerBody.setSize(this.options.playerWidth, nextHeight, false);
      playerBody.setOffset(0, this.options.playerHeight - nextHeight);
    }
    this.host.syncPlayerPickupSensor();
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

  private canPlayerStandUp(): boolean {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      return true;
    }

    const room = this.host.getRoomSnapshotForCoordinates(this.host.getCurrentRoomCoordinates());
    if (!room) {
      return true;
    }

    const topY = playerBody.bottom - this.options.playerHeight;
    const sampleXs = [playerBody.center.x, playerBody.left + 1, playerBody.right - 1];
    return sampleXs.every((sampleX) => !this.host.isSolidTerrainAtWorldPoint(room, sampleX, topY + 1));
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
        liveObject.config.id !== 'crate' ||
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

      if (moveDirectionX > 0) {
        const pushGap = crateBounds.left - playerBounds.right;
        const pullGap = playerBounds.left - crateBounds.right;
        if (pushGap >= -6 && pushGap <= this.options.crateInteractionMaxGap) {
          mode = 'push';
          gap = Math.abs(pushGap);
          facing = 1;
        } else if (downHeld && pullGap >= -6 && pullGap <= this.options.crateInteractionMaxGap) {
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
        } else if (downHeld && pullGap >= -6 && pullGap <= this.options.crateInteractionMaxGap) {
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
