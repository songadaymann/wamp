import Phaser from 'phaser';
import {
  SWORDSMAN_AI_JUMP_VELOCITY_X,
  SWORDSMAN_AI_JUMP_VELOCITY_Y,
} from '../../../enemies/swordsmanTuning';
import type { SwordsmanObjectiveTarget } from '../../../enemies/swordsmanObjectives';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { SwordsmanSurfaceSegment } from '../../../enemies/swordsmanTraversal';
import type { ArcadeObjectBody } from './bodies';
import { hasSolidTerrainAtWorldPoint, isSwordsmanOnFloor } from './swordsmanFloorContact';

const SWORDSMAN_AI_SPEED = 72;
const SWORDSMAN_AI_COLLECT_OVERHEAD_MIN_RISE_PX = 18;
const SWORDSMAN_AI_COLLECT_OVERHEAD_MAX_RISE_PX = 86;
const SWORDSMAN_AI_COLLECT_OVERHEAD_MAX_HORIZONTAL_PX = 48;
export const SWORDSMAN_AI_COLLECT_OVERHEAD_BEHIND_GRACE_PX = 12;
const SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX = 10;
const SWORDSMAN_AI_COLLECT_OVERHEAD_EDGE_CLEARANCE_PX = 72;
const SWORDSMAN_AI_COLLECT_OVERHEAD_PATH_STEP_PX = 8;

type RoomOrigin = { x: number; y: number };

export function getSwordsmanCollectOverheadJump(
  room: RoomSnapshot,
  currentSurface: SwordsmanSurfaceSegment | null,
  body: Phaser.Physics.Arcade.Body,
  targetBody: ArcadeObjectBody,
  sweepDirectionX: -1 | 1,
  origin: RoomOrigin,
): NonNullable<SwordsmanObjectiveTarget['opportunisticJump']> | null {
  if (!currentSurface || !isSwordsmanOnFloor(room, body, origin)) {
    return null;
  }

  const deltaX = targetBody.center.x - body.center.x;
  const rise = body.center.y - targetBody.center.y;
  if (
    rise < SWORDSMAN_AI_COLLECT_OVERHEAD_MIN_RISE_PX ||
    rise > SWORDSMAN_AI_COLLECT_OVERHEAD_MAX_RISE_PX ||
    Math.abs(deltaX) > SWORDSMAN_AI_COLLECT_OVERHEAD_MAX_HORIZONTAL_PX ||
    deltaX * sweepDirectionX < -SWORDSMAN_AI_COLLECT_OVERHEAD_BEHIND_GRACE_PX
  ) {
    return null;
  }

  const bodyLocalX = body.center.x - origin.x;
  const targetLocalX = targetBody.center.x - origin.x;
  if (
    targetLocalX < currentSurface.leftX - SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX ||
    targetLocalX > currentSurface.rightX + SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX
  ) {
    return null;
  }

  const directionX = (Math.abs(deltaX) <= 4 ? sweepDirectionX : deltaX >= 0 ? 1 : -1) as -1 | 1;
  const minSafeJumpX =
    currentSurface.leftX +
    body.halfWidth +
    SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX;
  const maxSafeJumpX =
    currentSurface.rightX -
    body.halfWidth -
    SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX;
  const edgeClearance =
    directionX > 0
      ? currentSurface.rightX - bodyLocalX
      : bodyLocalX - currentSurface.leftX;
  if (
    bodyLocalX < minSafeJumpX ||
    bodyLocalX > maxSafeJumpX ||
    targetLocalX < minSafeJumpX ||
    targetLocalX > maxSafeJumpX ||
    edgeClearance < SWORDSMAN_AI_COLLECT_OVERHEAD_EDGE_CLEARANCE_PX
  ) {
    return null;
  }

  if (!hasClearSwordsmanCollectOverheadPath(room, body, targetBody, origin)) {
    return null;
  }

  const velocityX =
    Math.abs(deltaX) <= 6
      ? body.velocity.x || directionX * SWORDSMAN_AI_SPEED
      : directionX *
        Phaser.Math.Clamp(Math.abs(deltaX) * 3.25, SWORDSMAN_AI_SPEED, SWORDSMAN_AI_JUMP_VELOCITY_X);

  return {
    directionX,
    targetX: targetBody.center.x,
    velocityX,
    velocityY: SWORDSMAN_AI_JUMP_VELOCITY_Y,
  };
}

export function hasClearSwordsmanCollectOverheadPath(
  room: RoomSnapshot,
  body: Phaser.Physics.Arcade.Body,
  targetBody: ArcadeObjectBody,
  origin: RoomOrigin,
): boolean {
  const startY = body.top - 2;
  const endY = targetBody.bottom + 2;
  if (endY >= startY) {
    return true;
  }

  const steps = Math.max(
    1,
    Math.ceil((startY - endY) / SWORDSMAN_AI_COLLECT_OVERHEAD_PATH_STEP_PX),
  );
  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    const x = Phaser.Math.Linear(body.center.x, targetBody.center.x, progress);
    const y = Phaser.Math.Linear(startY, endY, progress);
    if (hasSolidTerrainAtWorldPoint(room, x, y, origin)) {
      return false;
    }
  }

  return true;
}
