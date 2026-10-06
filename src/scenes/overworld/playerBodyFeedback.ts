export const MIN_LANDING_FEEDBACK_DISTANCE = 20;

interface BodyFeedbackSample {
  now: number;
  grounded: boolean;
  climbing: boolean;
  gravityDirection: string;
  positionAlongGravity: number;
  velocityAlongGravity: number;
}

/** Tracks actual falling distance, independently of the player's changing hitbox. */
export class PlayerBodyFeedback {
  private previous: BodyFeedbackSample | null = null;
  private apex: number | null = null;
  private pulse: { startedAt: number; duration: number; amount: number } | null = null;
  private lastLanding: { from: number; to: number; distance: number } | null = null;

  reset(): void {
    this.previous = null;
    this.apex = null;
    this.pulse = null;
    this.lastLanding = null;
  }

  describe() {
    return { apex: this.apex, previousPosition: this.previous?.positionAlongGravity ?? null,
      previousGrounded: this.previous?.grounded ?? null,
      lastLanding: this.lastLanding ? { ...this.lastLanding } : null };
  }

  sample(input: BodyFeedbackSample): { landed: boolean; scaleX: number; scaleY: number } {
    const previous = this.previous;
    const continuous = previous !== null && previous.gravityDirection === input.gravityDirection;
    let landed = false;
    if (!continuous || input.climbing || previous?.climbing) {
      this.apex = input.positionAlongGravity;
      this.pulse = null;
    } else {
      this.apex = Math.min(this.apex ?? input.positionAlongGravity, input.positionAlongGravity);
      landed = input.grounded && !previous.grounded
        && input.positionAlongGravity - this.apex >= MIN_LANDING_FEEDBACK_DISTANCE;
      const beganRising = !input.grounded && input.velocityAlongGravity < -20
        && (previous.grounded || previous.velocityAlongGravity >= -20);
      if (landed) {
        const from = this.apex ?? input.positionAlongGravity;
        this.lastLanding = { from, to: input.positionAlongGravity,
          distance: input.positionAlongGravity - from };
        this.pulse = { startedAt: input.now, duration: 90, amount: -0.12 };
      }
      else if (beganRising) this.pulse = { startedAt: input.now, duration: 80, amount: 0.12 };
    }
    if (input.grounded) this.apex = input.positionAlongGravity;
    this.previous = { ...input };

    let amount = 0;
    if (this.pulse) {
      const progress = Math.max(0, (input.now - this.pulse.startedAt) / this.pulse.duration);
      if (progress >= 1) this.pulse = null;
      // Show the peak immediately so a short pulse survives a slow next frame.
      else amount = Math.cos(Math.PI * progress * 0.5) * this.pulse.amount;
    }
    return { landed, scaleY: 1 + amount, scaleX: 1 - amount * 0.5 };
  }
}
