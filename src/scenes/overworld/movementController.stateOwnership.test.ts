import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import type { SpecialTilePlayerEnvironment } from './specialTiles';
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
    coyoteMs: 80,
    jumpBufferMs: 100,
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
      jumpBufferMs: 224,
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
  const samples: TrajectorySample[] = [];
  world.on('worldstep', () => samples.push({ x: body.x, y: body.y, vx: body.velocity.x, vy: body.velocity.y }));
  for (let frame = 1; frame <= hz * 4; frame += 1) {
    const time = frame * 1000 / hz;
    h.setNow(1000 + time);
    const jumping = !scenario.startsWith('ice') && !scenario.includes('wind');
    h.cursors.space.isDown = jumping && (scenario === 'tap' || scenario === 'quicksand' ? time < 80 : true);
    h.cursors.space.justDown = jumping && frame === 1;
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
    'wind', 'gravity-up', 'gravity-left', 'gravity-right'])('%s follows the same trajectory at all seven render rates', scenario => {
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
