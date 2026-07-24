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
