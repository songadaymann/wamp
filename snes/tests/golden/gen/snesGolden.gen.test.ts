/**
 * SNESWAMP golden physics trace generator.
 *
 * NOT part of the web game's test suite. `run.sh` (next to this file) copies it into
 * a scratch copy of the repo at `src/scenes/overworld/` and runs it with vitest.
 *
 * It drives the REAL OverworldMovementController + OverworldPhysicsCadence +
 * OverworldJumpCornerCorrection + OverworldSpecialTilesController (one-way rule and
 * drop-through only) against REAL Phaser Arcade physics (World, Body, Collider and the
 * tilemap separation code) on a 40x22 tile layer built from an ASCII mask, exactly the way
 * `fullRoomPresenter.ts` builds the invisible collision layer:
 *   tiles -> setCollisionByExclusion([-1]) -> world.addCollider(player, layer, undefined, processCallback).
 * Only the `phaser` *package entry* is mocked (it needs a browser); every Phaser class that
 * takes part in the simulation is loaded from `phaser/src/...` unmodified.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('phaser', async () => {
  const nodeModule = await import('node:module') as unknown as { createRequire(url: string): (id: string) => unknown };
  const req = nodeModule.createRequire(import.meta.url);
  const Rectangle = req('phaser/src/geom/rectangle/Rectangle.js');
  const RectangleToRectangle = req('phaser/src/geom/intersects/RectangleToRectangle.js');
  const Clamp = req('phaser/src/math/Clamp.js');
  const Linear = req('phaser/src/math/Linear.js');
  return {
    default: {
      Geom: { Rectangle, Intersects: { RectangleToRectangle } },
      Math: { Clamp, Linear },
      Input: { Keyboard: { JustDown: () => false } },
      Animations: { Events: { ANIMATION_COMPLETE: 'animationcomplete' } },
      Textures: { FilterMode: { NEAREST: 0 } },
    },
  };
});
vi.mock('../../audio/sfx', () => ({ playSfx: () => {}, stopSfx: () => {} }));
vi.mock('../../ui/mobile/touchControls', () => ({
  consumeTouchAction: () => false,
  getTouchInputState: () => ({ active: false, moveX: 0, moveY: 0, jumpHeld: false, stickMoveX: 0, stickMoveY: 0,
    stickDirectionX: 0, stickDirectionY: 0, forwardedMoveX: 0, forwardedMoveY: 0 }),
}));

import { OverworldMovementController } from './movementController';
import { OverworldPhysicsCadence, type OverworldMovementInput } from './physicsCadence';
import { OverworldSpecialTilesController } from './specialTiles';
import {
  roomHasTerrainTile, terrainTileCollidesAtLocalPixel, terrainTileDisablesTilemapCollision,
  getTerrainCollisionTileValue,
} from './terrainCollision';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import { ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../../config';
import { SPECIAL_TILE_ONE_WAY_PLATFORM_GID } from '../../config/tilesets';

const req = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const ArcadeWorld: any = req('phaser/src/physics/arcade/World.js');
const ArcadeBody: any = req('phaser/src/physics/arcade/Body.js');
// Tile.js mixes in three render-only components through `gameobjects/components/index.js`, whose
// other exports need a browser (`window`). Pre-seed the require cache for that index with the three
// unmodified component modules so that the unmodified Tile.js loads under Node.
{
  const indexPath = req.resolve('phaser/src/gameobjects/components/index.js');
  req.cache[indexPath] = { id: indexPath, filename: indexPath, loaded: true, exports: {
    AlphaSingle: req('phaser/src/gameobjects/components/AlphaSingle.js'),
    Flip: req('phaser/src/gameobjects/components/Flip.js'),
    Visible: req('phaser/src/gameobjects/components/Visible.js'),
  } } as never;
}
const Tile: any = req('phaser/src/tilemaps/Tile.js');
const LayerData: any = req('phaser/src/tilemaps/mapdata/LayerData.js');
const SetCollisionByExclusion: any = req('phaser/src/tilemaps/components/SetCollisionByExclusion.js');
const CalculateFacesWithin: any = req('phaser/src/tilemaps/components/CalculateFacesWithin.js');
const WorldToTileXY: any = req('phaser/src/tilemaps/components/WorldToTileXY.js');
const TileToWorldXY: any = req('phaser/src/tilemaps/components/TileToWorldXY.js');
const Rectangle: any = req('phaser/src/geom/rectangle/Rectangle.js');
const PHASER_VERSION: string = req('phaser/package.json').version;

const OUT_DIR = process.env.GOLDEN_OUT ?? join(process.cwd(), 'golden-out');
const SOLID_GID = 29; // forest tileset local index 28: profile 'decoratedTop' (topInset 0 = full 16x16 box; asserted below)
const LEAD_IN = 5;   // idle steps before any scripted button

// Scene constants, OverworldPlayScene.ts:417-466 and playerLifecycle.ts:62-77.
const OPTIONS = {
  playerWidth: 10, playerHeight: 14, playerStandingHeight: 26, playerCrouchHeight: 14, playerPushHeight: 22,
  playerSpeed: 150, crawlSpeed: 70, cratePushSpeed: 78, cratePullSpeed: 66, crateInteractionMaxGap: 14,
  coyoteMs: 110, jumpBufferMs: 120, wallJumpBufferMs: 240, wallContactGraceMs: 140, jumpVelocity: -280,
  wallSlideMaxFallSpeed: 70, wallJumpVelocityX: 205, wallJumpVelocityY: -265, wallJumpInputLockMs: 240,
  ladderClimbSpeed: 90, quicksandMoveFactor: 0.56, quicksandJumpFactor: 0.92, weaponKnockbackMs: 90,
};
const GRAVITY_Y = 700;
const MAX_VELOCITY_Y = 500;

type Buttons = string; // subset of "LRUDJ" (J = jump button, U = d-pad up which is also a jump)

interface StepRecord {
  step: number; in: Buttons; pressed: Buttons;
  x: number; y: number; vx: number; vy: number; grounded: boolean; h: number;
  blocked: string; pre_vx: number; pre_vy: number; pre_blocked: string;
  crouch: boolean; coyote_ms: number; jbuf_ms: number; wjbuf_ms: number; prot_ms: number;
  wall_slide: boolean; wall_side: number; wall_grace_side: number;
  wj_active: boolean; wj_dir: number; wj_chain: boolean; wj_lock_ms: number;
  corner_n: number; corner_shift: number; drop_ms: number;
  stomp: boolean; stomp_flip_ms: number; stomp_grace_ms: number;
}
interface Ctx { step: number; last: StepRecord; history: StepRecord[] }
type Script = (ctx: Ctx) => Buttons;

const r6 = (value: number) => { const v = Number(value.toFixed(6)); return Object.is(v, -0) ? 0 : v; };
const flags = (b: { up: boolean; down: boolean; left: boolean; right: boolean }) =>
  `${b.down ? 'd' : ''}${b.up ? 'u' : ''}${b.left ? 'l' : ''}${b.right ? 'r' : ''}`;

function buildRoom(rows: string[]): RoomSnapshot {
  expect(rows).toHaveLength(ROOM_HEIGHT);
  const room = createDefaultRoomSnapshot('snes-golden', { x: 0, y: 0 });
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    expect(rows[y], `row ${y}`).toHaveLength(ROOM_WIDTH);
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      const c = rows[y][x];
      room.tileData.terrain[y][x] = c === '#' ? SOLID_GID : c === '=' ? SPECIAL_TILE_ONE_WAY_PLATFORM_GID : -1;
    }
  }
  return room;
}

function simulate(rows: string[], spawnFeet: { x: number; y: number }, steps: number, script: Script) {
  const room = buildRoom(rows);
  let now = 1000;

  const world = new ArcadeWorld({ sys: { scale: { width: 640, height: 352 } } },
    { gravity: { x: 0, y: 0 }, debug: false });
  world.gravity.y = GRAVITY_Y; // OverworldPlayScene.ts:1373

  // --- invisible collision layer (fullRoomPresenter.ts:231-250, 332-353, 445-460) ---
  const layer = new LayerData({ name: 'terrain', width: ROOM_WIDTH, height: ROOM_HEIGHT,
    tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
  const camera = { scrollX: 0, scrollY: 0 };
  const tilemapLayer: any = {
    isTilemap: true, layer, x: 0, y: 0, scaleX: 1, scaleY: 1, scrollFactorX: 1, scrollFactorY: 1,
    collisionCategory: 1, collisionMask: 1,
    scene: { cameras: { main: camera } },
    tilemap: { _convert: { WorldToTileXY, TileToWorldXY } },
    tileToWorldXY: (tx: number, ty: number, point?: unknown) => TileToWorldXY(tx, ty, point, camera, layer),
  };
  layer.tilemapLayer = tilemapLayer;
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    layer.data[y] = [];
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      const { gid } = getTerrainCollisionTileValue(room, x, y);
      layer.data[y][x] = new Tile(layer, gid > 0 ? gid : -1, x, y, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  SetCollisionByExclusion([-1], true, true, layer);
  let disabled = 0;
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      const tile = layer.data[y][x];
      if (tile.index !== -1) expect(roomHasTerrainTile(room, x, y)).toBe(true);
      if (tile.index !== -1 && terrainTileDisablesTilemapCollision(room, x, y)) {
        tile.setCollision(false, false, false, false); disabled += 1;
      }
    }
  }
  expect(disabled).toBe(0);
  CalculateFacesWithin(0, 0, ROOM_WIDTH, ROOM_HEIGHT, layer);

  // --- player anchor rectangle + body (playerLifecycle.ts:62-77) ---
  const player: any = {
    x: spawnFeet.x, y: spawnFeet.y - 13, angle: 0, rotation: 0, scaleX: 1, scaleY: 1,
    displayOriginX: 5, displayOriginY: 13, displayWidth: 10, displayHeight: 26,
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
    // Phaser.GameObjects.Rectangle has GetBounds.getTopLeft; Body.reset() uses it.
    getTopLeft(out: { x: number; y: number }) {
      out.x = this.x - this.displayOriginX; out.y = this.y - this.displayOriginY; return out;
    },
  };
  const body = new ArcadeBody(world, player);
  player.body = body;
  world.add(body);
  body.setCollideWorldBounds(false);
  body.setMaxVelocityY(MAX_VELOCITY_Y);
  body.setAllowGravity(true);

  const getRoomOrigin = (c: { x: number; y: number }) => ({ x: c.x * ROOM_WIDTH * TILE_SIZE, y: c.y * ROOM_HEIGHT * TILE_SIZE });
  const specialTiles = new OverworldSpecialTilesController({} as never, {
    getMode: () => 'play', getCurrentTime: () => now, getPlayerBody: () => body,
    getLoadedFullRooms: () => [], getLoadedFullRoomById: () => null,
    getRoomCoordinatesForPoint: () => ({ x: 0, y: 0 }), getRoomOrigin,
    grantExternalLaunchGrace: () => {}, isPlayerButtStomping: () => false,
    handlePlayerButtStompImpact: () => {}, handlePlayerDeath: () => {}, playBounceFx: () => {},
  } as never);

  const controller = new OverworldMovementController({
    getCurrentTime: () => now,
    getPlayer: () => player,
    getPlayerBody: () => body,
    getSpecialTileEnvironment: () => specialTiles.getPlayerEnvironment(),
    getPlayerFacing: () => 1,
    getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
    getRoomOrigin,
    getRoomSnapshotForCoordinates: (c: { x: number; y: number }) => (c.x === 0 && c.y === 0 ? room : null),
    // Copy of OverworldPlayScene.isSolidTerrainAtWorldPoint (Scene:3437-3453), no removed tiles.
    isSolidTerrainAtWorldPoint: (target: RoomSnapshot, worldX: number, worldY: number) => {
      const origin = getRoomOrigin(target.coordinates);
      const localX = Math.floor((worldX - origin.x) / TILE_SIZE);
      const localY = Math.floor((worldY - origin.y) / TILE_SIZE);
      if (localX < 0 || localX >= ROOM_WIDTH || localY < 0 || localY >= ROOM_HEIGHT) return false;
      return terrainTileCollidesAtLocalPixel(target, localX, localY, worldY - origin.y - localY * TILE_SIZE);
    },
    getExternalLaunchGraceUntil: () => 0,
    getExternalGrounded: () => false,
    shouldForceFullBodyHitbox: () => false,
    getPushableLiveObjectsInBounds: () => [],
    getRuntimeSolidLiveObjectsInBounds: () => [],
    getArcadeBodyBounds: (b: any) => new Rectangle(b.left, b.top, b.width, b.height),
    getKeyboardInput: () => ({ held: () => false, pressed: () => false }),
    findOverlappingLadder: () => null,
    playJumpDustFx: () => {},
    syncPlayerPickupSensor: () => {},
  } as never, OPTIONS);
  controller.handlePlayerCreated();

  world.addCollider(player, tilemapLayer, undefined,
    (_player: unknown, tile: unknown) => specialTiles.shouldCollidePlayerWithTerrainTile(tile as never));

  let held: Buttons = '';
  let previousHeld: Buttons = '';
  const makeInput = (): OverworldMovementInput => {
    const has = (k: string) => held.includes(k);
    const edge = (k: string) => has(k) && !previousHeld.includes(k);
    return {
      left: has('L'), right: has('R'), upKeyHeld: has('U'), downHeld: has('D'), spaceHeld: has('J'),
      touchLeft: false, touchRight: false, touchUp: false, touchDown: false,
      upPressed: edge('U'), downPressed: edge('D'), leftPressed: edge('L'), rightPressed: edge('R'),
      spacePressed: edge('J'),
    };
  };

  const snapshot = (step: number, pre: { vx: number; vy: number; blocked: string }, grounded: boolean): StepRecord => {
    const d = controller.getDebugSnapshot();
    const dropUntil = (specialTiles as unknown as { oneWayDropThroughUntil: number }).oneWayDropThroughUntil;
    return {
      step, in: held, pressed: [...held].filter(k => !previousHeld.includes(k)).join(''),
      x: r6(body.center.x), y: r6(body.bottom), vx: r6(body.velocity.x), vy: r6(body.velocity.y),
      grounded, h: body.height,
      blocked: flags(body.blocked), pre_vx: r6(pre.vx), pre_vy: r6(pre.vy), pre_blocked: pre.blocked,
      crouch: d.crouching, coyote_ms: d.coyoteMs, jbuf_ms: d.jumpBufferMs, wjbuf_ms: d.wallJumpBufferMs,
      prot_ms: d.protectedJumpMs, wall_slide: d.wallSliding, wall_side: d.wallContactSide,
      wall_grace_side: d.wallContactGraceSide, wj_active: d.wallJumpActive, wj_dir: d.wallJumpDirection,
      wj_chain: d.wallJumpChainActive, wj_lock_ms: d.wallJumpLockMs,
      corner_n: d.cornerCorrections, corner_shift: d.lastCornerShiftPx,
      drop_ms: Math.max(0, Math.round(dropUntil - now)),
      stomp: d.buttStomping, stomp_flip_ms: d.buttStompFlipMs, stomp_grace_ms: d.buttStompImpactGraceMs,
    };
  };

  const history: StepRecord[] = [];
  let pre = { vx: 0, vy: 0, blocked: '' };
  let stepsThisFrame = 0;
  let stepNumber = 0;
  // Registered before the cadence: state after integration + collision, before the controller.
  world.on('worldstep', () => {
    pre = { vx: body.velocity.x, vy: body.velocity.y, blocked: flags(body.blocked) };
  });
  const scene = new EventEmitter();
  let lastGrounded = false;
  const cadence = new OverworldPhysicsCadence(scene, world, {
    canSimulate: () => true,
    getPlayerIdentity: () => body,
    captureInput: makeInput,
    simulateEnvironment: () => {},
    // OverworldPlayScene.simulateMovementStep (Scene:2392-2409)
    simulateMovement: (delta, input) => {
      const movement = controller.updateMovement(delta, false, input);
      if (movement.downHeld && movement.jumpPressed) specialTiles.beginOneWayDropThrough();
      lastGrounded = movement.grounded;
      return movement;
    },
  });
  world.on('worldstep', () => { stepsThisFrame += 1; });

  history.push(snapshot(0, pre, false));
  for (stepNumber = 1; stepNumber <= steps; stepNumber += 1) {
    previousHeld = held;
    held = stepNumber <= LEAD_IN ? '' : script({ step: stepNumber, last: history[history.length - 1], history });
    held = [...'LRUDJ'].filter(k => held.includes(k)).join('');
    now = 1000 + stepNumber * 1000 / 60;
    stepsThisFrame = 0;
    scene.emit('preupdate');
    world.update(now, world._frameTimeMS);
    world.postUpdate();
    expect(stepsThisFrame, 'exactly one fixed step per frame').toBe(1);
    // The anchor rectangle must stay glued to the body: centre x, feet - 13.
    expect(player.x).toBeCloseTo(body.center.x, 9);
    expect(player.y).toBeCloseTo(body.bottom - 13, 9);
    history.push(snapshot(stepNumber, pre, lastGrounded));
  }
  cadence.destroy();
  world.destroy();
  return history;
}

// ---------------------------------------------------------------------------------------------
// Layout helpers. Legend: '.' empty, '#' solid, '=' one-way platform (special gid 670).
// ---------------------------------------------------------------------------------------------
function blank(): string[][] {
  const grid = Array.from({ length: ROOM_HEIGHT }, () => Array.from({ length: ROOM_WIDTH }, () => '.'));
  return grid;
}
function fill(grid: string[][], x1: number, y1: number, x2: number, y2: number, c = '#'): string[][] {
  for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) grid[y][x] = c;
  return grid;
}
const done = (grid: string[][]) => grid.map(row => row.join(''));
const flatFloor = () => fill(blank(), 0, 20, 39, 21);

interface Scenario {
  name: string; description: string; rows: string[]; spawn: { x: number; y: number };
  steps: number; script: Script; events?: (h: StepRecord[]) => Record<string, number | string | boolean | null>;
}

const after = (n: number) => LEAD_IN + n; // scripted step number n (1-based) after the idle lead-in
const firstStep = (h: StepRecord[], from: number, test: (r: StepRecord) => boolean) =>
  h.find(r => r.step >= from && test(r))?.step ?? null;

function jumpEvents(floorY: number, pressStep: number) {
  return (h: StepRecord[]) => {
    const air = h.filter(r => r.step > pressStep && !r.grounded);
    const apex = h.reduce((best, r) => (r.y < best.y ? r : best), h[0]);
    const land = firstStep(h, pressStep + 1, r => r.grounded);
    return {
      press_step: pressStep,
      apex_px: r6(floorY - apex.y), apex_step: apex.step, apex_steps_after_press: apex.step - pressStep,
      airborne_steps: air.length, land_step: land,
      first_step_at_launch_height: firstStep(h, pressStep + 2, r => r.y >= floorY - 1e-6),
      x_at_press: h[pressStep].x, x_at_land: land === null ? null : h[land].x,
      distance_px: land === null ? null : r6(h[land].x - h[pressStep].x),
    };
  };
}

function buildScenarios(): Scenario[] {
  const list: Scenario[] = [];
  const FLOOR = 320;

  // 1 / 2 / 3 ------------------------------------------------------------------------------
  list.push({
    name: '01_jump_held', description: 'Flat ground, standing still. Jump pressed on step 6 and held to the end.',
    rows: done(flatFloor()), spawn: { x: 104, y: FLOOR }, steps: 70,
    script: ({ step }) => (step >= after(1) ? 'J' : ''), events: jumpEvents(FLOOR, after(1)),
  });
  list.push({
    name: '02_jump_tap', description: 'Flat ground, standing still. Jump held for exactly one step (step 6), then released.',
    rows: done(flatFloor()), spawn: { x: 104, y: FLOOR }, steps: 45,
    script: ({ step }) => (step === after(1) ? 'J' : ''), events: jumpEvents(FLOOR, after(1)),
  });
  for (const hold of [2, 3, 4, 6, 8, 12]) {
    list.push({
      name: `02_jump_hold_${String(hold).padStart(2, '0')}`,
      description: `Flat ground, standing still. Jump held for ${hold} steps (steps 6..${5 + hold}), then released.`,
      rows: done(flatFloor()), spawn: { x: 104, y: FLOOR }, steps: 60,
      script: ({ step }) => (step >= after(1) && step < after(1) + hold ? 'J' : ''), events: jumpEvents(FLOOR, after(1)),
    });
  }
  list.push({
    name: '03_jump_run_right', description: 'Flat ground. Right held from step 6; jump pressed on step 16 and held; right held throughout.',
    rows: done(flatFloor()), spawn: { x: 104, y: FLOOR }, steps: 80,
    script: ({ step }) => (step >= after(11) ? 'RJ' : 'R'), events: jumpEvents(FLOOR, after(11)),
  });

  // 4 coyote ------------------------------------------------------------------------------
  // Upper ledge: columns 0..11, top at y=224 (row 14). Lower floor at y=320.
  const ledge = () => done(fill(flatFloor(), 0, 14, 11, 19));
  const ledgeSpawn = { x: 150, y: 224 };
  const probe = simulate(ledge(), ledgeSpawn, 60, () => 'R');
  const firstAir = firstStep(probe, LEAD_IN + 1, r => !r.grounded)!;
  list.push({
    name: '04_ledge_fall', description: 'Run right off a ledge with no jump (reference for the coyote traces).',
    rows: ledge(), spawn: ledgeSpawn, steps: 60, script: () => 'R',
    events: h => ({ first_airborne_step: firstStep(h, LEAD_IN + 1, r => !r.grounded),
      last_grounded_step: firstStep(h, LEAD_IN + 1, r => !r.grounded)! - 1,
      land_step: firstStep(h, firstAir, r => r.grounded) }),
  });
  for (const airborne of [1, 6, 7]) {
    const press = firstAir + airborne - 1;
    list.push({
      name: `04_coyote_air${airborne}`,
      description: `Run right off a ledge; jump pressed (and held) on airborne step ${airborne} ` +
        `(step ${press}; first airborne step is ${firstAir}).`,
      rows: ledge(), spawn: ledgeSpawn, steps: 100,
      script: ({ step }) => (step >= press ? 'RJ' : 'R'),
      events: h => ({ first_airborne_step: firstAir, press_step: press, airborne_step_of_press: airborne,
        jumped: h[press].vy < -200, vy_after_press_step: h[press].vy,
        min_y: Math.min(...h.map(r => r.y)), land_step: firstStep(h, press + 1, r => r.grounded) }),
    });
  }
  list.push({
    name: '04_coyote_air6_tap',
    description: `Coyote jump on airborne step 6 with a one-step tap (step ${firstAir + 5}): the 70 ms protected rise delays the release cut.`,
    rows: ledge(), spawn: ledgeSpawn, steps: 100,
    script: ({ step }) => (step === firstAir + 5 ? 'RJ' : 'R'),
    events: h => ({ first_airborne_step: firstAir, press_step: firstAir + 5, jumped: h[firstAir + 5].vy < -200,
      min_y: Math.min(...h.map(r => r.y)) }),
  });

  // 5 jump buffer ---------------------------------------------------------------------------
  const dropSpawn = { x: 104, y: FLOOR - 60 };
  const dropProbe = simulate(done(flatFloor()), dropSpawn, 60, () => '');
  const landStep = firstStep(dropProbe, 1, r => r.grounded)!;
  for (const before of [1, 7, 8]) {
    const press = landStep - before;
    list.push({
      name: `05_buffer_${before}_before_landing`,
      description: `Spawn 60 px above flat ground and fall. Jump pressed ${before} step(s) before the landing step ` +
        `(pressed on step ${press}, landing collision happens on step ${landStep}) and held.`,
      rows: done(flatFloor()), spawn: dropSpawn, steps: 110,
      script: ({ step }) => (step >= press ? 'J' : ''),
      events: h => ({ land_step: landStep, press_step: press, steps_before_landing: before,
        jumped_on_landing_step: h[landStep].vy < -200, vy_after_landing_step: h[landStep].vy,
        prot_ms_after_landing_step: h[landStep].prot_ms }),
    });
  }
  list.push({
    name: '05_buffer_7_tap',
    description: `As 05_buffer_7_before_landing but the jump is a one-step tap (step ${landStep - 7}): ` +
      'buffered jump with the button already released, protected rise of 70 ms then release cut.',
    rows: done(flatFloor()), spawn: dropSpawn, steps: 90,
    script: ({ step }) => (step === landStep - 7 ? 'J' : ''),
    events: h => ({ land_step: landStep, press_step: landStep - 7, jumped_on_landing_step: h[landStep].vy < -200,
      apex_px: r6(FLOOR - Math.min(...h.filter(r => r.step > landStep).map(r => r.y))) }),
  });

  // 6 wall slide / wall jump ------------------------------------------------------------------
  // Shaft: left wall columns 10-11, right wall columns 15-16 (rows 2..19); open x = 192..240.
  const shaft = () => done(fill(fill(flatFloor(), 10, 2, 11, 19), 15, 2, 16, 19));
  {
    // Closed-loop script; the resolved per-step buttons are stored in the trace.
    let phase = 0; let slideSteps = 0; let holdUntil = 0; let side: 'L' | 'R' = 'L'; let jumps = 0;
    list.push({
      name: '06_wall_slide_jump',
      description: 'Shaft 48 px wide. Run left into the wall, ground jump holding left, slide 8 steps, wall jump ' +
        '(jump held 10 steps) while holding toward the far wall, slide 8 steps, wall jump back, slide, third wall jump, ' +
        'then slide to the floor holding toward the wall.',
      rows: shaft(), spawn: { x: 216, y: FLOOR }, steps: 260,
      script: ({ step, last }) => {
        if (phase === 0) { // run to the left wall
          if (last.pre_blocked.includes('l') && last.grounded && step > after(12)) { phase = 1; holdUntil = step + 14; return 'LJ'; }
          return 'L';
        }
        if (step < holdUntil) return `${side}J`;
        if (phase === 1 || phase === 2) {
          slideSteps = last.wall_slide ? slideSteps + 1 : 0;
          if (jumps < 3 && slideSteps >= 8) {
            slideSteps = 0; jumps += 1; holdUntil = step + 10;
            side = side === 'L' ? 'R' : 'L'; phase = 2;
            return `${side}J`;
          }
        }
        return side;
      },
      events: h => {
        const launches = h.filter(r => r.pressed.includes('J') && r.wj_active && Math.abs(r.vx) > 200).map(r => r.step);
        return { ground_jump_step: h.find(r => r.pressed.includes('J'))!.step,
          wall_jump_steps: launches.join(','), wall_jump_count: launches.length,
          slide_vy_after_controller: 70, land_step: firstStep(h, launches[launches.length - 1] ?? 1, r => r.grounded) };
      },
    });
  }
  {
    list.push({
      name: '06_wall_jump_lock',
      description: 'Shaft 112 px wide. Ground jump against the left wall, slide 8 steps, tap wall jump (1 step) and ' +
        'immediately hold LEFT (back toward the wall): shows the 240 ms input lock, the 120 ms steer-back threshold ' +
        'and the release cut on a wall jump.',
      rows: done(fill(fill(flatFloor(), 10, 2, 11, 19), 19, 2, 20, 19)), spawn: { x: 216, y: FLOOR }, steps: 150,
      script: (() => {
        let phase = 0; let slideSteps = 0; let holdUntil = 0;
        return ({ step, last }: Ctx) => {
          if (phase === 0) {
            if (last.pre_blocked.includes('l') && last.grounded && step > after(12)) { phase = 1; holdUntil = step + 14; return 'LJ'; }
            return 'L';
          }
          if (step < holdUntil) return 'LJ';
          if (phase === 1) {
            slideSteps = last.wall_slide ? slideSteps + 1 : 0;
            if (slideSteps >= 8) { phase = 2; return 'LJ'; }
          }
          return 'L';
        };
      })(),
      events: h => {
        const launch = h.find(r => r.wj_active && r.pressed.includes('J'))!.step;
        const forced = h.filter(r => r.step >= launch && r.vx === 205).length;
        return { wall_jump_step: launch, steps_with_vx_205_after_controller: forced,
          first_step_vx_negative: firstStep(h, launch, r => r.vx < 0) };
      },
    });
  }

  // 7 head bump / corner correction -----------------------------------------------------------
  // Ceiling block row 17 (y 272..288), columns 0..9 (x < 160). Player body overlaps it by N px.
  for (const overlap of [1, 2, 3, 4, 5, 10]) {
    list.push({
      name: `07_corner_${String(overlap).padStart(2, '0')}px`,
      description: `Jump (held) under the right-hand corner of a ceiling block whose underside is 32 px above the floor. ` +
        `The body overlaps the block horizontally by ${overlap} px (body left = ${160 - overlap}, block right edge = 160). ` +
        (overlap <= 4 ? 'Corner correction nudges the player right.' : 'Too deep: plain head bump.'),
      rows: done(fill(flatFloor(), 0, 17, 9, 17)), spawn: { x: 165 - overlap, y: FLOOR }, steps: 70,
      script: ({ step }) => (step >= after(1) ? 'J' : ''),
      events: h => ({ press_step: after(1), overlap_px: overlap,
        corrections: h[h.length - 1].corner_n, shift_px: h[h.length - 1].corner_shift,
        bump_step: firstStep(h, after(1), r => r.pre_blocked.includes('u')),
        x_final: h[h.length - 1].x, apex_px: r6(FLOOR - Math.min(...h.map(r => r.y))) }),
    });
  }
  list.push({
    name: '07_corner_left_03px',
    description: 'Mirror case: ceiling block columns 10..19 (x >= 160), body overlaps it by 3 px on its left corner ' +
      '(body right = 163). vx = 0 so the preferred direction (-1) is tried first and succeeds at -3.',
    rows: done(fill(flatFloor(), 10, 17, 19, 17)), spawn: { x: 158, y: FLOOR }, steps: 70,
    script: ({ step }) => (step >= after(1) ? 'J' : ''),
    events: h => ({ corrections: h[h.length - 1].corner_n, shift_px: h[h.length - 1].corner_shift, x_final: h[h.length - 1].x }),
  });

  // 8 terminal velocity -----------------------------------------------------------------------
  list.push({
    name: '08_fall_terminal', description: 'Spawn with the feet at y=24 in mid-air above flat ground (296 px drop), no input.',
    rows: done(flatFloor()), spawn: { x: 320, y: 24 }, steps: 75, script: () => '',
    events: h => ({ first_step_vy_500: firstStep(h, 1, r => r.vy === 500), land_step: firstStep(h, 1, r => r.grounded),
      max_px_per_step: r6(Math.max(...h.slice(1).map((r, i) => r.y - h[i].y))) }),
  });

  // 9 run into a wall -------------------------------------------------------------------------
  list.push({
    name: '09_wall_stop',
    description: 'Run right into a 4-tile-high wall (columns 12-13, x=192), keep pushing 20 steps, release 5 steps, ' +
      'push 5 more, then run left.',
    rows: done(fill(flatFloor(), 12, 16, 13, 19)), spawn: { x: 104, y: FLOOR }, steps: 100,
    script: ({ step }) => (step <= after(55) ? 'R' : step <= after(60) ? '' : step <= after(65) ? 'R' : 'L'),
    events: h => ({ first_blocked_step: firstStep(h, 1, r => r.pre_blocked.includes('r')), x_at_wall: h[after(40)].x }),
  });

  // 10 one-way platform -----------------------------------------------------------------------
  // One-way tiles row 17 (top y=272), columns 5..8, 48 px above the floor.
  {
    let phase = 0; let timer = 0;
    list.push({
      name: '10_one_way',
      description: 'Jump (held) straight up through a one-way platform 48 px above the floor, land on it, idle 6 steps, ' +
        'hold Down 3 steps (crouch), press Jump with Down held (drop-through), release everything, land on the floor.',
      rows: done(fill(flatFloor(), 5, 17, 8, 17, '=')), spawn: { x: 104, y: FLOOR }, steps: 130,
      script: ({ step, last }) => {
        if (phase === 0) { if (step > after(3) && last.grounded && last.y < 300) { phase = 1; timer = 6; return ''; } return 'J'; }
        if (phase === 1) { timer -= 1; if (timer <= 0) { phase = 2; timer = 3; } return ''; }
        if (phase === 2) { timer -= 1; if (timer < 0) { phase = 3; return 'DJ'; } return 'D'; }
        return '';
      },
      events: h => {
        const drop = h.find(r => r.in === 'DJ')!.step;
        return { press_step: after(1), land_on_platform_step: firstStep(h, after(3), r => r.grounded && r.y < 300),
          platform_top_y: 272, drop_press_step: drop, vy_after_drop_step: h[drop].vy,
          land_on_floor_step: firstStep(h, drop + 1, r => r.grounded) };
      },
    });
  }
  list.push({
    name: '10_one_way_walk_off_and_under',
    description: 'Start on the one-way platform, walk right off its end, land, walk back left underneath it ' +
      '(a one-way tile never blocks sideways or from below), then jump up through it from below while moving left ' +
      '(steps 56..80), release everything and land on top of it.',
    rows: done(fill(flatFloor(), 5, 17, 8, 17, '=')), spawn: { x: 120, y: 272 }, steps: 110,
    script: ({ step }) => (step <= after(30) ? 'R' : step <= after(50) ? 'L' : step <= after(75) ? 'LJ' : ''),
    events: h => ({ first_airborne_step: firstStep(h, LEAD_IN + 1, r => !r.grounded),
      land_on_floor_step: firstStep(h, LEAD_IN + 2, r => r.grounded && r.y === FLOOR),
      jump_press_step: after(51), land_on_platform_step: firstStep(h, after(52), r => r.grounded && r.y === 272),
      ever_blocked_sideways_or_up: h.some(r => /[ulr]/.test(r.pre_blocked)),
      final_x: h[h.length - 1].x, final_y: h[h.length - 1].y }),
  });

  // 11 crouch / crawl -------------------------------------------------------------------------
  // Block row 18 (y 288..304), columns 10..15: a 16 px high tunnel between x=160 and x=256.
  list.push({
    name: '11_crouch_crawl',
    description: 'Run right into a block that leaves a 16 px gap above the floor (standing body is stopped), then hold ' +
      'Down+Right to crawl in, release Down inside (forced crouch), press Jump inside (ignored), keep Right until out ' +
      'and standing again.',
    rows: done(fill(flatFloor(), 10, 18, 15, 18)), spawn: { x: 104, y: FLOOR }, steps: 190,
    script: ({ step }) => {
      if (step <= after(30)) return 'R';
      if (step <= after(60)) return 'DR';
      if (step === after(75) || step === after(76)) return 'RJ';
      return 'R';
    },
    events: h => ({ first_blocked_step: firstStep(h, 1, r => r.pre_blocked.includes('r')), x_blocked: h[after(30)].x,
      crouch_start_step: firstStep(h, 1, r => r.crouch), stand_up_step: firstStep(h, after(61), r => !r.crouch),
      x_at_stand_up: h[firstStep(h, after(61), r => !r.crouch)!].x }),
  });
  list.push({
    name: '11_crouch_idle',
    description: 'Flat ground: hold Down 10 steps (crouch, body 14 px), Down+Right 20 steps (crawl 70 px/s), ' +
      'Down+Jump on one step (no jump while crouching), release.',
    rows: done(flatFloor()), spawn: { x: 104, y: FLOOR }, steps: 60,
    script: ({ step }) => (step <= after(10) ? 'D' : step <= after(30) ? 'DR' : step === after(31) ? 'DJ' : ''),
  });

  // 12 single-tile gap assist -----------------------------------------------------------------
  // Holes are one tile deep (row 20 only; row 21 stays solid) so a fall ends inside the room.
  const hole = (width: number) => done(fill(flatFloor(), 12, 20, 11 + width, 20, '.'));
  list.push({
    name: '12_gap_assist', description: 'Run right across a hole exactly one tile wide (column 12, x 192..208, 16 px deep).',
    rows: hole(1), spawn: { x: 150, y: FLOOR }, steps: 60, script: () => 'R',
    events: h => ({ max_y: Math.max(...h.map(r => r.y)), min_y: Math.min(...h.map(r => r.y)),
      always_grounded: h.slice(2).every(r => r.grounded),
      steps_without_blocked_down: h.filter(r => r.step > 1 && !r.pre_blocked.includes('d')).map(r => r.step).join(',') }),
  });
  list.push({
    name: '12_gap_assist_left', description: 'Run left across the same one-tile hole.',
    rows: hole(1), spawn: { x: 250, y: FLOOR }, steps: 60, script: () => 'L',
    events: h => ({ max_y: Math.max(...h.map(r => r.y)), always_grounded: h.slice(2).every(r => r.grounded) }),
  });
  list.push({
    name: '12_gap_down_held',
    description: 'Crawl right (Down+Right) into the one-tile hole. Down disables the assist, the player becomes airborne ' +
      '(un-crouches, air speed 150 px/s), sinks about 1.2 px and is then lifted onto the far lip by Arcade\'s ' +
      'smallest-penetration tile separation. The hole is still crossed.',
    rows: hole(1), spawn: { x: 150, y: FLOOR }, steps: 90, script: () => 'DR',
    events: h => ({ first_airborne_step: firstStep(h, LEAD_IN + 1, r => !r.grounded),
      airborne_steps: h.filter(r => r.step > LEAD_IN && !r.grounded).length,
      max_y: Math.max(...h.map(r => r.y)), final_y: h[h.length - 1].y }),
  });
  list.push({
    name: '12_gap_stop_in_hole',
    description: 'Run right onto the one-tile hole and release Right while over it (step 26): without horizontal input ' +
      'the assist stops and the player falls in; then hold Right against the hole wall.',
    rows: hole(1), spawn: { x: 150, y: FLOOR }, steps: 90, script: ({ step }) => (step <= 25 || step > 60 ? 'R' : ''),
    events: h => ({ first_airborne_step: firstStep(h, LEAD_IN + 1, r => !r.grounded), final_x: h[h.length - 1].x,
      final_y: h[h.length - 1].y }),
  });
  list.push({
    name: '12_gap_two_tiles', description: 'Run right into a hole two tiles wide (columns 12-13): no assist, the player falls.',
    rows: hole(2), spawn: { x: 150, y: FLOOR }, steps: 60, script: () => 'R',
    events: h => ({ first_airborne_step: firstStep(h, LEAD_IN + 1, r => !r.grounded), final_y: h[h.length - 1].y }),
  });

  // 13 butt stomp -----------------------------------------------------------------------------
  list.push({
    name: '13_butt_stomp',
    description: 'Jump (held 15 steps), then press Down in mid-air for 2 steps (butt stomp): 190 ms flip pause with ' +
      'v = 0 and gravity off, then vy = 520 (clamped to 500 by Arcade), land.',
    rows: done(flatFloor()), spawn: { x: 104, y: FLOOR }, steps: 80,
    script: ({ step }) => (step >= after(1) && step < after(16) ? 'J' : step === after(16) || step === after(17) ? 'D' : ''),
    events: h => {
      const start = firstStep(h, 1, r => r.stomp)!;
      return { stomp_start_step: start, hover_steps: h.filter(r => r.stomp && r.vy === 0 && r.vx === 0).length,
        first_fall_step: firstStep(h, start, r => r.vy >= 500), land_step: firstStep(h, start, r => r.grounded) };
    },
  });

  // 14 level-design limits (research-physics section 18 "derived facts") ----------------------
  for (const [tiles, mode] of [[7, 'last_ground'], [8, 'last_ground'], [8, 'coyote6'], [9, 'coyote6']] as const) {
    // Floor columns 0..9, gap columns 10..(9+tiles) one tile deep, floor again after it. Left lip at x=160.
    const rows = done(fill(flatFloor(), 10, 20, 9 + tiles, 20, '.'));
    const spawn = { x: 100, y: FLOOR };
    const runProbe = simulate(rows, spawn, 60, () => 'R');
    const air = firstStep(runProbe, LEAD_IN + 1, r => !r.grounded)!;
    const press = mode === 'last_ground' ? air - 1 : air + 5;
    const farLip = 160 + tiles * 16;
    list.push({
      name: `14_gap_${tiles}_tiles_${mode}`,
      description: `Run right and jump (held) over a ${tiles}-tile (${tiles * 16} px) gap between two floors of equal height; ` +
        `jump pressed on ${mode === 'last_ground' ? 'the last grounded step' : 'airborne step 6 (last coyote step)'} (step ${press}).`,
      rows, spawn, steps: 120, script: ({ step }) => (step >= press ? 'RJ' : 'R'),
      events: h => {
        const land = firstStep(h, press + 2, r => r.grounded);
        return { gap_px: tiles * 16, press_step: press, x_at_press: h[press].x, land_step: land,
          cleared: land !== null && h[land].y === FLOOR && h[land].x > farLip - 5,
          x_at_land: land === null ? null : h[land].x, y_at_land: land === null ? null : h[land].y,
          max_y_before_landing: land === null ? null : Math.max(...h.slice(press, land).map(r => r.y)) };
      },
    });
  }
  for (const tiles of [3, 4]) {
    // Ledge of `tiles` tiles in front of the player (columns 12..39), jump from the adjacent floor holding Right.
    list.push({
      name: `14_step_${tiles}_tiles`,
      description: `Stand against a ledge ${tiles} tiles (${tiles * 16} px) high, then jump (held) while holding Right.`,
      rows: done(fill(flatFloor(), 12, 20 - tiles, 39, 19)), spawn: { x: 170, y: FLOOR }, steps: 110,
      script: ({ step }) => (step >= after(15) ? 'RJ' : 'R'),
      events: h => ({ press_step: after(15), ledge_top_y: FLOOR - tiles * 16,
        reached: h[h.length - 1].y === FLOOR - tiles * 16 && h[h.length - 1].grounded,
        final_x: h[h.length - 1].x, final_y: h[h.length - 1].y, min_y: Math.min(...h.map(r => r.y)) }),
    });
  }

  // q* : Phaser quirk probes. Informational, NOT conformance targets for the port ----------------
  list.push({
    name: 'q1_oneway_hides_solid_face',
    description: 'QUIRK PROBE. A one-way tile (column 10, row 19) directly left of a lone solid tile (column 11, row 19), ' +
      'both resting on the floor. Arcade derives tile faces from `collides` (the one-way tile counts), so the solid ' +
      'tile has no left face and the two floor tiles underneath have no top face: a player running right sinks about ' +
      '9 px into the floor under the one-way tile, walks through the solid tile and pops back up on the next floor tile.',
    rows: done(fill(fill(flatFloor(), 10, 19, 10, 19, '='), 11, 19, 11, 19)), spawn: { x: 120, y: FLOOR }, steps: 60,
    script: () => 'R',
    events: h => ({ final_x: h[h.length - 1].x, passed_through_solid_tile: h[h.length - 1].x > 192,
      max_y: Math.max(...h.map(r => r.y)),
      ever_blocked_right: h.some(r => r.pre_blocked.includes('r')) }),
  });
  list.push({
    name: 'q2_solid_tile_control',
    description: 'Control for q1: the same lone solid tile (column 11, row 19) without the one-way neighbour stops the player.',
    rows: done(fill(flatFloor(), 11, 19, 11, 19)), spawn: { x: 120, y: FLOOR }, steps: 60, script: () => 'R',
    events: h => ({ final_x: h[h.length - 1].x, ever_blocked_right: h.some(r => r.pre_blocked.includes('r')) }),
  });
  return list;
}

describe('SNESWAMP golden physics traces', () => {
  it('writes one JSON trace per scenario', () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const summary: Record<string, unknown> = {};
    for (const scenario of buildScenarios()) {
      const history = simulate(scenario.rows, scenario.spawn, scenario.steps, scenario.script);
      // The port has edge walls (body kept inside x 17..623) and a pit line; the web harness has neither.
      for (const r of history) {
        expect(r.x, `${scenario.name} step ${r.step} x`).toBeGreaterThanOrEqual(32);
        expect(r.x, `${scenario.name} step ${r.step} x`).toBeLessThanOrEqual(608);
        expect(r.y, `${scenario.name} step ${r.step} y`).toBeLessThanOrEqual(336);
        expect(r.y - r.h, `${scenario.name} step ${r.step} head`).toBeGreaterThanOrEqual(0);
      }
      const events = scenario.events?.(history) ?? {};
      summary[scenario.name] = events;
      const head = {
        scenario: scenario.name,
        description: scenario.description,
        generator: { tool: 'snes/tests/golden/gen/snesGolden.gen.test.ts', phaser: PHASER_VERSION, step_hz: 60,
          gravity_px_s2: GRAVITY_Y, max_velocity_y_px_s: MAX_VELOCITY_Y, lead_in_idle_steps: LEAD_IN },
        units: { position: 'px, room-local', velocity: 'px/s', timers: 'ms (rounded)', step: '1/60 s' },
        anchor: 'x = body centre, y = feet (body bottom)',
        layout: { legend: { '.': 'empty', '#': 'solid', '=': 'one-way platform (gid 670)' },
          tile_px: TILE_SIZE, rows: scenario.rows, spawn_feet: scenario.spawn },
        events,
        inputs: history.slice(1).map(r => r.in),
      };
      const text = `${JSON.stringify(head, null, 1).replace(/\n\}$/, '')},\n "steps": [\n${
        history.map(r => `  ${JSON.stringify(r)}`).join(',\n')}\n ]\n}\n`;
      JSON.parse(text);
      writeFileSync(join(OUT_DIR, `${scenario.name}.json`), text);
    }
    writeFileSync(join(OUT_DIR, '_summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
  });
});
