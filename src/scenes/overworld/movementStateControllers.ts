export class OverworldLadderMovementStateController {
  private climbing = false;
  private ladderKey: string | null = null;
  private climbSfxPlaying = false;

  isClimbing(): boolean {
    return this.climbing;
  }

  getActiveLadderKey(): string | null {
    return this.ladderKey;
  }

  isClimbSfxPlaying(): boolean {
    return this.climbSfxPlaying;
  }

  setActiveLadder(ladderKey: string | null): { changed: boolean; entering: boolean } {
    const nextClimbing = ladderKey !== null;
    if (this.ladderKey === ladderKey && this.climbing === nextClimbing) {
      return { changed: false, entering: false };
    }

    const entering = nextClimbing && !this.climbing;
    this.climbing = nextClimbing;
    this.ladderKey = ladderKey;
    return { changed: true, entering };
  }

  setClimbSfxPlaying(playing: boolean): boolean {
    if (this.climbSfxPlaying === playing) {
      return false;
    }
    this.climbSfxPlaying = playing;
    return true;
  }
}

export class OverworldButtStompMovementStateController {
  private active = false;
  private flipUntil = 0;
  private impactGraceUntil = 0;

  isActive(): boolean {
    return this.active;
  }

  getFlipUntil(): number {
    return this.flipUntil;
  }

  getImpactGraceUntil(): number {
    return this.impactGraceUntil;
  }

  start(now: number, flipMs: number): void {
    this.active = true;
    this.flipUntil = now + flipMs;
    this.impactGraceUntil = 0;
  }

  clear(
    now: number,
    options: { keepImpactGrace?: boolean; impactGraceMs?: number } = {},
  ): void {
    const wasActive = this.active;
    this.active = false;
    this.flipUntil = 0;
    if (options.keepImpactGrace && wasActive) {
      this.impactGraceUntil = now + (options.impactGraceMs ?? 0);
    } else if (!options.keepImpactGrace) {
      this.impactGraceUntil = 0;
    }
  }

  isInFlipPause(now: number): boolean {
    return this.active && now < this.flipUntil;
  }

  isImpactActive(now: number): boolean {
    return this.active || now <= this.impactGraceUntil;
  }
}

export class OverworldCrateMovementStateController {
  private mode: 'push' | 'pull' | null = null;
  private facing: -1 | 1 | null = null;

  getMode(): 'push' | 'pull' | null {
    return this.mode;
  }

  getFacing(): -1 | 1 | null {
    return this.facing;
  }

  sync(input: { mode: 'push' | 'pull'; facing: -1 | 1 } | null): void {
    this.mode = input?.mode ?? null;
    this.facing = input?.facing ?? null;
  }

  clear(): void {
    this.sync(null);
  }
}

export class OverworldWallMovementStateController {
  private contactSide: -1 | 1 | 0 = 0;
  private contactGraceSide: -1 | 1 | 0 = 0;
  private contactGraceUntil = 0;
  private sliding = false;
  private jumpLockUntil = 0;
  private jumpActive = false;
  private jumpDirection: -1 | 1 | 0 = 0;
  private jumpChainActive = false;

  getContactSide(): -1 | 1 | 0 {
    return this.contactSide;
  }

  getContactGraceSide(): -1 | 1 | 0 {
    return this.contactGraceSide;
  }

  getContactGraceUntil(): number {
    return this.contactGraceUntil;
  }

  isSliding(): boolean {
    return this.sliding;
  }

  getJumpLockUntil(): number {
    return this.jumpLockUntil;
  }

  isJumpActive(): boolean {
    return this.jumpActive;
  }

  getJumpDirection(): -1 | 1 | 0 {
    return this.jumpDirection;
  }

  isJumpChainActive(): boolean {
    return this.jumpChainActive;
  }

  reset(): void {
    this.clearContact();
    this.jumpLockUntil = 0;
    this.jumpActive = false;
    this.jumpDirection = 0;
    this.jumpChainActive = false;
  }

  clearContact(): void {
    this.contactSide = 0;
    this.contactGraceSide = 0;
    this.contactGraceUntil = 0;
    this.sliding = false;
  }

  update(input: {
    rawContactSide: -1 | 1 | 0;
    gravityVelocity: number;
    now: number;
    contactGraceMs: number;
  }): void {
    if (this.jumpActive && input.gravityVelocity >= 0) {
      this.jumpActive = false;
      this.jumpDirection = 0;
    }

    if (input.rawContactSide !== 0) {
      this.contactGraceSide = input.rawContactSide;
      this.contactGraceUntil = input.now + input.contactGraceMs;
    }

    const hasContactGrace =
      this.contactGraceSide !== 0 && input.now <= this.contactGraceUntil;
    this.contactSide = input.rawContactSide !== 0
      ? input.rawContactSide
      : hasContactGrace
        ? this.contactGraceSide
        : 0;
    this.sliding = input.rawContactSide !== 0 && input.gravityVelocity >= 0;

    if (this.sliding) {
      this.jumpActive = false;
      this.jumpDirection = 0;
    } else if (!this.jumpActive && input.now >= this.jumpLockUntil) {
      this.jumpDirection = 0;
    }
  }

  getJumpDirectionFromContact(): -1 | 1 | 0 {
    return this.contactSide === -1 ? 1 : this.contactSide === 1 ? -1 : 0;
  }

  commitJump(direction: -1 | 1, now: number, inputLockMs: number): void {
    this.clearContact();
    this.jumpLockUntil = now + inputLockMs;
    this.jumpActive = true;
    this.jumpDirection = direction;
    this.jumpChainActive = true;
  }

  finishGroundJump(): void {
    this.jumpActive = false;
    this.jumpDirection = 0;
    this.jumpLockUntil = 0;
    this.clearContact();
    this.jumpChainActive = false;
  }
}
