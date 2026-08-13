import { describe, expect, it } from 'vitest';
import type { SuspiciousRunCase, SuspiciousSignal, SuspiciousUserCase } from '../../../admin/model';
import {
  applyNewAccountSpikeSignals,
  applyPointBurstSignals,
  applyRepeatSignals,
  applyRunBurstSignals,
  applyTooFastSignals,
  buildSuspiciousUserCaseFromAccumulator,
  compareRunCases,
  compareSignals,
  compareUserCases,
  findBestCountWindow,
  findBestPointWindow,
  getOrCreateAccumulator,
  markRecordGapRoomRuns,
  mergeFlaggedRunsIntoHistory,
  type CombinedRunBase,
  type UserAccumulator,
} from './suspiciousModel';

describe('suspicious analysis thresholds', () => {
  it('treats exactly one second as valid and flags only faster runs as high severity', () => {
    const accumulators = new Map<string, UserAccumulator>();
    createAccumulator(accumulators, 'user-fast');
    const fast = run('fast', 'user-fast', '2026-08-13T12:00:00.000Z', 999);
    const boundary = run('boundary', 'user-fast', '2026-08-13T12:01:00.000Z', 1_000);

    applyTooFastSignals(
      accumulators,
      new Map([
        [fast.attemptId, fast],
        [boundary.attemptId, boundary],
      ]),
      new Map()
    );

    const accumulator = accumulators.get('user-fast')!;
    expect(accumulator.signals.get('too_fast_absolute')).toEqual({
      code: 'too_fast_absolute',
      severity: 'high',
      label: 'Too Fast',
      summary: '1 completed run under 1s.',
      relatedAttemptIds: ['fast'],
    });
    expect([...accumulator.roomRuns]).toHaveLength(1);
    expect(accumulator.roomRuns.has('boundary')).toBe(false);
  });

  it('keeps run burst thresholds inclusive and the time-window boundary inclusive', () => {
    const accumulators = new Map<string, UserAccumulator>();
    createAccumulator(accumulators, 'user-burst');
    const runs = Array.from({ length: 20 }, (_, index) =>
      run(
        `attempt-${index.toString().padStart(2, '0')}`,
        'user-burst',
        new Date(Date.parse('2026-08-13T12:00:00.000Z') + index * 15_000).toISOString(),
        5_000
      )
    );

    applyRunBurstSignals(
      accumulators,
      new Map([['user-burst', runs.slice(0, 10)]]),
      5 * 60 * 1_000,
      10,
      20,
      'run_burst_5m'
    );
    expect(accumulators.get('user-burst')!.signals.get('run_burst_5m')?.severity).toBe('medium');

    createAccumulator(accumulators, 'user-burst-high');
    applyRunBurstSignals(
      accumulators,
      new Map([['user-burst-high', runs.map((entry) => ({ ...entry, userId: 'user-burst-high' }))]]),
      5 * 60 * 1_000,
      10,
      20,
      'run_burst_5m'
    );
    expect(accumulators.get('user-burst-high')!.signals.get('run_burst_5m')?.severity).toBe('high');

    expect(
      findBestCountWindow(
        [
          { at: '2026-08-13T12:00:00.000Z', attemptId: 'a' },
          { at: '2026-08-13T12:05:00.000Z', attemptId: 'b' },
          { at: '2026-08-13T12:05:00.001Z', attemptId: 'c' },
        ],
        5 * 60 * 1_000
      )
    ).toEqual({ count: 2, attemptIds: ['a', 'b'] });
  });

  it('requires four identical clears inside fifteen minutes', () => {
    const accumulators = new Map<string, UserAccumulator>();
    createAccumulator(accumulators, 'user-repeat');
    const runs = Array.from({ length: 4 }, (_, index) =>
      run(
        `repeat-${index}`,
        'user-repeat',
        new Date(Date.parse('2026-08-13T12:00:00.000Z') + index * 60_000).toISOString(),
        12_345
      )
    );

    applyRepeatSignals(accumulators, new Map([['user-repeat', runs.slice(0, 3)]]));
    expect(accumulators.get('user-repeat')!.signals.has('repeat_identical')).toBe(false);

    applyRepeatSignals(accumulators, new Map([['user-repeat', runs]]));
    expect(accumulators.get('user-repeat')!.signals.get('repeat_identical')).toEqual({
      code: 'repeat_identical',
      severity: 'medium',
      label: 'Repeated Identical Clears',
      summary: '1 repeated identical finish cluster; max 4 repeats in 15m.',
      relatedAttemptIds: runs.map((entry) => entry.attemptId),
    });
    expect([...accumulators.get('user-repeat')!.roomRuns.values()]).toEqual(
      expect.arrayContaining([expect.objectContaining({ repeatGroupCount: 4, severity: 'medium' })])
    );
  });

  it('classifies point bursts at 500 and 1000 points and ignores negative points', () => {
    const accumulators = new Map<string, UserAccumulator>();
    for (const userId of ['below', 'medium', 'high']) {
      createAccumulator(accumulators, userId);
    }

    applyPointBurstSignals(accumulators, [
      event('below', '2026-08-13T12:00:00.000Z', 499),
      event('below', '2026-08-13T12:01:00.000Z', -1),
      event('medium', '2026-08-13T12:00:00.000Z', 250),
      event('medium', '2026-08-13T12:05:00.000Z', 250),
      event('high', '2026-08-13T12:00:00.000Z', 500),
      event('high', '2026-08-13T12:04:59.999Z', 500),
    ]);

    expect(accumulators.get('below')!.signals.has('point_burst_5m')).toBe(false);
    expect(accumulators.get('medium')!.signals.get('point_burst_5m')?.severity).toBe('medium');
    expect(accumulators.get('high')!.signals.get('point_burst_5m')?.severity).toBe('high');
    expect(
      findBestPointWindow(
        [
          { at: '2026-08-13T12:00:00.000Z', points: 500 },
          { at: '2026-08-13T12:05:00.001Z', points: 500 },
        ],
        5 * 60 * 1_000
      )
    ).toEqual({ totalPoints: 500 });
  });

  it('uses inclusive new-account point/run thresholds and a strict age cutoff', () => {
    const nowMs = Date.parse('2026-08-13T16:00:00.000Z');
    const accumulators = new Map<string, UserAccumulator>();
    createAccumulator(accumulators, 'points', '2026-08-12T16:00:00.000Z', 1_000, 0);
    createAccumulator(accumulators, 'runs', '2026-08-13T15:00:00.000Z', 0, 20);
    createAccumulator(accumulators, 'old', '2026-08-12T15:59:59.999Z', 10_000, 100);
    createAccumulator(accumulators, 'below', '2026-08-13T15:00:00.000Z', 999, 19);

    applyNewAccountSpikeSignals(accumulators, nowMs);

    expect(accumulators.get('points')!.signals.has('new_account_spike')).toBe(true);
    expect(accumulators.get('runs')!.signals.has('new_account_spike')).toBe(true);
    expect(accumulators.get('old')!.signals.has('new_account_spike')).toBe(false);
    expect(accumulators.get('below')!.signals.has('new_account_spike')).toBe(false);
  });

  it('flags record gaps only when both the 3000ms and 30 percent boundaries are met', () => {
    const accumulators = new Map<string, UserAccumulator>();
    createAccumulator(accumulators, 'user-gap');
    const baseline = historical('baseline', '2026-08-13T11:00:00.000Z', 10_000);
    const boundary = run('boundary', 'user-gap', '2026-08-13T12:00:00.000Z', 7_000);
    const shortGap = run('short-gap', 'user-gap', '2026-08-13T13:00:00.000Z', 7_001);
    const ratioMiss = run('ratio-miss', 'user-gap', '2026-08-13T14:00:00.000Z', 14_001);

    markRecordGapRoomRuns(
      accumulators,
      [boundary],
      [baseline, historicalFromRun(boundary)],
      { type: 'reach_exit', exit: null, timeLimitMs: null }
    );
    expect(accumulators.get('user-gap')!.signals.get('record_gap')).toEqual(
      expect.objectContaining({ severity: 'high', relatedAttemptIds: ['boundary'] })
    );
    expect(accumulators.get('user-gap')!.roomRuns.get('boundary')).toEqual(
      expect.objectContaining({
        previousBestElapsedMs: 10_000,
        improvementMs: 3_000,
        improvementRatio: 0.3,
      })
    );

    const misses = new Map<string, UserAccumulator>();
    createAccumulator(misses, 'user-gap');
    markRecordGapRoomRuns(
      misses,
      [shortGap],
      [baseline, historicalFromRun(shortGap)],
      { type: 'reach_exit', exit: null, timeLimitMs: null }
    );
    expect(misses.get('user-gap')!.signals.has('record_gap')).toBe(false);

    const ratioMisses = new Map<string, UserAccumulator>();
    createAccumulator(ratioMisses, 'user-gap');
    markRecordGapRoomRuns(
      ratioMisses,
      [ratioMiss],
      [historical('slower-baseline', '2026-08-13T11:00:00.000Z', 20_000), historicalFromRun(ratioMiss)],
      { type: 'reach_exit', exit: null, timeLimitMs: null }
    );
    expect(ratioMisses.get('user-gap')!.signals.has('record_gap')).toBe(false);
  });
});

describe('suspicious severity and ordering', () => {
  it('reuses an accumulator while applying the original identity and stats precedence', () => {
    const accumulators = new Map<string, UserAccumulator>();
    const original = createAccumulator(accumulators, 'user-merge');
    original.recentPoints = 25;

    const merged = getOrCreateAccumulator(accumulators, 'user-merge', {
      userDisplayName: '',
      userCreatedAt: '',
      email: null,
      walletAddress: '0xabc',
      ogpId: 'ogp-1',
      playerId: null,
      stats: {
        userId: 'user-merge',
        userDisplayName: 'Ignored Stats Name',
        totalPoints: 200,
        totalScore: 0,
        totalDeaths: 0,
        totalCollectibles: 0,
        totalEnemiesDefeated: 0,
        totalCheckpoints: 0,
        totalRoomsPublished: 0,
        completedRuns: 9,
        failedRuns: 0,
        abandonedRuns: 0,
        pvpWins: 0,
        pvpLosses: 0,
        pvpDraws: 0,
        bestScore: 0,
        fastestClearMs: null,
        updatedAt: '2026-08-13T00:00:00.000Z',
      },
    });

    expect(merged).toBe(original);
    expect(merged).toEqual(
      expect.objectContaining({
        userDisplayName: 'user-merge',
        userCreatedAt: '2026-08-01T00:00:00.000Z',
        email: 'user-merge@example.test',
        walletAddress: '0xabc',
        ogpId: 'ogp-1',
        totalPoints: 200,
        completedRuns: 9,
        recentPoints: 25,
      })
    );
    expect(accumulators).toHaveLength(1);
  });

  it('sorts signals, run cases, and users by the exact severity and tie-break rules', () => {
    const signals: SuspiciousSignal[] = [
      signal('point_burst_5m', 'medium', 'Zulu'),
      signal('new_account_spike', 'medium', 'Alpha'),
      signal('too_fast_absolute', 'high', 'Too Fast'),
    ];
    expect([...signals].sort(compareSignals).map((entry) => entry.label)).toEqual([
      'Too Fast',
      'Alpha',
      'Zulu',
    ]);

    const runCases = [
      runCase('b', 'medium', '2026-08-13T12:00:00.000Z'),
      runCase('a', 'medium', '2026-08-13T12:00:00.000Z'),
      runCase('high-old', 'high', '2026-08-13T11:00:00.000Z'),
    ];
    expect([...runCases].sort(compareRunCases).map((entry) => entry.attemptId)).toEqual([
      'high-old',
      'a',
      'b',
    ]);

    const users = [
      userCase('Zulu', 'medium', '2026-08-13T12:00:00.000Z'),
      userCase('Alpha', 'medium', '2026-08-13T12:00:00.000Z'),
      userCase('High', 'high', '2026-08-13T11:00:00.000Z'),
    ];
    expect([...users].sort(compareUserCases).map((entry) => entry.userDisplayName)).toEqual([
      'High',
      'Alpha',
      'Zulu',
    ]);
  });

  it('derives strongest severity, stable signal-code order, maxima, and identity', () => {
    const accumulators = new Map<string, UserAccumulator>();
    const accumulator = createAccumulator(
      accumulators,
      'user-case',
      '2026-08-13T12:00:00.000Z',
      10,
      2
    );
    accumulator.recentPoints = 20;
    accumulator.recentCompletedRuns = 1;
    accumulator.lastActivityAt = '2026-08-13T15:00:00.000Z';
    accumulator.signals.set('new_account_spike', signal('new_account_spike', 'medium', 'Zulu'));
    accumulator.signals.set('too_fast_absolute', signal('too_fast_absolute', 'high', 'Too Fast'));

    expect(buildSuspiciousUserCaseFromAccumulator(accumulator)).toEqual(
      expect.objectContaining({
        totalPoints: 20,
        completedRuns: 2,
        strongestSeverity: 'high',
        signalCodes: ['too_fast_absolute', 'new_account_spike'],
        identity: expect.objectContaining({ kind: 'no_generated_signal' }),
      })
    );
  });

  it('merges only flagged review fields into player history and returns newest first', () => {
    const old = runCase('old', 'low', '2026-08-13T11:00:00.000Z');
    const newest = runCase('newest', 'low', '2026-08-13T13:00:00.000Z');
    const flagged = {
      ...old,
      severity: 'high' as const,
      ruleCodes: ['record_gap' as const],
      previousBestElapsedMs: 10_000,
      improvementMs: 4_000,
      improvementRatio: 0.4,
      repeatGroupCount: null,
      score: 999,
    };

    const merged = mergeFlaggedRunsIntoHistory([old, newest], [flagged]);

    expect(merged.map((entry) => entry.attemptId)).toEqual(['newest', 'old']);
    expect(merged[1]).toEqual(
      expect.objectContaining({
        score: old.score,
        severity: 'high',
        ruleCodes: ['record_gap'],
        improvementMs: 4_000,
      })
    );
  });
});

function createAccumulator(
  accumulators: Map<string, UserAccumulator>,
  userId: string,
  userCreatedAt = '2026-08-01T00:00:00.000Z',
  totalPoints = 0,
  completedRuns = 0
): UserAccumulator {
  return getOrCreateAccumulator(accumulators, userId, {
    userDisplayName: userId,
    userCreatedAt,
    email: `${userId}@example.test`,
    walletAddress: null,
    ogpId: null,
    playerId: null,
    stats: {
      userId,
      userDisplayName: userId,
      totalPoints,
      totalScore: 0,
      totalDeaths: 0,
      totalCollectibles: 0,
      totalEnemiesDefeated: 0,
      totalCheckpoints: 0,
      totalRoomsPublished: 0,
      completedRuns,
      failedRuns: 0,
      abandonedRuns: 0,
      pvpWins: 0,
      pvpLosses: 0,
      pvpDraws: 0,
      bestScore: 0,
      fastestClearMs: null,
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
  });
}

function run(
  attemptId: string,
  userId: string,
  finishedAt: string,
  elapsedMs: number
): CombinedRunBase {
  return {
    kind: 'room',
    attemptId,
    userId,
    userDisplayName: userId,
    userCreatedAt: '2026-08-01T00:00:00.000Z',
    email: `${userId}@example.test`,
    walletAddress: null,
    ogpId: null,
    playerId: null,
    sourceId: 'room-1',
    title: 'Fixture Room',
    version: 1,
    roomX: 1,
    roomY: 2,
    goalType: 'reach_exit',
    rankingMode: 'time',
    goal: { type: 'reach_exit', exit: null, timeLimitMs: null },
    startedAt: new Date(Date.parse(finishedAt) - elapsedMs).toISOString(),
    finishedAt,
    elapsedMs,
    deaths: 0,
    score: 100,
    runFinalizedPoints: 10,
    runFinalizedPointEventId: `points-${attemptId}`,
    runFinalizedPointCreatedAt: finishedAt,
  };
}

function historical(attemptId: string, finishedAt: string, elapsedMs: number) {
  return {
    attemptId,
    finishedAt,
    startedAt: new Date(Date.parse(finishedAt) - elapsedMs).toISOString(),
    elapsedMs,
    deaths: 0,
    score: 100,
  };
}

function historicalFromRun(value: CombinedRunBase) {
  return historical(value.attemptId, value.finishedAt, value.elapsedMs);
}

function event(userId: string, createdAt: string, points: number) {
  return { user_id: userId, created_at: createdAt, points };
}

function signal(
  code: SuspiciousSignal['code'],
  severity: SuspiciousSignal['severity'],
  label: string
): SuspiciousSignal {
  return { code, severity, label, summary: label, relatedAttemptIds: [] };
}

function runCase(
  attemptId: string,
  severity: SuspiciousRunCase['severity'],
  finishedAt: string
): SuspiciousRunCase {
  return {
    kind: 'room',
    attemptId,
    sourceId: 'room-1',
    title: 'Fixture',
    version: 1,
    roomX: 1,
    roomY: 2,
    goalType: 'reach_exit',
    rankingMode: 'time',
    userId: 'user',
    userDisplayName: 'User',
    startedAt: '2026-08-13T10:00:00.000Z',
    finishedAt,
    result: 'completed',
    elapsedMs: 5_000,
    deaths: 0,
    score: 100,
    runFinalizedPoints: 10,
    runFinalizedPointEventId: `points-${attemptId}`,
    runFinalizedPointCreatedAt: finishedAt,
    severity,
    ruleCodes: [],
    previousBestElapsedMs: null,
    improvementMs: null,
    improvementRatio: null,
    repeatGroupCount: null,
  };
}

function userCase(
  userDisplayName: string,
  strongestSeverity: SuspiciousUserCase['strongestSeverity'],
  lastActivityAt: string
): SuspiciousUserCase {
  return {
    userId: userDisplayName.toLowerCase(),
    userDisplayName,
    userCreatedAt: '2026-08-01T00:00:00.000Z',
    ogpId: null,
    playerId: null,
    totalPoints: 0,
    completedRuns: 0,
    recentPoints: 0,
    recentCompletedRuns: 0,
    strongestSeverity,
    signalCodes: [],
    signals: [],
    identity: {
      bucket: 'real_players',
      kind: 'no_generated_signal',
      label: 'Real player, as far as we know',
      summary: 'No generated-account link or current generated-name heuristic on this account.',
    },
    lastActivityAt,
  };
}
