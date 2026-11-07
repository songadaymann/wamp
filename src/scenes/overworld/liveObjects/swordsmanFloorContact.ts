import type Phaser from 'phaser';
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
} from '../../../config';
import {
  isFloorTriangle,
  normalizePlacedTriangle,
  triangleFloorHighTip,
  triangleFloorSurfaceYAt,
  triangleSupportsFeetAt,
} from '../../../config/trianglePiece';
import { SWORDSMAN_STANDING_BODY_HEIGHT } from '../../../enemies/swordsmanTuning';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { terrainTileCollidesAtLocalPixel } from '../terrainCollision';
import { isDynamicArcadeBody, type ArcadeObjectBody } from './bodies';
import type { LoadedRoomObject } from './model';

type RoomOrigin = { x: number; y: number };

/** True when another floor triangle's hyp continues past the tip we're facing. */
export function hasSwordsmanTriangleCrestContinuation(
  room: RoomSnapshot,
  body: ArcadeObjectBody,
  directionX: -1 | 1,
  origin: RoomOrigin,
): boolean {
  const localBottom = body.bottom - origin.y;
  const localCenterX = body.center.x - origin.x;
  let nearTip: { x: number; y: number } | null = null;

  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry || !isFloorTriangle(geometry.legY) || geometry.legX === 0) {
      continue;
    }
    const tip = triangleFloorHighTip(
      geometry.anchorX,
      geometry.anchorY,
      geometry.legX,
      geometry.legY,
    );
    if (!tip) {
      continue;
    }
    if (Math.abs(localBottom - tip.y) > 8) {
      continue;
    }
    if (Math.abs(localCenterX - tip.x) > body.halfWidth + 12) {
      continue;
    }
    nearTip = tip;
    break;
  }

  if (!nearTip) {
    return false;
  }

  const probeX = nearTip.x + directionX * 6;
  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry || !isFloorTriangle(geometry.legY) || geometry.legX === 0) {
      continue;
    }
    const tip = triangleFloorHighTip(
      geometry.anchorX,
      geometry.anchorY,
      geometry.legX,
      geometry.legY,
    );
    if (!tip) {
      continue;
    }
    if (Math.abs(tip.x - nearTip.x) > 6 || Math.abs(tip.y - nearTip.y) > 6) {
      continue;
    }
    const hypY = triangleFloorSurfaceYAt(
      geometry.anchorX,
      geometry.anchorY,
      geometry.legX,
      geometry.legY,
      probeX,
    );
    if (hypY != null && Math.abs(hypY - nearTip.y) <= 10) {
      return true;
    }
  }

  return false;
}

/**
 * Decide whether a grounded tip-clear jump should fire. Returns the clear
 * direction, or null when the jump should not start.
 */
export function evaluateSwordsmanTriangleTipJumpClearDirection(
  room: RoomSnapshot,
  body: ArcadeObjectBody,
  directionX: number,
  origin: RoomOrigin,
  now: number,
  cooldownUntil: number,
): -1 | 1 | null {
  if (now < cooldownUntil) {
    return null;
  }
  if (!hasTriangleFloorSupport(room, body, origin)) {
    return null;
  }

  const tipWall = getTriangleVerticalContactSide(room, body, origin);
  if (tipWall === 0) {
    return null;
  }
  const intoWall =
    (tipWall === -1 && directionX < 0) ||
    (tipWall === 1 && directionX > 0);
  if (!intoWall) {
    return null;
  }

  const clearDirectionX = (directionX >= 0 ? 1 : -1) as -1 | 1;
  // Mountain peaks: the paired hyp continues past the tip — walk over, don't jump.
  if (hasSwordsmanTriangleCrestContinuation(room, body, clearDirectionX, origin)) {
    return null;
  }
  return clearDirectionX;
}

export function swordsmanStandingBlockedAhead(
  room: RoomSnapshot,
  liveObject: LoadedRoomObject,
  body: Phaser.Physics.Arcade.Body,
  origin: RoomOrigin,
): boolean {
  const directionX = liveObject.runtime.directionX >= 0 ? 1 : -1;
  const probeX = body.center.x + directionX * (body.halfWidth + 4);
  return !swordsmanStandingHitboxFitsAt(room, liveObject, body, probeX, origin);
}

function swordsmanStandingHitboxFitsAt(
  room: RoomSnapshot,
  liveObject: LoadedRoomObject,
  body: Phaser.Physics.Arcade.Body,
  centerX: number,
  origin: RoomOrigin,
): boolean {
  const height = SWORDSMAN_STANDING_BODY_HEIGHT;
  const halfWidth = Math.max(2, (liveObject.config.bodyWidth || body.width) * 0.5);
  const top = body.bottom - height;
  const midY = body.bottom - height * 0.5;
  for (const sampleX of [centerX, centerX - halfWidth + 1, centerX + halfWidth - 1]) {
    if (
      hasSolidTerrainAtWorldPoint(room, sampleX, top + 1, origin)
      || hasSolidTerrainAtWorldPoint(room, sampleX, midY, origin)
    ) {
      return false;
    }
  }
  return true;
}

/** Arcade blocked.down misses triangle floors (zero-size bodies), so check hyps too. */
export function isSwordsmanOnFloor(
  room: RoomSnapshot,
  body: ArcadeObjectBody,
  origin: RoomOrigin,
): boolean {
  if (!isDynamicArcadeBody(body)) {
    return false;
  }
  if (body.blocked.down || body.touching.down) {
    return true;
  }
  // Rising jumps must not keep "floor" from a nearby hyp — that blocked wall-jumps
  // and tip-clear arcs at the crest.
  if (body.velocity.y < -40) {
    return false;
  }
  return hasTriangleFloorSupport(room, body, origin);
}

export function hasTriangleFloorSupport(
  room: RoomSnapshot,
  body: ArcadeObjectBody,
  origin: RoomOrigin,
): boolean {
  const feetY = body.bottom;
  for (const feetX of [body.center.x, body.left + 1, body.right - 1]) {
    for (const placed of room.placedObjects) {
      const geometry = normalizePlacedTriangle(placed);
      if (!geometry) {
        continue;
      }
      const anchorX = origin.x + geometry.anchorX;
      const anchorY = origin.y + geometry.anchorY;
      if (
        triangleSupportsFeetAt(
          anchorX,
          anchorY,
          geometry.legX,
          geometry.legY,
          feetX,
          feetY,
        )
      ) {
        return true;
      }
      const surfaceY = triangleFloorSurfaceYAt(
        anchorX,
        anchorY,
        geometry.legX,
        geometry.legY,
        feetX,
      );
      if (surfaceY != null && feetY >= surfaceY - 4 && feetY <= surfaceY + 8) {
        return true;
      }
    }
  }
  return false;
}

function hasTriangleFloorNearWorldPoint(
  room: RoomSnapshot,
  worldX: number,
  feetY: number,
  maxRise: number,
  maxDrop: number,
  origin: RoomOrigin,
): boolean {
  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry) {
      continue;
    }
    const surfaceY = triangleFloorSurfaceYAt(
      origin.x + geometry.anchorX,
      origin.y + geometry.anchorY,
      geometry.legX,
      geometry.legY,
      worldX,
    );
    if (surfaceY == null) {
      continue;
    }
    if (surfaceY >= feetY - maxRise && surfaceY <= feetY + maxDrop) {
      return true;
    }
  }
  return false;
}

export function getSwordsmanWallContactSide(
  room: RoomSnapshot,
  body: ArcadeObjectBody,
  origin: RoomOrigin,
): -1 | 0 | 1 {
  if (!isDynamicArcadeBody(body)) {
    return 0;
  }
  if (body.blocked.left || body.touching.left) {
    return -1;
  }
  if (body.blocked.right || body.touching.right) {
    return 1;
  }
  // Grounded: ignore triangle verticals so he can walk the hyp and dismount.
  // Airborne: keep contact so wall-jumps still work on those faces.
  if (isSwordsmanOnFloor(room, body, origin)) {
    return 0;
  }
  return getTriangleVerticalContactSide(room, body, origin);
}

/**
 * Vertical triangle legs do not set Arcade blocked.left/right. Detect contact
 * from either side (hyp approach or open-air face) so tip-clear jumps and
 * wall-jumps both work.
 */
function getTriangleVerticalContactSide(
  room: RoomSnapshot,
  body: ArcadeObjectBody,
  origin: RoomOrigin,
): -1 | 0 | 1 {
  let bestSide: -1 | 0 | 1 = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry || geometry.legX === 0) {
      continue;
    }

    const wallX = origin.x + geometry.anchorX;
    const wallTop = origin.y + Math.min(geometry.anchorY, geometry.anchorY + geometry.legY);
    const wallBottom = origin.y + Math.max(geometry.anchorY, geometry.anchorY + geometry.legY);
    if (wallBottom - wallTop < 8) {
      continue;
    }
    if (body.bottom <= wallTop + 2 || body.top >= wallBottom - 2) {
      continue;
    }

    const fromRightDist = Math.abs(body.left - wallX);
    const fromLeftDist = Math.abs(body.right - wallX);
    // Body on the right of the face → left side touching → contactSide -1.
    if (fromRightDist <= 5 && body.center.x >= wallX - 2 && fromRightDist < bestDist) {
      bestDist = fromRightDist;
      bestSide = -1;
    }
    // Body on the left of the face → right side touching → contactSide 1.
    if (fromLeftDist <= 5 && body.center.x <= wallX + 2 && fromLeftDist < bestDist) {
      bestDist = fromLeftDist;
      bestSide = 1;
    }
  }

  return bestSide;
}

function hasTriangleFloorSupportAtWorldPoint(
  room: RoomSnapshot,
  worldX: number,
  worldY: number,
  origin: RoomOrigin,
): boolean {
  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry) {
      continue;
    }
    if (
      triangleSupportsFeetAt(
        origin.x + geometry.anchorX,
        origin.y + geometry.anchorY,
        geometry.legX,
        geometry.legY,
        worldX,
        worldY,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function hasSolidSupportAhead(
  room: RoomSnapshot,
  body: Phaser.Physics.Arcade.Body,
  directionX: number,
  leadPx: number,
  origin: RoomOrigin,
  hasSolidRuntimeAt: (x: number, y: number) => boolean,
): boolean {
  const probeX = body.center.x + directionX * (body.halfWidth + leadPx);
  const probeY = body.bottom + 2;
  if (
    hasSolidTerrainAtWorldPoint(room, probeX, probeY, origin) ||
    hasSolidRuntimeAt(probeX, probeY)
  ) {
    return true;
  }
  // Triangle floors are not tile solids — keep walking onto / along ramps.
  return (
    hasTriangleFloorSupportAtWorldPoint(room, probeX, body.bottom, origin) ||
    hasTriangleFloorNearWorldPoint(room, probeX, body.bottom, 4, TILE_SIZE + 2, origin)
  );
}

export function hasSolidTerrainAtWorldPoint(
  room: RoomSnapshot,
  worldX: number,
  worldY: number,
  origin: RoomOrigin,
): boolean {
  const localX = Math.floor((worldX - origin.x) / TILE_SIZE);
  const localY = Math.floor((worldY - origin.y) / TILE_SIZE);

  if (localX < 0 || localX >= ROOM_WIDTH || localY < 0 || localY >= ROOM_HEIGHT) {
    return false;
  }

  const localPixelY = worldY - origin.y - localY * TILE_SIZE;
  return terrainTileCollidesAtLocalPixel(room, localX, localY, localPixelY);
}
