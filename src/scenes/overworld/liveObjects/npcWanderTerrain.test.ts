import { describe, expect, it, vi } from 'vitest';
import {
  encodeTileDataValue,
  getTerrainCollisionProfileForGid,
  getTilesetByKey,
  ROOM_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
} from '../../../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { terrainTileCollidesAtLocalPixel } from '../terrainCollision';
import { LiveObjectNpcController } from './npcController';

const { randomState } = vi.hoisted(() => ({ randomState: { seed: 1 } }));

vi.mock('phaser', () => {
  class Rectangle {
    left: number;
    top: number;
    width: number;
    height: number;

    constructor(x: number, y: number, width: number, height: number) {
      this.left = x;
      this.top = y;
      this.width = width;
      this.height = height;
    }

    get right(): number {
      return this.left + this.width;
    }

    get bottom(): number {
      return this.top + this.height;
    }
  }

  return {
    default: {
      Geom: { Rectangle },
      Math: {
        Between(min: number, max: number): number {
          randomState.seed = (randomState.seed * 16807) % 2147483647;
          const span = Math.max(1, max - min + 1);
          return min + (randomState.seed % span);
        },
      },
    },
  };
});

const SOLID_GID = getTilesetByKey('forest')!.firstGid + 14;
const FRAME_MS = 1000 / 60;
const FRAME_SECONDS = FRAME_MS / 1000;
const GRAVITY = 700;
const SIM_SECONDS = 120;
const BODY_HALF_WIDTH = 12;
const BODY_HEIGHT = 16;
const FLOOR_ROW = 15;
const LEFT_WALL_COLUMN = 12;
const RIGHT_WALL_COLUMN = 27;
const LEFT_FACE = (LEFT_WALL_COLUMN + 1) * TILE_SIZE;
const RIGHT_FACE = RIGHT_WALL_COLUMN * TILE_SIZE;
const FLOOR_TOP = FLOOR_ROW * TILE_SIZE;
const STEP_TOP = (FLOOR_ROW - 1) * TILE_SIZE;
const PIT_TOP = (FLOOR_ROW + 1) * TILE_SIZE;

interface SimSprite {
  x: number;
  y: number;
  active: boolean;
  depth: number;
  visible: boolean;
  body: SimBody | null;
  anims: { currentAnim: { key: string } | null };
  setPosition(x: number, y: number): void;
  play(key: string): void;
  setFlipX(flipped: boolean): void;
}

interface SimBody {
  sprite: SimSprite;
  velocity: { x: number; y: number };
  blocked: { left: boolean; right: boolean; up: boolean; down: boolean };
  touching: { left: boolean; right: boolean; up: boolean; down: boolean };
  allowGravity: boolean;
  dragX: number;
  maxVelocity: { x: number; y: number };
  pushable: boolean;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
  readonly center: { x: number; y: number };
  setVelocity(x: number, y: number): void;
  setVelocityX(x: number): void;
  setVelocityY(y: number): void;
  setAllowGravity(enabled: boolean): void;
  setImmovable(_immovable: boolean): void;
  setDragX(dragX: number): void;
  setMaxVelocity(x: number, y: number): void;
  reset(x: number, y: number): void;
}

function createSprite(x: number, y: number): SimSprite {
  const sprite: SimSprite = {
    x,
    y,
    active: true,
    depth: 0,
    visible: true,
    body: null,
    anims: { currentAnim: null },
    setPosition(nextX: number, nextY: number) {
      sprite.x = nextX;
      sprite.y = nextY;
    },
    play(key: string) {
      sprite.anims.currentAnim = { key };
    },
    setFlipX() {},
  };
  return sprite;
}

function createBody(sprite: SimSprite): SimBody {
  const body: SimBody = {
    sprite,
    velocity: { x: 0, y: 0 },
    blocked: { left: false, right: false, up: false, down: false },
    touching: { left: false, right: false, up: false, down: false },
    allowGravity: true,
    dragX: 550,
    maxVelocity: { x: 140, y: 500 },
    pushable: false,
    get left() {
      return sprite.x - BODY_HALF_WIDTH;
    },
    get right() {
      return sprite.x + BODY_HALF_WIDTH;
    },
    get top() {
      return sprite.y;
    },
    get bottom() {
      return sprite.y + BODY_HEIGHT;
    },
    get width() {
      return BODY_HALF_WIDTH * 2;
    },
    get height() {
      return BODY_HEIGHT;
    },
    get center() {
      return { x: sprite.x, y: sprite.y + BODY_HEIGHT / 2 };
    },
    setVelocity(x: number, y: number) {
      body.velocity.x = x;
      body.velocity.y = y;
    },
    setVelocityX(x: number) {
      body.velocity.x = x;
    },
    setVelocityY(y: number) {
      body.velocity.y = y;
    },
    setAllowGravity(enabled: boolean) {
      body.allowGravity = enabled;
    },
    setImmovable() {},
    setDragX(dragX: number) {
      body.dragX = dragX;
    },
    setMaxVelocity(x: number, y: number) {
      body.maxVelocity = { x, y };
    },
    reset(x: number, y: number) {
      sprite.x = x;
      sprite.y = y;
    },
  };
  sprite.body = body;
  return body;
}

function tileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

function paintSolid(room: RoomSnapshot, solids: Set<string>, tileX: number, tileY: number): void {
  room.tileData.terrain[tileY][tileX] = encodeTileDataValue(SOLID_GID);
  solids.add(tileKey(tileX, tileY));
}

function buildCourse(): { room: RoomSnapshot; solids: Set<string> } {
  const room = createDefaultRoomSnapshot('wander-course', { x: 0, y: 0 });
  const solids = new Set<string>();
  const raisedColumns = [15, 16, 23, 24];
  const pitColumns = [18, 19, 20, 21];

  for (let tileX = LEFT_WALL_COLUMN; tileX <= RIGHT_WALL_COLUMN; tileX += 1) {
    if (!pitColumns.includes(tileX)) {
      paintSolid(room, solids, tileX, FLOOR_ROW);
    }
  }
  for (const tileY of [FLOOR_ROW - 3, FLOOR_ROW - 2, FLOOR_ROW - 1]) {
    paintSolid(room, solids, LEFT_WALL_COLUMN, tileY);
    paintSolid(room, solids, RIGHT_WALL_COLUMN, tileY);
  }
  for (const tileX of raisedColumns) {
    paintSolid(room, solids, tileX, FLOOR_ROW - 1);
  }
  for (const tileX of pitColumns) {
    paintSolid(room, solids, tileX, FLOOR_ROW + 1);
  }

  return { room, solids };
}

function hasSolid(room: RoomSnapshot, worldX: number, worldY: number): boolean {
  const tileX = Math.floor(worldX / TILE_SIZE);
  const tileY = Math.floor(worldY / TILE_SIZE);
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
    return false;
  }
  const localPixelY = worldY - tileY * TILE_SIZE;
  return terrainTileCollidesAtLocalPixel(room, tileX, tileY, localPixelY);
}

function forEachOverlappingTile(
  body: SimBody,
  solids: Set<string>,
  visit: (tileX: number, tileY: number) => void,
): void {
  const x0 = Math.floor(body.left / TILE_SIZE);
  const x1 = Math.floor((body.right - 0.001) / TILE_SIZE);
  const y0 = Math.floor(body.top / TILE_SIZE);
  const y1 = Math.floor((body.bottom - 0.001) / TILE_SIZE);
  for (let tileY = y0; tileY <= y1; tileY += 1) {
    for (let tileX = x0; tileX <= x1; tileX += 1) {
      if (solids.has(tileKey(tileX, tileY))) {
        visit(tileX, tileY);
      }
    }
  }
}

function integrate(body: SimBody, solids: Set<string>): void {
  if (body.dragX > 0 && body.velocity.x !== 0) {
    const dragStep = body.dragX * FRAME_SECONDS;
    body.velocity.x = body.velocity.x > 0
      ? Math.max(0, body.velocity.x - dragStep)
      : Math.min(0, body.velocity.x + dragStep);
  }
  if (body.allowGravity) {
    body.velocity.y = Math.min(body.maxVelocity.y, body.velocity.y + GRAVITY * FRAME_SECONDS);
  }
  body.velocity.x = Math.max(-body.maxVelocity.x, Math.min(body.maxVelocity.x, body.velocity.x));
  body.velocity.y = Math.max(-body.maxVelocity.y, Math.min(body.maxVelocity.y, body.velocity.y));

  body.blocked.left = false;
  body.blocked.right = false;
  body.blocked.up = false;
  body.blocked.down = false;
  body.touching.left = false;
  body.touching.right = false;
  body.touching.up = false;
  body.touching.down = false;

  const dx = body.velocity.x * FRAME_SECONDS;
  body.sprite.x += dx;
  if (dx !== 0) {
    let correction = 0;
    forEachOverlappingTile(body, solids, (tileX, tileY) => {
      const tileLeft = tileX * TILE_SIZE;
      const tileRight = tileLeft + TILE_SIZE;
      const tileTop = tileY * TILE_SIZE;
      const tileBottom = tileTop + TILE_SIZE;
      if (body.bottom <= tileTop + 0.5 || body.top >= tileBottom - 0.5) {
        return;
      }
      if (dx > 0) {
        correction = Math.min(correction, -(body.right - tileLeft));
      } else {
        correction = Math.max(correction, tileRight - body.left);
      }
    });
    if (correction !== 0) {
      body.sprite.x += correction;
      if (dx > 0) {
        body.velocity.x = Math.min(0, body.velocity.x);
        body.blocked.right = true;
        body.touching.right = true;
      } else {
        body.velocity.x = Math.max(0, body.velocity.x);
        body.blocked.left = true;
        body.touching.left = true;
      }
    }
  }

  const previousTop = body.top;
  const previousBottom = body.bottom;
  const dy = body.velocity.y * FRAME_SECONDS;
  body.sprite.y += dy;
  if (dy > 0) {
    let landAt: number | null = null;
    forEachOverlappingTile(body, solids, (_tileX, tileY) => {
      const tileTop = tileY * TILE_SIZE;
      if (previousBottom <= tileTop + 0.75 && body.bottom > tileTop) {
        landAt = landAt === null ? tileTop : Math.min(landAt, tileTop);
      }
    });
    if (landAt !== null) {
      body.sprite.y -= body.bottom - landAt;
      body.velocity.y = 0;
      body.blocked.down = true;
      body.touching.down = true;
    }
  } else if (dy < 0) {
    let ceilingAt: number | null = null;
    forEachOverlappingTile(body, solids, (_tileX, tileY) => {
      const tileBottom = tileY * TILE_SIZE + TILE_SIZE;
      if (previousTop >= tileBottom - 0.75 && body.top < tileBottom) {
        ceilingAt = ceilingAt === null ? tileBottom : Math.max(ceilingAt, tileBottom);
      }
    });
    if (ceilingAt !== null) {
      body.sprite.y += ceilingAt - body.top;
      body.velocity.y = 0;
      body.blocked.up = true;
      body.touching.up = true;
    }
  }

  if (!body.blocked.down && body.velocity.y >= 0) {
    const tileY = Math.floor((body.bottom + 0.2) / TILE_SIZE);
    const tileTop = tileY * TILE_SIZE;
    if (body.bottom >= tileTop - 0.01 && body.bottom <= tileTop + 1.25) {
      const x0 = Math.floor(body.left / TILE_SIZE);
      const x1 = Math.floor((body.right - 0.001) / TILE_SIZE);
      for (let tileX = x0; tileX <= x1; tileX += 1) {
        if (!solids.has(tileKey(tileX, tileY))) {
          continue;
        }
        body.sprite.y -= body.bottom - tileTop;
        body.velocity.y = 0;
        body.blocked.down = true;
        body.touching.down = true;
        break;
      }
    }
  }
}

interface WanderRun {
  samples: number[];
  minLeft: number;
  maxRight: number;
  footLevels: Set<number>;
  failure: string | null;
}

function simulateWander(seed: number, startX: number, directionX: 1 | -1): WanderRun {
  randomState.seed = seed;
  const { room, solids } = buildCourse();
  const sprite = createSprite(startX, FLOOR_TOP - BODY_HEIGHT);
  const body = createBody(sprite);
  let now = 0;
  const liveObject = {
    layer: 'terrain',
    config: { category: 'npc', id: 'jimothy', facingDirection: 'right' },
    sprite,
    runtime: {
      npcMode: 'wander',
      directionX,
      npcCanJumpFall: true,
      npcWalking: false,
      nextActionAt: 0,
      npcPushable: false,
      npcFriendlyFire: false,
      npcVictorious: false,
      npcBounceCooldownUntil: 0,
      npcQuicksandUntil: 0,
      specialTileOnIce: false,
      specialTileOnSticky: false,
      specialTileWindX: 0,
      previousX: sprite.x,
      previousY: sprite.y,
    },
  };
  const loadedRoom = { room, liveObjects: [] as never[] };
  const controller = new LiveObjectNpcController({
    scene: { anims: { exists: () => false }, cameras: { main: { zoom: 1 } } },
    getCurrentTime: () => now,
    getPlayerBody: () => null,
    resetDynamicObjectIfOutOfBounds: () => false,
    getRoomWorldBounds: () => ({ left: 0, right: ROOM_PX_WIDTH, top: 0, bottom: FLOOR_TOP + TILE_SIZE * 4 }),
    applyDirectionalFacing: () => {},
    hasSolidTerrainAtWorldPoint: (candidate: RoomSnapshot, worldX: number, worldY: number) => (
      hasSolid(candidate, worldX, worldY)
    ),
    playBounceFx: () => {},
    bouncePadVelocity: -320,
    bouncePadCooldownMs: 180,
  } as never);

  const samples: number[] = [];
  const recentX: number[] = [];
  const footLevels = new Set<number>();
  let minLeft = body.left;
  let maxRight = body.right;
  const frameCount = SIM_SECONDS * 60;

  for (let frame = 0; frame < frameCount; frame += 1) {
    integrate(body, solids);
    controller.updateNpc([loadedRoom] as never, loadedRoom as never, liveObject as never, FRAME_MS);

    const nearRightWall = body.right >= RIGHT_FACE - 4 && body.velocity.y < -50;
    const nearLeftWall = body.left <= LEFT_FACE + 4 && body.velocity.y < -50;
    if (nearRightWall || nearLeftWall) {
      return {
        samples,
        minLeft,
        maxRight,
        footLevels,
        failure: `jumped at a ${nearLeftWall ? 'left' : 'right'} end wall at x=${sprite.x.toFixed(1)}`,
      };
    }

    minLeft = Math.min(minLeft, body.left);
    maxRight = Math.max(maxRight, body.right);
    if (body.blocked.down) {
      footLevels.add(Math.round(body.bottom));
    }
    samples.push(sprite.x);
    recentX.push(sprite.x);
    if (recentX.length > 40 * 60) {
      recentX.shift();
    }
    if (recentX.length === 40 * 60) {
      let low = recentX[0];
      let high = recentX[0];
      for (const x of recentX) {
        low = Math.min(low, x);
        high = Math.max(high, x);
      }
      if (high - low < 8) {
        return {
          samples,
          minLeft,
          maxRight,
          footLevels,
          failure: `stuck near x=${sprite.x.toFixed(1)} at ${now.toFixed(0)}ms (40s range ${ (high - low).toFixed(1) }px)`,
        };
      }
    }

    now += FRAME_MS;
  }

  return { samples, minLeft, maxRight, footLevels, failure: null };
}

describe('Jimothy wander terrain', () => {
  it('builds a collision-layer course with tall end walls and one-tile changes', () => {
    const profile = getTerrainCollisionProfileForGid(SOLID_GID);
    expect(profile.hasCollision).toBe(true);
    expect(profile.topInset).toBe(0);

    const { room, solids } = buildCourse();
    expect(hasSolid(room, LEFT_FACE - 4, FLOOR_TOP - 8)).toBe(true);
    expect(hasSolid(room, LEFT_FACE - 4, FLOOR_TOP - 24)).toBe(true);
    expect(hasSolid(room, LEFT_FACE - 4, FLOOR_TOP - 40)).toBe(true);
    expect(hasSolid(room, LEFT_FACE + 8, FLOOR_TOP - 8)).toBe(false);
    expect(hasSolid(room, 15 * TILE_SIZE + 8, STEP_TOP + 8)).toBe(true);
    expect(hasSolid(room, 19 * TILE_SIZE + 8, FLOOR_TOP + 8)).toBe(false);
    expect(hasSolid(room, 19 * TILE_SIZE + 8, PIT_TOP + 8)).toBe(true);
    expect(solids.size).toBeGreaterThan(20);
  });

  it('crosses from either tall wall to the other without getting stuck', () => {
    const leftStart = 14 * TILE_SIZE + TILE_SIZE / 2;
    const rightStart = ROOM_PX_WIDTH - leftStart;
    const placements = [
      { startX: leftStart, directionX: 1 as const, mirrorX: rightStart, mirrorDirection: -1 as const },
      { startX: leftStart, directionX: -1 as const, mirrorX: rightStart, mirrorDirection: 1 as const },
    ];

    for (const seed of [1, 7]) {
      for (const placement of placements) {
        const leftRun = simulateWander(seed, placement.startX, placement.directionX);
        const rightRun = simulateWander(seed, placement.mirrorX, placement.mirrorDirection);
        const label = `seed ${seed}, facing ${placement.directionX > 0 ? 'right' : 'left'} from the left`;

        expect(leftRun.failure, label).toBeNull();
        expect(rightRun.failure, `${label} mirror`).toBeNull();
        expect(leftRun.minLeft, label).toBeLessThanOrEqual(LEFT_FACE + 8);
        expect(leftRun.maxRight, label).toBeGreaterThanOrEqual(RIGHT_FACE - 8);
        expect(rightRun.minLeft, `${label} mirror`).toBeLessThanOrEqual(LEFT_FACE + 8);
        expect(rightRun.maxRight, `${label} mirror`).toBeGreaterThanOrEqual(RIGHT_FACE - 8);
        expect(leftRun.footLevels.has(FLOOR_TOP), label).toBe(true);
        expect(leftRun.footLevels.has(STEP_TOP), label).toBe(true);
        expect(leftRun.footLevels.has(PIT_TOP), label).toBe(true);
        expect(rightRun.footLevels.has(STEP_TOP), `${label} mirror`).toBe(true);
        expect(rightRun.footLevels.has(PIT_TOP), `${label} mirror`).toBe(true);
      }
    }
  });
});
