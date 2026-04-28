import type {
  SwordsmanSurfaceSegment,
  SwordsmanTraversalEdge,
} from './swordsmanTraversal';

const SWORDSMAN_DROP_DOWN_LANDING_BODY_CLEARANCE_PX = 2;
const SWORDSMAN_DROP_DOWN_LANDING_BRAKE_MARGIN_PX = 5;
const SWORDSMAN_DROP_DOWN_MIN_AIR_CORRECTION_SPEED = 28;
const SWORDSMAN_DROP_DOWN_MAX_AIR_CORRECTION_SPEED = 88;
const SWORDSMAN_DROP_DOWN_AIR_CORRECTION_WEIGHT = 3.5;

export function getSwordsmanDropDownAirVelocityX(
  edge: Pick<SwordsmanTraversalEdge, 'directionX' | 'targetX'>,
  targetSurface: SwordsmanSurfaceSegment,
  bodyCenterX: number,
  bodyWidth: number,
): number {
  const landingWindow = getSwordsmanDropDownLandingWindow(targetSurface, bodyWidth);
  if (bodyCenterX >= landingWindow.minX && bodyCenterX <= landingWindow.maxX) {
    return 0;
  }

  const desiredX = clamp(edge.targetX, landingWindow.minX, landingWindow.maxX);
  const deltaX = desiredX - bodyCenterX;
  if (Math.abs(deltaX) <= SWORDSMAN_DROP_DOWN_LANDING_BRAKE_MARGIN_PX) {
    return 0;
  }

  const directionX = (deltaX > 0 ? 1 : -1) as -1 | 1;
  const correctionSpeed = clamp(
    Math.abs(deltaX) * SWORDSMAN_DROP_DOWN_AIR_CORRECTION_WEIGHT,
    SWORDSMAN_DROP_DOWN_MIN_AIR_CORRECTION_SPEED,
    SWORDSMAN_DROP_DOWN_MAX_AIR_CORRECTION_SPEED,
  );
  return directionX * correctionSpeed;
}

function getSwordsmanDropDownLandingWindow(
  targetSurface: SwordsmanSurfaceSegment,
  bodyWidth: number,
): { minX: number; maxX: number } {
  const bodyInset = Math.max(
    bodyWidth * 0.5 + SWORDSMAN_DROP_DOWN_LANDING_BODY_CLEARANCE_PX,
    SWORDSMAN_DROP_DOWN_LANDING_BRAKE_MARGIN_PX,
  );
  const minX = targetSurface.leftX + bodyInset;
  const maxX = targetSurface.rightX - bodyInset;
  if (minX <= maxX) {
    return { minX, maxX };
  }

  const centerX = (targetSurface.leftX + targetSurface.rightX) * 0.5;
  return { minX: centerX, maxX: centerX };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
