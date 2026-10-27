import Phaser from 'phaser';
import { isSolidRuntimeObjectConfig } from '../../../config';
import { getRollingBallGraphic, isRollingBallObjectId, rollingBallFrame } from '../../../config/rollingBall';
import {
  evaluateSlopeWalk,
  hypotenuseY,
  isFloorTriangle,
  isSteepTriangle,
  isTrianglePieceObjectId,
  separationFromTriangle,
  slopeSlideVelocity,
  uphillTravelCorrection,
} from '../../../config/trianglePiece';
import { getGravityVector, type PlayerGravityDirection } from '../specialTiles';
import type { ArcadeObjectBody } from './bodies';
import { isDynamicArcadeBody } from './bodies';
import { getLiveObjectBehavior } from './behaviorRegistry';
import type { LoadedRoomObject } from './model';
import {
  BALL_GRAVITY,
  BALL_MAX_SPEED,
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
  ) => { gravityDirection: PlayerGravityDirection; inWater: boolean };
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
  const forceSlopeSlide = options.playerButtStomping === true || options.slopeSlide?.active === true;
  const balls: BallSimState[] = [];
  const ballObjects: LoadedRoomObject[] = [];

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
      balls.push(state);
      ballObjects.push(liveObject);
    }
  }

  const solids = collectSolids(options.rooms, balls);
  const triangles = collectTriangles(options.rooms);
  const actors = collectActors(options.rooms, options.playerBody, options.playerIntent);

  balls.forEach((ball) => {
    const environment = sampleBallEnvironment(ball, options.sampleEnvironment);
    const gravity = getGravityVector(environment.gravityDirection);
    const inWater = environment.inWater;
    const result = stepRollingBalls({
      balls: [ball],
      deltaSeconds: dt,
      gravityX: gravity.x,
      gravityY: gravity.y,
      gravityAccel: BALL_GRAVITY * (inWater ? BALL_WATER_GRAVITY_FACTOR : 1),
      maxSpeed: inWater ? BALL_WATER_MAX_SPEED : BALL_MAX_SPEED,
      inWater,
      solids,
      triangles,
      actors: actors.map((actor) => actor.rect),
    });
    for (const correction of result.actorCorrections) {
      const actor = actors[correction.index];
      actor.correction.dx += correction.dx;
      actor.correction.dy += correction.dy;
      actor.correction.dvx += correction.dvx;
      actor.correction.dvy += correction.dvy;
    }
  });
  separateBalls(balls);

  actors.forEach((actor, index) => {
    const correction = lastActorCorrection(actors, index);
    if (!correction) return;
    moveActor(actor, correction.dx, correction.dy, correction.dvx, correction.dvy);
  });

  for (const room of options.rooms) {
    for (const triangle of room.liveObjects) {
      const geometry = triangleGeometry(triangle);
      if (!geometry) continue;
      for (const actor of actors) {
        const supported = supportActor(
          actor,
          geometry,
          dt,
          forceSlopeSlide && actor.liveObject === null,
        );
        if (supported && actor.liveObject === null) playerOnSlope = true;
      }
    }
  }

  if (seatActorsOnBalls(actors, balls)) playerOnBall = true;
  if (options.slopeSlide) {
    options.slopeSlide.active = playerOnSlope && forceSlopeSlide;
  }

  balls.forEach((ball, index) => {
    const liveObject = ballObjects[index];
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

function sampleBallEnvironment(
  ball: BallSimState,
  sample: UtilityStepOptions['sampleEnvironment'],
): { gravityDirection: PlayerGravityDirection; inWater: boolean } {
  const probe = {
    left: ball.x - ball.radius,
    right: ball.x + ball.radius,
    top: ball.y - ball.radius,
    bottom: ball.y + ball.radius,
    center: { x: ball.x, y: ball.y },
    width: ball.radius * 2,
    height: ball.radius * 2,
  } as Phaser.Physics.Arcade.Body;
  try {
    return sample(probe);
  } catch {
    return { gravityDirection: 'down', inWater: false };
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
  );
}

interface TrackedActor {
  rect: ActorRect;
  correction: { dx: number; dy: number; dvx: number; dvy: number };
  body: Phaser.Physics.Arcade.Body;
  liveObject: LoadedRoomObject | null;
  room: UtilityRoom | null;
  intent: number;
}

function collectActors(
  rooms: UtilityRoom[],
  playerBody: Phaser.Physics.Arcade.Body | null,
  playerIntent: number,
): TrackedActor[] {
  const actors: TrackedActor[] = [];
  if (playerBody?.enable) {
    actors.push(trackActor(playerBody, null, null, playerIntent));
  }
  for (const room of rooms) {
    for (const liveObject of room.liveObjects) {
      if (!liveObject.sprite.active) continue;
      const rides = liveObject.config.category === 'npc'
        || (liveObject.config.category === 'enemy' && liveObject.config.behavior !== 'fly');
      if (!rides) continue;
      const body = liveObject.sprite.body;
      if (!body || !isDynamicArcadeBody(body as ArcadeObjectBody)) continue;
      const enabled = body as Phaser.Physics.Arcade.Body;
      if (enabled.enable === false) continue;
      const dynamic = body as Phaser.Physics.Arcade.Body;
      actors.push(trackActor(dynamic, liveObject, room, Math.sign(dynamic.velocity.x)));
    }
  }
  return actors;
}

function trackActor(
  body: Phaser.Physics.Arcade.Body,
  liveObject: LoadedRoomObject | null,
  room: UtilityRoom | null,
  intent: number,
): TrackedActor {
  return {
    body,
    liveObject,
    room,
    intent,
    correction: { dx: 0, dy: 0, dvx: 0, dvy: 0 },
    rect: {
      left: body.left,
      right: body.right,
      top: body.top,
      bottom: body.bottom,
      vx: body.velocity.x,
      vy: body.velocity.y,
      mass: ACTOR_MASS,
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
  const appliedDy = dy > 0 ? 0 : dy;
  const appliedDvy = dy > 0 && dvy > 0 ? 0 : dvy;
  shiftBody(actor.body, dx, appliedDy);
  actor.body.setVelocity(actor.body.velocity.x + dvx, actor.body.velocity.y + appliedDvy);
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
      const support = ballTopSupport(ball, {
        centerX: actor.body.center.x,
        bottom: actor.body.bottom,
        vy: actor.body.velocity.y,
      });
      if (!support) continue;
      shiftBody(actor.body, 0, support.dy);
      actor.body.setVelocityY(support.vy);
      syncActorRect(actor);
      if (actor.liveObject === null) playerSeated = true;
      break;
    }
  }
  return playerSeated;
}

function supportActor(
  actor: TrackedActor,
  triangle: TriangleSolid,
  dt: number,
  forceSlide: boolean,
): boolean {
  const surfaceAtFeet = hypotenuseY(
    triangle.anchorX,
    triangle.anchorY,
    triangle.legX,
    triangle.legY,
    actor.body.center.x,
  );
  if (surfaceAtFeet != null) {
    const correction = uphillTravelCorrection({
      legX: triangle.legX,
      legY: triangle.legY,
      traveledX: actor.body.position.x - actor.body.prev.x,
      feetDelta: actor.body.bottom - surfaceAtFeet,
      verticalVelocity: actor.body.velocity.y,
      forceSlide,
    });
    if (correction !== 0) shiftBody(actor.body, correction, 0);
  }
  const walk = evaluateSlopeWalk({
    ...triangle,
    feetX: actor.body.center.x,
    feetY: actor.body.bottom,
    verticalVelocity: actor.body.velocity.y,
    horizontalIntent: actor.intent,
    deltaSeconds: dt,
    forceSlide,
  });
  if (walk?.supported) {
    const slope = triangle.legX === 0 ? 0 : -triangle.legY / triangle.legX;
    if (walk.slideX !== 0) {
      const slide = slopeSlideVelocity(triangle.legX, triangle.legY);
      const traveled = actor.body.position.x - actor.body.prev.x;
      const sign = Math.sign(slide.x) || 1;
      const already = Math.max(0, traveled * sign);
      const extra = Math.max(0, Math.abs(slide.x) * dt - already);
      shiftBody(actor.body, sign * extra, 0);
      const surface = hypotenuseY(
        triangle.anchorX,
        triangle.anchorY,
        triangle.legX,
        triangle.legY,
        actor.body.center.x,
      );
      shiftBody(actor.body, 0, (surface ?? walk.feetY) - actor.body.bottom);
      actor.body.setVelocity(slide.x, slide.y);
    } else if (walk.blockUphill) {
      shiftBody(actor.body, 0, walk.feetY - actor.body.bottom);
      actor.body.setVelocity(0, 0);
    } else if (actor.body.velocity.y > -40) {
      shiftBody(actor.body, 0, walk.feetY - actor.body.bottom);
      actor.body.setVelocityY(actor.body.velocity.x * slope);
    } else {
      shiftBody(actor.body, 0, walk.feetY - actor.body.bottom);
    }
    syncActorRect(actor);
    return true;
  }
  let separation = separationForBody(actor.body, triangle);
  if (
    separation &&
    isFloorTriangle(triangle.legY) &&
    isSteepTriangle(triangle.legX, triangle.legY) &&
    Math.abs(actor.body.bottom - triangle.anchorY) <= 8 &&
    separation.dy < 0
  ) {
    separation = Math.abs(separation.dx) < 0.2 ? null : { dx: separation.dx, dy: 0 };
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
  return false;
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
  const row = Math.floor(ball.animTime * 6) % 4;
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
