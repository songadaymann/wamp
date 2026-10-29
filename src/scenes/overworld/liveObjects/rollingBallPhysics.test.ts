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
  slopeSlideVelocity,
  steepSlopeMotion,
  triangleEdges,
  triangleVertices,
  uphillTravelCorrection,
} from '../../../config/trianglePiece';
import {
  BALL_ICE_DRAG,
  BALL_STICKY_DRAG,
  BALL_STICKY_PUSH_SCALE,
  ballTopSupport,
  createBallState,
  resetBallMotion,
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

  it('puts a rolling ball back at its spawn with no leftover velocity', () => {
    const ball = createBallState(40, 80, settingsFromGraphic('basic'));
    ball.vx = 180;
    ball.vy = -40;
    ball.spin = 3;
    ball.angle = 1.2;
    ball.grounded = true;
    ball.pushScale = 3;
    ball.gravityDirection = 'up';
    ball.gravityRoomId = '0,0';
    ball.bounceCooldownUntil = 900;
    resetBallMotion(ball, 12, 30);
    expect(ball).toMatchObject({
      x: 12,
      y: 30,
      vx: 0,
      vy: 0,
      spin: 0,
      angle: 0,
      grounded: false,
      pushScale: 1,
      gravityDirection: 'down',
      gravityRoomId: null,
      bounceCooldownUntil: 0,
    });
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

  it('rolls a grounded ball while an actor is pushing it', () => {
    const ball = createBallState(40, 16, settingsFromGraphic('basic'));
    ball.vx = 80;
    const floor: SolidRect = { left: 0, right: 80, top: 30, bottom: 46, vx: 0, vy: 0, kind: 'tile' };
    stepRollingBalls({
      balls: [ball],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 1,
      gravityAccel: 700,
      maxSpeed: 500,
      inWater: false,
      solids: [floor],
      triangles: [],
      actors: [{ left: 0, right: 28, top: 0, bottom: 24, vx: 0, vy: 0, mass: 1 }],
    });
    expect(ball.grounded).toBe(true);
    expect(Math.sign(ball.spin)).toBe(Math.sign(ball.vx));
    expect(Math.abs(ball.spin)).toBeGreaterThan(1);
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
    const slideSpeed = slopeSlideVelocity(16, -32);
    expect(slideSpeed.x).toBeGreaterThan(0);
    expect(slideSpeed.y).toBeGreaterThan(0);
    expect(Math.hypot(slideSpeed.x, slideSpeed.y)).toBeCloseTo(70, 4);
  });

  it('does not grab the floor at the bottom of a steep slope when walking uphill', () => {
    expect(slopeWalk({
      anchorX: 0,
      anchorY: 64,
      legX: 16,
      legY: -64,
      feetX: 14,
      feetY: 64,
      verticalVelocity: 0,
      horizontalIntent: -1,
      deltaSeconds: 1 / 60,
    })).toBeNull();
    const riding = slopeWalk({
      anchorX: 0,
      anchorY: 64,
      legX: 16,
      legY: -64,
      feetX: 8,
      feetY: 32,
      verticalVelocity: 40,
      horizontalIntent: -1,
      deltaSeconds: 1 / 60,
    });
    expect(riding?.supported).toBe(true);
    expect(riding?.slideX).toBeGreaterThan(0);
  });

  it('never raises a body that is on a steep slope, including while jumping', () => {
    expect(uphillTravelCorrection({
      legX: 16,
      legY: -64,
      traveledX: -2.5,
      feetDelta: 0,
    })).toBeCloseTo(2.5);
    expect(uphillTravelCorrection({
      legX: 16,
      legY: -64,
      traveledX: 1.2,
      feetDelta: 0,
    })).toBe(0);
    expect(uphillTravelCorrection({
      legX: 32,
      legY: -32,
      traveledX: -2.5,
      feetDelta: 0,
    })).toBe(0);
    const climbed = steepSlopeMotion({
      anchorX: 0,
      anchorY: 64,
      legX: 16,
      legY: -64,
      feetX: 8,
      feetY: 28,
      traveledX: -2.5,
      traveledY: -4,
      deltaSeconds: 1 / 60,
    });
    expect(climbed).not.toBeNull();
    expect(climbed!.dy).toBeGreaterThanOrEqual(0);
    expect(climbed!.dx).toBeGreaterThan(0);
    expect(climbed!.vy).toBeGreaterThan(0);
    expect(28 + climbed!.dy).toBeGreaterThanOrEqual(28);
    const walked = slopeWalk({
      anchorX: 0,
      anchorY: 32,
      legX: 32,
      legY: -32,
      feetX: 16,
      feetY: 16,
      verticalVelocity: 0,
      horizontalIntent: -1,
      deltaSeconds: 1 / 60,
    });
    expect(walked?.slideX).toBe(0);
    expect(steepSlopeMotion({
      anchorX: 0,
      anchorY: 32,
      legX: 32,
      legY: -32,
      feetX: 16,
      feetY: 16,
      traveledX: 0,
      traveledY: 4,
      deltaSeconds: 1 / 60,
    })).toBeNull();
    const stomp = steepSlopeMotion({
      anchorX: 0,
      anchorY: 32,
      legX: 32,
      legY: -32,
      feetX: 16,
      feetY: 16,
      traveledX: -2,
      traveledY: 8,
      deltaSeconds: 1 / 60,
      forceSlide: true,
      verticalVelocity: 520,
    });
    expect(stomp).not.toBeNull();
    expect(stomp!.dx).toBeGreaterThan(0);
    expect(stomp!.vy).toBeGreaterThan(0);
    expect(steepSlopeMotion({
      anchorX: 0,
      anchorY: 32,
      legX: 64,
      legY: -32,
      feetX: 32,
      feetY: 16,
      traveledX: 0,
      traveledY: 8,
      deltaSeconds: 1 / 60,
      forceSlide: true,
      verticalVelocity: 520,
    })).toBeNull();
  });

  it('treats the top of a ball as ground and leaves side hits as a push', () => {
    const ball = { x: 16, y: 40, radius: 15 };
    const landed = ballTopSupport(ball, { centerX: 16, bottom: 30, vy: 200 });
    expect(landed?.dy).toBeCloseTo(-5);
    expect(landed?.vy).toBe(0);
    const resting = ballTopSupport(ball, { centerX: 16, bottom: 25, vy: 0 });
    expect(resting?.dy).toBeCloseTo(0);
    expect(resting?.vy).toBe(0);
    expect(ballTopSupport(ball, { centerX: 30, bottom: 30, vy: 0 })).toBeNull();
    expect(ballTopSupport(ball, { centerX: 16, bottom: 24, vy: -120 })).toBeNull();

    const rolling = createBallState(16, 40, settingsFromGraphic('basic'));
    const actor = { left: 8, right: 24, top: 0, bottom: 30, vx: 0, vy: 200, mass: 1 };
    const result = stepRollingBalls({
      balls: [rolling],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 0,
      gravityAccel: 0,
      maxSpeed: 500,
      inWater: false,
      solids: [],
      triangles: [],
      actors: [actor],
    });
    expect(result.actorCorrections[0].dy).toBeLessThan(0);
    expect(result.actorCorrections[0].dvy).toBeLessThan(0);
    expect(rolling.y).toBeCloseTo(40, 4);
  });

  it('launches a ball harder from a butt stomp than from standing on it', () => {
    const strike = (vy: number, stomping: boolean) => {
      const ball = createBallState(30, 40, settingsFromGraphic('basic'));
      stepRollingBalls({
        balls: [ball],
        deltaSeconds: 1 / 60,
        gravityX: 0,
        gravityY: 1,
        gravityAccel: 0,
        maxSpeed: 500,
        inWater: false,
        solids: [],
        triangles: [],
        actors: [{ left: 0, right: 22, top: 8, bottom: 34, vx: 0, vy, mass: 1, stomping }],
      });
      return Math.hypot(ball.vx, ball.vy);
    };
    const stomp = strike(520, true);
    const push = strike(150, false);
    expect(stomp).toBeGreaterThan(push + 40);

    const seated = createBallState(16, 40, settingsFromGraphic('basic'));
    stepRollingBalls({
      balls: [seated],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 1,
      gravityAccel: 0,
      maxSpeed: 500,
      inWater: false,
      solids: [],
      triangles: [],
      actors: [{ left: 8, right: 24, top: 0, bottom: 30, vx: 0, vy: 520, mass: 1, stomping: true }],
    });
    expect(seated.vy).toBeGreaterThan(80);
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

  it('keeps more speed on ice than on ordinary ground, and less when the surface is sticky', () => {
    const coast = (drag?: number) => {
      const ball = createBallState(20, 16, settingsFromGraphic('basic'));
      ball.vx = 200;
      const floor: SolidRect = { left: 0, right: 80, top: 30, bottom: 46, vx: 0, vy: 0, kind: 'tile' };
      for (let frame = 0; frame < 40; frame += 1) {
        stepRollingBalls({
          balls: [ball],
          deltaSeconds: 1 / 60,
          gravityX: 0,
          gravityY: 1,
          gravityAccel: 700,
          maxSpeed: 500,
          inWater: false,
          groundDrag: drag,
          solids: [floor],
          triangles: [],
          actors: [],
        });
      }
      return ball.vx;
    };
    const ice = coast(BALL_ICE_DRAG);
    const ground = coast();
    const sticky = coast(BALL_STICKY_DRAG);
    expect(ice).toBeGreaterThan(ground);
    expect(ground).toBeGreaterThan(sticky);
  });

  it('makes a sticky ball harder to push', () => {
    const shove = (pushScale: number) => {
      const ball = createBallState(40, 16, settingsFromGraphic('basic'));
      ball.pushScale = pushScale;
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
    expect(shove(1)).toBeGreaterThan(shove(BALL_STICKY_PUSH_SCALE));
  });

  it('sinks a heavier ball faster in water', () => {
    const drop = (weight: number) => {
      const ball = createBallState(0, 0, { ...settingsFromGraphic('basic'), weight });
      ball.weight = weight;
      for (let frame = 0; frame < 30; frame += 1) {
        stepRollingBalls({
          balls: [ball],
          deltaSeconds: 1 / 60,
          gravityX: 0,
          gravityY: 1,
          gravityAccel: 700 * 0.35 * weight,
          maxSpeed: Math.min(500, 118 * weight),
          inWater: true,
          solids: [],
          triangles: [],
          actors: [],
        });
      }
      return ball.y;
    };
    expect(drop(4)).toBeGreaterThan(drop(0.25));
  });

  it('lets wind push a light ball farther than a heavy one', () => {
    const blow = (weight: number) => {
      const ball = createBallState(0, 0, { ...settingsFromGraphic('basic'), weight });
      ball.weight = weight;
      for (let frame = 0; frame < 20; frame += 1) {
        stepRollingBalls({
          balls: [ball],
          deltaSeconds: 1 / 60,
          gravityX: 0,
          gravityY: 0,
          gravityAccel: 0,
          maxSpeed: 500,
          inWater: false,
          windX: 1,
          solids: [],
          triangles: [],
          actors: [],
        });
      }
      return ball.vx;
    };
    expect(blow(0.25)).toBeGreaterThan(blow(4));
    expect(blow(0.25)).toBeGreaterThan(0);
  });

  it('keeps sideways momentum when a bounce tile launches against flipped or sideways gravity', () => {
    const ceiling: SolidRect = { left: 0, right: 160, top: 0, bottom: 16, vx: 0, vy: 0, kind: 'tile' };
    const onCeiling = createBallState(40, 16 + 15, settingsFromGraphic('basic'));
    onCeiling.vx = 120;
    stepRollingBalls({
      balls: [onCeiling],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: -1,
      gravityAccel: 700,
      maxSpeed: 500,
      inWater: false,
      bounce: true,
      now: 0,
      solids: [ceiling],
      triangles: [],
      actors: [],
    });
    expect(onCeiling.vx).toBeGreaterThan(100);
    expect(onCeiling.vy).toBeGreaterThan(0);

    const wall: SolidRect = { left: 0, right: 16, top: 0, bottom: 160, vx: 0, vy: 0, kind: 'tile' };
    const onWall = createBallState(16 + 15, 40, settingsFromGraphic('basic'));
    onWall.vy = -90;
    stepRollingBalls({
      balls: [onWall],
      deltaSeconds: 1 / 60,
      gravityX: -1,
      gravityY: 0,
      gravityAccel: 700,
      maxSpeed: 500,
      inWater: false,
      bounce: true,
      now: 0,
      solids: [wall],
      triangles: [],
      actors: [],
    });
    expect(onWall.vy).toBeLessThan(-70);
    expect(onWall.vx).toBeGreaterThan(0);

    const tile: SolidRect = { left: 48, right: 64, top: 0, bottom: 16, vx: 0, vy: 0, kind: 'tile' };
    const approaching = createBallState(20, 40, settingsFromGraphic('basic'));
    approaching.vx = 140;
    approaching.vy = -40;
    for (let frame = 0; frame < 12; frame += 1) {
      stepRollingBalls({
        balls: [approaching],
        deltaSeconds: 1 / 60,
        gravityX: 0,
        gravityY: -1,
        gravityAccel: 700,
        maxSpeed: 500,
        inWater: false,
        bounce: true,
        now: frame * 20,
        solids: [tile],
        triangles: [],
        actors: [],
      });
    }
    expect(approaching.vx).toBeGreaterThan(100);
    expect(approaching.vy).toBeGreaterThan(0);

    const side: SolidRect = { left: 0, right: 16, top: 48, bottom: 64, vx: 0, vy: 0, kind: 'tile' };
    const alongWall = createBallState(40, 20, settingsFromGraphic('basic'));
    alongWall.vx = -40;
    alongWall.vy = 140;
    for (let frame = 0; frame < 12; frame += 1) {
      stepRollingBalls({
        balls: [alongWall],
        deltaSeconds: 1 / 60,
        gravityX: -1,
        gravityY: 0,
        gravityAccel: 700,
        maxSpeed: 500,
        inWater: false,
        bounce: true,
        now: frame * 20,
        solids: [side],
        triangles: [],
        actors: [],
      });
    }
    expect(alongWall.vy).toBeGreaterThan(100);
    expect(alongWall.vx).toBeGreaterThan(0);
  });

  it('rides a conveyor and bounces off a bounce tile', () => {
    const ball = createBallState(20, 16, settingsFromGraphic('basic'));
    const floor: SolidRect = { left: 0, right: 80, top: 30, bottom: 46, vx: 0, vy: 0, kind: 'tile' };
    stepRollingBalls({
      balls: [ball],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 1,
      gravityAccel: 700,
      maxSpeed: 500,
      inWater: false,
      conveyorX: 1,
      solids: [floor],
      triangles: [],
      actors: [],
    });
    expect(ball.vx).toBeGreaterThan(0);

    const resting = createBallState(20, 16, settingsFromGraphic('basic'));
    const launched = stepRollingBalls({
      balls: [resting],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 1,
      gravityAccel: 700,
      maxSpeed: 500,
      inWater: false,
      bounce: true,
      now: 0,
      solids: [floor],
      triangles: [],
      actors: [],
    });
    expect(launched.bounced).toBe(true);
    expect(resting.vy).toBeLessThan(0);
  });

  it('builds speed along a ceiling slope when gravity points up', () => {
    const ball = createBallState(32 + 15 / Math.SQRT2, 32 + 15 / Math.SQRT2, settingsFromGraphic('basic'));
    for (let frame = 0; frame < 8; frame += 1) {
      stepRollingBalls({
        balls: [ball],
        deltaSeconds: 1 / 60,
        gravityX: 0,
        gravityY: -1,
        gravityAccel: 700,
        maxSpeed: 500,
        inWater: false,
        solids: [],
        triangles: [{ anchorX: 0, anchorY: 0, legX: 64, legY: 64 }],
        actors: [],
      });
    }
    const speed = Math.hypot(ball.vx, ball.vy);
    expect(ball.grounded).toBe(true);
    expect(speed).toBeGreaterThan(20);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.vy).toBeLessThan(0);
  });

  it('passes through a one-way platform from below and lands on it from above', () => {
    const platform: SolidRect = { left: 0, right: 64, top: 40, bottom: 56, vx: 0, vy: 0, kind: 'tile', oneWay: true };
    const rising = createBallState(32, 70, settingsFromGraphic('basic'));
    rising.vy = -200;
    stepRollingBalls({
      balls: [rising],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 1,
      gravityAccel: 0,
      maxSpeed: 500,
      inWater: false,
      solids: [platform],
      triangles: [],
      actors: [],
    });
    expect(rising.y).toBeLessThan(70);

    const falling = createBallState(32, 24, settingsFromGraphic('basic'));
    falling.vy = 200;
    stepRollingBalls({
      balls: [falling],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: 1,
      gravityAccel: 0,
      maxSpeed: 500,
      inWater: false,
      solids: [platform],
      triangles: [],
      actors: [],
    });
    expect(falling.y + falling.radius).toBeLessThanOrEqual(platform.top + 1);
    expect(falling.grounded).toBe(true);
  });

  it('keeps horizontal direction when a ceiling bounce lands on the floor', () => {
    const tile = (left: number, top: number): SolidRect => ({
      left,
      right: left + 16,
      top,
      bottom: top + 16,
      vx: 0,
      vy: 0,
      kind: 'tile',
    });
    const ceiling = [0, 16, 32, 48, 64, 80, 96].map((left) => tile(left, 0));
    const floor = [0, 16, 32, 48, 64, 80, 96].map((left) => tile(left, 128));
    const ball = createBallState(20, 16 + 15, settingsFromGraphic('basic'));
    ball.vx = 120;
    let lowestVx = ball.vx;
    let launched = false;
    let landed = false;
    for (let frame = 0; frame < 90; frame += 1) {
      const result = stepRollingBalls({
        balls: [ball],
        deltaSeconds: 1 / 60,
        gravityX: 0,
        gravityY: -1,
        gravityAccel: 700,
        maxSpeed: 500,
        inWater: false,
        bounce: ball.y < 48,
        now: frame * 16,
        solids: [...ceiling, ...floor],
        triangles: [],
        actors: [],
      });
      if (result.bounced) launched = true;
      if (launched && ball.y > 100) landed = true;
      lowestVx = Math.min(lowestVx, ball.vx);
    }
    expect(launched).toBe(true);
    expect(landed).toBe(true);
    expect(lowestVx).toBeGreaterThan(40);
  });

  it('does not reverse a downward run across a tile seam', () => {
    const tiles: SolidRect[] = [0, 16, 32].map((left) => ({
      left,
      right: left + 16,
      top: 64,
      bottom: 80,
      vx: 0,
      vy: 0,
      kind: 'tile' as const,
    }));
    const ball = createBallState(16, 64 + 3, settingsFromGraphic('basic'));
    ball.vx = 90;
    ball.vy = 220;
    stepRollingBalls({
      balls: [ball],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: -1,
      gravityAccel: 0,
      maxSpeed: 500,
      inWater: false,
      solids: tiles,
      triangles: [],
      actors: [],
    });
    expect(ball.vx).toBeGreaterThan(70);
    expect(ball.y).toBeLessThan(64);
  });

  it('keeps sideways momentum when a ball hits a tiled floor under inverted gravity', () => {
    const tiles: SolidRect[] = [0, 16, 32, 48, 64].map((left) => ({
      left,
      right: left + 16,
      top: 0,
      bottom: 16,
      vx: 0,
      vy: 0,
      kind: 'tile' as const,
    }));
    const ball = createBallState(8, 48, settingsFromGraphic('basic'));
    ball.vx = 140;
    ball.vy = -260;
    let lowestVx = ball.vx;
    for (let frame = 0; frame < 24; frame += 1) {
      stepRollingBalls({
        balls: [ball],
        deltaSeconds: 1 / 60,
        gravityX: 0,
        gravityY: -1,
        gravityAccel: 700,
        maxSpeed: 500,
        inWater: false,
        solids: tiles,
        triangles: [],
        actors: [],
      });
      lowestVx = Math.min(lowestVx, ball.vx);
    }
    expect(lowestVx).toBeGreaterThan(80);
    expect(ball.y).toBeGreaterThan(16);
  });

  it('keeps a sideways run when a ball lands on a tiled floor', () => {
    const tiles: SolidRect[] = [0, 16, 32, 48, 64].map((left) => ({
      left,
      right: left + 16,
      top: 48,
      bottom: 64,
      vx: 0,
      vy: 0,
      kind: 'tile' as const,
    }));
    const ball = createBallState(8, 16, settingsFromGraphic('basic'));
    ball.vx = 140;
    ball.vy = 260;
    let lowestVx = ball.vx;
    for (let frame = 0; frame < 24; frame += 1) {
      stepRollingBalls({
        balls: [ball],
        deltaSeconds: 1 / 60,
        gravityX: 0,
        gravityY: 1,
        gravityAccel: 700,
        maxSpeed: 500,
        inWater: false,
        solids: tiles,
        triangles: [],
        actors: [],
      });
      lowestVx = Math.min(lowestVx, ball.vx);
    }
    expect(lowestVx).toBeGreaterThan(80);
    expect(ball.y).toBeLessThan(48);
  });

  it('seats an upside-down actor on a ball instead of pushing the ball through a corner', () => {
    const ceiling: SolidRect[] = [0, 16, 32].map((left) => ({
      left,
      right: left + 16,
      top: 0,
      bottom: 16,
      vx: 0,
      vy: 0,
      kind: 'tile' as const,
    }));
    const wall: SolidRect = { left: 48, right: 64, top: 16, bottom: 96, vx: 0, vy: 0, kind: 'tile' };
    const ball = createBallState(33, 31, settingsFromGraphic('basic'));
    const actor = { left: 14, right: 28, top: 40, bottom: 64, vx: 0, vy: -200, mass: 1 };
    const first = stepRollingBalls({
      balls: [ball],
      deltaSeconds: 1 / 60,
      gravityX: 0,
      gravityY: -1,
      gravityAccel: 700,
      maxSpeed: 500,
      inWater: false,
      solids: [...ceiling, wall],
      triangles: [],
      actors: [actor],
    });
    expect(first.actorCorrections[0].dy).toBeGreaterThan(0);
    for (let frame = 0; frame < 8; frame += 1) {
      stepRollingBalls({
        balls: [ball],
        deltaSeconds: 1 / 60,
        gravityX: 0,
        gravityY: -1,
        gravityAccel: 700,
        maxSpeed: 500,
        inWater: false,
        solids: [...ceiling, wall],
        triangles: [],
        actors: [actor],
      });
    }
    expect(ball.y).toBeGreaterThan(24);
    expect(ball.x).toBeLessThan(48);
  });

  it('treats the underside of a ball as ground when gravity points up', () => {
    const ball = { x: 16, y: 40, radius: 15 };
    const landed = ballTopSupport(ball, {
      centerX: 16,
      left: 8,
      right: 24,
      top: 50,
      bottom: 70,
      vx: 30,
      vy: -200,
      gravityX: 0,
      gravityY: -1,
    });
    expect(landed?.dy).toBeCloseTo(5);
    expect(landed?.dx).toBeCloseTo(0);
    expect(landed?.vy).toBeCloseTo(0);
    expect(landed?.vx).toBeCloseTo(30);
  });

  it('lets every rolling ball press a plate, including one that cannot be pushed', () => {
    expect(rollingBallActivatesPressurePlate(true)).toBe(true);
    expect(rollingBallActivatesPressurePlate(false)).toBe(true);
  });
});
