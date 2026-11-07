import Phaser from 'phaser';
import {
  decodeTileDataValue,
  getSpecialTileKindForGid,
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  type SpecialTileKind,
} from '../../../config';
import {
  isFloorTriangle,
  normalizePlacedTriangle,
  pointInTriangle,
  separationFromTriangle,
  triangleDownhillSignX,
  triangleFloorSurfaceYAt,
  triangleHypotenuseYAt,
  triangleSupportsFeetAt,
  triangleVertices,
} from '../../../config/trianglePiece';
import type { RoomCoordinates, RoomSnapshot } from '../../../persistence/roomModel';
import { terrainTileCollidesAtLocalPixel } from '../terrainCollision';
import {
  getGravityRightVector,
  getGravityVector,
  type PlayerGravityDirection,
} from '../specialTiles';
import { isDynamicArcadeBody, type ArcadeObjectBody } from './bodies';
import type { LoadedRoomObject } from './model';

export type GetRoomOrigin = (coordinates: RoomCoordinates) => { x: number; y: number };

const GROUND_ENEMY_EDGE_SAFE_SPECIAL_TILE_KINDS = new Set<SpecialTileKind>([
  'conveyorLeft',
  'conveyorRight',
  'ice',
  'sticky',
  'bounce',
  'gravityUp',
  'gravityDown',
  'gravityLeft',
  'gravityRight',
  'water',
]);

/**
 * When a ground enemy rides a floor triangle into a tile platform, lift onto
 * the landing before the feet leave the hypotenuse (and before a tile face
 * reads as a wall). Keeps horizontal speed so the climb does not hitch.
 */
export function tryStepOntoTriangleLanding(
  room: RoomSnapshot,
  liveObject: LoadedRoomObject,
  body: Phaser.Physics.Arcade.Body,
  touchingWall: boolean,
  getRoomOrigin: GetRoomOrigin,
): boolean {
  const directionX = liveObject.runtime.directionX < 0 ? -1 : 1;
  const leadFootX = directionX > 0 ? body.right - 1 : body.left + 1;
  const onTriangle =
    hasTriangleFloorSupportAtWorldPoint(room, body.center.x, body.bottom, getRoomOrigin)
    || hasTriangleFloorSupportAtWorldPoint(room, leadFootX, body.bottom, getRoomOrigin)
    || hasTriangleFloorNearWorldPoint(
      room,
      body.center.x,
      body.bottom,
      4,
      TILE_SIZE,
      getRoomOrigin,
    );
  if (!onTriangle && !touchingWall) {
    return false;
  }

  const probeXs = [
    directionX > 0 ? body.right + 1 : body.left - 1,
    directionX > 0 ? body.right + 4 : body.left - 4,
    leadFootX,
  ];
  let landingTop: number | null = null;
  for (const probeX of probeXs) {
    // Slack below the feet catches a one-frame dip off the tip.
    const top = findSolidTerrainTopNear(room, probeX, body.bottom + 6, TILE_SIZE + 4, getRoomOrigin);
    if (top == null) continue;
    if (landingTop == null || top > landingTop) landingTop = top;
  }
  if (landingTop == null) return false;
  const rise = body.bottom - landingTop;
  if (rise <= 0.05 || rise > TILE_SIZE + 2) return false;
  // Proactive tip seats only when already near the landing. A full-tile lift
  // mid-ramp looks like a forward jump.
  if (!touchingWall && rise > 6) return false;

  const keepVx = body.velocity.x;
  // Vertical seat only — any large X teleport reads as a forward hop.
  const nextX = liveObject.sprite.x + directionX;
  const nextY = liveObject.sprite.y - rise;
  liveObject.sprite.setPosition(nextX, nextY);
  body.reset(nextX, nextY);
  body.setVelocity(keepVx, 0);
  return true;
}

function findSolidTerrainTopNear(
  room: RoomSnapshot,
  worldX: number,
  feetY: number,
  maxRise: number,
  getRoomOrigin: GetRoomOrigin,
): number | null {
  const origin = getRoomOrigin(room.coordinates);
  const localX = Math.floor((worldX - origin.x) / TILE_SIZE);
  if (localX < 0 || localX >= ROOM_WIDTH) return null;
  let bestTop: number | null = null;
  const minLocalY = Math.floor((feetY - maxRise - origin.y) / TILE_SIZE);
  const maxLocalY = Math.floor((feetY - origin.y) / TILE_SIZE);
  for (let localY = minLocalY; localY <= maxLocalY; localY += 1) {
    if (localY < 0 || localY >= ROOM_HEIGHT) continue;
    // Probe mid-tile so top-inset profiles still count as a landing.
    if (!terrainTileCollidesAtLocalPixel(room, localX, localY, TILE_SIZE * 0.5)) continue;
    const top = origin.y + localY * TILE_SIZE;
    if (top >= feetY) continue;
    if (feetY - top > maxRise) continue;
    // Closest landing under the feet (largest top in y-down space).
    if (bestTop == null || top > bestTop) bestTop = top;
  }
  return bestTop;
}

export function hasTriangleFloorSupportAtWorldPoint(
  room: RoomSnapshot,
  worldX: number,
  worldY: number,
  getRoomOrigin: GetRoomOrigin,
): boolean {
  const origin = getRoomOrigin(room.coordinates);
  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry) continue;
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

/**
 * True when a floor triangle's hypotenuse is under worldX and within
 * [feetY - maxRise, feetY + maxDrop]. Used for edge probes onto descending
 * ramps and for landing transfers that slightly overshoot the tip.
 */
export function hasTriangleFloorNearWorldPoint(
  room: RoomSnapshot,
  worldX: number,
  feetY: number,
  maxRise: number,
  maxDrop: number,
  getRoomOrigin: GetRoomOrigin,
): boolean {
  const origin = getRoomOrigin(room.coordinates);
  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry) continue;
    const surfaceY = triangleFloorSurfaceYAt(
      origin.x + geometry.anchorX,
      origin.y + geometry.anchorY,
      geometry.legX,
      geometry.legY,
      worldX,
    );
    if (surfaceY == null) continue;
    if (surfaceY >= feetY - maxRise && surfaceY <= feetY + maxDrop) {
      return true;
    }
  }
  return false;
}

/**
 * Flyer/swim vs triangles:
 * - Vertical legs are walls (reverse + eject).
 * - Floor hyps only push UP (climb). Never follow a floor slope downhill.
 * - Ceiling hyps only push DOWN. Never follow a ceiling slope upward.
 */
export function flyingEnemyResolveTriangles(
  room: RoomSnapshot,
  liveObject: LoadedRoomObject,
  body: ArcadeObjectBody,
  proposedSpriteY: number,
  getRoomOrigin: GetRoomOrigin,
): { rideY: number | null; hitVerticalWall: boolean; pushX: number } {
  if (!isDynamicArcadeBody(body)) {
    return { rideY: null, hitVerticalWall: false, pushX: 0 };
  }
  const origin = getRoomOrigin(room.coordinates);
  const bottomOffset = body.bottom - liveObject.sprite.y;
  const topOffset = body.top - liveObject.sprite.y;
  const probeBottom = Math.max(proposedSpriteY + bottomOffset, body.bottom);
  const probeTop = Math.min(proposedSpriteY + topOffset, body.top);
  const dirX = liveObject.runtime.directionX >= 0 ? 1 : -1;
  // Near-hyp contact only — deep mid-solid must not teleport up to a high tip.
  const maxFloorClimbDepth = body.height + 6;
  const maxCeilingPushDepth = body.height + 6;
  const floorClearance = 2;
  const probeXs = [
    body.center.x,
    body.center.x + dirX * body.halfWidth,
    body.center.x + dirX * (body.halfWidth + 2),
  ];
  const samplePoints = [
    { x: body.center.x, y: body.center.y },
    { x: body.left + 1, y: body.center.y },
    { x: body.right - 1, y: body.center.y },
    { x: body.center.x, y: body.bottom - 1 },
    { x: body.center.x, y: body.top + 1 },
    { x: body.left + 1, y: body.bottom - 1 },
    { x: body.right - 1, y: body.bottom - 1 },
  ];

  let bestFloorLiftY: number | null = null;
  let bestCeilingPushY: number | null = null;
  let hitVerticalWall = false;
  let pushX = 0;

  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry || geometry.legX === 0) continue;
    const anchorX = origin.x + geometry.anchorX;
    const anchorY = origin.y + geometry.anchorY;
    const verts = triangleVertices(anchorX, anchorY, geometry.legX, geometry.legY);
    const floor = isFloorTriangle(geometry.legY);
    const spanMin = Math.min(anchorX, anchorX + geometry.legX);
    const spanMax = Math.max(anchorX, anchorX + geometry.legX);
    const clampedX = Phaser.Math.Clamp(body.center.x, spanMin, spanMax);

    let bestSep: { dx: number; dy: number } | null = null;
    let bestSepLen = Number.POSITIVE_INFINITY;
    for (const point of samplePoints) {
      const separation = separationFromTriangle(
        anchorX,
        anchorY,
        geometry.legX,
        geometry.legY,
        point.x,
        point.y,
      );
      if (!separation) continue;
      const length = Math.hypot(separation.dx, separation.dy);
      if (length < bestSepLen) {
        bestSep = separation;
        bestSepLen = length;
      }
    }

    const inside =
      pointInTriangle(
        { x: body.center.x, y: body.center.y },
        verts.rightAngle,
        verts.horizontal,
        verts.vertical,
      ) ||
      pointInTriangle(
        { x: body.center.x, y: probeBottom - 1 },
        verts.rightAngle,
        verts.horizontal,
        verts.vertical,
      ) ||
      pointInTriangle(
        { x: body.center.x, y: probeTop + 1 },
        verts.rightAngle,
        verts.horizontal,
        verts.vertical,
      );

    // Vertical leg wall (outward nx). Check lead face before hyp separation so
    // wide bodies (shark) at the tip corner don't lift instead of reversing.
    const vertOutNx = geometry.legX < 0 ? 1 : -1;
    const vertY0 = Math.min(anchorY, anchorY + geometry.legY);
    const vertY1 = Math.max(anchorY, anchorY + geometry.legY);
    const leadX = dirX > 0 ? body.right - 1 : body.left + 1;
    const leadHitsVertical =
      dirX * vertOutNx < 0
      && Math.abs(leadX - anchorX) <= 4
      && body.bottom > vertY0 + 1
      && body.top < vertY1 - 1
      && (body.center.x - anchorX) * vertOutNx >= -2;
    if (leadHitsVertical) {
      hitVerticalWall = true;
      const eject = vertOutNx * (Math.abs(leadX - anchorX) + 1);
      if (Math.abs(eject) > Math.abs(pushX)) pushX = eject;
      continue;
    }

    // Vertical leg only (ny ≈ 0). Steep hyps also have large |dx| — do not
    // treat those as walls or climbing ramps would flip mid-slope.
    if (
      bestSep &&
      Math.abs(bestSep.dy) < 0.35 &&
      Math.abs(bestSep.dx) > 0.5 &&
      bestSep.dx * dirX < 0
    ) {
      hitVerticalWall = true;
      if (Math.abs(bestSep.dx) > Math.abs(pushX)) {
        pushX = bestSep.dx;
      }
      continue;
    }

    // Floor climb only while moving uphill — downhill / side clips must not
    // eject the flyer up onto a high tip (shark jump near shallow crests).
    const floorUphill =
      floor && dirX * -triangleDownhillSignX(geometry.legX, geometry.legY) > 0;

    let deepestSurface: number | null = null;
    for (const probeX of probeXs) {
      const surface = triangleHypotenuseYAt(
        anchorX,
        anchorY,
        geometry.legX,
        geometry.legY,
        probeX,
      );
      if (surface == null) continue;
      if (floor) {
        if (!floorUphill) continue;
        // At/into the solid near the hyp only — not deep mid-volume ejects.
        const depth = probeBottom - surface;
        if (depth > -1 && depth < maxFloorClimbDepth) {
          deepestSurface =
            deepestSurface == null ? surface : Math.min(deepestSurface, surface);
        }
      } else {
        // At/into the ceiling solid near the hyp only.
        const depth = surface - probeTop;
        if (depth > -1 && depth < maxCeilingPushDepth) {
          deepestSurface =
            deepestSurface == null ? surface : Math.max(deepestSurface, surface);
        }
      }
    }

    if ((inside || bestSep) && (floor ? floorUphill : true)) {
      const hypAtBody =
        triangleHypotenuseYAt(anchorX, anchorY, geometry.legX, geometry.legY, body.center.x) ??
        triangleHypotenuseYAt(anchorX, anchorY, geometry.legX, geometry.legY, clampedX);
      if (hypAtBody != null) {
        const depth = floor
          ? probeBottom - hypAtBody
          : hypAtBody - probeTop;
        const maxDepth = floor ? maxFloorClimbDepth : maxCeilingPushDepth;
        if (depth > -1 && depth < maxDepth) {
          deepestSurface =
            deepestSurface == null
              ? hypAtBody
              : floor
                ? Math.min(deepestSurface, hypAtBody)
                : Math.max(deepestSurface, hypAtBody);
        }
      }
    }

    if (deepestSurface == null) continue;

    if (floor) {
      const spriteY = deepestSurface - bottomOffset - floorClearance;
      // Up hill only — never pull cruise altitude down a descending hyp.
      if (spriteY > proposedSpriteY + 0.5 && spriteY > liveObject.sprite.y + 0.5) {
        continue;
      }
      // Cap sudden lifts so a side-clip can't jump a full tile to the crest.
      if (liveObject.sprite.y - spriteY > TILE_SIZE) {
        continue;
      }
      bestFloorLiftY =
        bestFloorLiftY == null ? spriteY : Math.min(bestFloorLiftY, spriteY);
    } else {
      const spriteY = deepestSurface - topOffset + floorClearance;
      // Down ceiling only — never pull cruise altitude up a rising ceiling.
      if (spriteY < proposedSpriteY - 0.5 && spriteY < liveObject.sprite.y - 0.5) {
        continue;
      }
      if (spriteY - liveObject.sprite.y > TILE_SIZE) {
        continue;
      }
      bestCeilingPushY =
        bestCeilingPushY == null ? spriteY : Math.max(bestCeilingPushY, spriteY);
    }
  }

  const rideY = bestFloorLiftY ?? bestCeilingPushY ?? null;
  return { rideY, hitVerticalWall, pushX };
}

export function hasGroundEnemySupportOrSpecialTileAhead(
  room: RoomSnapshot,
  body: Phaser.Physics.Arcade.Body,
  directionX: number,
  gravityDirection: PlayerGravityDirection,
  getRoomOrigin: GetRoomOrigin,
  leadPx = 4,
): boolean {
  const probe = getGroundEnemySupportProbePoint(body, directionX, gravityDirection, leadPx);
  if (
    hasSolidTerrainAtWorldPoint(room, probe.x, probe.y, getRoomOrigin) ||
    hasEdgeSafeSpecialTileAtWorldPoint(room, probe.x, probe.y, getRoomOrigin)
  ) {
    return true;
  }
  // Triangle floors are not tile solids. A ramp against a platform edge often
  // sits below the current feet, so accept a surface within one tile drop.
  const rightVector = getGravityRightVector(gravityDirection);
  const gravityVector = getGravityVector(gravityDirection);
  const tangentHalfExtent = rightVector.x !== 0 ? body.halfWidth : body.halfHeight;
  const feetX =
    body.center.x + rightVector.x * directionX * (tangentHalfExtent + leadPx);
  const feetY =
    body.center.y
    + rightVector.y * directionX * (tangentHalfExtent + leadPx)
    + gravityVector.y * body.halfHeight
    + gravityVector.x * body.halfWidth;
  if (
    hasTriangleFloorSupportAtWorldPoint(room, feetX, feetY, getRoomOrigin)
    || (
      gravityDirection === 'down'
      && hasTriangleFloorNearWorldPoint(room, feetX, feetY, 4, TILE_SIZE + 2, getRoomOrigin)
    )
  ) {
    return true;
  }
  // Descending a ramp onto a lower tile: the ahead probe sits above the
  // landing, so look down a tile for a solid top.
  if (gravityDirection === 'down') {
    return findSolidTerrainTopNear(room, feetX, feetY + TILE_SIZE + 2, TILE_SIZE + 2, getRoomOrigin) != null;
  }
  return false;
}

function getGroundEnemySupportProbePoint(
  body: Phaser.Physics.Arcade.Body,
  directionX: number,
  gravityDirection: PlayerGravityDirection,
  leadPx: number,
): { x: number; y: number } {
  const gravityVector = getGravityVector(gravityDirection);
  const rightVector = getGravityRightVector(gravityDirection);
  const tangentHalfExtent = rightVector.x !== 0 ? body.halfWidth : body.halfHeight;
  const gravityHalfExtent = gravityVector.x !== 0 ? body.halfWidth : body.halfHeight;
  return {
    x:
      body.center.x +
      rightVector.x * directionX * (tangentHalfExtent + leadPx) +
      gravityVector.x * (gravityHalfExtent + 2),
    y:
      body.center.y +
      rightVector.y * directionX * (tangentHalfExtent + leadPx) +
      gravityVector.y * (gravityHalfExtent + 2),
  };
}

export function hasSolidTerrainAtWorldPoint(
  room: RoomSnapshot,
  worldX: number,
  worldY: number,
  getRoomOrigin: GetRoomOrigin,
): boolean {
  const roomOrigin = getRoomOrigin(room.coordinates);
  const localX = Math.floor((worldX - roomOrigin.x) / TILE_SIZE);
  const localY = Math.floor((worldY - roomOrigin.y) / TILE_SIZE);

  if (localX < 0 || localX >= ROOM_WIDTH || localY < 0 || localY >= ROOM_HEIGHT) {
    return false;
  }

  const localPixelY = worldY - roomOrigin.y - localY * TILE_SIZE;
  return terrainTileCollidesAtLocalPixel(room, localX, localY, localPixelY);
}

function hasEdgeSafeSpecialTileAtWorldPoint(
  room: RoomSnapshot,
  worldX: number,
  worldY: number,
  getRoomOrigin: GetRoomOrigin,
): boolean {
  const roomOrigin = getRoomOrigin(room.coordinates);
  const localX = Math.floor((worldX - roomOrigin.x) / TILE_SIZE);
  const localY = Math.floor((worldY - roomOrigin.y) / TILE_SIZE);

  if (localX < 0 || localX >= ROOM_WIDTH || localY < 0 || localY >= ROOM_HEIGHT) {
    return false;
  }

  for (const layerName of LAYER_NAMES) {
    const gid = decodeTileDataValue(room.tileData[layerName][localY][localX]).gid;
    const specialKind = getSpecialTileKindForGid(gid);
    if (specialKind && GROUND_ENEMY_EDGE_SAFE_SPECIAL_TILE_KINDS.has(specialKind)) {
      return true;
    }
  }

  return false;
}
