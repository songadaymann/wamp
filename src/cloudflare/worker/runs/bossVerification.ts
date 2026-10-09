import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../../config';
import { BOSS_PROTECTION_MS, type BossHitPoints } from '../../../enemies/boss';
import { SWORDSMAN_AI_WALL_JUMP_VELOCITY_X } from '../../../enemies/swordsmanTuning';

/** A bounded plausibility check, not simulation: bosses chase and recoil before their final hit. */
export function isPlausibleBossDefeat(
  event: { x: number; y: number; atMs: number },
  binding: { x: number; y: number; bossHitPoints: BossHitPoints },
): boolean {
  if (event.atMs < (binding.bossHitPoints - 1) * BOSS_PROTECTION_MS) return false;
  const seconds = event.atMs / 1000;
  const slack = 64;
  return event.x >= -slack && event.x <= ROOM_PX_WIDTH + slack
    && event.y >= -slack && event.y <= ROOM_PX_HEIGHT + slack
    // Leave room for authored platform carry as well as jumps and hit recoil.
    && Math.abs(event.x - binding.x) <= slack + seconds * SWORDSMAN_AI_WALL_JUMP_VELOCITY_X * 2
    && Math.abs(event.y - binding.y) <= slack + seconds * 600;
}
