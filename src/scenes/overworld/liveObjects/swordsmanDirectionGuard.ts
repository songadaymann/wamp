import {
  SWORDSMAN_AI_DIRECTION_TURN_WINDOW_MS,
  SWORDSMAN_AI_MAX_DIRECTION_TURNS_PER_WINDOW,
} from '../../../enemies/swordsmanTuning';
import type { LoadedRoomObjectRuntimeState } from './model';

export const SWORDSMAN_AI_FACING_FLIP_MIN_INTERVAL_MS = Math.ceil(
  SWORDSMAN_AI_DIRECTION_TURN_WINDOW_MS / SWORDSMAN_AI_MAX_DIRECTION_TURNS_PER_WINDOW,
);

type DirectionRuntime = Pick<
  LoadedRoomObjectRuntimeState,
  | 'directionX'
  | 'aiDirectionTurnAtMs'
  | 'aiFacingDirectionX'
  | 'aiFacingLastFlipAt'
  | 'aiFacingLastFlipX'
>;

type FacingRuntime = Pick<
  LoadedRoomObjectRuntimeState,
  'aiFacingDirectionX' | 'aiFacingLastFlipAt' | 'aiFacingLastFlipX'
>;

export function resetSwordsmanFacingMemory(
  runtime: DirectionRuntime,
  directionX: number,
  now: number,
  spriteX: number,
): void {
  const facingDirectionX = directionX >= 0 ? 1 : -1;
  runtime.aiFacingDirectionX = facingDirectionX;
  runtime.aiFacingLastFlipAt = now;
  runtime.aiFacingLastFlipX = spriteX;
  runtime.aiDirectionTurnAtMs = [];
}

/**
 * Apply a chase/patrol facing change with a sliding-window turn cap so tip
 * contact cannot flip him every frame (blurred run cycle).
 */
export function trySetSwordsmanDirectionX(
  runtime: DirectionRuntime,
  desiredDirectionX: number,
  now: number,
  options: { force?: boolean } = {},
): boolean {
  if (desiredDirectionX === 0) {
    return false;
  }
  const next = (desiredDirectionX > 0 ? 1 : -1) as -1 | 1;
  const current = (runtime.directionX >= 0 ? 1 : -1) as -1 | 1;
  if (next === current) {
    runtime.directionX = next;
    return true;
  }

  if (!Array.isArray(runtime.aiDirectionTurnAtMs)) {
    runtime.aiDirectionTurnAtMs = [];
  }
  const turns = runtime.aiDirectionTurnAtMs;
  const windowStart = now - SWORDSMAN_AI_DIRECTION_TURN_WINDOW_MS;
  while (turns.length > 0 && turns[0]! < windowStart) {
    turns.shift();
  }

  if (!options.force && turns.length >= SWORDSMAN_AI_MAX_DIRECTION_TURNS_PER_WINDOW) {
    return false;
  }

  turns.push(now);
  if (turns.length > SWORDSMAN_AI_MAX_DIRECTION_TURNS_PER_WINDOW) {
    turns.splice(0, turns.length - SWORDSMAN_AI_MAX_DIRECTION_TURNS_PER_WINDOW);
  }
  runtime.directionX = next;
  return true;
}

export function commitSwordsmanDirectionX(
  runtime: DirectionRuntime,
  desiredDirectionX: number,
  previousDirectionX: number,
  now: number,
): -1 | 1 {
  // Ensure comparison is against the pre-decision facing (not a premature write).
  runtime.directionX = previousDirectionX >= 0 ? 1 : -1;
  if (trySetSwordsmanDirectionX(runtime, desiredDirectionX, now)) {
    return (runtime.directionX >= 0 ? 1 : -1);
  }
  return runtime.directionX as -1 | 1;
}

/** Rate-limit visual facing flips separately from locomotion directionX. */
export function updateSwordsmanFacingDirection(
  runtime: FacingRuntime,
  desiredDirectionX: number,
  now: number,
  currentX: number,
  options: { force?: boolean } = {},
): void {
  if (desiredDirectionX === 0) {
    return;
  }
  const facingDirectionX = desiredDirectionX > 0 ? 1 : -1;
  if (facingDirectionX === runtime.aiFacingDirectionX) {
    return;
  }
  const recentlyFlipped =
    now < runtime.aiFacingLastFlipAt + SWORDSMAN_AI_FACING_FLIP_MIN_INTERVAL_MS;
  if (options.force || !recentlyFlipped) {
    runtime.aiFacingDirectionX = facingDirectionX;
    runtime.aiFacingLastFlipAt = now;
    runtime.aiFacingLastFlipX = currentX;
  }
}
