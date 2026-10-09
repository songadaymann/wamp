import type { PlacedObject } from '../config';
import { isPoliceEnemyObjectId } from './policeEnemy';
import { SWORDSMAN_AI_OBJECT_ID } from './swordsmanAi';

export const BOSS_MIN_HITS = 3;
export const BOSS_MAX_HITS = 10;
export const DEFAULT_BOSS_HITS = 5;
export const BOSS_PROTECTION_MS = 600;
export const BOSS_HURT_MS = 250;
export type BossHitPoints = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export function isBossEnemyObjectId(id: unknown): boolean {
  return id === SWORDSMAN_AI_OBJECT_ID || isPoliceEnemyObjectId(id);
}
export function normalizeBossHitPoints(value: unknown): BossHitPoints | null {
  return Number.isInteger(value) && Number(value) >= BOSS_MIN_HITS && Number(value) <= BOSS_MAX_HITS
    ? value as BossHitPoints : null;
}
export function getPlacedBossHitPoints(placed: Partial<Pick<PlacedObject, 'id' | 'bossHitPoints' | 'swordsmanDefeatMode'>>): BossHitPoints | null {
  return isBossEnemyObjectId(placed.id) && placed.swordsmanDefeatMode !== 'invincible'
    ? normalizeBossHitPoints(placed.bossHitPoints) : null;
}

export function withPlacedBossHitPoints(placed: PlacedObject, value: number | null): PlacedObject {
  if (!isBossEnemyObjectId(placed.id)) return placed;
  const bossHitPoints = normalizeBossHitPoints(value);
  return {
    ...placed,
    bossHitPoints,
    ...(bossHitPoints && placed.swordsmanDefeatMode === 'invincible'
      ? { swordsmanDefeatMode: 'defeatable' as const } : {}),
  };
}

export function getBossChallengeSignature(placedObjects: readonly PlacedObject[]): string {
  return JSON.stringify(placedObjects.flatMap(placed => {
    const hits = getPlacedBossHitPoints(placed);
    return hits === null ? [] : [[placed.id, placed.x, placed.y, placed.layer ?? 'terrain', hits]];
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export interface BossHealthState {
  maximum: BossHitPoints;
  health: number;
  protectedUntil: number;
  hurtUntil: number;
}
export function createBossHealthState(value: unknown): BossHealthState | null {
  const maximum = normalizeBossHitPoints(value);
  return maximum === null ? null : { maximum, health: maximum, protectedUntil: 0, hurtUntil: 0 };
}
export function bossPhase(state: BossHealthState | null | undefined): 1 | 2 {
  return state && state.health <= state.maximum / 2 ? 2 : 1;
}
export function damageBoss(state: BossHealthState, now: number): 'protected' | 'hurt' | 'defeated' {
  if (state.health <= 0 || now < state.protectedUntil) return 'protected';
  state.health--;
  state.protectedUntil = now + BOSS_PROTECTION_MS;
  state.hurtUntil = now + BOSS_HURT_MS;
  return state.health === 0 ? 'defeated' : 'hurt';
}
export function bossTimingMs(state: BossHealthState | null | undefined, base: number): number {
  return bossPhase(state) === 2 ? Math.round(base * 0.65) : base;
}
export function bossGroundChaseSpeed(state: BossHealthState | null | undefined, base: number, hasTraversal: boolean): number {
  return !hasTraversal && bossPhase(state) === 2 ? base * 1.2 : base;
}
