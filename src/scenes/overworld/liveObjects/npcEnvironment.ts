import type { GameObjectConfig } from '../../../config';

const NPC_ICE_COAST_FACTOR = 0.985;
const NPC_ICE_ACCELERATION = 900;
const NPC_STICKY_MOVE_FACTOR = 0.48;
const NPC_QUICKSAND_MOVE_FACTOR = 0.56;
const NPC_WIND_RECOVERY_FACTOR = 0.18;
const NPC_WIND_IDLE_DAMPING = 0.92;

export type NpcEnvironmentalObjectInteraction =
  | 'lethal'
  | 'quicksand'
  | 'tornado'
  | 'none';

export interface NpcHorizontalMovementInput {
  currentVelocityX: number;
  directionX: number;
  baseSpeed: number;
  deltaMs: number;
  walking: boolean;
  externallyLaunched: boolean;
  onIce: boolean;
  onSticky: boolean;
  inQuicksand: boolean;
  windX: -1 | 0 | 1;
}

export interface NpcRoomBoundaryBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface NpcRoomBoundaryCorrection {
  deltaX: number;
  deltaY: number;
  hitLeft: boolean;
  hitRight: boolean;
  hitTop: boolean;
  hitBottom: boolean;
}

export interface NpcRoomBoundaryInput {
  roomBounds: NpcRoomBoundaryBounds;
  bodyBounds: NpcRoomBoundaryBounds;
  velocityX: number;
  velocityY: number;
  inset?: number;
}

export function getNpcEnvironmentalObjectInteraction(
  config: Pick<GameObjectConfig, 'id' | 'category'>,
): NpcEnvironmentalObjectInteraction {
  if (config.id === 'tornado' || config.id === 'tornado_sand') {
    return 'tornado';
  }
  if (config.id === 'quicksand') {
    return 'quicksand';
  }
  if (config.category === 'hazard' || config.category === 'enemy') {
    return 'lethal';
  }
  return 'none';
}

export function resolveNpcHorizontalVelocity(
  input: NpcHorizontalMovementInput,
): number {
  if (input.externallyLaunched) {
    return input.currentVelocityX;
  }

  if (!input.walking) {
    if (input.onIce) {
      return input.currentVelocityX * NPC_ICE_COAST_FACTOR;
    }
    if (input.windX !== 0) {
      return input.currentVelocityX * NPC_WIND_IDLE_DAMPING;
    }
    return 0;
  }

  const surfaceMoveFactor = input.inQuicksand
    ? NPC_QUICKSAND_MOVE_FACTOR
    : input.onSticky
      ? NPC_STICKY_MOVE_FACTOR
      : 1;
  const targetVelocityX =
    Math.sign(input.directionX || 1) * input.baseSpeed * surfaceMoveFactor;
  if (input.onIce) {
    const deltaSeconds = Math.max(input.deltaMs / 1000, 1 / 60);
    const amount = Math.min(
      1,
      NPC_ICE_ACCELERATION * deltaSeconds / Math.max(1, Math.abs(targetVelocityX)),
    );
    return input.currentVelocityX + (targetVelocityX - input.currentVelocityX) * amount;
  }
  if (input.windX !== 0) {
    return input.currentVelocityX +
      (targetVelocityX - input.currentVelocityX) * NPC_WIND_RECOVERY_FACTOR;
  }
  return targetVelocityX;
}

export function resolveNpcRoomBoundaryCorrection(
  input: NpcRoomBoundaryInput,
): NpcRoomBoundaryCorrection | null {
  const inset = Math.max(0, input.inset ?? 1);
  const minLeft = input.roomBounds.left + inset;
  const maxRight = input.roomBounds.right - inset;
  const minTop = input.roomBounds.top + inset;
  const maxBottom = input.roomBounds.bottom - inset;
  const hitLeft =
    input.bodyBounds.left < minLeft ||
    (input.bodyBounds.left <= minLeft && input.velocityX < 0);
  const hitRight =
    input.bodyBounds.right > maxRight ||
    (input.bodyBounds.right >= maxRight && input.velocityX > 0);
  const hitTop =
    input.bodyBounds.top < minTop ||
    (input.bodyBounds.top <= minTop && input.velocityY < 0);
  const hitBottom =
    input.bodyBounds.bottom > maxBottom ||
    (input.bodyBounds.bottom >= maxBottom && input.velocityY > 0);

  if (!hitLeft && !hitRight && !hitTop && !hitBottom) {
    return null;
  }

  return {
    deltaX: hitLeft
      ? Math.max(0, minLeft - input.bodyBounds.left)
      : hitRight
        ? Math.min(0, maxRight - input.bodyBounds.right)
        : 0,
    deltaY: hitTop
      ? Math.max(0, minTop - input.bodyBounds.top)
      : hitBottom
        ? Math.min(0, maxBottom - input.bodyBounds.bottom)
        : 0,
    hitLeft,
    hitRight,
    hitTop,
    hitBottom,
  };
}
