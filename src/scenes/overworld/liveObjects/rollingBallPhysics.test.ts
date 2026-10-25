import { describe, expect, it } from 'vitest';
import {
  ROLLING_BALL_RADIUS,
  rollingBallClearsTileGap,
  rollingBallSettingsFromGraphic as settingsFromGraphic,
  listRollingBallGraphics as graphics,
  rollingBallActivatesPressurePlate,
} from '../../../config/rollingBall';
import {
  dragTriangleHandle as dragHandle,
  evaluateSlopeWalk as slopeWalk,
  isSteepTriangle as steep,
  triangleEdges,
  triangleVertices,
} from '../../../config/trianglePiece';
import {
  createBallState,
  stepRollingBalls,
  type SolidRect,
} from './rollingBallPhysics';

describe('rolling ball and triangle helpers', () => {
  it('lists only defined ball graphics and copies their preset', () => {
    expect(graphics().map((graphic) => graphic.name)).toEqual(['Basic Ball']);
    expect(settingsFromGraphic('basic')).toMatchObject({
      graphicId: 'basic',
      weight: 1,
      pushable: true,
      hurtEnemies: false,
      hurtFriendlies: false,
      hurtPlayer: false,
    });
    expect(settingsFromGraphic('missing').graphicId).toBe('basic');
  });

  it('gives a 30px ball clearance through a 32px tile gap and pushes a penetrating circle back out', () => {
    expect(rollingBallClearsTileGap(ROLLING_BALL_RADIUS, 32)).toBe(true);
    expect(rollingBallClearsTileGap(16, 32)).toBe(false);
    const walls: SolidRect[] = [
      { left: -16, right: 0, top: 0, bottom: 64, vx: 0, vy: 0, kind: 'tile' },
      { left: 32, right: 48, top: 0, bottom: 64, vx: 0, vy: 0, kind: 'tile' },
    ];
    const centered = createBallState(16, 20, settingsFromGraphic('basic'));
    stepRollingBalls({
      balls: [centered],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 0,
      gravityAccel: 0,
      maxSpeed: 500,
      inWater: false,
      solids: walls,
      triangles: [],
      actors: [],
    });
    expect(centered.x).toBeCloseTo(16, 4);

    const penetrating = createBallState(14, 20, settingsFromGraphic('basic'));
    stepRollingBalls({
      balls: [penetrating],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 0,
      gravityAccel: 0,
      maxSpeed: 500,
      inWater: false,
      solids: walls,
      triangles: [],
      actors: [],
    });
    expect(penetrating.x).toBeGreaterThan(14);
  });

  it('builds downhill speed on a ramp and keeps that direction', () => {
    const ball = createBallState(32 + 15 / Math.SQRT2, 32 - 15 / Math.SQRT2, settingsFromGraphic('basic'));
    for (let frame = 0; frame < 8; frame += 1) {
      stepRollingBalls({
        balls: [ball],
        deltaSeconds: 1 / 60,
        gravityX: 0,
        gravityY: 1,
        gravityAccel: 700,
        maxSpeed: 500,
        inWater: false,
        solids: [],
        triangles: [{ anchorX: 0, anchorY: 64, legX: 64, legY: -64 }],
        actors: [],
      });
    }
    const speed = Math.hypot(ball.vx, ball.vy);
    expect(speed).toBeGreaterThan(20);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.vy).toBeGreaterThan(0);
  });

  it('keeps a standing actor on the floor when a ball lands on them', () => {
    const ball = createBallState(10, 8, settingsFromGraphic('basic'));
    ball.vy = 120;
    const actor = { left: 0, right: 20, top: 18, bottom: 48, vx: 0, vy: 0, mass: 1 };
    const result = stepRollingBalls({
      balls: [ball],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 1,
      gravityAccel: 0,
      maxSpeed: 500,
      inWater: false,
      solids: [],
      triangles: [],
      actors: [actor],
    });
    expect(result.actorCorrections[0].dy).toBeLessThanOrEqual(0);
    expect(result.actorCorrections[0].dvy).toBeLessThanOrEqual(0);
    expect(ball.y).toBeLessThan(8);
  });

  it('gives a light ball more speed from the same push than a heavy ball', () => {
    const push = (weight: number) => {
      const settings = { ...settingsFromGraphic('basic'), weight };
      const ball = createBallState(40, 16, settings);
      ball.weight = weight;
      stepRollingBalls({
        balls: [ball],
        deltaSeconds: 1 / 60,
        gravityX: 0,
        gravityY: 0,
        gravityAccel: 0,
        maxSpeed: 500,
        inWater: false,
        solids: [],
        triangles: [],
        actors: [{ left: 0, right: 30, top: 0, bottom: 32, vx: 120, vy: 0, mass: 1 }],
      });
      return ball.vx;
    };
    expect(push(0.25)).toBeGreaterThan(push(4));
  });

  it('draws a tall hypotenuse on the true edge and ignores the vertical face as a floor', () => {
    for (const [legX, legY] of [[32, -48], [-32, -48], [32, 48], [-48, 32]] as const) {
      const edges = triangleEdges(0, 0, legX, legY);
      const hypotenuse = edges[2];
      const verts = triangleVertices(0, 0, legX, legY);
      const directionX = verts.vertical.x - verts.horizontal.x;
      const directionY = verts.vertical.y - verts.horizontal.y;
      expect(Math.abs(directionX * hypotenuse.nx + directionY * hypotenuse.ny)).toBeLessThan(1e-6);
      for (const point of [verts.horizontal, verts.vertical]) {
        const signed = (point.x - hypotenuse.a.x) * hypotenuse.nx + (point.y - hypotenuse.a.y) * hypotenuse.ny;
        expect(Math.abs(signed)).toBeLessThan(1e-6);
      }
      const inside = (verts.rightAngle.x - hypotenuse.a.x) * hypotenuse.nx
        + (verts.rightAngle.y - hypotenuse.a.y) * hypotenuse.ny;
      expect(inside).toBeLessThan(0);
    }
    const tall = triangleEdges(0, 48, 32, -48)[2];
    const falseStroke = { x: 0, y: 48 - (32 * 32) / 48 };
    const missed = Math.abs((falseStroke.x - tall.a.x) * tall.nx + (falseStroke.y - tall.a.y) * tall.ny);
    expect(missed).toBeGreaterThan(1);
    expect(slopeWalk({
      anchorX: 0,
      anchorY: 64,
      legX: 32,
      legY: -64,
      feetX: 1,
      feetY: 64,
      verticalVelocity: 0,
      horizontalIntent: 1,
      deltaSeconds: 1 / 60,
    })).toBeNull();
  });

  it('walks a 45 degree ramp and slides down a steeper one', () => {
    expect(steep(32, -32)).toBe(false);
    expect(steep(16, -32)).toBe(true);
    const walk = slopeWalk({
      anchorX: 0,
      anchorY: 32,
      legX: 32,
      legY: -32,
      feetX: 16,
      feetY: 16,
      verticalVelocity: 0,
      horizontalIntent: 1,
      deltaSeconds: 1 / 60,
    });
    expect(walk).toMatchObject({ supported: true, slideX: 0, blockUphill: false });
    const slide = slopeWalk({
      anchorX: 0,
      anchorY: 32,
      legX: 16,
      legY: -32,
      feetX: 8,
      feetY: 16,
      verticalVelocity: 0,
      horizontalIntent: -1,
      deltaSeconds: 1 / 60,
    });
    expect(slide?.blockUphill).toBe(true);
    expect(slide?.downhillX).toBe(1);
    expect(slide?.slideX).toBeGreaterThan(0);
  });

  it('snaps a hypotenuse drag to one grid axis', () => {
    const moved = dragHandle(
      { anchorX: 0, anchorY: 32, legX: 32, legY: -32 },
      'hypotenuse',
      20,
      4,
      0,
      0,
    );
    expect(moved.legY).toBe(-32);
    expect(Math.abs(moved.legX)).toBeGreaterThanOrEqual(16);
    expect(moved.legX % 16).toBe(0);
  });

  it('lets every rolling ball press a plate, including one that cannot be pushed', () => {
    expect(rollingBallActivatesPressurePlate(true)).toBe(true);
    expect(rollingBallActivatesPressurePlate(false)).toBe(true);
  });
});
