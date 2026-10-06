export interface FollowCameraMotionInput {
  playerY: number;
  velocityX: number;
  grounded: boolean;
  visibleWidth: number;
  visibleHeight: number;
  physicsSteps: number;
}

/** Presentation only: a small cushion absorbs jitter without holding back jumps or falls. */
export class OverworldFollowCameraMotion {
  private anchorY: number | null = null;
  private leadX = 0;

  reset(playerY?: number): void {
    this.anchorY = playerY ?? null;
    this.leadX = 0;
  }

  getAnchorY(): number | null { return this.anchorY; }

  update(input: FollowCameraMotionInput): { anchorY: number; leadX: number } {
    if (this.anchorY === null) this.anchorY = input.playerY;
    if (input.physicsSteps > 0) {
      if (input.grounded) this.anchorY = input.playerY;
      else {
        const cushion = Math.min(12, input.visibleHeight * 0.04);
        this.anchorY = Math.max(input.playerY - cushion,
          Math.min(input.playerY + cushion, this.anchorY));
      }
      // Airborne reversals and wall kicks should not swing the view sideways.
      const leadLimit = Math.min(48, input.visibleWidth * 0.12);
      const targetLead = input.grounded
        ? Math.abs(input.velocityX) > 20
          ? Math.sign(input.velocityX) * leadLimit : 0
        : Math.max(-leadLimit, Math.min(leadLimit, this.leadX));
      const blend = 1 - Math.exp(-input.physicsSteps * (1000 / 60) / 300);
      this.leadX += (targetLead - this.leadX) * blend;
    }
    return { anchorY: this.anchorY, leadX: this.leadX };
  }

  describe() { return { anchorY: this.anchorY, leadX: this.leadX }; }
}
