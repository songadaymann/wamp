import type { OverworldMovementStepResult } from './movementController';

export interface OverworldMovementInput {
  left: boolean;
  right: boolean;
  upKeyHeld: boolean;
  downHeld: boolean;
  spaceHeld: boolean;
  touchLeft: boolean;
  touchRight: boolean;
  touchUp: boolean;
  touchDown: boolean;
  upPressed: boolean;
  downPressed: boolean;
  leftPressed: boolean;
  rightPressed: boolean;
  spacePressed: boolean;
}

interface CadenceEvents {
  on(event: string, callback: () => void): unknown;
  off(event: string, callback: () => void): unknown;
}

interface CadenceWorldEvents {
  on(event: 'worldstep', callback: (deltaSeconds: number) => void): unknown;
  off(event: 'worldstep', callback: (deltaSeconds: number) => void): unknown;
}

interface PhysicsCadenceHost {
  canSimulate(): boolean;
  getPlayerIdentity(): object | null;
  captureInput(): OverworldMovementInput;
  simulateEnvironment(deltaMs: number): void;
  simulateMovement(deltaMs: number, input: OverworldMovementInput): OverworldMovementStepResult | null;
}

const emptyMovement = (): OverworldMovementStepResult => ({
  grounded: false, downHeld: false, horizontalInput: 0, verticalInput: 0, jumpPressed: false,
});
const edgeKeys = ['upPressed', 'downPressed', 'leftPressed', 'rightPressed', 'spacePressed'] as const;

/** Owns the render-to-physics handoff, including short taps and scene lifecycle resets. */
export class OverworldPhysicsCadence {
  private playerIdentity: object | null = null;
  private pendingInput: OverworldMovementInput | null = null;
  private movement = emptyMovement();
  private steps = 0;
  private generation = 0;
  private totalSteps = 0;
  private readonly lifecycleEvents = ['pause', 'sleep', 'resume', 'wake'];

  constructor(
    private readonly sceneEvents: CadenceEvents,
    private readonly worldEvents: CadenceWorldEvents,
    private readonly host: PhysicsCadenceHost,
  ) {
    sceneEvents.on('preupdate', this.captureFrame);
    worldEvents.on('worldstep', this.step);
    for (const event of this.lifecycleEvents) sceneEvents.on(event, this.reset);
    sceneEvents.on('shutdown', this.destroy);
  }

  getMovement(): Readonly<OverworldMovementStepResult> { return this.movement; }
  getStepsThisFrame(): number { return this.steps; }
  describe() {
    return { stepsThisFrame: this.steps, totalSteps: this.totalSteps,
      pendingPresses: this.pendingInput ? edgeKeys.filter(key => this.pendingInput![key]).length : 0 };
  }

  reset = (): void => {
    this.generation += 1;
    this.playerIdentity = null;
    this.pendingInput = null;
    this.movement = emptyMovement();
    this.steps = 0;
  };

  destroy = (): void => {
    this.sceneEvents.off('preupdate', this.captureFrame);
    this.worldEvents.off('worldstep', this.step);
    for (const event of this.lifecycleEvents) this.sceneEvents.off(event, this.reset);
    this.sceneEvents.off('shutdown', this.destroy);
    this.reset();
  };

  private syncPlayer(): void {
    const identity = this.host.getPlayerIdentity();
    if (identity === this.playerIdentity) return;
    this.pendingInput = null;
    this.movement = emptyMovement();
    this.playerIdentity = identity;
  }

  private captureFrame = (): void => {
    this.steps = 0;
    this.movement.jumpPressed = false;
    if (!this.host.canSimulate()) { this.reset(); return; }
    this.syncPlayer();
    if (!this.playerIdentity) return;
    const input = this.host.captureInput();
    // Held directions always use the latest frame; pressed edges survive frames with no step.
    if (this.pendingInput) {
      for (const key of edgeKeys) input[key] ||= this.pendingInput[key];
    }
    this.pendingInput = input;
  };

  private step = (deltaSeconds: number): void => {
    if (!this.host.canSimulate()) { this.reset(); return; }
    this.syncPlayer();
    this.steps += 1;
    this.totalSteps += 1;
    const deltaMs = deltaSeconds * 1000;
    // Hazards may respawn or replace the player. Read input only after those resets.
    this.host.simulateEnvironment(deltaMs);
    if (!this.host.canSimulate()) { this.reset(); return; }
    this.syncPlayer();
    const input = this.pendingInput;
    if (!input || !this.playerIdentity) return;
    // Clear before simulation: teardown or death during this step cannot restore stale input.
    if (input) {
      this.pendingInput = { ...input };
      for (const key of edgeKeys) this.pendingInput[key] = false;
    }
    const generation = this.generation;
    const movement = this.host.simulateMovement(deltaMs, input);
    if (movement && generation === this.generation && this.playerIdentity === this.host.getPlayerIdentity()) {
      // Render-owned run traces must see a catch-up frame's first jump once,
      // without replaying it on subsequent frames that have no physics step.
      const jumpPressed = this.movement.jumpPressed || movement.jumpPressed;
      Object.assign(this.movement, movement, { jumpPressed });
    }
  };
}
