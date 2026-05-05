export const SWORDSMAN_AI_AIR_SPEED = 88;
export const SWORDSMAN_AI_JUMP_VELOCITY_Y = -265;
export const SWORDSMAN_AI_JUMP_VELOCITY_X = 118;
export const SWORDSMAN_AI_WALL_JUMP_VELOCITY_Y = -260;
export const SWORDSMAN_AI_WALL_JUMP_VELOCITY_X = 150;
export const SWORDSMAN_AI_LADDER_CLIMB_SPEED = 72;
export const SWORDSMAN_AI_LADDER_ALIGN_SPEED = 48;

export function getSwordsmanTraversalAirSpeed(
  edgeId: string | null,
  directionX: -1 | 1,
  currentVelocityX: number,
): number {
  const movingSameDirection =
    Math.abs(currentVelocityX) <= 0.01 || Math.sign(currentVelocityX) === directionX;
  if (movingSameDirection && edgeId?.endsWith(':wall-jump')) {
    return Math.max(Math.abs(currentVelocityX), SWORDSMAN_AI_WALL_JUMP_VELOCITY_X);
  }
  if (movingSameDirection && edgeId?.endsWith(':jump-to-wall')) {
    return Math.max(Math.abs(currentVelocityX), SWORDSMAN_AI_JUMP_VELOCITY_X);
  }
  return SWORDSMAN_AI_AIR_SPEED;
}

// Keep traversal heuristics aligned with the live jump physics instead of
// allowing routes that only look reachable on the graph.
export const SWORDSMAN_AI_RELIABLE_JUMP_RISE_PX = 48;
export const SWORDSMAN_AI_JUMP_SETUP_BACKOFF_PX = 18;
export const SWORDSMAN_AI_JUMP_LANDING_INSET_PX = 18;
export const SWORDSMAN_AI_JUMP_SETUP_APPROACH_TOLERANCE_PX = 4;
export const SWORDSMAN_AI_JUMP_SETUP_OVERSHOOT_TOLERANCE_PX = 2;
export const SWORDSMAN_AI_JUMP_SETUP_LAUNCH_OVERSHOOT_TOLERANCE_PX = 6;
export const SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX = 4;
export const SWORDSMAN_AI_DROP_SETUP_APPROACH_TOLERANCE_PX = 4;
