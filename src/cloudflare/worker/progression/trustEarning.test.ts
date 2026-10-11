import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, params, run } from '../activity/testDatabase';
import { relaxVerificationTriggerForTrustTier, type RunVerificationTriggerResult } from '../runs/verification';
import { awardRoomRunProgression } from './awards';
import { awardCappedTrustDelta } from './laneEvents';
import { loadOrBackfillUserProgress } from './progressRows';
import { loadEffectiveTrustState } from './trustCaps';

type Fixture = ReturnType<typeof fixture>;
const trust = (f: Fixture, user: string) =>
  Number((f.sqlite.prepare('SELECT hidden_trust_score AS n FROM user_progress WHERE user_id = ?').get(user) as { n: number }).n);
const trigger = (reason: RunVerificationTriggerResult['reason']): RunVerificationTriggerResult => ({
  required: true, reason, predictedRank: 1, previousRank: null, improvementMs: null, improvementRatio: null,
  improvementScore: null, previousBestElapsedMs: null, previousBestScore: null, pointAwardPotential: false,
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-09T12:00:00.000Z')); });
afterEach(() => vi.useRealTimers());

describe('ranked verification by trust tier', () => {
  it('checks T1 runs only when they take or extend the #1 record, and leaves T2+ unchecked', () => {
    expect(relaxVerificationTriggerForTrustTier(trigger('take_top_1'), 'T1').required).toBe(true);
    expect(relaxVerificationTriggerForTrustTier(trigger('record_gap'), 'T1').required).toBe(true);
    expect(relaxVerificationTriggerForTrustTier(trigger('enter_top_10'), 'T1').required).toBe(false);
    expect(relaxVerificationTriggerForTrustTier(trigger('point_gain'), 'T1').required).toBe(false);
    expect(relaxVerificationTriggerForTrustTier(trigger('take_top_1'), 'T2').required).toBe(false);
    expect(relaxVerificationTriggerForTrustTier(trigger('point_gain'), 'T0').required).toBe(true);
  });
});

describe('earning hidden trust', () => {
  it('gives the runner their own clear trust and the creator only theirs', async () => {
    const f = fixture();
    await loadOrBackfillUserProgress(f.env, 'p1'); await loadOrBackfillUserProgress(f.env, 'builder');
    const [runner, creator] = [trust(f, 'p1'), trust(f, 'builder')];
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'clear', 'p1', 9_000)));
    expect(trust(f, 'p1')).toBe(runner + 1);
    expect(trust(f, 'builder')).toBe(creator + 2);
  });

  it('counts a room once for clear trust, and never the player\'s own room', async () => {
    const f = fixture();
    await loadOrBackfillUserProgress(f.env, 'p1'); await loadOrBackfillUserProgress(f.env, 'builder');
    const [runner, builder] = [trust(f, 'p1'), trust(f, 'builder')];
    for (const attempt of ['a', 'b', 'c']) await awardRoomRunProgression(f.env, params(f.record, run(f, attempt, 'p1', 9_000)));
    expect(trust(f, 'p1')).toBe(runner + 1);
    for (const attempt of ['own1', 'own2']) {
      await awardRoomRunProgression(f.env, { ...params(f.record, run(f, attempt, 'builder', 9_000)), ownContent: true });
    }
    expect(trust(f, 'builder')).toBe(builder + 2); // only the creator credit from p1's clear
  });

  it('caps each trust source per UTC day', async () => {
    const f = fixture();
    const award = (key: string, createdAt = '2026-10-09T12:00:00.000Z') => awardCappedTrustDelta(f.env, 'p1', {
      eventType: 'room_clear_completed', sourceType: 'room_attempt', sourceId: key, dedupeKey: `trust:test:${key}`, amount: 1, createdAt,
    }, { eventTypes: ['room_clear_completed', 'course_clear_completed'], dailyCap: 5 });
    const today = [];
    for (let index = 0; index < 7; index += 1) today.push(await award(`room-${index}`));
    expect(today.reduce((sum, value) => sum + value, 0)).toBe(5);
    expect(await award('next-day', '2026-10-10T00:00:01.000Z')).toBe(1);
  });

  it('holds accounts under three days old at T0 whatever their score', async () => {
    const f = fixture(); // accounts created 2026-10-04T17:00Z
    const progress = await loadOrBackfillUserProgress(f.env, 'p1');
    const raised = { ...progress, hidden_trust_score: 95 };
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    const young = await loadEffectiveTrustState(f.env, 'p1', raised);
    expect(young).toMatchObject({ rawTier: 'T2', effectiveTier: 'T0', newAccountHold: true });
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
    expect(await loadEffectiveTrustState(f.env, 'p1', raised)).toMatchObject({ effectiveTier: 'T2', newAccountHold: false });
  });
});
