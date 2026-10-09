import { expect, it } from 'vitest';
import { bossGroundChaseSpeed, bossPhase, bossTimingMs, createBossHealthState, damageBoss, getPlacedBossHitPoints, normalizeBossHitPoints } from './boss';

it('accepts only optional 3–10-hit bosses on the supported enemies', () => {
  for (const value of [undefined, null, true, '5', 2, 11, 3.5, Infinity]) expect(normalizeBossHitPoints(value)).toBeNull();
  for (let value = 3; value <= 10; value++) expect(normalizeBossHitPoints(value)).toBe(value);
  for (const id of ['swordsman_ai', 'police_patrolman', 'policewoman']) expect(getPlacedBossHitPoints({ id, bossHitPoints: 5 })).toBe(5);
  expect(getPlacedBossHitPoints({ id: 'frog', bossHitPoints: 5 })).toBeNull();
  expect(getPlacedBossHitPoints({ id: 'swordsman_ai', bossHitPoints: 5, swordsmanDefeatMode: 'invincible' })).toBeNull();
  expect(createBossHealthState(undefined)).toBeNull();
});
it('requires separate hits, protects for 600ms, changes phase at half health and terminates once', () => {
  const state = createBossHealthState(4)!;
  expect(damageBoss(state, 0)).toBe('hurt'); expect(state.health).toBe(3); expect(bossPhase(state)).toBe(1);
  expect(state.hurtUntil).toBe(250);
  expect(damageBoss(state, 599)).toBe('protected'); expect(state.health).toBe(3);
  expect(damageBoss(state, 600)).toBe('hurt'); expect(bossPhase(state)).toBe(2);
  expect(damageBoss(state, 1200)).toBe('hurt'); expect(damageBoss(state, 1800)).toBe('defeated');
  expect(damageBoss(state, 2400)).toBe('protected'); expect(state.health).toBe(0);
  expect(createBossHealthState(4)?.health).toBe(4);
});
it('changes only phase-two timings and plain ground chase, retaining traversal speed', () => {
  const state = createBossHealthState(5)!;
  expect(bossTimingMs(state, 180)).toBe(180); expect(bossGroundChaseSpeed(state, 84, false)).toBe(84);
  state.health = 2;
  expect(bossTimingMs(state, 180)).toBe(117); expect(bossTimingMs(state, 680)).toBe(442);
  expect(bossGroundChaseSpeed(state, 84, false)).toBeCloseTo(100.8);
  expect(bossGroundChaseSpeed(state, 84, true)).toBe(84);
  expect(bossTimingMs(null, 180)).toBe(180);
});
