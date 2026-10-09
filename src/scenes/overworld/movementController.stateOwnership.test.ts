import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { getGravityVector, getGravityRightVector, getBodyVelocityAlongVector,
  type SpecialTilePlayerEnvironment } from './specialTiles';
import { OverworldJumpCornerCorrection } from './jumpCornerCorrection';
import { GAME_OBJECTS } from '../../config';
import { OverworldPhysicsCadence } from './physicsCadence';

const audio = vi.hoisted(() => ({
  playSfx: vi.fn(),
  stopSfx: vi.fn(),
}));

const { MockRectangle } = vi.hoisted(() => ({
  MockRectangle: class MockRectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}

    get left(): number { return this.x; }
    get right(): number { return this.x + this.width; }
    get top(): number { return this.y; }
    get bottom(): number { return this.y + this.height; }
  },
}));

vi.mock('phaser', () => ({
  default: {
    Geom: {
      Rectangle: MockRectangle,
      Intersects: {
        RectangleToRectangle: (
          first: InstanceType<typeof MockRectangle>,
          second: InstanceType<typeof MockRectangle>,
        ) => (
          first.right >= second.left &&
          first.left <= second.right &&
          first.bottom >= second.top &&
          first.top <= second.bottom
        ),
      },
    },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Linear: (start: number, end: number, amount: number) => start + (end - start) * amount,
    },
    Input: {
      Keyboard: {
        JustDown: (key: FakeKey) => key.justDown,
      },
    },
    Animations: { Events: { ANIMATION_COMPLETE: 'animationcomplete' } },
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}));

vi.mock('../../audio/sfx', () => audio);

vi.mock('../../ui/mobile/touchControls', () => ({
  consumeTouchAction: () => false,
  getTouchInputState: () => ({
    active: false,
    moveX: 0,
    moveY: 0,
    jumpHeld: false,
  }),
}));

import type { LoadedRoomObject } from './liveObjects';
import {
  OverworldMovementController,
  type OverworldCrateInteraction,
} from './movementController';

interface FakeKey {
  isDown: boolean;
  justDown: boolean;
}

interface FakeBody {
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  center: { x: number; y: number };
  offset: { x: number; y: number };
  blocked: { up: boolean; down: boolean; left: boolean; right: boolean };
  touching: { up: boolean; down: boolean; left: boolean; right: boolean };
  velocity: { x: number; y: number };
  drag: { x: number; y: number };
  setAllowGravity: ReturnType<typeof vi.fn<(value: boolean) => void>>;
  setVelocity: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setVelocityX: ReturnType<typeof vi.fn<(x: number) => void>>;
  setVelocityY: ReturnType<typeof vi.fn<(y: number) => void>>;
  setSize: ReturnType<typeof vi.fn<(width: number, height: number, center?: boolean) => void>>;
  setOffset: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  updateCenter: ReturnType<typeof vi.fn<() => void>>;
}

interface OwnedState {
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

interface ControllerTestSeam {
  state: OwnedState;
  setPlayerLadderState(ladder: LoadedRoomObject | null): void;
  startButtStomp(body: FakeBody): void;
  clearButtStompState(options?: { keepImpactGrace?: boolean }): void;
  updateWallMovementState(
    horizontalInput: number,
    grounded: boolean,
    canWallAttach: boolean,
  ): void;
  tryPerformWallJump(player: { x: number }, body: FakeBody): boolean;
  syncCrateInteractionState(interaction: OverworldCrateInteraction | null): void;
}

function createKey(): FakeKey {
  return { isDown: false, justDown: false };
}

function createBody(): FakeBody {
  const body = {
    x: 100,
    y: 100,
    left: 100,
    right: 110,
    top: 100,
    bottom: 126,
    width: 10,
    height: 26,
    center: { x: 105, y: 113 },
    offset: { x: 0, y: 0 },
    blocked: { up: false, down: false, left: false, right: false },
    touching: { up: false, down: false, left: false, right: false },
    velocity: { x: 0, y: 0 },
    drag: { x: 0, y: 0 },
    setAllowGravity: vi.fn<(value: boolean) => void>(),
    setVelocity: vi.fn<(x: number, y: number) => void>(),
    setVelocityX: vi.fn<(x: number) => void>(),
    setVelocityY: vi.fn<(y: number) => void>(),
    setSize: vi.fn<(width: number, height: number, center?: boolean) => void>(),
    setOffset: vi.fn<(x: number, y: number) => void>(),
    updateCenter: vi.fn<() => void>(),
  } satisfies FakeBody;

  body.setVelocity.mockImplementation((x, y) => {
    body.velocity.x = x;
    body.velocity.y = y;
  });
  body.setVelocityX.mockImplementation((x) => {
    body.velocity.x = x;
  });
  body.setVelocityY.mockImplementation((y) => {
    body.velocity.y = y;
  });
  body.setSize.mockImplementation((width, height) => {
    body.width = width;
    body.height = height;
    body.right = body.left + width;
    body.top = body.bottom - height;
  });
  body.setOffset.mockImplementation((x, y) => {
    body.offset.x = x;
    body.offset.y = y;
  });
  body.updateCenter.mockImplementation(() => {
    body.center.x = body.left + body.width * 0.5;
    body.center.y = body.top + body.height * 0.5;
  });
  return body;
}

function createHarness(environment: SpecialTilePlayerEnvironment = {
  inWater: false, onIce: false, onSticky: false, conveyorX: 0, windX: 0, gravityDirection: 'down',
  onBounce: false, onDamage: false,
}) {
  let now = 1_000;
  let forceFullBody = false;
  const body = createBody();
  const player = { x: 105, y: 113 };
  const cursors = {
    left: createKey(),
    right: createKey(),
    up: createKey(),
    down: createKey(),
    space: createKey(),
  };
  const wasd = {
    W: createKey(),
    A: createKey(),
    S: createKey(),
    D: createKey(),
  };
  const host = {
    getCurrentTime: () => now,
    getPlayer: () => player,
    getPlayerBody: () => body,
    getSpecialTileEnvironment: () => environment,
    getPlayerFacing: () => 1 as const,
    getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
    getRoomOrigin: () => ({ x: 0, y: 0 }),
    getRoomSnapshotForCoordinates: () => null,
    isSolidTerrainAtWorldPoint: () => false,
    getExternalLaunchGraceUntil: () => 0,
    shouldForceFullBodyHitbox: () => forceFullBody,
    getPushableLiveObjectsInBounds: () => [],
    getRuntimeSolidLiveObjectsInBounds: () => [],
    getArcadeBodyBounds: (target: FakeBody) =>
      new MockRectangle(target.left, target.top, target.width, target.height),
    getCursors: () => cursors,
    getWasd: () => wasd,
    findOverlappingLadder: () => null,
    playJumpDustFx: vi.fn(),
    syncPlayerPickupSensor: vi.fn(),
  };
  const controller = new OverworldMovementController(host as never, {
    playerWidth: 10,
    playerHeight: 14,
    playerStandingHeight: 26,
    playerCrouchHeight: 14,
    playerPushHeight: 22,
    playerSpeed: 120,
    crawlSpeed: 48,
    cratePushSpeed: 52,
    cratePullSpeed: 42,
    crateInteractionMaxGap: 4,
    coyoteMs: 110,
    jumpBufferMs: 120,
    wallJumpBufferMs: 240,
    wallContactGraceMs: 140,
    jumpVelocity: -220,
    wallSlideMaxFallSpeed: 70,
    wallJumpVelocityX: 205,
    wallJumpVelocityY: -265,
    wallJumpInputLockMs: 240,
    ladderClimbSpeed: 90,
    quicksandMoveFactor: 0.56,
    quicksandJumpFactor: 0.92,
    weaponKnockbackMs: 90,
  });

  return {
    body,
    controller,
    cursors,
    host,
    player,
    seam: controller as unknown as ControllerTestSeam,
    setForceFullBody(value: boolean) { forceFullBody = value; },
    setNow(value: number) { now = value; },
  };
}

describe('OverworldMovementController state ownership', () => {
  beforeEach(() => {
    audio.playSfx.mockClear();
    audio.stopSfx.mockClear();
  });

  it('creates isolated state and exposes semantic presentation and debug reads', () => {
    const first = createHarness();
    const second = createHarness();

    first.seam.state.isCrouching = true;
    first.seam.state.coyoteTime = 47.6;

    expect(first.controller.isCrouching()).toBe(true);
    expect(first.controller.getPresentationState()).toBe(first.controller.getPresentationState());
    expect(Object.isFrozen(first.controller.getPresentationState())).toBe(true);
    expect(first.controller.getPresentationState().isCrouching).toBe(true);
    expect(first.controller.getDebugSnapshot()).toMatchObject({
      crouching: true,
      coyoteMs: 48,
      climbing: false,
      crateInteractionMode: null,
      wallContactSide: 0,
    });
    expect(second.controller.getDebugSnapshot()).toMatchObject({
      crouching: false,
      coyoteMs: 0,
    });
  });

  it('owns crouch, push, full-body hitboxes and restores them on respawn', () => {
    const harness = createHarness();
    harness.body.blocked.down = true;
    harness.seam.state.isCrouching = true;

    harness.controller.refreshPlayerHitbox();

    expect(harness.body.setSize).toHaveBeenLastCalledWith(10, 14, false);
    expect(harness.body.setOffset).toHaveBeenLastCalledWith(0, 12);

    harness.seam.state.isCrouching = false;
    harness.seam.syncCrateInteractionState({
      crateBody: harness.body as never,
      mode: 'push',
      moveDirectionX: 1,
      facing: 1,
      gravityDirection: 'down',
    });
    harness.controller.refreshPlayerHitbox();

    expect(harness.body.setSize).toHaveBeenLastCalledWith(10, 22, false);
    expect(harness.body.setOffset).toHaveBeenLastCalledWith(0, 4);

    harness.setForceFullBody(true);
    harness.controller.handleRespawnReset();

    expect(harness.body.setSize).toHaveBeenLastCalledWith(10, 26, false);
    expect(harness.body.setOffset).toHaveBeenLastCalledWith(0, 0);
    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      crouching: false,
      crateInteractionMode: null,
    });
    expect(harness.host.syncPlayerPickupSensor).toHaveBeenCalledTimes(3);
  });

  it('cleans up ladder gravity, wall state, sound, and key ownership', () => {
    const harness = createHarness();
    const ladder = { key: '0,0:ladder:7' } as LoadedRoomObject;

    harness.seam.setPlayerLadderState(ladder);
    harness.body.velocity.y = -30;
    harness.controller.syncLadderClimbSfx(1);

    expect(harness.controller.isClimbingLadder()).toBe(true);
    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      climbing: true,
      ladderKey: '0,0:ladder:7',
      ladderClimbSfxPlaying: true,
    });
    expect(harness.body.setAllowGravity).toHaveBeenCalledWith(false);
    expect(audio.playSfx).toHaveBeenCalledWith('ladder-climb');

    harness.controller.clearLadderState();

    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      climbing: false,
      ladderKey: null,
      ladderClimbSfxPlaying: false,
      wallSliding: false,
      wallContactSide: 0,
    });
    expect(harness.body.setAllowGravity).toHaveBeenLastCalledWith(true);
    expect(audio.stopSfx).toHaveBeenCalledWith('ladder-climb');
  });

  it('preserves coyote jumps and buffered landing jumps inside owned state', () => {
    const harness = createHarness();
    harness.seam.state.coyoteTime = 80;
    harness.cursors.space.justDown = true;
    harness.cursors.space.isDown = true;

    harness.controller.updateMovement(16, false);

    expect(harness.body.velocity.y).toBe(-220);
    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      jumpBuffered: false,
      jumpBufferMs: 0,
      coyoteMs: 0,
    });

    harness.body.velocity.y = 0;
    harness.cursors.space.justDown = true;
    harness.controller.updateMovement(16, false);

    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      jumpBuffered: true,
      jumpBufferMs: 120,
      wallJumpBufferMs: 240,
      coyoteMs: 0,
    });

    harness.cursors.space.justDown = false;
    harness.body.blocked.down = true;
    harness.controller.updateMovement(16, false);

    expect(harness.body.velocity.y).toBe(-220);
    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      jumpBuffered: false,
      jumpBufferMs: 0,
      coyoteMs: 0,
    });
  });

  it('owns wall-slide contact, grace, and wall-jump lock state', () => {
    const harness = createHarness();
    harness.body.blocked.right = true;
    harness.body.velocity.y = 140;

    harness.seam.updateWallMovementState(1, false, true);

    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      wallSliding: true,
      wallContactSide: 1,
      wallContactGraceSide: 1,
      wallContactGraceMs: 140,
    });

    expect(harness.seam.tryPerformWallJump(harness.player, harness.body)).toBe(true);
    expect(harness.body.velocity).toEqual({ x: -205, y: -265 });
    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      wallSliding: false,
      wallContactSide: 0,
      wallJumpActive: true,
      wallJumpDirection: -1,
      wallJumpChainActive: true,
      wallJumpLockMs: 240,
    });
    expect(harness.host.playJumpDustFx).toHaveBeenCalledOnce();
  });

  it('owns butt-stomp, weapon-knockback, crate, destruction, and creation reset state', () => {
    const harness = createHarness();

    harness.seam.startButtStomp(harness.body);
    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      buttStomping: true,
      buttStompFlipMs: 190,
    });
    expect(harness.body.setAllowGravity).toHaveBeenLastCalledWith(false);
    expect(harness.body.setVelocityY).toHaveBeenLastCalledWith(0);

    harness.seam.clearButtStompState({ keepImpactGrace: true });
    expect(harness.controller.isButtStompImpactActive()).toBe(true);
    harness.setNow(1_121);
    expect(harness.controller.isButtStompImpactActive()).toBe(false);

    harness.setNow(2_000);
    harness.body.velocity.y = 200;
    harness.seam.startButtStomp(harness.body);
    harness.controller.handleButtStompImpact(-150);
    expect(harness.body.velocity.y).toBe(-150);
    expect(harness.controller.isButtStomping()).toBe(false);

    harness.controller.applyWeaponKnockback(44);
    harness.seam.syncCrateInteractionState({
      crateBody: harness.body as never,
      mode: 'pull',
      moveDirectionX: 1,
      facing: -1,
      gravityDirection: 'down',
    });
    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      weaponKnockbackVelocityX: 44,
      weaponKnockbackMs: 90,
      crateInteractionMode: 'pull',
      crateInteractionFacing: -1,
    });

    harness.controller.handlePlayerDestroyed();
    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      buttStomping: false,
      buttStompImpactGraceMs: 0,
      weaponKnockbackVelocityX: 0,
      weaponKnockbackMs: 0,
      crateInteractionMode: null,
      crateInteractionFacing: null,
      climbing: false,
      wallSliding: false,
      wallJumpActive: false,
    });

    harness.controller.handlePlayerCreated();
    expect(harness.host.syncPlayerPickupSensor).toHaveBeenCalled();
    expect(harness.controller.getDebugSnapshot()).toMatchObject({
      crouching: false,
      ladderKey: null,
    });
  });
});

interface TrajectorySample { x: number; y: number; vx: number; vy: number }
const phaserRequire = createRequire(import.meta.url);
const ArcadeWorld = phaserRequire('phaser/src/physics/arcade/World.js') as typeof Phaser.Physics.Arcade.World;
const ArcadeBody = phaserRequire('phaser/src/physics/arcade/Body.js') as typeof Phaser.Physics.Arcade.Body;

function runActualPhysics(hz: number, scenario: string, legacyRenderMovement = false, shapedPlayer = false, legacyHitbox = false): TrajectorySample[] {
  const environment: SpecialTilePlayerEnvironment = {
    inWater: scenario === 'water', onIce: scenario.startsWith('ice'), onSticky: false,
    conveyorX: scenario === 'ice-conveyor' ? 1 : 0,
    windX: scenario.includes('wind') ? 1 : 0,
    gravityDirection: scenario.startsWith('gravity-') ? scenario.slice(8) as SpecialTilePlayerEnvironment['gravityDirection'] : 'down',
    onDamage: false, onBounce: false,
  };
  const h = createHarness(environment);
  h.setForceFullBody(true);
  const world = new ArcadeWorld({ sys: { scale: { width: 20000, height: 20000 } } } as never,
    { gravity: { x: 0, y: environment.gravityDirection === 'down' ? 700 : 0 }, debug: false });
  const gameObject = {
    x: 0, y: 0, angle: 0, rotation: 0, scaleX: 1, scaleY: 1,
    displayOriginX: 5, displayOriginY: 13, displayWidth: 10, displayHeight: 26,
    setPosition(x: number, y: number) { this.x = x; this.y = y; },
  };
  const body = new ArcadeBody(world, shapedPlayer ? gameObject as never : undefined);
  if (shapedPlayer) h.host.getPlayer = () => gameObject;
  body.setSize(10, 26, false); body.reset(0, 0); body.setCollideWorldBounds(true);
  switch (environment.gravityDirection) {
    case 'down': world.setBounds(-10000, -10000, 20000, 10026, false, false, false, true); break;
    case 'up': world.setBounds(-10000, 0, 20000, 10000, false, false, true, false); break;
    case 'left': world.setBounds(0, -10000, 10000, 20000, true, false, false, false); break;
    case 'right': world.setBounds(-10000, -10000, 10010, 20000, false, true, false, false); break;
  }
  world.add(body);
  h.host.getPlayerBody = () => body as never;
  const scene = new EventEmitter();
  const cadence = new OverworldPhysicsCadence(scene, world, {
    canSimulate: () => true, getPlayerIdentity: () => body,
    captureInput: () => {
      const value = h.controller.captureInput();
      h.cursors.space.justDown = false;
      return value;
    },
    simulateEnvironment: () => {},
    simulateMovement: (delta, input) => {
      const sprite = body.gameObject;
      if (legacyHitbox) body.gameObject = undefined as never;
      try { return h.controller.updateMovement(delta, scenario === 'quicksand', input); }
      finally { body.gameObject = sprite; }
    },
  });
  if (legacyRenderMovement) cadence.destroy();
  // Settle against the actual world boundary before pressing jump or starting a slide.
  for (let i = 0; i < 12; i += 1) {
    h.controller.updateMovement(1000 / 60, false);
    world.update(i * 1000 / 60, 1000 / 60); world.postUpdate();
  }
  if (shapedPlayer) h.setForceFullBody(false);
  if (scenario.startsWith('ice')) body.setVelocityX(120);
  if (scenario === 'buffered-release') { body.reset(0, -32); h.controller.reset(); }
  if (scenario === 'coyote-release') {
    body.setCollideWorldBounds(false); h.controller.reset(); h.seam.state.coyoteTime = 110;
  }
  let forgivenPressed = false;
  const samples: TrajectorySample[] = [];
  world.on('worldstep', () => samples.push({ x: body.x, y: body.y, vx: body.velocity.x, vy: body.velocity.y }));
  for (let frame = 1; frame <= hz * 4; frame += 1) {
    const time = frame * 1000 / hz;
    h.setNow(1000 + time);
    const jumping = !scenario.startsWith('ice') && !scenario.includes('wind');
    h.cursors.space.isDown = jumping && (scenario === 'tap' || scenario === 'quicksand' ? time < 80 : true);
    h.cursors.space.justDown = jumping && frame === 1;
    if (scenario === 'buffered-release' || scenario === 'coyote-release') {
      const ready = scenario === 'buffered-release' ? body.y >= -14 : samples.length >= 4;
      h.cursors.space.justDown = !forgivenPressed && ready;
      if (h.cursors.space.justDown) forgivenPressed = true;
      h.cursors.space.isDown = false;
    }
    h.cursors.right.isDown = scenario === 'ice-acceleration';
    scene.emit('preupdate');
    world.update(time, 1000 / hz);
    if (legacyRenderMovement) {
      h.controller.updateMovement(1000 / hz, scenario === 'quicksand');
      h.cursors.space.justDown = false;
    }
    world.postUpdate();
  }
  cadence.destroy(); world.destroy();
  return samples.slice(0, 180);
}

describe('actual Arcade trajectories with fixed-step movement', () => {
  it('keeps changing airborne hitboxes aligned during catch-up steps', () => {
    const baseline = runActualPhysics(60, 'held', false, true);
    expect(Math.min(...baseline.map(sample => sample.vy))).toBeLessThan(-150);
    for (const hz of [30, 90, 120, 144, 165, 240]) {
      const samples = runActualPhysics(hz, 'held', false, true);
      expect(samples).toHaveLength(baseline.length);
      for (let i = 0; i < samples.length; i += 1) {
        for (const key of ['x', 'y', 'vx', 'vy'] as const) {
          expect(samples[i][key], `${hz}Hz step ${i} ${key}`).toBeCloseTo(baseline[i][key], 8);
        }
      }
    }
    const previous60 = runActualPhysics(60, 'held', false, true, true);
    const previous30 = runActualPhysics(30, 'held', false, true, true);
    expect(Math.min(...baseline.map(sample => sample.y)))
      .toBeCloseTo(Math.min(...previous60.map(sample => sample.y)), 8);
    expect(Math.max(...previous30.map((sample, i) => Math.abs(sample.y - previous60[i].y))))
      .toBeGreaterThan(8);
  });
  it.each(['tap', 'held', 'quicksand', 'water', 'ice-coast', 'ice-acceleration', 'ice-conveyor', 'ice-wind',
    'wind', 'gravity-up', 'gravity-left', 'gravity-right', 'buffered-release', 'coyote-release'])('%s follows the same trajectory at all seven render rates', scenario => {
    const baseline = runActualPhysics(60, scenario);
    expect(baseline).toHaveLength(180);
    for (const hz of [30, 90, 120, 144, 165, 240]) {
      const samples = runActualPhysics(hz, scenario);
      expect(samples, `${scenario} at ${hz}Hz`).toHaveLength(180);
      for (let i = 0; i < samples.length; i += 1) {
        for (const key of ['x', 'y', 'vx', 'vy'] as const) {
          expect(samples[i][key], `${scenario} ${hz}Hz step ${i} ${key}`).toBeCloseTo(baseline[i][key], 8);
        }
      }
    }
  });

  it('keeps the original 60Hz tap-jump apex and ice travel, and detects the original high-refresh defects', () => {
    for (const scenario of ['tap', 'held', 'ice-coast', 'ice-acceleration', 'gravity-up']) {
      const legacy = runActualPhysics(60, scenario, true);
      const fixed = runActualPhysics(60, scenario);
      const maxDisplacement = (samples: TrajectorySample[]) => Math.max(...samples.map(s => Math.abs(s.y)));
      if (scenario.startsWith('ice')) expect(fixed.at(-1)!.x).toBeCloseTo(legacy.at(-1)!.x, 8);
      else expect(maxDisplacement(fixed)).toBeCloseTo(maxDisplacement(legacy), 8);
    }
    const apex = (hz: number) => Math.max(...runActualPhysics(hz, 'gravity-up', true).map(s => s.y));
    expect(apex(120)).toBeLessThan(apex(60) * 0.7);
    const coast = (hz: number) => runActualPhysics(hz, 'ice-coast', true).at(-1)!.x;
    expect(coast(120)).toBeLessThan(coast(60) * 0.7);
  });
});


describe('jump forgiveness boundaries', () => {
  const directions = ['down', 'up', 'left', 'right'] as const;
  const environment = (gravityDirection: SpecialTilePlayerEnvironment['gravityDirection']): SpecialTilePlayerEnvironment => ({
    inWater: false, onIce: false, onSticky: false, conveyorX: 0, windX: 0,
    gravityDirection, onBounce: false, onDamage: false,
  });
  const groundSide = (gravity: typeof directions[number]) => gravity;

  it.each(directions)('%s uses 110ms coyote grace and protects a released late jump', gravity => {
    const h = createHarness(environment(gravity)), normal = getGravityVector(gravity);
    h.seam.state.coyoteTime = 110;
    h.cursors.space.justDown = true;
    h.controller.updateMovement(100, false);
    expect(getBodyVelocityAlongVector(h.body as never, normal)).toBe(-220);
    expect(h.controller.getDebugSnapshot().protectedJumpMs).toBe(70);
    h.cursors.space.justDown = false;
    h.controller.updateMovement(60, false);
    expect(h.controller.getDebugSnapshot().protectedJumpMs).toBe(10);
    h.controller.updateMovement(10, false);
    expect(h.controller.getDebugSnapshot().protectedJumpMs).toBe(0);
    expect(getBodyVelocityAlongVector(h.body as never, normal)).toBeGreaterThan(-220);
    const expired = createHarness(environment(gravity));
    expired.seam.state.coyoteTime = 110; expired.cursors.space.justDown = true;
    expired.controller.updateMovement(110, false);
    expect(expired.host.playJumpDustFx).not.toHaveBeenCalled();
  });

  it.each(directions)('%s caps landing at 120ms while retaining 240ms wall buffering', gravity => {
    for (const elapsed of [119, 120]) {
      const h = createHarness(environment(gravity)); h.cursors.space.justDown = true;
      h.controller.updateMovement(16, false);
      expect(h.controller.getDebugSnapshot()).toMatchObject({ jumpBufferMs: 120, wallJumpBufferMs: 240 });
      h.cursors.space.justDown = false; h.body.blocked[groundSide(gravity)] = true;
      h.controller.updateMovement(elapsed, false);
      expect(h.host.playJumpDustFx).toHaveBeenCalledTimes(elapsed === 119 ? 1 : 0);
      if (elapsed === 119) expect(h.controller.getDebugSnapshot()).toMatchObject({
        protectedJumpMs: 70, jumpBufferMs: 0, wallJumpBufferMs: 0,
      });
      else expect(h.controller.getDebugSnapshot()).toMatchObject({ jumpBufferMs: 0, wallJumpBufferMs: 120 });
    }
    const wall = createHarness(environment(gravity)); wall.cursors.space.justDown = true;
    wall.controller.updateMovement(16, false); wall.cursors.space.justDown = false;
    const tangent = getGravityRightVector(gravity);
    const side = tangent.x === 1 ? 'right' : tangent.x === -1 ? 'left' : tangent.y === 1 ? 'down' : 'up';
    wall.body.blocked[side] = true; wall.controller.updateMovement(200, false);
    expect(wall.host.playJumpDustFx).toHaveBeenCalledOnce();
    expect(wall.controller.getDebugSnapshot()).toMatchObject({ wallJumpActive: true,
      protectedJumpMs: 70, jumpBufferMs: 0, wallJumpBufferMs: 0 });
  });

  it.each(['reset', 'handleNoPlayerRuntime', 'handlePlayerCreated', 'handlePlayerDestroyed',
    'handleRespawnReset', 'resetTransientPlayState'] as const)('%s clears pending and protected jumps', method => {
    const h = createHarness(); h.cursors.space.justDown = true; h.controller.updateMovement(16, false);
    h.controller[method]();
    expect(h.controller.getDebugSnapshot()).toMatchObject({ jumpBuffered: false, jumpBufferMs: 0,
      wallJumpBufferMs: 0, protectedJumpMs: 0, coyoteMs: 0, cornerCorrections: 0 });
  });

  it('gives released buffered jumps useful height in actual Arcade physics', () => {
    const samples = runActualPhysics(60, 'buffered-release');
    const launched = samples.findIndex(sample => sample.vy < -150);
    expect(launched).toBeGreaterThan(0);
    const launchFeet = samples[launched].y;
    expect(launchFeet - Math.min(...samples.slice(launched).map(sample => sample.y))).toBeGreaterThan(18);
  });
});

function createCornerHarness(gravity: SpecialTilePlayerEnvironment['gravityDirection']) {
  const world = new ArcadeWorld({ sys: { scale: { width: 640, height: 352 } } } as never,
    { gravity: { x: 0, y: 0 }, debug: false });
  const player = { x: 100, y: 100, angle: 0, rotation: 0, scaleX: 1, scaleY: 1,
    displayOriginX: 0, displayOriginY: 0, displayWidth: 10, displayHeight: 14,
    setPosition(x: number, y: number) { this.x = x; this.y = y; } };
  const body = new ArcadeBody(world, player as never); body.setSize(10, 14, false); body.reset(100, 100);
  const room = { coordinates: { x: 0, y: 0 } };
  const host = {
    getCurrentRoomCoordinates: () => room.coordinates, getRoomOrigin: () => ({ x: 0, y: 0 }),
    getRoomSnapshotForCoordinates: () => room as never,
    isSolidTerrainAtWorldPoint: vi.fn((_room: unknown, _x: number, _y: number) => false),
    getRuntimeSolidLiveObjectsInBounds: () => [] as LoadedRoomObject[],
    getArcadeBodyBounds: (other: { left: number; top: number; width: number; height: number }) =>
      new MockRectangle(other.left, other.top, other.width, other.height) as never,
  };
  const controller = new OverworldJumpCornerCorrection(host);
  const normal = getGravityVector(gravity), tangent = getGravityRightVector(gravity);
  body.setVelocity(-normal.x * 200, -normal.y * 200); controller.remember(body, gravity);
  const head: 'up' | 'down' | 'left' | 'right' = gravity === 'down' ? 'up' : gravity === 'up' ? 'down' : gravity === 'left' ? 'right' : 'left';
  body.setVelocity(0, 0); body.blocked[head] = true;
  return { world, player, body, host, controller, normal, tangent, head };
}

describe('actual Arcade corner correction', () => {
  it.each(['down', 'up', 'left', 'right'] as const)('%s clears a two-pixel corner and restores the rise', gravity => {
    const h = createCornerHarness(gravity);
    const edge = h.tangent.x ? h.body.right - 2 : h.body.bottom - 2;
    h.host.isSolidTerrainAtWorldPoint.mockImplementation((_room, x, y) => {
      const headCoordinate = x * h.normal.x + y * h.normal.y;
      const bodyHead = h.normal.x === 1 ? h.body.left : h.normal.x === -1 ? -h.body.right :
        h.normal.y === 1 ? h.body.top : -h.body.bottom;
      return headCoordinate < bodyHead && (h.tangent.x ? x : y) >= edge;
    });
    const before = { x: h.body.x, y: h.body.y, px: h.player.x, py: h.player.y,
      prevX: h.body.prev.x, frameX: h.body.prevFrame.x };
    expect(h.controller.correct(h.player as never, h.body, gravity)).toBe(true);
    const dx = h.body.x - before.x, dy = h.body.y - before.y;
    expect(Math.abs(dx) + Math.abs(dy)).toBe(2);
    expect(h.player.x - before.px).toBe(dx); expect(h.player.y - before.py).toBe(dy);
    expect(h.body.prev.x - before.prevX).toBe(dx); expect(h.body.prevFrame.x - before.frameX).toBe(dx);
    expect(getBodyVelocityAlongVector(h.body, h.normal)).toBe(-200);
    expect(h.body.blocked[h.head]).toBe(false);
    expect(h.controller.describe().cornerCorrections).toBe(1); h.world.destroy();
  });

  it('retains Arcade gravity for the collided step and keeps sprite/body alignment after postUpdate', () => {
    const h = createCornerHarness('down'); h.world.gravity.y = 700;
    expect(h.controller.correct(h.player as never, h.body, 'down', 1000 / 60)).toBe(true);
    expect(h.body.velocity.y).toBeCloseTo(-200 + 700 / 60, 8);
    h.body.postUpdate();
    expect(h.player.x).toBe(h.body.x); expect(h.player.y).toBe(h.body.y);
    h.world.destroy();
  });

  it('rejects broad ceilings, missing rooms, room edges, resets and falling motion', () => {
    for (const kind of ['broad', 'missing', 'edge', 'reset', 'falling']) {
      const h = createCornerHarness('down');
      if (kind === 'broad') h.host.isSolidTerrainAtWorldPoint.mockReturnValue(true);
      if (kind === 'missing') h.host.getRoomSnapshotForCoordinates = () => null as never;
      if (kind === 'edge') { h.body.x = 0; h.body.y = 0; h.body.updateCenter(); }
      if (kind === 'reset') h.controller.reset();
      if (kind === 'falling') { h.body.setVelocityY(20); h.controller.remember(h.body, 'down'); }
      expect(h.controller.correct(h.player as never, h.body, 'down'), kind).toBe(false);
      expect(h.controller.describe().cornerCorrections).toBe(0); h.world.destroy();
    }
  });

  it('checks enabled runtime solids across the complete candidate body', () => {
    const h = createCornerHarness('down');
    const config = GAME_OBJECTS.find(object => object.id === 'brick_box')!;
    const object = { config, layer: 'terrain', runtime: { npcPlayerCollision: false }, sprite: {
      active: true, body: { enable: true, left: 90, top: 99, right: 120, bottom: 130, width: 30, height: 31 },
    } } as unknown as LoadedRoomObject;
    h.host.getRuntimeSolidLiveObjectsInBounds = () => [object];
    expect(h.controller.correct(h.player as never, h.body, 'down')).toBe(false);
    (object.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    expect(h.controller.correct(h.player as never, h.body, 'down')).toBe(true);
    h.world.destroy();
  });
});

describe('traversal jumps and springs through the movement owner', () => {
  const enablePickup = (h: ReturnType<typeof createHarness>) => Object.assign(h.body, { enable: true });
  const pressJump = (h: ReturnType<typeof createHarness>) => {
    h.cursors.space.justDown = true; h.cursors.space.isDown = true;
    h.controller.updateMovement(16, false);
    h.cursors.space.justDown = false;
  };

  it('takes a grounded feather through the normal jump, spends it once in midair, and clears both buffers', () => {
    const h = createHarness(); enablePickup(h); h.body.blocked.down = true;
    expect(h.controller.grantAirJump()).toBe(true); expect(h.controller.grantAirJump()).toBe(false);
    pressJump(h); expect(h.body.velocity.y).toBe(-220);
    expect(h.controller.getDebugSnapshot().airJumpAvailable).toBe(true);
    h.body.blocked.down = false; h.body.velocity.y = 40; pressJump(h);
    expect(h.body.velocity.y).toBe(-220);
    expect(h.controller.getDebugSnapshot()).toMatchObject({ airJumpAvailable: false, jumpBufferMs: 0, wallJumpBufferMs: 0 });
    h.body.velocity.y = 60; pressJump(h); expect(h.body.velocity.y).toBe(60);
  });

  it.each(['down', 'up', 'left', 'right'] as const)('restarts the rise against %s gravity and preserves tangent velocity', direction => {
    const environment = { inWater: false, onIce: false, onSticky: false, conveyorX: 0 as const, windX: 0 as const,
      gravityDirection: direction, onBounce: false, onDamage: false };
    const h = createHarness(environment); enablePickup(h); h.cursors.right.isDown = direction === 'down';
    expect(h.controller.grantAirJump()).toBe(true); pressJump(h);
    expect(getBodyVelocityAlongVector(h.body as never, getGravityVector(direction))).toBe(-220);
    expect(h.controller.getDebugSnapshot().airJumpAvailable).toBe(false);
    expect(h.controller.grantAirJump()).toBe(true); h.body.setVelocity(0, 100); pressJump(h);
    expect(getBodyVelocityAlongVector(h.body as never, getGravityVector(direction))).toBe(-220);
  });

  it('prioritizes a coyote jump and keeps the feather for a later jump', () => {
    const h = createHarness(); enablePickup(h); h.seam.state.coyoteTime = 80;
    h.controller.grantAirJump(); pressJump(h);
    expect(h.controller.getDebugSnapshot().airJumpAvailable).toBe(true);
    h.body.velocity.y = 80; pressJump(h);
    expect(h.controller.getDebugSnapshot().airJumpAvailable).toBe(false);
  });

  it('clears the charge on landing, wall attachment and every play reset', () => {
    const h = createHarness(); enablePickup(h);
    h.controller.grantAirJump(); h.body.blocked.down = true; h.controller.updateMovement(16, false);
    expect(h.controller.getDebugSnapshot().airJumpAvailable).toBe(false);
    h.body.blocked.down = false; h.controller.updateMovement(16, false); h.controller.grantAirJump();
    h.body.blocked.right = true; h.body.velocity.y = 140; h.cursors.right.isDown = true;
    h.controller.updateMovement(16, false);
    expect(h.controller.getDebugSnapshot().airJumpAvailable).toBe(false);
    h.body.blocked.right = false; h.cursors.right.isDown = false; h.controller.updateMovement(16, false);
    for (const method of ['reset', 'handleNoPlayerRuntime', 'handlePlayerCreated', 'handlePlayerDestroyed', 'handleRespawnReset', 'resetTransientPlayState'] as const) {
      h.controller.grantAirJump(); h.controller.launchFromSpring(300, -300, 180); h.controller[method]();
      expect(h.controller.getDebugSnapshot()).toMatchObject({ airJumpAvailable: false, springInputLockMs: 0 });
    }
  });

  it('does not replay the consumed air-jump input when a wall arrives next frame', () => {
    const h = createHarness(); enablePickup(h); h.controller.grantAirJump(); pressJump(h);
    h.body.velocity.y = 100; h.body.blocked.right = true; h.cursors.right.isDown = true;
    h.controller.updateMovement(16, false);
    expect(h.body.velocity.y).toBe(70);
    expect(h.controller.getDebugSnapshot().wallJumpActive).toBe(false);
  });

  it('preserves a spring launch against opposing input, then restores steering and cancels on a wall', () => {
    const h = createHarness(); h.cursors.left.isDown = true;
    h.controller.launchFromSpring(350, -300, 180); h.controller.updateMovement(16, false);
    expect(h.body.velocity).toEqual({ x: 350, y: -300 });
    h.setNow(1181); h.controller.updateMovement(16, false); expect(h.body.velocity.x).toBe(-120);
    h.controller.launchFromSpring(350, -300, 180); h.body.blocked.right = true;
    h.controller.updateMovement(16, false); expect(h.body.velocity.x).toBe(-120);
  });

  it('lets the feather interrupt a butt stomp without losing its jump', () => {
    const h = createHarness(); enablePickup(h); h.controller.grantAirJump(); h.seam.startButtStomp(h.body);
    pressJump(h); expect(h.controller.isButtStomping()).toBe(false); expect(h.body.velocity.y).toBe(-220);
  });
});


describe('nonfatal hurt movement', () => {
  it.each(['down', 'up', 'left', 'right'] as const)('pushes away from facing against %s gravity, then restores steering', gravity => {
    const h = createHarness({ inWater: false, onIce: false, onSticky: false, conveyorX: 0, windX: 0,
      gravityDirection: gravity, onBounce: false, onDamage: false });
    // Establish this gravity before damage so the next frame is a normal step.
    h.controller.updateMovement(16, false);
    h.controller.applyHurtKnockback(1);
    expect(getBodyVelocityAlongVector(h.body as never, getGravityRightVector(gravity))).toBeCloseTo(-100);
    expect(getBodyVelocityAlongVector(h.body as never, getGravityVector(gravity))).toBeCloseTo(-120);
    h.controller.updateMovement(16, false);
    expect(getBodyVelocityAlongVector(h.body as never, getGravityRightVector(gravity))).toBeCloseTo(-100);
    h.setNow(1200); h.controller.updateMovement(16, false);
    expect(getBodyVelocityAlongVector(h.body as never, getGravityRightVector(gravity))).toBeCloseTo(0);
  });

  it.each(['reset', 'handleNoPlayerRuntime', 'handlePlayerCreated', 'handlePlayerDestroyed',
    'handleRespawnReset', 'resetTransientPlayState'] as const)('%s cancels damage recoil before the next life', method => {
    const h = createHarness(); h.controller.applyHurtKnockback(-1);
    h.controller[method](); h.controller.updateMovement(16, false);
    expect(h.body.velocity.x).toBeCloseTo(0);
  });
});
