import {
  ROLLING_BALL_RADIUS,
  type RollingBallSettings,
} from '../../../config/rollingBall';
import {
  separationFromTriangle,
  triangleEdges,
  triangleVertices,
  type TriangleEdge,
  type TrianglePoint,
} from '../../../config/trianglePiece';

export const BALL_GRAVITY = 700;
export const BALL_MAX_SPEED = 500;
export const BALL_WATER_GRAVITY_FACTOR = 0.35;
export const BALL_WATER_MAX_SPEED = 118;
export const BALL_WATER_DAMPING = 0.965;
export const BALL_GROUND_DRAG = 40;
export const BALL_ICE_DRAG = 8;
export const BALL_STICKY_DRAG = 160;
export const BALL_STICKY_PUSH_SCALE = 3;
export const BALL_CONVEYOR_SPEED = 48;
export const BALL_WIND_ACCELERATION = 980;
export const BALL_WIND_MAX_SPEED = 280;
export const BALL_BOUNCE_SPEED = 392;
export const BALL_BOUNCE_COOLDOWN_MS = 180;
export const ACTOR_MASS = 1;
/** Player run speed. A butt stomp faster than this adds the difference to the ball. */
export const BALL_REGULAR_PUSH_SPEED = 150;

export interface BallSimState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  animTime: number;
  radius: number;
  weight: number;
  pushable: boolean;
  /** Multiplies weight while a push is resolved. Sticky gum raises it. */
  pushScale: number;
  gravityDirection: 'down' | 'up' | 'left' | 'right';
  gravityRoomId: string | null;
  bounceCooldownUntil: number;
  grounded: boolean;
  settings: RollingBallSettings;
}

export interface SolidRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  vx: number;
  vy: number;
  kind: 'tile' | 'solid' | 'platform';
  /** Jump-through from the side opposite gravity. */
  oneWay?: boolean;
}

export interface ActorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  vx: number;
  vy: number;
  mass: number;
  /** Falling in a butt stomp. An edge hit can launch the ball. */
  stomping?: boolean;
}

export interface TriangleSolid {
  anchorX: number;
  anchorY: number;
  legX: number;
  legY: number;
}

export interface ActorCorrection {
  index: number;
  dx: number;
  dy: number;
  dvx: number;
  dvy: number;
}

export interface BallStepResult {
  actorCorrections: ActorCorrection[];
  bounced: boolean;
}

export function resetBallMotion(state: BallSimState, x: number, y: number): void {
  state.x = x;
  state.y = y;
  state.vx = 0;
  state.vy = 0;
  state.spin = 0;
  state.angle = 0;
  state.grounded = false;
  state.pushScale = 1;
  state.gravityDirection = 'down';
  state.gravityRoomId = null;
  state.bounceCooldownUntil = 0;
}

export function createBallState(x: number, y: number, settings: RollingBallSettings): BallSimState {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    animTime: 0,
    radius: ROLLING_BALL_RADIUS,
    weight: settings.weight,
    pushable: settings.pushable,
    pushScale: 1,
    gravityDirection: 'down',
    gravityRoomId: null,
    bounceCooldownUntil: 0,
    grounded: false,
    settings,
  };
}

const BALL_TOP_CAP = 0.65;

/** Feet resting on the ball, on the side opposite gravity. Sides stay a push. */
export function ballTopSupport(
  ball: { x: number; y: number; radius: number },
  actor: {
    centerX: number;
    bottom: number;
    vy: number;
    left?: number;
    right?: number;
    top?: number;
    vx?: number;
    gravityX?: number;
    gravityY?: number;
  },
): { dx: number; dy: number; vx: number; vy: number } | null {
  const gravityX = actor.gravityX ?? 0;
  const gravityY = actor.gravityY ?? 1;
  const vx = actor.vx ?? 0;
  const vy = actor.vy;
  const alongGravity = Math.abs(gravityY) >= Math.abs(gravityX);
  const centerY = actor.top === undefined ? actor.bottom : (actor.top + actor.bottom) / 2;
  const feetX = alongGravity
    ? actor.centerX
    : gravityX > 0 ? (actor.right ?? actor.centerX) : (actor.left ?? actor.centerX);
  const feetY = alongGravity
    ? (gravityY >= 0 ? actor.bottom : (actor.top ?? actor.bottom))
    : centerY;
  const tangentX = -gravityY;
  const tangentY = gravityX;
  const along = (feetX - ball.x) * tangentX + (feetY - ball.y) * tangentY;
  if (Math.abs(along) > ball.radius * BALL_TOP_CAP) return null;
  const rise = Math.sqrt(Math.max(0, ball.radius * ball.radius - along * along));
  const surfaceX = ball.x - gravityX * rise;
  const surfaceY = ball.y - gravityY * rise;
  const delta = (feetX - surfaceX) * gravityX + (feetY - surfaceY) * gravityY;
  // Negative delta is a nearby foot we can catch. Positive is overlap into the ball.
  if (delta < -8 || delta > ball.radius + 4) return null;
  const into = vx * gravityX + vy * gravityY;
  if (into < -40) return null;
  return {
    dx: -delta * gravityX,
    dy: -delta * gravityY,
    vx: into > 0 ? vx - into * gravityX : vx,
    vy: into > 0 ? vy - into * gravityY : vy,
  };
}

export function circleIntersectsRect(
  x: number,
  y: number,
  radius: number,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean {
  const closestX = clamp(x, rect.left, rect.right);
  const closestY = clamp(y, rect.top, rect.bottom);
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy < radius * radius || (
    x > rect.left && x < rect.right && y > rect.top && y < rect.bottom
  );
}

export function stepRollingBalls(input: {
  balls: BallSimState[];
  deltaSeconds: number;
  gravityX: number;
  gravityY: number;
  gravityAccel: number;
  maxSpeed: number;
  inWater: boolean;
  solids: SolidRect[];
  triangles: TriangleSolid[];
  actors: ActorRect[];
  windX?: -1 | 0 | 1;
  conveyorX?: -1 | 0 | 1;
  groundDrag?: number;
  bounce?: boolean;
  now?: number;
}): BallStepResult {
  const dt = Math.min(Math.max(input.deltaSeconds, 0), 0.05);
  const actorCorrections: ActorCorrection[] = input.actors.map(() => ({
    index: 0,
    dx: 0,
    dy: 0,
    dvx: 0,
    dvy: 0,
  }));
  let bounced = false;
  actorCorrections.forEach((correction, index) => {
    correction.index = index;
  });

  const approach = input.balls.map((ball) => ({ x: ball.x, y: ball.y }));
  for (const ball of input.balls) {
    applyWind(ball, input.windX ?? 0, dt);
    applyGravity(ball, input, dt);
    if (input.inWater) {
      ball.vx *= BALL_WATER_DAMPING;
      ball.vy *= BALL_WATER_DAMPING;
    }
    if (ball.grounded) applyGroundDrag(ball, input.groundDrag ?? BALL_GROUND_DRAG, dt);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.animTime += dt;
  }

  const arrival = input.balls.map((ball) => ({ vx: ball.vx, vy: ball.vy }));
  const contactNormals: Array<{ x: number; y: number } | null> = input.balls.map(() => null);
  const grounded: boolean[] = input.balls.map(() => false);
  const carried = new Set<BallSimState>();
  for (let pass = 0; pass < 3; pass += 1) {
    input.balls.forEach((ball, ballIndex) => {
      let touchedGround = false;
      let supportNormal: { x: number; y: number } | null = null;
      for (const solid of input.solids) {
        if (
          solid.oneWay
          && !ballLandsOnOneWay(approach[ballIndex], ball, solid, input.gravityY)
        ) continue;
        const normal = resolveCircleSolid(ball, solid, approach[ballIndex]);
        if (!normal) continue;
        if (isSupportNormal(normal, input.gravityX, input.gravityY)) {
          touchedGround = true;
          supportNormal = normal;
          if (solid.kind === 'platform' && !carried.has(ball)) {
            carried.add(ball);
            carryOnPlatform(ball, solid, normal, dt);
          }
        }
      }
      for (const triangle of input.triangles) {
        const normal = resolveCircleTriangle(ball, triangle);
        if (!normal) continue;
        if (isSupportNormal(normal, input.gravityX, input.gravityY)) {
          touchedGround = true;
          supportNormal = normal;
        }
      }
      if (ball.pushable) {
        input.actors.forEach((actor, actorIndex) => {
          const correction = separateBallAndActor(
            ball,
            actor,
            input.gravityX,
            input.gravityY,
            input.solids,
          );
          if (!correction) return;
          actorCorrections[actorIndex].dx += correction.dx;
          actorCorrections[actorIndex].dy += correction.dy;
          actorCorrections[actorIndex].dvx += correction.dvx;
          actorCorrections[actorIndex].dvy += correction.dvy;
          actor.left += correction.dx;
          actor.right += correction.dx;
          actor.top += correction.dy;
          actor.bottom += correction.dy;
          actor.vx += correction.dvx;
          actor.vy += correction.dvy;
        });
      }
      separateBalls(input.balls);
      // A sideways push is not the rolling surface. Spin follows the ground
      // so a ball rolls while a player, crate, or other ball is pushing it.
      if (supportNormal) contactNormals[ballIndex] = supportNormal;
      if (touchedGround) grounded[ballIndex] = true;
    });
  }

  input.balls.forEach((ball, index) => {
    ball.grounded = grounded[index];
    if (ball.grounded) applyConveyor(ball, input.conveyorX ?? 0);
    if (launchFromBounceTile(ball, input, grounded[index], arrival[index])) bounced = true;
    const contactNormal = contactNormals[index];
    if (contactNormal && grounded[index]) {
      const tx = -contactNormal.y;
      const ty = contactNormal.x;
      const tangentSpeed = ball.vx * tx + ball.vy * ty;
      ball.spin = tangentSpeed / ball.radius;
    }
    ball.angle += ball.spin * dt;
  });

  return { actorCorrections, bounced };
}

function applyGravity(
  ball: BallSimState,
  input: { gravityX: number; gravityY: number; gravityAccel: number; maxSpeed: number },
  dt: number,
): void {
  const along = ball.vx * input.gravityX + ball.vy * input.gravityY;
  const next = clamp(along + input.gravityAccel * dt, -input.maxSpeed, input.maxSpeed);
  const delta = next - along;
  ball.vx += input.gravityX * delta;
  ball.vy += input.gravityY * delta;
}

function applyWind(ball: BallSimState, windX: -1 | 0 | 1, dt: number): void {
  if (windX === 0) return;
  const accel = windX * (BALL_WIND_ACCELERATION / ball.weight) * dt;
  ball.vx = clamp(ball.vx + accel, -BALL_WIND_MAX_SPEED, BALL_WIND_MAX_SPEED);
}

function applyGroundDrag(ball: BallSimState, drag: number, dt: number): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= 0.01) {
    ball.vx = 0;
    ball.vy = 0;
    return;
  }
  const drop = Math.min(speed, (drag / ball.weight) * dt);
  const scale = (speed - drop) / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

function applyConveyor(ball: BallSimState, conveyorX: -1 | 0 | 1): void {
  if (conveyorX === 0) return;
  const belt = conveyorX * BALL_CONVEYOR_SPEED;
  if (ball.vx * Math.sign(belt) >= Math.abs(belt)) return;
  const next = ball.vx + Math.sign(belt) * Math.min(BALL_CONVEYOR_SPEED, Math.abs(belt - ball.vx));
  ball.vx = next;
}

function launchFromBounceTile(
  ball: BallSimState,
  input: { gravityX: number; gravityY: number; bounce?: boolean; now?: number },
  grounded: boolean,
  arrival: { vx: number; vy: number },
): boolean {
  if (!input.bounce || !grounded) return false;
  const now = input.now ?? 0;
  if (now < ball.bounceCooldownUntil) return false;
  const gravityX = input.gravityX;
  const gravityY = input.gravityY;
  const along = ball.vx * gravityX + ball.vy * gravityY;
  if (along < -24) return false;
  // The tile corner can scrape or reverse the run. Keep the speed the ball
  // arrived with, perpendicular to gravity, and replace only the gravity part.
  const tangentX = -gravityY;
  const tangentY = gravityX;
  const tangentSpeed = arrival.vx * tangentX + arrival.vy * tangentY;
  ball.vx = tangentX * tangentSpeed - gravityX * BALL_BOUNCE_SPEED;
  ball.vy = tangentY * tangentSpeed - gravityY * BALL_BOUNCE_SPEED;
  ball.bounceCooldownUntil = now + BALL_BOUNCE_COOLDOWN_MS;
  return true;
}

function ballLandsOnOneWay(
  previous: { x: number; y: number },
  ball: BallSimState,
  rect: SolidRect,
  gravityY: number,
): boolean {
  if (gravityY > 0) return previous.y + ball.radius <= rect.top + 6 && ball.vy >= -12;
  if (gravityY < 0) return previous.y - ball.radius >= rect.bottom - 6 && ball.vy <= 12;
  return false;
}

function separateAlongAxis(
  ball: BallSimState,
  rect: SolidRect,
  previous: { x: number; y: number },
  axis: 'x' | 'y',
): { x: number; y: number } | null {
  let nx = 0;
  let ny = 0;
  if (axis === 'y') {
    if (previous.y <= rect.top) ny = -1;
    else if (previous.y >= rect.bottom) ny = 1;
    else if (ball.vy > 0) ny = -1;
    else if (ball.vy < 0) ny = 1;
    else ny = (ball.y - rect.top) <= (rect.bottom - ball.y) ? -1 : 1;
  } else if (previous.x <= rect.left) nx = -1;
  else if (previous.x >= rect.right) nx = 1;
  else if (ball.vx > 0) nx = -1;
  else if (ball.vx < 0) nx = 1;
  else nx = (ball.x - rect.left) <= (rect.right - ball.x) ? -1 : 1;
  const pen = axis === 'y'
    ? (ny < 0 ? ball.y - (rect.top - ball.radius) : (rect.bottom + ball.radius) - ball.y)
    : (nx < 0 ? ball.x - (rect.left - ball.radius) : (rect.right + ball.radius) - ball.x);
  if (pen <= 0) return null;
  const nextX = ball.x + nx * pen;
  const nextY = ball.y + ny * pen;
  if (circleIntersectsRect(nextX, nextY, ball.radius, rect)) return null;
  ball.x = nextX;
  ball.y = nextY;
  const vn = (ball.vx - rect.vx) * nx + (ball.vy - rect.vy) * ny;
  if (vn < 0) {
    ball.vx -= vn * nx;
    ball.vy -= vn * ny;
  }
  return { x: nx, y: ny };
}

function resolveCircleSolid(
  ball: BallSimState,
  rect: SolidRect,
  previous: { x: number; y: number },
): { x: number; y: number } | null {
  if (!circleIntersectsRect(ball.x, ball.y, ball.radius, rect)) return null;
  // A tile seam is a corner. Leave along the axis the ball arrived on so a
  // floor or ceiling cannot turn the run around.
  const prevDx = Math.abs(previous.x - clamp(previous.x, rect.left, rect.right));
  const prevDy = Math.abs(previous.y - clamp(previous.y, rect.top, rect.bottom));
  const verticalFirst = prevDy > prevDx + 0.01 || (
    Math.abs(prevDy - prevDx) <= 0.01 && Math.abs(ball.vy) >= Math.abs(ball.vx)
  );
  const axes: Array<'x' | 'y'> = verticalFirst ? ['y', 'x'] : ['x', 'y'];
  for (const axis of axes) {
    const separated = separateAlongAxis(ball, rect, previous, axis);
    if (separated) return separated;
  }
  const savedVx = ball.vx;
  const savedVy = ball.vy;
  const closestX = clamp(ball.x, rect.left, rect.right);
  const closestY = clamp(ball.y, rect.top, rect.bottom);
  let dx = ball.x - closestX;
  let dy = ball.y - closestY;
  const inside = dx === 0 && dy === 0
    && ball.x > rect.left && ball.x < rect.right
    && ball.y > rect.top && ball.y < rect.bottom;
  let dist = Math.hypot(dx, dy);
  if (inside) {
    const options = [
      { pen: ball.radius + (ball.x - rect.left), x: -1, y: 0 },
      { pen: ball.radius + (rect.right - ball.x), x: 1, y: 0 },
      { pen: ball.radius + (ball.y - rect.top), x: 0, y: -1 },
      { pen: ball.radius + (rect.bottom - ball.y), x: 0, y: 1 },
    ];
    const best = options.reduce((chosen, option) => option.pen < chosen.pen ? option : chosen);
    dx = best.x;
    dy = best.y;
    dist = 1;
    ball.x += best.x * best.pen;
    ball.y += best.y * best.pen;
  } else if (dist >= ball.radius || dist === 0) {
    return null;
  } else {
    const nx = dx / dist;
    const ny = dy / dist;
    const pen = ball.radius - dist;
    ball.x += nx * pen;
    ball.y += ny * pen;
    dx = nx;
    dy = ny;
    dist = 1;
  }
  const nx = dx / dist;
  const ny = dy / dist;
  const vn = (savedVx - rect.vx) * nx + (savedVy - rect.vy) * ny;
  if (vn < 0) {
    ball.vx = savedVx - vn * nx;
    ball.vy = savedVy - vn * ny;
  } else {
    ball.vx = savedVx;
    ball.vy = savedVy;
  }
  if (Math.abs(ny) >= Math.abs(nx)) ball.vx = savedVx;
  else ball.vy = savedVy;
  return { x: nx, y: ny };
}

function resolveCircleTriangle(ball: BallSimState, triangle: TriangleSolid): { x: number; y: number } | null {
  const edges = triangleEdges(triangle.anchorX, triangle.anchorY, triangle.legX, triangle.legY);
  const verts = triangleVertices(triangle.anchorX, triangle.anchorY, triangle.legX, triangle.legY);
  let bestSigned = Number.NEGATIVE_INFINITY;
  let best: TriangleEdge | null = null;
  for (const edge of edges) {
    const signed = (ball.x - edge.a.x) * edge.nx + (ball.y - edge.a.y) * edge.ny;
    if (signed > bestSigned) {
      bestSigned = signed;
      best = edge;
    }
  }
  const inside = separationFromTriangle(
    triangle.anchorX,
    triangle.anchorY,
    triangle.legX,
    triangle.legY,
    ball.x,
    ball.y,
  ) !== null;
  if (best && bestSigned < ball.radius && (inside || projectsOntoSegment(best, ball.x, ball.y))) {
    return pushCircleAlongNormal(ball, best.nx, best.ny, ball.radius - bestSigned);
  }
  let closest: TrianglePoint | null = null;
  let closestDist = ball.radius;
  for (const vertex of [verts.rightAngle, verts.horizontal, verts.vertical]) {
    const dist = Math.hypot(ball.x - vertex.x, ball.y - vertex.y);
    if (dist < closestDist) {
      closestDist = dist;
      closest = vertex;
    }
  }
  if (!closest || closestDist === 0 || closestDist >= ball.radius) return null;
  const nx = (ball.x - closest.x) / closestDist;
  const ny = (ball.y - closest.y) / closestDist;
  return pushCircleAlongNormal(ball, nx, ny, ball.radius - closestDist);
}

function pushCircleAlongNormal(
  ball: BallSimState,
  nx: number,
  ny: number,
  pen: number,
): { x: number; y: number } {
  if (pen > 0) {
    ball.x += nx * pen;
    ball.y += ny * pen;
  }
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx -= vn * nx;
    ball.vy -= vn * ny;
  }
  return { x: nx, y: ny };
}

function circleSolidDepth(x: number, y: number, radius: number, rect: SolidRect): number {
  if (x > rect.left && x < rect.right && y > rect.top && y < rect.bottom) {
    return radius + Math.min(x - rect.left, rect.right - x, y - rect.top, rect.bottom - y);
  }
  const dx = x - clamp(x, rect.left, rect.right);
  const dy = y - clamp(y, rect.top, rect.bottom);
  return Math.max(0, radius - Math.hypot(dx, dy));
}

function embedsDeeper(
  x: number,
  y: number,
  radius: number,
  solids: SolidRect[],
  fromX: number,
  fromY: number,
): boolean {
  let next = 0;
  let current = 0;
  for (const solid of solids) {
    if (solid.oneWay) continue;
    next = Math.max(next, circleSolidDepth(x, y, radius, solid));
    current = Math.max(current, circleSolidDepth(fromX, fromY, radius, solid));
  }
  return next > current + 0.25;
}

function separateBallAndActor(
  ball: BallSimState,
  actor: ActorRect,
  gravityX: number,
  gravityY: number,
  solids: SolidRect[],
): { dx: number; dy: number; dvx: number; dvy: number; normal: { x: number; y: number } } | null {
  const closestX = clamp(ball.x, actor.left, actor.right);
  const closestY = clamp(ball.y, actor.top, actor.bottom);
  let dx = ball.x - closestX;
  let dy = ball.y - closestY;
  let dist = Math.hypot(dx, dy);
  const inside = dist === 0 && ball.x > actor.left && ball.x < actor.right && ball.y > actor.top && ball.y < actor.bottom;
  if (!inside && dist >= ball.radius) return null;
  if (inside) {
    const left = ball.x - actor.left;
    const right = actor.right - ball.x;
    const top = ball.y - actor.top;
    const bottom = actor.bottom - ball.y;
    if (left <= right && left <= top && left <= bottom) {
      dx = -1;
      dy = 0;
    } else if (right <= top && right <= bottom) {
      dx = 1;
      dy = 0;
    } else if (top <= bottom) {
      dx = 0;
      dy = -1;
    } else {
      dx = 0;
      dy = 1;
    }
    dist = 0;
  }
  const nx = dist === 0 ? dx : dx / dist;
  const ny = dist === 0 ? dy : dy / dist;
  const pen = ball.radius - dist;
  const actorCenterX = (actor.left + actor.right) / 2;
  // A step with no gravity still has a top. Flipped gravity moves that side.
  const supportX = gravityX === 0 && gravityY === 0 ? 0 : gravityX;
  const supportY = gravityX === 0 && gravityY === 0 ? 1 : gravityY;
  const support = ballTopSupport(ball, {
    centerX: actorCenterX,
    left: actor.left,
    right: actor.right,
    top: actor.top,
    bottom: actor.bottom,
    vx: actor.vx,
    vy: actor.vy,
    gravityX: supportX,
    gravityY: supportY,
  });
  // Feet on the ball: move the actor onto the surface and leave the ball put.
  // A butt stomp is a hit, including on the edge, so it keeps the push path.
  if (!actor.stomping && support && support.dx * supportX + support.dy * supportY < -0.01) {
    return {
      dx: support.dx,
      dy: support.dy,
      dvx: support.vx - actor.vx,
      dvy: support.vy - actor.vy,
      normal: { x: nx, y: ny },
    };
  }
  const resistance = ball.weight * (ball.pushScale || 1);
  const ballShare = actor.mass / (actor.mass + resistance);
  const actorShare = resistance / (actor.mass + resistance);
  let actorDx = -nx * pen * actorShare;
  let actorDy = -ny * pen * actorShare;
  let dvx = 0;
  let dvy = 0;
  let ballVx = ball.vx;
  let ballVy = ball.vy;
  const vn = (ball.vx - actor.vx) * nx + (ball.vy - actor.vy) * ny;
  if (vn < 0) {
    const impulse = -vn;
    ballVx += nx * impulse * ballShare;
    ballVy += ny * impulse * ballShare;
    dvx = -nx * impulse * actorShare;
    dvy = -ny * impulse * actorShare;
  }
  if (actor.stomping) {
    const intoBall = actor.vx * nx + actor.vy * ny;
    const bonus = Math.max(0, intoBall - BALL_REGULAR_PUSH_SPEED) * ballShare;
    if (bonus > 0) {
      ballVx += nx * bonus;
      ballVy += ny * bonus;
    }
  }
  let ballDx = nx * pen * ballShare;
  let ballDy = ny * pen * ballShare;
  // A shove along gravity lands after tile collision and would bury the actor.
  // The ball takes that part of the overlap.
  const into = actorDx * gravityX + actorDy * gravityY;
  if (into > 0) {
    ballDx += nx * pen * actorShare;
    ballDy += ny * pen * actorShare;
    if (vn < 0) {
      ballVx += nx * -vn * actorShare;
      ballVy += ny * -vn * actorShare;
    }
    actorDx -= gravityX * into;
    actorDy -= gravityY * into;
    const velInto = dvx * gravityX + dvy * gravityY;
    if (velInto > 0) {
      dvx -= gravityX * velInto;
      dvy -= gravityY * velInto;
    }
  }
  const nextX = ball.x + ballDx;
  const nextY = ball.y + ballDy;
  if (embedsDeeper(nextX, nextY, ball.radius, solids, ball.x, ball.y)) {
    let freeDx = -nx * pen;
    let freeDy = -ny * pen;
    const freeInto = freeDx * gravityX + freeDy * gravityY;
    if (freeInto > 0) {
      freeDx -= gravityX * freeInto;
      freeDy -= gravityY * freeInto;
    }
    const actorVn = actor.vx * nx + actor.vy * ny;
    let stopVx = actorVn > 0 ? -actorVn * nx : 0;
    let stopVy = actorVn > 0 ? -actorVn * ny : 0;
    const addedInto = stopVx * gravityX + stopVy * gravityY;
    if (addedInto > 0) {
      stopVx -= gravityX * addedInto;
      stopVy -= gravityY * addedInto;
    }
    return {
      dx: freeDx,
      dy: freeDy,
      dvx: stopVx,
      dvy: stopVy,
      normal: { x: nx, y: ny },
    };
  }
  ball.x = nextX;
  ball.y = nextY;
  ball.vx = ballVx;
  ball.vy = ballVy;
  return {
    dx: actorDx,
    dy: actorDy,
    dvx,
    dvy,
    normal: { x: nx, y: ny },
  };
}

export function separateBalls(balls: BallSimState[]): void {
  for (let startIndex = 0; startIndex < balls.length; startIndex += 1) {
    resolveBallPairs(balls, startIndex);
  }
}

function resolveBallPairs(balls: BallSimState[], startIndex: number): void {
  const ball = balls[startIndex];
  for (let otherIndex = startIndex + 1; otherIndex < balls.length; otherIndex += 1) {
    const other = balls[otherIndex];
    let dx = other.x - ball.x;
    let dy = other.y - ball.y;
    let dist = Math.hypot(dx, dy);
    const minDist = ball.radius + other.radius;
    if (dist >= minDist) continue;
    if (dist === 0) {
      dx = 1;
      dy = 0;
      dist = 1;
    }
    const nx = dx / dist;
    const ny = dy / dist;
    const pen = minDist - (dist === 1 && dx === 1 && dy === 0 ? 0 : dist);
    const shareA = other.weight / (ball.weight + other.weight);
    const shareB = ball.weight / (ball.weight + other.weight);
    ball.x -= nx * pen * shareA;
    ball.y -= ny * pen * shareA;
    other.x += nx * pen * shareB;
    other.y += ny * pen * shareB;
    const vn = (other.vx - ball.vx) * nx + (other.vy - ball.vy) * ny;
    if (vn < 0) {
      const impulse = -vn;
      ball.vx -= nx * impulse * shareA;
      ball.vy -= ny * impulse * shareA;
      other.vx += nx * impulse * shareB;
      other.vy += ny * impulse * shareB;
    }
  }
}

function carryOnPlatform(ball: BallSimState, solid: SolidRect, normal: { x: number; y: number }, dt: number): void {
  ball.x += solid.vx * dt;
  ball.y += solid.vy * dt;
  const tx = -normal.y;
  const ty = normal.x;
  const ballT = ball.vx * tx + ball.vy * ty;
  const platformT = solid.vx * tx + solid.vy * ty;
  const delta = platformT - ballT;
  ball.vx += delta * tx;
  ball.vy += delta * ty;
}

function isSupportNormal(normal: { x: number; y: number }, gravityX: number, gravityY: number): boolean {
  return normal.x * gravityX + normal.y * gravityY < -0.45;
}

function projectsOntoSegment(edge: TriangleEdge, x: number, y: number): boolean {
  const dx = edge.b.x - edge.a.x;
  const dy = edge.b.y - edge.a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = ((x - edge.a.x) * dx + (y - edge.a.y) * dy) / lengthSq;
  return t >= -0.02 && t <= 1.02;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
