export interface FollowCameraMotionInput {
  playerY: number;
  velocityX: number;
  grounded: boolean;
  visibleWidth: number;
  visibleHeight: number;
  physicsSteps: number;
}

/** Presentation only: platform anchors absorb hops, with bounded room for long falls. */
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
        const riseMargin = Math.min(96, input.visibleHeight * 0.28);
        const fallMargin = Math.min(96, input.visibleHeight * 0.35);
        this.anchorY = Math.max(input.playerY - fallMargin,
          Math.min(input.playerY + riseMargin, this.anchorY));
      }
      const targetLead = Math.abs(input.velocityX) > 20
        ? Math.sign(input.velocityX) * Math.min(48, input.visibleWidth * 0.12) : 0;
      const blend = 1 - Math.exp(-input.physicsSteps * (1000 / 60) / 300);
      this.leadX += (targetLead - this.leadX) * blend;
    }
    return { anchorY: this.anchorY, leadX: this.leadX };
  }

  describe() { return { anchorY: this.anchorY, leadX: this.leadX }; }
}
