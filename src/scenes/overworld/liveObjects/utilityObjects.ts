import Phaser from 'phaser';
import { isSolidRuntimeObjectConfig, isSpecialTileKindGid } from '../../../config';
import { getRollingBallGraphic, isRollingBallObjectId, ROLLING_BALL_FPS, ROLLING_BALL_ROWS, rollingBallFrame } from '../../../config/rollingBall';
import { GHOST_OBJECT_ID } from '../../../enemies/ghost';
import { SWORDSMAN_AI_OBJECT_ID } from '../../../enemies/swordsmanAi';
import { TILE_SIZE } from '../../../config';
import {
  evaluateFlatWalk,
  evaluateSlopeWalk,
  isButtStompSlideTriangle,
  isFloorTriangle,
  isSteepTriangle,
  isTrianglePieceObjectId,
  pointInTriangle,
  separationFromTriangle,
  steepSlopeMotion,
  triangleDownhillSignX,
  triangleFloorHighTip,
  triangleFloorSurfaceOrFlushTip,
  triangleFloorSurfaceYAt,
  triangleVertices,
} from '../../../config/trianglePiece';
import {
  getGravityVector,
  type PlayerGravityDirection,
  type SpecialTilePlayerEnvironment,
} from '../specialTiles';
import type { ArcadeObjectBody } from './bodies';
import { isDynamicArcadeBody } from './bodies';
import { getLiveObjectBehavior } from './behaviorRegistry';
import type { LoadedRoomObject } from './model';
import {
  BALL_GRAVITY,
  BALL_ICE_DRAG,
  BALL_MAX_SPEED,
  BALL_STICKY_DRAG,
  BALL_STICKY_PUSH_SCALE,
  BALL_WATER_GRAVITY_FACTOR,
  BALL_WATER_MAX_SPEED,
  ACTOR_MASS,
  ballTopSupport,
  circleIntersectsRect,
  createBallState,
  separateBalls,
  stepRollingBalls,
  type ActorRect,
  type BallSimState,
  type SolidRect,
  type TriangleSolid,
} from './rollingBallPhysics';
import { placeTriangleSprite } from './triangleTexture';

interface UtilityRoom {
  room: { coordinates: { x: number; y: number } };
  terrainLayer: Phaser.Tilemaps.TilemapLayer | null;
  terrainInsetBodies: Phaser.Physics.Arcade.StaticGroup | null;
  liveObjects: LoadedRoomObject[];
}

export interface UtilityStepOptions {
  rooms: UtilityRoom[];
  delta: number;
  playerBody: Phaser.Physics.Arcade.Body | null;
  playerIntent: number;
  playerButtStomping?: boolean;
  slopeSlide?: { active: boolean };
  states: WeakMap<LoadedRoomObject, BallSimState>;
  sampleEnvironment: (
    probe: Phaser.Physics.Arcade.Body,
    gravityDirection: PlayerGravityDirection,
  ) => { environment: SpecialTilePlayerEnvironment; roomId: string };
  onDestroy: (room: UtilityRoom, liveObject: LoadedRoomObject) => void;
  supportCrumbling?: (
    probe: Phaser.Physics.Arcade.Body,
    gravityDirection: PlayerGravityDirection,
  ) => void;
  now: number;
  bounceSpeed: number;
  bounceCooldownMs: number;
  bounceActiveMs: number;
  onPlayerHurt: () => void;
  onDefeat: (room: UtilityRoom, liveObject: LoadedRoomObject) => void;
  onBounce: (x: number, y: number, coordinates: { x: number; y: number }) => void;
}

export function stepUtilityObjects(options: UtilityStepOptions): boolean {
  const dt = Math.max(options.delta / 1000, 1 / 120);
  let playerOnSlope = false;
  let playerOnBall = false;
  let playerStompSliding = false;
  const forceSlopeSlide = options.playerButtStomping === true || options.slopeSlide?.active === true;
  const entries: Array<{ room: UtilityRoom; liveObject: LoadedRoomObject; state: BallSimState }> = [];

  for (const room of options.rooms) {
    for (const liveObject of room.liveObjects) {
      if (!liveObject.sprite.active) continue;
      if (isTrianglePieceObjectId(liveObject.config.id)) {
        syncTriangleSprite(liveObject);
      }
      if (!isRollingBallObjectId(liveObject.config.id) || !liveObject.ball) continue;
      let state = options.states.get(liveObject);
      if (!state) {
        state = createBallState(liveObject.sprite.x, liveObject.sprite.y, liveObject.ball);
        options.states.set(liveObject, state);
      }
      state.weight = liveObject.ball.weight;
      state.pushable = liveObject.ball.pushable;
      state.settings = liveObject.ball;
      entries.push({ room, liveObject, state });
    }
  }
  const balls = entries.map((entry) => entry.state);

  const solids = collectSolids(options.rooms, balls);
  const triangles = collectTriangles(options.rooms);
  const actors = collectActors(
    options.rooms,
    options.playerBody,
    options.playerIntent,
    options.playerButtStomping === true,
  );

  const rolling: typeof entries = [];
  for (const entry of entries) {
    const environment = sampleBallEnvironment(entry.state, options.sampleEnvironment);
    if (environment.onDamage) {
      options.onDestroy(entry.room, entry.liveObject);
      continue;
    }
    const gravity = getGravityVector(environment.gravityDirection);
    const inWater = environment.inWater;
    const sticky = environment.onSticky;
    entry.state.pushScale = sticky ? BALL_STICKY_PUSH_SCALE : 1;
    const result = stepRollingBalls({
      balls: [entry.state],
      deltaSeconds: dt,
      gravityX: gravity.x,
      gravityY: gravity.y,
      gravityAccel: BALL_GRAVITY * (inWater ? BALL_WATER_GRAVITY_FACTOR * entry.state.weight : 1),
      maxSpeed: inWater
        ? Math.min(BALL_MAX_SPEED, BALL_WATER_MAX_SPEED * entry.state.weight)
        : BALL_MAX_SPEED,
      inWater,
      windX: environment.windX,
      conveyorX: environment.conveyorX,
      groundDrag: sticky ? BALL_STICKY_DRAG : environment.onIce ? BALL_ICE_DRAG : undefined,
      bounce: environment.onBounce,
      now: options.now,
      solids,
      triangles,
      actors: actors.map((actor) => actor.rect),
    });
    if (result.bounced) {
      options.onBounce(entry.state.x, entry.state.y, entry.room.room.coordinates);
    }
    if (entry.state.grounded) {
      options.supportCrumbling?.(ballProbe(entry.state), environment.gravityDirection);
    }
    for (const correction of result.actorCorrections) {
      const actor = actors[correction.index];
      actor.correction.dx += correction.dx;
      actor.correction.dy += correction.dy;
      actor.correction.dvx += correction.dvx;
      actor.correction.dvy += correction.dvy;
    }
    rolling.push(entry);
  }
  separateBalls(rolling.map((entry) => entry.state));

  actors.forEach((actor, index) => {
    const correction = lastActorCorrection(actors, index);
    if (!correction) return;
    const facing = actor.liveObject?.runtime.directionX ?? 0;
    moveActor(actor, correction.dx, correction.dy, correction.dvx, correction.dvy);
    maybeReverseNpcFromBallPush(actor, correction, facing);
  });

  for (const room of options.rooms) {
    for (const triangle of room.liveObjects) {
      const geometry = triangleGeometry(triangle);
      if (!geometry) continue;
      for (const actor of actors) {
        const supported = supportActor(actor, geometry, dt, forceSlopeSlide && actor.liveObject === null);
        if (!supported || actor.liveObject !== null) continue;
        playerOnSlope = true;
        if (forceSlopeSlide && isButtStompSlideTriangle(geometry.legX, geometry.legY)) {
          playerStompSliding = true;
        }
      }
    }
  }

  if (options.slopeSlide) options.slopeSlide.active = playerStompSliding;
  if (seatActorsOnBalls(actors, rolling.map((entry) => entry.state))) playerOnBall = true;

  rolling.forEach(({ liveObject, state: ball }) => {
    presentBall(liveObject, ball);
    launchFromPads(ball, liveObject, options);
    hurtOverlaps(ball, actors, options);
  });

  return playerOnSlope || playerOnBall;
}

function lastActorCorrection(
  actors: TrackedActor[],
  index: number,
): { dx: number; dy: number; dvx: number; dvy: number } | null {
  const stored = actors[index].correction;
  if (!stored || (stored.dx === 0 && stored.dy === 0 && stored.dvx === 0 && stored.dvy === 0)) return null;
  return stored;
}

/** When a solid NPC pushes a ball and the ball stops or shoves them back, turn around. */
function maybeReverseNpcFromBallPush(
  actor: TrackedActor,
  correction: { dx: number; dy: number; dvx: number; dvy: number },
  facing: number,
): void {
  const liveObject = actor.liveObject;
  if (!liveObject || liveObject.config.category !== 'npc' || facing === 0) return;
  const mode = liveObject.runtime.npcMode ?? 'idle';
  if (mode === 'idle' && !liveObject.runtime.npcPushable) return;
  const pushedBack = correction.dx * facing < -0.35 || correction.dvx * facing < -8;
  const stopped =
    Math.abs(actor.body.velocity.x) < 10
    && correction.dx * facing <= 0
    && (Math.abs(correction.dx) > 0.2 || Math.abs(correction.dvx) > 1);
  if (!pushedBack && !stopped) return;
  liveObject.runtime.directionX = facing < 0 ? 1 : -1;
}

interface BallSurfaceProbe {
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: { x: number; y: number };
  width: number;
  height: number;
}

const ballProbes = new WeakMap<BallSimState, BallSurfaceProbe>();

const IDLE_SURFACE: SpecialTilePlayerEnvironment = {
  gravityDirection: 'down',
  inWater: false,
  windX: 0,
  conveyorX: 0,
  onIce: false,
  onSticky: false,
  onBounce: false,
  onDamage: false,
};

function ballProbe(ball: BallSimState): Phaser.Physics.Arcade.Body {
  let probe = ballProbes.get(ball);
  if (!probe) {
    probe = { left: 0, right: 0, top: 0, bottom: 0, center: { x: 0, y: 0 }, width: 0, height: 0 };
    ballProbes.set(ball, probe);
  }
  probe.left = ball.x - ball.radius;
  probe.right = ball.x + ball.radius;
  probe.top = ball.y - ball.radius;
  probe.bottom = ball.y + ball.radius;
  probe.center.x = ball.x;
  probe.center.y = ball.y;
  probe.width = ball.radius * 2;
  probe.height = ball.radius * 2;
  return probe as Phaser.Physics.Arcade.Body;
}

function sampleBallEnvironment(
  ball: BallSimState,
  sample: UtilityStepOptions['sampleEnvironment'],
): SpecialTilePlayerEnvironment {
  const probe = ballProbe(ball);
  try {
    let sampled = sample(probe, ball.gravityDirection);
    if (ball.gravityRoomId !== sampled.roomId) {
      ball.gravityRoomId = sampled.roomId;
      ball.gravityDirection = 'down';
      sampled = sample(probe, 'down');
    }
    ball.gravityDirection = sampled.environment.gravityDirection;
    return sampled.environment;
  } catch {
    return { ...IDLE_SURFACE, gravityDirection: ball.gravityDirection };
  }
}

function collectSolids(rooms: UtilityRoom[], balls: BallSimState[]): SolidRect[] {
  const solids: SolidRect[] = [];
  for (const room of rooms) {
    const layer = room.terrainLayer;
    if (layer?.getTileAtWorldXY && balls.length > 0) {
      const seen = new Set<string>();
      for (const ball of balls) {
        const minX = ball.x - ball.radius - 16;
        const maxX = ball.x + ball.radius + 16;
        const minY = ball.y - ball.radius - 16;
        const maxY = ball.y + ball.radius + 16;
        for (let y = minY; y <= maxY; y += 16) {
          for (let x = minX; x <= maxX; x += 16) {
            const tile = layer.getTileAtWorldXY(x, y, true);
            if (!tile?.collides) continue;
            const key = `${tile.x}:${tile.y}:${layer.name ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const worldX = layer.tileToWorldX(tile.x);
            const worldY = layer.tileToWorldY(tile.y);
            solids.push({
              left: worldX,
              right: worldX + tile.width,
              top: worldY,
              bottom: worldY + tile.height,
              vx: 0,
              vy: 0,
              kind: 'tile',
              oneWay: isSpecialTileKindGid(tile.index, 'oneWayPlatform'),
            });
          }
        }
      }
    }
    room.terrainInsetBodies?.children.iterate((child) => {
      const body = (child as Phaser.GameObjects.GameObject & { body?: ArcadeObjectBody }).body;
      pushBodySolid(solids, body, 'solid', 0, 0);
      return true;
    });
    for (const liveObject of room.liveObjects) {
      if (!liveObject.sprite.active || !liveObject.sprite.body) continue;
      if (isRollingBallObjectId(liveObject.config.id) || isTrianglePieceObjectId(liveObject.config.id)) continue;
      if (getLiveObjectBehavior(liveObject.config.id).kind === 'bouncePad') continue;
      if (liveObject.config.category === 'enemy' || liveObject.config.category === 'npc') continue;
      if (!isSolidRuntimeObjectConfig(liveObject.config)) continue;
      const body = liveObject.sprite.body as ArcadeObjectBody;
      const dynamic = isDynamicArcadeBody(body);
      const kind = liveObject.config.id === 'moving_platform' ? 'platform' : 'solid';
      pushBodySolid(
        solids,
        body,
        kind,
        dynamic ? body.velocity.x : 0,
        dynamic ? body.velocity.y : 0,
      );
    }
  }
  return solids;
}

function pushBodySolid(
  solids: SolidRect[],
  body: ArcadeObjectBody | null | undefined,
  kind: SolidRect['kind'],
  vx: number,
  vy: number,
): void {
  if (!body || body.enable === false) return;
  solids.push({
    left: body.left,
    right: body.right,
    top: body.top,
    bottom: body.bottom,
    vx,
    vy,
    kind,
  });
}

function collectTriangles(rooms: UtilityRoom[]): TriangleSolid[] {
  const triangles: TriangleSolid[] = [];
  for (const room of rooms) {
    for (const liveObject of room.liveObjects) {
      const geometry = triangleGeometry(liveObject);
      if (!geometry) continue;
      triangles.push(geometry);
    }
  }
  return triangles;
}

function triangleGeometry(liveObject: LoadedRoomObject): TriangleSolid | null {
  if (!liveObject.sprite.active || !liveObject.triangle) return null;
  return {
    anchorX: liveObject.triangle.anchorX,
    anchorY: liveObject.triangle.anchorY,
    legX: liveObject.triangle.legX,
    legY: liveObject.triangle.legY,
  };
}

function syncTriangleSprite(liveObject: LoadedRoomObject): void {
  const triangle = liveObject.triangle;
  if (!triangle) return;
  placeTriangleSprite(
    liveObject.sprite,
    triangle.anchorX,
    triangle.anchorY,
    triangle.legX,
    triangle.legY,
    triangle.fill,
    triangle.stroke,
    triangle.tiles ?? null,
    triangle.strokeOn !== false,
    triangle.backgroundOn !== false,
  );
}

type TriangleRideMode = 'walk' | 'climb';

interface TrackedActor {
  rect: ActorRect;
  correction: { dx: number; dy: number; dvx: number; dvy: number };
  body: Phaser.Physics.Arcade.Body;
  liveObject: LoadedRoomObject | null;
  room: UtilityRoom | null;
  intent: number;
  rideMode: TriangleRideMode;
}

function triangleRideModeFor(liveObject: LoadedRoomObject): TriangleRideMode | null {
  if (liveObject.config.id === GHOST_OBJECT_ID || liveObject.config.collidesWithWorld === false) {
    return null;
  }
  // Fly/swim slope following lives in updateFlyingEnemyObject so it does not
  // fight horizontal cruise velocity or reverse on hypotenuse contact.
  if (liveObject.config.behavior === 'fly') {
    return null;
  }
  if (liveObject.config.category === 'npc' || liveObject.config.category === 'enemy') {
    return 'walk';
  }
  return null;
}

function collectActors(
  rooms: UtilityRoom[],
  playerBody: Phaser.Physics.Arcade.Body | null,
  playerIntent: number,
  playerButtStomping: boolean,
): TrackedActor[] {
  const actors: TrackedActor[] = [];
  if (playerBody?.enable) {
    actors.push(trackActor(playerBody, null, null, playerIntent, 'walk', playerButtStomping));
  }
  for (const room of rooms) {
    for (const liveObject of room.liveObjects) {
      if (!liveObject.sprite.active) continue;
      const rideMode = triangleRideModeFor(liveObject);
      if (!rideMode) continue;
      const body = liveObject.sprite.body;
      if (!body || !isDynamicArcadeBody(body as ArcadeObjectBody)) continue;
      const enabled = body as Phaser.Physics.Arcade.Body;
      if (enabled.enable === false) continue;
      const dynamic = body as Phaser.Physics.Arcade.Body;
      const intent = liveObject.runtime.directionX || Math.sign(dynamic.velocity.x);
      actors.push(trackActor(dynamic, liveObject, room, intent, rideMode));
    }
  }
  return actors;
}

function trackActor(
  body: Phaser.Physics.Arcade.Body,
  liveObject: LoadedRoomObject | null,
  room: UtilityRoom | null,
  intent: number,
  rideMode: TriangleRideMode,
  stomping = false,
): TrackedActor {
  return {
    body,
    liveObject,
    room,
    intent,
    rideMode,
    correction: { dx: 0, dy: 0, dvx: 0, dvy: 0 },
    rect: {
      left: body.left,
      right: body.right,
      top: body.top,
      bottom: body.bottom,
      vx: body.velocity.x,
      vy: body.velocity.y,
      mass: ACTOR_MASS,
      stomping,
    },
  };
}

function shiftBody(body: Phaser.Physics.Arcade.Body, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  // Arcade copies body movement onto the sprite in postUpdate. Moving the
  // sprite here as well applies the correction twice and cancels the step's
  // horizontal travel.
  body.position.x += dx;
  body.position.y += dy;
  body.updateCenter();
}

function moveActor(
  actor: TrackedActor,
  dx: number,
  dy: number,
  dvx: number,
  dvy: number,
): void {
  // The ball step already drops a correction that would bury the actor in the
  // floor. Screen-down movement is how an upside-down actor sits on a ball.
  shiftBody(actor.body, dx, dy);
  actor.body.setVelocity(actor.body.velocity.x + dvx, actor.body.velocity.y + dvy);
  syncActorRect(actor);
}

function syncActorRect(actor: TrackedActor): void {
  actor.rect.left = actor.body.left;
  actor.rect.right = actor.body.right;
  actor.rect.top = actor.body.top;
  actor.rect.bottom = actor.body.bottom;
  actor.rect.vx = actor.body.velocity.x;
  actor.rect.vy = actor.body.velocity.y;
}

function seatActorsOnBalls(actors: TrackedActor[], balls: BallSimState[]): boolean {
  let playerSeated = false;
  for (const actor of actors) {
    for (const ball of balls) {
      const gravity = getGravityVector(ball.gravityDirection);
      const support = ballTopSupport(ball, {
        centerX: actor.body.center.x,
        left: actor.body.left,
        right: actor.body.right,
        top: actor.body.top,
        bottom: actor.body.bottom,
        vx: actor.body.velocity.x,
        vy: actor.body.velocity.y,
        gravityX: gravity.x,
        gravityY: gravity.y,
      });
      if (!support) continue;
      shiftBody(actor.body, support.dx, support.dy);
      actor.body.setVelocity(support.vx, support.vy);
      syncActorRect(actor);
      if (actor.liveObject === null) playerSeated = true;
      break;
    }
  }
  return playerSeated;
}

/**
 * Ride contact is the center of the collision bottom so every NPC seats the
 * same way on the hypotenuse. Lead/trail are mount fallbacks when the center
 * is still just shy of the tip span.
 */
function actorFootXs(actor: TrackedActor): number[] {
  const inset = Math.min(4, Math.max(1, actor.body.halfWidth * 0.35));
  const lead = actor.intent < 0 ? actor.body.left + inset : actor.body.right - inset;
  const trail = actor.intent < 0 ? actor.body.right - inset : actor.body.left + inset;
  return [actor.body.center.x, lead, trail];
}

/** Tile top flush with a ramp crest (within 2px), or null. */
function flushFloorTopAt(
  room: UtilityRoom | null,
  worldX: number,
  tipY: number,
): number | null {
  const layer = room?.terrainLayer;
  if (!layer) return null;
  for (const probeY of [tipY + 1, tipY + 4, tipY + 8, tipY]) {
    const tile = layer.getTileAtWorldXY(worldX, probeY, true);
    if (!tile || !tile.collides) continue;
    const top = tile.getTop();
    if (Math.abs(top - tipY) <= 2) return top;
  }
  return null;
}

function supportActor(
  actor: TrackedActor,
  triangle: TriangleSolid,
  dt: number,
  forceSlide: boolean,
): boolean {
  const climbSteep = actor.rideMode === 'climb';
  const footXs = actorFootXs(actor);
  if (!climbSteep) {
    for (const feetX of footXs) {
      const motion = steepSlopeMotion({
        ...triangle,
        feetX,
        feetY: actor.body.bottom,
        traveledX: actor.body.position.x - actor.body.prev.x,
        traveledY: actor.body.position.y - actor.body.prev.y,
        deltaSeconds: dt,
        forceSlide,
        verticalVelocity: actor.body.velocity.y,
      });
      if (!motion) continue;
      shiftBody(actor.body, motion.dx, motion.dy);
      actor.body.setVelocity(motion.vx, motion.vy);
      syncActorRect(actor);
      return true;
    }
  }
  const tip = triangleFloorHighTip(
    triangle.anchorX,
    triangle.anchorY,
    triangle.legX,
    triangle.legY,
  );
  const uphill = tip ? -triangleDownhillSignX(triangle.legX, triangle.legY) : 0;
  const flushTop = tip
    ? flushFloorTopAt(actor.room, tip.x + uphill * 2, tip.y)
      ?? flushFloorTopAt(actor.room, tip.x, tip.y)
    : null;
  // Flush crest → tile: seat to landing height without falling.
  // Narrow bodies: center arrives near the tip (small lift).
  // Wide bodies (snake): lead hits the tip/face while center is still
  // halfWidth downhill — allow a full-tile lift so they still transfer.
  if (
    tip
    && flushTop != null
    && actor.intent * uphill > 0
    && !isSteepTriangle(triangle.legX, triangle.legY)
  ) {
    const lead = actor.intent < 0 ? actor.body.left + 1 : actor.body.right - 1;
    const leadAtCrest = (lead - tip.x) * uphill >= -2;
    const centerAtCrest = (actor.body.center.x - tip.x) * uphill >= -2;
    if (leadAtCrest || centerAtCrest) {
      const dy = flushTop - actor.body.bottom;
      const maxLift = leadAtCrest ? TILE_SIZE + 2 : 14;
      if (dy >= -maxLift && dy <= 14) {
        shiftBody(actor.body, 0, dy);
        actor.body.setVelocityY(0);
        syncActorRect(actor);
        return true;
      }
    }
  }
  for (const feetX of footXs) {
    const surfaceY = triangleFloorSurfaceOrFlushTip(
      triangle.anchorX,
      triangle.anchorY,
      triangle.legX,
      triangle.legY,
      feetX,
      flushTop,
      Math.max(TILE_SIZE, actor.body.halfWidth + 4),
    );
    const onHypotenuse = triangleFloorSurfaceYAt(
      triangle.anchorX,
      triangle.anchorY,
      triangle.legX,
      triangle.legY,
      feetX,
    ) != null;
    const walk = onHypotenuse
      ? evaluateSlopeWalk({
          ...triangle,
          feetX,
          feetY: actor.body.bottom,
          verticalVelocity: actor.body.velocity.y,
          horizontalIntent: actor.intent,
          deltaSeconds: dt,
          allowSteepClimb: climbSteep,
        })
      : surfaceY != null
        ? {
            supported: true as const,
            feetY: surfaceY,
            slideX: 0,
            blockUphill: false,
            downhillX: triangleDownhillSignX(triangle.legX, triangle.legY),
          }
        : null;
    if (!walk?.supported) continue;
    const hypY = surfaceY ?? walk.feetY;
    const atFlushCrest =
      tip != null
      && flushTop != null
      && Math.abs(hypY - tip.y) <= 2
      && (feetX - tip.x) * uphill >= -2;
    // Slight downhill float off the solid only — never bias into the hyp
    // (that buried walkers in the floor tile under a ramp and dropped them).
    let seatY = hypY;
    if (
      actor.liveObject
      && onHypotenuse
      && !atFlushCrest
      && tip
      && actor.intent !== 0
      && feetX === actor.body.center.x
      && actor.intent * uphill < 0
    ) {
      seatY = hypY - 2;
    }
    const slope = triangle.legX === 0 ? 0 : -triangle.legY / triangle.legX;
    const dy = seatY - actor.body.bottom;
    // Only seat when already touching the hyp band, or lifting out of the solid.
    // Never yank a walker down onto a distant ramp through a floor.
    if (dy > 2 && actor.body.bottom < hypY - 2) {
      continue;
    }
    const blockSnap = !climbSteep && dy < 0 && isSteepTriangle(triangle.legX, triangle.legY);
    shiftBody(actor.body, 0, blockSnap ? 0 : dy);
    if (walk.blockUphill) {
      actor.body.setVelocity(0, 0);
      // Gravity walkers cannot climb steep faces — turn around instead of stalling.
      if (actor.liveObject && actor.intent !== 0) {
        actor.liveObject.runtime.directionX *= -1;
        actor.intent *= -1;
      }
    } else if (atFlushCrest) {
      // Hypotenuse meets a tile corner: finish the climb horizontally, no dip.
      actor.body.setVelocityY(0);
    } else if (actor.body.velocity.y > -40) {
      actor.body.setVelocityY(actor.body.velocity.x * slope);
    }
    syncActorRect(actor);
    return true;
  }
  for (const feetX of footXs) {
    const flat = evaluateFlatWalk({
      ...triangle,
      feetX,
      feetY: actor.body.bottom,
      verticalVelocity: actor.body.velocity.y,
    });
    if (!flat?.supported) continue;
    shiftBody(actor.body, 0, flat.feetY - actor.body.bottom);
    if (actor.body.velocity.y > 0) actor.body.setVelocityY(0);
    syncActorRect(actor);
    return true;
  }
  // Standing on the shared floor plane puts the body inside the triangle
  // volume (above the horizontal leg, below the hyp). Separation can eject
  // downward through floor tiles onto lower ramps, or yank them up the hyp
  // without a real foothold. Near the floor leg: walls only. Deeper in the
  // solid: lift onto the hyp. Never push floor-ramp walkers downward.
  const overlapsFloorTriangle =
    isFloorTriangle(triangle.legY) && bodyOverlapsFloorTriangle(actor, triangle);
  const nearFloorLeg =
    overlapsFloorTriangle && Math.abs(actor.body.bottom - triangle.anchorY) <= 6;
  if (overlapsFloorTriangle && !nearFloorLeg) {
    const liftY = floorTriangleEjectSpriteBottom(actor, triangle);
    if (liftY != null && liftY < actor.body.bottom - 0.5) {
      shiftBody(actor.body, 0, liftY - actor.body.bottom);
      if (actor.body.velocity.y > 0) actor.body.setVelocityY(0);
      syncActorRect(actor);
      return true;
    }
  }

  let separation = separationForBody(actor.body, triangle);
  if (separation && isFloorTriangle(triangle.legY) && separation.dy > 0) {
    separation = Math.abs(separation.dx) < 0.05 ? null : { dx: separation.dx, dy: 0 };
  }
  if (separation && nearFloorLeg) {
    // Keep vertical-leg wall pushes; ignore hyp lift while feet stay on the floor.
    if (Math.abs(separation.dy) >= Math.abs(separation.dx)) {
      separation = null;
    } else {
      separation = { dx: separation.dx, dy: 0 };
    }
  }
  if (
    separation &&
    isFloorTriangle(triangle.legY) &&
    isSteepTriangle(triangle.legX, triangle.legY) &&
    separation.dy < 0
  ) {
    separation = Math.abs(separation.dx) < 0.2 ? null : { dx: separation.dx, dy: 0 };
  }
  // Pure vertical-leg exit (ny ≈ 0). Distinct from hyp contact, which has dy.
  const verticalLegHit =
    separation != null
    && Math.abs(separation.dy) < 0.35
    && Math.abs(separation.dx) > 0.5;
  // Body seated on the hyp at the high tip overlaps the vertical leg. Treat that
  // as crest contact, not a wall reverse — otherwise walkers vibrate L/R on tip.
  const nearHighTip =
    tip != null
    && Math.abs(actor.body.bottom - tip.y) <= 6
    && Math.abs(actor.body.center.x - tip.x) <= actor.body.halfWidth + 10;
  // Climbing a paired peak: the other triangle's vertical meets mid-slope before
  // feet reach tip height. Do not reverse — that vibrates facing on the way up.
  const approachingCrestAlongHyp =
    tip != null
    && Math.abs(actor.body.center.x - tip.x) <= actor.body.halfWidth + 14
    && actor.body.bottom >= tip.y - 2
    && actor.body.bottom < tip.y + Math.abs(triangle.legY) - 4
    && actor.intent !== 0
    && (tip.x - actor.body.center.x) * actor.intent > 0;
  const crestContact = nearHighTip || approachingCrestAlongHyp;
  // Sword Hunter turns are rate-limited in its controller — flipping here blurs the run.
  const allowTriangleReverse =
    actor.liveObject != null
    && actor.liveObject.config.id !== SWORDSMAN_AI_OBJECT_ID;
  // Vertical face is a wall on every floor ramp (shallow included) — reverse.
  if (
    separation
    && verticalLegHit
    && !crestContact
    && allowTriangleReverse
    && isFloorTriangle(triangle.legY)
    && actor.intent !== 0
    && separation.dx * actor.intent < 0
  ) {
    actor.liveObject!.runtime.directionX *= -1;
    actor.intent *= -1;
  }
  // Steep hyp face blocking an enemy/NPC walk: turn around instead of grinding.
  if (
    separation
    && !verticalLegHit
    && !crestContact
    && allowTriangleReverse
    && isFloorTriangle(triangle.legY)
    && isSteepTriangle(triangle.legX, triangle.legY)
    && actor.intent !== 0
    && separation.dx * actor.intent < 0
  ) {
    actor.liveObject!.runtime.directionX *= -1;
    actor.intent *= -1;
  }
  // Shallow hyp tip: drop sideways shove that fights walk into the first hyp
  // pixel. Never strip a vertical-leg wall hit — that lets walkers phase through.
  if (
    separation
    && !verticalLegHit
    && isFloorTriangle(triangle.legY)
    && !isSteepTriangle(triangle.legX, triangle.legY)
    && actor.intent !== 0
    && separation.dx * actor.intent < 0
  ) {
    separation = Math.abs(separation.dy) < 0.05 ? null : { dx: 0, dy: separation.dy };
  }
  // At the crest the vertical face still overlaps the body. Do not shove
  // walkers back down the hyp or reverse them — let them run over / jump clear.
  if (separation && tip && crestContact) {
    if (separation.dy > 0) separation = { dx: separation.dx, dy: 0 };
    // Kill sideways wall shove at the tip; keep a tiny lift if still buried.
    if (Math.abs(separation.dx) > 0) {
      separation = Math.abs(separation.dy) < 0.05 ? null : { dx: 0, dy: separation.dy };
    }
  } else if (separation && tip && flushTop != null && actor.intent * uphill > 0) {
    const nearCrest =
      Math.abs(actor.body.bottom - tip.y) <= 4
      && Math.abs(actor.body.center.x - tip.x) <= actor.body.halfWidth + 6;
    if (nearCrest) {
      if (separation.dy > 0) separation = { dx: separation.dx, dy: 0 };
      if (separation.dx * uphill < 0) {
        separation = Math.abs(separation.dy) < 0.05 ? null : { dx: 0, dy: separation.dy };
      }
    }
  }
  if (!separation) return false;
  shiftBody(actor.body, separation.dx, separation.dy);
  const length = Math.hypot(separation.dx, separation.dy) || 1;
  const nx = separation.dx / length;
  const ny = separation.dy / length;
  const into = actor.body.velocity.x * nx + actor.body.velocity.y * ny;
  if (into < 0) {
    actor.body.setVelocity(
      actor.body.velocity.x - into * nx,
      actor.body.velocity.y - into * ny,
    );
  }
  syncActorRect(actor);
  return ny < -0.5;
}

function bodyOverlapsFloorTriangle(actor: TrackedActor, triangle: TriangleSolid): boolean {
  if (!isFloorTriangle(triangle.legY)) return false;
  const verts = triangleVertices(
    triangle.anchorX,
    triangle.anchorY,
    triangle.legX,
    triangle.legY,
  );
  const samples = [
    { x: actor.body.center.x, y: actor.body.center.y },
    { x: actor.body.center.x, y: actor.body.bottom - 1 },
    { x: actor.body.left + 1, y: actor.body.bottom - 1 },
    { x: actor.body.right - 1, y: actor.body.bottom - 1 },
  ];
  return samples.some((point) =>
    pointInTriangle(point, verts.rightAngle, verts.horizontal, verts.vertical)
  );
}

/** Bottom Y to sit on the hyp when the body is already inside the floor ramp. */
function floorTriangleEjectSpriteBottom(
  actor: TrackedActor,
  triangle: TriangleSolid,
): number | null {
  let best: number | null = null;
  for (const feetX of actorFootXs(actor)) {
    const surface = triangleFloorSurfaceYAt(
      triangle.anchorX,
      triangle.anchorY,
      triangle.legX,
      triangle.legY,
      feetX,
    );
    if (surface == null) continue;
    // Only eject when feet are at/under the hyp (inside), not when far above.
    if (actor.body.bottom < surface - 1) continue;
    best = best == null ? surface : Math.min(best, surface);
  }
  return best;
}

function separationForBody(
  body: Phaser.Physics.Arcade.Body,
  triangle: TriangleSolid,
): { dx: number; dy: number } | null {
  const samples = [
    { x: body.center.x, y: body.center.y },
    { x: body.left, y: body.bottom },
    { x: body.right, y: body.bottom },
    { x: body.left, y: body.center.y },
    { x: body.right, y: body.center.y },
    { x: body.left, y: body.top },
    { x: body.right, y: body.top },
  ];
  let best: { dx: number; dy: number } | null = null;
  let bestLength = Number.POSITIVE_INFINITY;
  for (const point of samples) {
    const separation = separationFromTriangle(
      triangle.anchorX,
      triangle.anchorY,
      triangle.legX,
      triangle.legY,
      point.x,
      point.y,
    );
    if (!separation) continue;
    const length = Math.hypot(separation.dx, separation.dy);
    if (length < bestLength) {
      best = separation;
      bestLength = length;
    }
  }
  return best;
}

function presentBall(liveObject: LoadedRoomObject, ball: BallSimState): void {
  const graphicColumn = getRollingBallGraphic(liveObject.ball?.graphicId).column;
  const row = Math.floor(ball.animTime * ROLLING_BALL_FPS) % ROLLING_BALL_ROWS;
  liveObject.sprite.setPosition(ball.x, ball.y);
  liveObject.sprite.rotation = ball.angle;
  liveObject.sprite.setFrame(rollingBallFrame(graphicColumn, row));
}

function launchFromPads(ball: BallSimState, ballObject: LoadedRoomObject, options: UtilityStepOptions): void {
  for (const room of options.rooms) {
    for (const pad of room.liveObjects) {
      if (getLiveObjectBehavior(pad.config.id).kind !== 'bouncePad' || !pad.sprite.active || !pad.sprite.body) continue;
      if (options.now < pad.runtime.cooldownUntil) continue;
      const body = pad.sprite.body as ArcadeObjectBody;
      if (!circleIntersectsRect(ball.x, ball.y, ball.radius, body)) continue;
      const speed = Math.abs(options.bounceSpeed);
      const direction = pad.runtime.directionX < 0 ? -1 : 1;
      if (pad.config.id === 'bounce_pad') {
        if (ball.vy < -24) continue;
        if (ball.y + ball.radius > body.top + 12 && ball.y > body.center.y) continue;
        ball.vy = -speed;
      } else if (pad.config.id === 'spring_side') {
        const facing = direction;
        if ((ball.x - body.center.x) * facing < -8) continue;
        ball.vx = facing * speed;
      } else if (pad.config.id === 'spring_diagonal') {
        const nx = direction / Math.SQRT2;
        const ny = -1 / Math.SQRT2;
        if ((ball.x - body.center.x) * nx + (ball.y - body.center.y) * ny < -8) continue;
        ball.vx = direction * speed / Math.SQRT2;
        ball.vy = -speed / Math.SQRT2;
      } else {
        continue;
      }
      pad.runtime.cooldownUntil = options.now + options.bounceCooldownMs;
      pad.runtime.activatedUntil = options.now + options.bounceActiveMs;
      options.onBounce(pad.sprite.x, pad.sprite.y, room.room.coordinates);
      ballObject.sprite.setPosition(ball.x, ball.y);
    }
  }
}

function hurtOverlaps(ball: BallSimState, actors: TrackedActor[], options: UtilityStepOptions): void {
  const settings = ball.settings;
  for (const actor of actors) {
    if (!circleIntersectsRect(ball.x, ball.y, ball.radius, actor.rect)) continue;
    if (!actor.liveObject) {
      if (settings.hurtPlayer) options.onPlayerHurt();
      continue;
    }
    const category = actor.liveObject.config.category;
    if (category === 'enemy' && settings.hurtEnemies && actor.room) {
      options.onDefeat(actor.room, actor.liveObject);
    }
    if (category === 'npc' && settings.hurtFriendlies && actor.room) {
      options.onDefeat(actor.room, actor.liveObject);
    }
  }
}
