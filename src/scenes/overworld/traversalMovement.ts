import type Phaser from 'phaser';
import { getGravityRightVector, type PlayerGravityDirection } from './specialTiles';

/** A feather is one charge for this flight; springs briefly own tangent momentum. */
export class OverworldTraversalMovementState {
  private airJumpAvailable = false;
  private wasGrounded = false;
  private springVelocity: { x: number; y: number } | null = null;
  private springLockUntil = 0;

  grantAirJump(): boolean {
    if (this.airJumpAvailable) return false;
    this.airJumpAvailable = true;
    return true;
  }

  consumeAirJump(): boolean {
    if (!this.airJumpAvailable) return false;
    this.airJumpAvailable = false;
    return true;
  }

  hasAirJump(): boolean { return this.airJumpAvailable; }

  observeSupport(grounded: boolean, wallAttached: boolean, inWater: boolean): void {
    // A feather touched while already standing can be taken into the next jump.
    if ((grounded && !this.wasGrounded) || wallAttached || inWater) {
      this.airJumpAvailable = false;
    }
    this.wasGrounded = grounded;
  }

  beginSpringLaunch(x: number, y: number, now: number, durationMs: number): void {
    this.springVelocity = { x, y };
    this.springLockUntil = now + durationMs;
  }

  getSpringTangentVelocity(
    direction: PlayerGravityDirection, now: number, body: Phaser.Physics.Arcade.Body,
  ): number | null {
    if (!this.springVelocity || now >= this.springLockUntil) return null;
    const right = getGravityRightVector(direction);
    const velocity = this.springVelocity.x * right.x + this.springVelocity.y * right.y;
    const x = velocity * right.x, y = velocity * right.y;
    if ((x < 0 && body.blocked.left) || (x > 0 && body.blocked.right) ||
        (y < 0 && body.blocked.up) || (y > 0 && body.blocked.down)) {
      this.springLockUntil = 0;
      return null;
    }
    return velocity;
  }

  describe(now: number): { airJumpAvailable: boolean; springInputLockMs: number } {
    return { airJumpAvailable: this.airJumpAvailable,
      springInputLockMs: Math.max(0, Math.round(this.springLockUntil - now)) };
  }

  reset(): void {
    this.airJumpAvailable = false;
    this.wasGrounded = false;
    this.springVelocity = null;
    this.springLockUntil = 0;
  }
}
