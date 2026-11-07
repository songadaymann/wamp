import Phaser from 'phaser';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { getArcadeBodyBounds, type ArcadeObjectBody } from './bodies';
import type { LoadedRoomObject } from './model';
import { hasSolidTerrainAtWorldPoint } from './swordsmanFloorContact';

const SWORDSMAN_AI_SWORD_LOS_STEP_PX = 4;

type RoomOrigin = { x: number; y: number };

export function getSwordsmanSwordPathLane(
  liveObject: LoadedRoomObject,
  targetBounds: Phaser.Geom.Rectangle,
  attackBounds: Phaser.Geom.Rectangle,
): Phaser.Geom.Rectangle | null {
  const body = liveObject.sprite.body as ArcadeObjectBody | null;
  if (!body) {
    return null;
  }

  const overlapTop = Math.max(attackBounds.top, targetBounds.top);
  const overlapBottom = Math.min(attackBounds.bottom, targetBounds.bottom);
  if (overlapBottom <= overlapTop) {
    return null;
  }

  const bodyBounds = getArcadeBodyBounds(body);
  const directionX = liveObject.runtime.directionX >= 0 ? 1 : -1;
  const pathStartX = directionX > 0 ? bodyBounds.right : targetBounds.right;
  const pathEndX = directionX > 0 ? targetBounds.left : bodyBounds.left;
  const left = Math.min(pathStartX, pathEndX);
  const right = Math.max(pathStartX, pathEndX);
  if (right - left <= 1) {
    return null;
  }

  return new Phaser.Geom.Rectangle(left, overlapTop, right - left, overlapBottom - overlapTop);
}

export function swordsmanSwordLaneHitsSolidTerrain(
  room: RoomSnapshot,
  lane: Phaser.Geom.Rectangle,
  origin: RoomOrigin,
): boolean {
  const left = Math.floor(lane.left) + 1;
  const right = Math.ceil(lane.right) - 1;
  if (right < left) {
    return false;
  }

  const top = lane.top + 1;
  const bottom = lane.bottom - 1;
  const sampleYs = [
    lane.centerY,
    Phaser.Math.Clamp(top, lane.top, lane.bottom),
    Phaser.Math.Clamp(bottom, lane.top, lane.bottom),
  ];
  const sampleAtX = (x: number): boolean => {
    for (const y of sampleYs) {
      if (hasSolidTerrainAtWorldPoint(room, x, y, origin)) {
        return true;
      }
    }
    return false;
  };

  for (let x = left; x <= right; x += SWORDSMAN_AI_SWORD_LOS_STEP_PX) {
    if (sampleAtX(x)) {
      return true;
    }
  }

  return sampleAtX(right);
}
