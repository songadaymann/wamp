import type {
  SuspiciousRunCase,
  SuspiciousSeverity,
  SuspiciousSignal,
  SuspiciousSignalCode,
  SuspiciousUserCase,
  SuspiciousUserIdentity,
} from '../../../admin/model';
import type { CourseGoal } from '../../../courses/model';
import { compareCourseLeaderboardEntries } from '../../../courses/scoring';
import { isHeuristicGeneratedCharacterDisplayName } from '../../../generatedUsers/identity';
import type { RoomGoal } from '../../../goals/roomGoals';
import type { UserStatsRecord } from '../../../runs/model';
import { compareLeaderboardEntries } from '../../../runs/scoring';

const TOO_FAST_ABSOLUTE_MS = 1_000;
const RECORD_GAP_MIN_IMPROVEMENT_MS = 3_000;
const RECORD_GAP_MIN_IMPROVEMENT_RATIO = 0.3;
const REPEAT_IDENTICAL_THRESHOLD = 4;
const REPEAT_IDENTICAL_WINDOW_MS = 15 * 60 * 1_000;
const POINT_BURST_5M_THRESHOLD = 500;
const POINT_BURST_5M_HIGH_THRESHOLD = 1_000;
const NEW_ACCOUNT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const NEW_ACCOUNT_POINTS_THRESHOLD = 1_000;
const NEW_ACCOUNT_COMPLETED_RUNS_THRESHOLD = 20;

export interface CombinedRunBase {
  kind: 'room' | 'course';
  attemptId: string;
  userId: string;
  userDisplayName: string;
  userCreatedAt: string;
  email: string | null;
  walletAddress: string | null;
  ogpId: string | null;
  playerId: string | null;
  sourceId: string;
  title: string | null;
  version: number;
  roomX: number | null;
  roomY: number | null;
  goalType: string;
  rankingMode: 'time' | 'score';
  goal: RoomGoal | CourseGoal;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  deaths: number;
  score: number;
  runFinalizedPoints: number | null;
  runFinalizedPointEventId: string | null;
  runFinalizedPointCreatedAt: string | null;
}

export interface HistoricalComparableRun {
  attemptId: string;
  finishedAt: string;
  startedAt: string;
  elapsedMs: number;
  deaths: number;
  score: number;
}

export interface UserAccumulator {
  userId: string;
  userDisplayName: string;
  userCreatedAt: string;
  email: string | null;
  walletAddress: string | null;
  ogpId: string | null;
  playerId: string | null;
  totalPoints: number;
  completedRuns: number;
  recentPoints: number;
  recentCompletedRuns: number;
  lastActivityAt: string | null;
  signals: Map<SuspiciousSignalCode, SuspiciousSignal>;
  roomRuns: Map<string, SuspiciousRunCase>;
  courseRuns: Map<string, SuspiciousRunCase>;
}

export interface SuspiciousPointEventInput {
  user_id: string;
  created_at: string;
  points: number | string | null;
}

export const SIGNAL_LABELS: Record<SuspiciousSignalCode, string> = {
  record_gap: 'Record Gap',
  too_fast_absolute: 'Too Fast',
  run_burst_5m: 'Run Burst · 5m',
  run_burst_60m: 'Run Burst · 60m',
  repeat_identical: 'Repeated Identical Clears',
  point_burst_5m: 'Point Burst · 5m',
  new_account_spike: 'New Account Spike',
};

export function getOrCreateAccumulator(
  accumulators: Map<string, UserAccumulator>,
  userId: string,
  input: {
    userDisplayName: string;
    userCreatedAt: string;
    email: string | null;
    walletAddress: string | null;
    ogpId: string | null;
    playerId: string | null;
    stats: UserStatsRecord | null;
  }
): UserAccumulator {
  const existing = accumulators.get(userId);
  if (existing) {
    existing.userDisplayName = input.userDisplayName || existing.userDisplayName;
    existing.userCreatedAt = input.userCreatedAt || existing.userCreatedAt;
    existing.email = input.email ?? existing.email;
    existing.walletAddress = input.walletAddress ?? existing.walletAddress;
    existing.ogpId = input.ogpId ?? existing.ogpId;
    existing.playerId = input.playerId ?? existing.playerId;
    if (input.stats) {
      existing.totalPoints = input.stats.totalPoints;
      existing.completedRuns = input.stats.completedRuns;
    }
    return existing;
  }

  const created: UserAccumulator = {
    userId,
    userDisplayName: input.userDisplayName,
    userCreatedAt: input.userCreatedAt,
    email: input.email,
    walletAddress: input.walletAddress,
    ogpId: input.ogpId,
    playerId: input.playerId,
    totalPoints: input.stats?.totalPoints ?? 0,
    completedRuns: input.stats?.completedRuns ?? 0,
    recentPoints: 0,
    recentCompletedRuns: 0,
    lastActivityAt: null,
    signals: new Map(),
    roomRuns: new Map(),
    courseRuns: new Map(),
  };
  accumulators.set(userId, created);
  return created;
}

export function applyTooFastSignals(
  accumulators: Map<string, UserAccumulator>,
  roomRunLookup: Map<string, CombinedRunBase>,
  courseRunLookup: Map<string, CombinedRunBase>
): void {
  const counts = new Map<string, number>();
  for (const run of [...roomRunLookup.values(), ...courseRunLookup.values()]) {
    if (run.elapsedMs >= TOO_FAST_ABSOLUTE_MS) {
      continue;
    }
    incrementCount(counts, run.userId);
    markRun(accumulators, run, 'too_fast_absolute', 'high');
  }

  for (const [userId, count] of counts) {
    const accumulator = accumulators.get(userId);
    if (!accumulator) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code: 'too_fast_absolute',
      severity: 'high',
      label: SIGNAL_LABELS.too_fast_absolute,
      summary: `${count} completed run${count === 1 ? '' : 's'} under ${Math.round(TOO_FAST_ABSOLUTE_MS / 1000)}s.`,
      relatedAttemptIds: collectAttemptIdsForSignal(accumulator, 'too_fast_absolute'),
    });
  }
}

export function applyRunBurstSignals(
  accumulators: Map<string, UserAccumulator>,
  runsByUser: Map<string, CombinedRunBase[]>,
  windowMs: number,
  threshold: number,
  highThreshold: number,
  code: 'run_burst_5m' | 'run_burst_60m'
): void {
  for (const [userId, runs] of runsByUser) {
    const sorted = [...runs].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));
    const best = findBestCountWindow(
      sorted.map((run) => ({ at: run.finishedAt, attemptId: run.attemptId })),
      windowMs
    );
    if (best.count < threshold) {
      continue;
    }

    const severity: SuspiciousSeverity = best.count >= highThreshold ? 'high' : 'medium';
    for (const attemptId of best.attemptIds) {
      const run = sorted.find((entry) => entry.attemptId === attemptId);
      if (run) {
        markRun(accumulators, run, code, severity);
      }
    }

    const accumulator = accumulators.get(userId);
    if (!accumulator) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code,
      severity,
      label: SIGNAL_LABELS[code],
      summary: `${best.count} completed runs inside ${Math.round(windowMs / 60_000)} minutes.`,
      relatedAttemptIds: best.attemptIds,
    });
  }
}

export function applyRepeatSignals(
  accumulators: Map<string, UserAccumulator>,
  runsByUser: Map<string, CombinedRunBase[]>
): void {
  for (const [userId, runs] of runsByUser) {
    const groups = new Map<string, CombinedRunBase[]>();
    for (const run of runs) {
      const key = `${run.kind}:${run.sourceId}:${run.version}:${run.elapsedMs}`;
      const list = groups.get(key) ?? [];
      list.push(run);
      groups.set(key, list);
    }

    let clusterCount = 0;
    let maxRepeats = 0;
    const relatedAttemptIds = new Set<string>();

    for (const group of groups.values()) {
      const sorted = [...group].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));
      const best = findBestCountWindow(
        sorted.map((run) => ({ at: run.finishedAt, attemptId: run.attemptId })),
        REPEAT_IDENTICAL_WINDOW_MS
      );
      if (best.count < REPEAT_IDENTICAL_THRESHOLD) {
        continue;
      }

      clusterCount += 1;
      maxRepeats = Math.max(maxRepeats, best.count);
      for (const attemptId of best.attemptIds) {
        relatedAttemptIds.add(attemptId);
        const run = sorted.find((entry) => entry.attemptId === attemptId);
        if (run) {
          markRun(accumulators, run, 'repeat_identical', 'medium', {
            repeatGroupCount: best.count,
          });
        }
      }
    }

    if (clusterCount === 0) {
      continue;
    }

    const accumulator = accumulators.get(userId);
    if (!accumulator) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code: 'repeat_identical',
      severity: 'medium',
      label: SIGNAL_LABELS.repeat_identical,
      summary: `${clusterCount} repeated identical finish cluster${clusterCount === 1 ? '' : 's'}; max ${maxRepeats} repeats in 15m.`,
      relatedAttemptIds: [...relatedAttemptIds],
    });
  }
}

export function applyPointBurstSignals(
  accumulators: Map<string, UserAccumulator>,
  pointEvents: SuspiciousPointEventInput[]
): void {
  const grouped = new Map<string, Array<{ at: string; points: number }>>();
  for (const event of pointEvents) {
    const list = grouped.get(event.user_id) ?? [];
    list.push({ at: event.created_at, points: Math.max(0, Number(event.points ?? 0)) });
    grouped.set(event.user_id, list);
  }

  for (const [userId, events] of grouped) {
    const sorted = [...events].sort((left, right) => left.at.localeCompare(right.at));
    const best = findBestPointWindow(sorted, 5 * 60 * 1_000);
    if (best.totalPoints < POINT_BURST_5M_THRESHOLD) {
      continue;
    }

    const severity: SuspiciousSeverity =
      best.totalPoints >= POINT_BURST_5M_HIGH_THRESHOLD ? 'high' : 'medium';
    const accumulator = accumulators.get(userId);
    if (!accumulator) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code: 'point_burst_5m',
      severity,
      label: SIGNAL_LABELS.point_burst_5m,
      summary: `${best.totalPoints} points earned inside 5 minutes.`,
      relatedAttemptIds: [],
    });
  }
}

export function applyNewAccountSpikeSignals(
  accumulators: Map<string, UserAccumulator>
): void {
  const now = Date.now();
  for (const accumulator of accumulators.values()) {
    const createdAtMs = Date.parse(accumulator.userCreatedAt);
    if (!Number.isFinite(createdAtMs) || now - createdAtMs > NEW_ACCOUNT_MAX_AGE_MS) {
      continue;
    }

    const totalPoints = Math.max(accumulator.totalPoints, accumulator.recentPoints);
    const completedRuns = Math.max(accumulator.completedRuns, accumulator.recentCompletedRuns);
    if (
      totalPoints < NEW_ACCOUNT_POINTS_THRESHOLD &&
      completedRuns < NEW_ACCOUNT_COMPLETED_RUNS_THRESHOLD
    ) {
      continue;
    }

    addOrReplaceSignal(accumulator, {
      code: 'new_account_spike',
      severity: 'medium',
      label: SIGNAL_LABELS.new_account_spike,
      summary: `Account is under 24h old with ${totalPoints} total points and ${completedRuns} completed runs.`,
      relatedAttemptIds: [],
    });
  }
}

export function markRecordGapRoomRuns(
  accumulators: Map<string, UserAccumulator>,
  recentRuns: CombinedRunBase[],
  historicalRuns: HistoricalComparableRun[],
  goal: RoomGoal
): void {
  markRecordGapRuns(
    accumulators,
    recentRuns,
    historicalRuns,
    (left, right) =>
      compareLeaderboardEntries(
        {
          elapsedMs: left.elapsedMs,
          deaths: left.deaths,
          score: left.score,
          finishedAt: left.finishedAt,
        },
        {
          elapsedMs: right.elapsedMs,
          deaths: right.deaths,
          score: right.score,
          finishedAt: right.finishedAt,
        },
        goal
      ),
    'run'
  );
}

export function markRecordGapCourseRuns(
  accumulators: Map<string, UserAccumulator>,
  recentRuns: CombinedRunBase[],
  historicalRuns: HistoricalComparableRun[],
  goal: CourseGoal
): void {
  markRecordGapRuns(
    accumulators,
    recentRuns,
    historicalRuns,
    (left, right) =>
      compareCourseLeaderboardEntries(
        {
          elapsedMs: left.elapsedMs,
          deaths: left.deaths,
          score: left.score,
          finishedAt: left.finishedAt,
        },
        {
          elapsedMs: right.elapsedMs,
          deaths: right.deaths,
          score: right.score,
          finishedAt: right.finishedAt,
        },
        goal
      ),
    'course run'
  );
}

function markRecordGapRuns(
  accumulators: Map<string, UserAccumulator>,
  recentRuns: CombinedRunBase[],
  historicalRuns: HistoricalComparableRun[],
  compare: (left: HistoricalComparableRun, right: HistoricalComparableRun) => number,
  runLabel: 'run' | 'course run'
): void {
  const counts = new Map<string, number>();
  const bestSummaries = new Map<string, { improvementMs: number; ratio: number }>();
  const recentIds = new Set(recentRuns.map((run) => run.attemptId));
  const bestBeforeByAttemptId = buildBestBeforeMap(historicalRuns, recentIds, compare);

  for (const run of recentRuns) {
    const bestBefore = bestBeforeByAttemptId.get(run.attemptId);
    if (!bestBefore) {
      continue;
    }
    const improvementMs = bestBefore.elapsedMs - run.elapsedMs;
    const improvementRatio = improvementMs / bestBefore.elapsedMs;
    if (
      improvementMs < RECORD_GAP_MIN_IMPROVEMENT_MS ||
      improvementRatio < RECORD_GAP_MIN_IMPROVEMENT_RATIO
    ) {
      continue;
    }

    incrementCount(counts, run.userId);
    const best = bestSummaries.get(run.userId);
    if (!best || improvementMs > best.improvementMs) {
      bestSummaries.set(run.userId, { improvementMs, ratio: improvementRatio });
    }
    markRun(accumulators, run, 'record_gap', 'high', {
      previousBestElapsedMs: bestBefore.elapsedMs,
      improvementMs,
      improvementRatio,
    });
  }

  for (const [userId, count] of counts) {
    const accumulator = accumulators.get(userId);
    const best = bestSummaries.get(userId);
    if (!accumulator || !best) {
      continue;
    }
    addOrReplaceSignal(accumulator, {
      code: 'record_gap',
      severity: 'high',
      label: SIGNAL_LABELS.record_gap,
      summary: `${count} ${runLabel}${count === 1 ? '' : 's'} beat the prior best by at least ${Math.round(RECORD_GAP_MIN_IMPROVEMENT_RATIO * 100)}%; biggest gap ${formatDuration(best.improvementMs)}.`,
      relatedAttemptIds: collectAttemptIdsForSignal(accumulator, 'record_gap'),
    });
  }
}

export function buildBestBeforeMap(
  runs: HistoricalComparableRun[],
  recentIds: Set<string>,
  compare: (left: HistoricalComparableRun, right: HistoricalComparableRun) => number
): Map<string, HistoricalComparableRun> {
  const sorted = [...runs].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));
  const result = new Map<string, HistoricalComparableRun>();
  let bestBefore: HistoricalComparableRun | null = null;
  for (const run of sorted) {
    if (recentIds.has(run.attemptId) && bestBefore) {
      result.set(run.attemptId, bestBefore);
    }
    if (!bestBefore || compare(run, bestBefore) < 0) {
      bestBefore = run;
    }
  }
  return result;
}

export function buildSuspiciousUserCaseFromAccumulator(
  accumulator: UserAccumulator
): SuspiciousUserCase {
  const signals = [...accumulator.signals.values()].sort(compareSignals);
  const strongestSeverity = signals.reduce<SuspiciousSeverity>(
    (current, signal) =>
      severityRank(signal.severity) > severityRank(current) ? signal.severity : current,
    'low'
  );

  return {
    userId: accumulator.userId,
    userDisplayName: accumulator.userDisplayName,
    userCreatedAt: accumulator.userCreatedAt,
    ogpId: accumulator.ogpId,
    playerId: accumulator.playerId,
    totalPoints: Math.max(accumulator.totalPoints, accumulator.recentPoints),
    completedRuns: Math.max(accumulator.completedRuns, accumulator.recentCompletedRuns),
    recentPoints: accumulator.recentPoints,
    recentCompletedRuns: accumulator.recentCompletedRuns,
    strongestSeverity,
    signalCodes: signals.map((signal) => signal.code),
    signals,
    identity: classifySuspiciousUserIdentity(accumulator),
    lastActivityAt: accumulator.lastActivityAt,
  };
}

export function classifySuspiciousUserIdentity(
  accumulator: UserAccumulator
): SuspiciousUserIdentity {
  const hasLegacyGeneratedLink = Boolean(accumulator.ogpId || accumulator.playerId);
  const hasIdentityBacking = Boolean(accumulator.email || accumulator.walletAddress);
  const hasHeuristicName = isHeuristicGeneratedCharacterDisplayName(accumulator.userDisplayName);

  if (hasLegacyGeneratedLink && !hasIdentityBacking) {
    return {
      bucket: 'generated_signals',
      kind: 'generated_only',
      label: 'Generated-only',
      summary:
        'Linked through a retired generated-account source and still missing both email and wallet identity.',
    };
  }

  if (hasLegacyGeneratedLink) {
    return {
      bucket: 'generated_signals',
      kind: 'legacy_generated_linked',
      label: 'Legacy generated-linked',
      summary:
        'Linked through a retired generated-account source, but also backed by email or wallet identity.',
    };
  }

  if (hasHeuristicName) {
    return {
      bucket: 'generated_signals',
      kind: 'generated_name_heuristic',
      label: 'Generated-name heuristic',
      summary: 'Display name matches the current generated-account name heuristic.',
    };
  }

  return {
    bucket: 'real_players',
    kind: 'no_generated_signal',
    label: 'Real player, as far as we know',
    summary: 'No generated-account link or current generated-name heuristic on this account.',
  };
}

function addOrReplaceSignal(accumulator: UserAccumulator, signal: SuspiciousSignal): void {
  accumulator.signals.set(signal.code, signal);
}

function markRun(
  accumulators: Map<string, UserAccumulator>,
  run: CombinedRunBase,
  code: SuspiciousSignalCode,
  severity: SuspiciousSeverity,
  extras?: {
    previousBestElapsedMs?: number | null;
    improvementMs?: number | null;
    improvementRatio?: number | null;
    repeatGroupCount?: number | null;
  }
): void {
  const accumulator = accumulators.get(run.userId);
  if (!accumulator) {
    return;
  }

  const store = run.kind === 'room' ? accumulator.roomRuns : accumulator.courseRuns;
  const existing = store.get(run.attemptId);
  const next: SuspiciousRunCase = existing ?? {
    kind: run.kind,
    attemptId: run.attemptId,
    sourceId: run.sourceId,
    title: run.title,
    version: run.version,
    roomX: run.roomX,
    roomY: run.roomY,
    goalType: run.goalType,
    rankingMode: run.rankingMode,
    userId: run.userId,
    userDisplayName: run.userDisplayName,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    result: 'completed',
    elapsedMs: run.elapsedMs,
    deaths: run.deaths,
    score: run.score,
    runFinalizedPoints: run.runFinalizedPoints,
    runFinalizedPointEventId: run.runFinalizedPointEventId,
    runFinalizedPointCreatedAt: run.runFinalizedPointCreatedAt,
    severity,
    ruleCodes: [],
    previousBestElapsedMs: null,
    improvementMs: null,
    improvementRatio: null,
    repeatGroupCount: null,
  };

  if (!next.ruleCodes.includes(code)) {
    next.ruleCodes = [...next.ruleCodes, code].sort();
  }
  next.severity = severityRank(severity) > severityRank(next.severity) ? severity : next.severity;
  if (extras?.previousBestElapsedMs !== undefined) {
    next.previousBestElapsedMs = extras.previousBestElapsedMs;
  }
  if (extras?.improvementMs !== undefined) {
    next.improvementMs = extras.improvementMs;
  }
  if (extras?.improvementRatio !== undefined) {
    next.improvementRatio = extras.improvementRatio;
  }
  if (extras?.repeatGroupCount !== undefined) {
    next.repeatGroupCount = extras.repeatGroupCount;
  }
  store.set(run.attemptId, next);
}

function collectAttemptIdsForSignal(
  accumulator: UserAccumulator,
  code: SuspiciousSignalCode
): string[] {
  const roomAttemptIds = [...accumulator.roomRuns.values()]
    .filter((run) => run.ruleCodes.includes(code))
    .map((run) => run.attemptId);
  const courseAttemptIds = [...accumulator.courseRuns.values()]
    .filter((run) => run.ruleCodes.includes(code))
    .map((run) => run.attemptId);
  return [...roomAttemptIds, ...courseAttemptIds];
}

export function findBestCountWindow(
  items: Array<{ at: string; attemptId: string }>,
  windowMs: number
): { count: number; attemptIds: string[] } {
  const sorted = [...items].sort((left, right) => left.at.localeCompare(right.at));
  let bestCount = 0;
  let bestAttemptIds: string[] = [];
  let startIndex = 0;

  for (let endIndex = 0; endIndex < sorted.length; endIndex += 1) {
    const endTime = Date.parse(sorted[endIndex].at);
    while (startIndex <= endIndex && endTime - Date.parse(sorted[startIndex].at) > windowMs) {
      startIndex += 1;
    }
    const count = endIndex - startIndex + 1;
    if (count > bestCount) {
      bestCount = count;
      bestAttemptIds = sorted.slice(startIndex, endIndex + 1).map((item) => item.attemptId);
    }
  }

  return { count: bestCount, attemptIds: bestAttemptIds };
}

export function findBestPointWindow(
  items: Array<{ at: string; points: number }>,
  windowMs: number
): { totalPoints: number } {
  const sorted = [...items].sort((left, right) => left.at.localeCompare(right.at));
  let bestTotal = 0;
  let startIndex = 0;
  let currentTotal = 0;

  for (let endIndex = 0; endIndex < sorted.length; endIndex += 1) {
    currentTotal += sorted[endIndex].points;
    const endTime = Date.parse(sorted[endIndex].at);
    while (startIndex <= endIndex && endTime - Date.parse(sorted[startIndex].at) > windowMs) {
      currentTotal -= sorted[startIndex].points;
      startIndex += 1;
    }
    bestTotal = Math.max(bestTotal, currentTotal);
  }

  return { totalPoints: bestTotal };
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function severityRank(value: SuspiciousSeverity): number {
  switch (value) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
    default:
      return 1;
  }
}

export function compareSignals(left: SuspiciousSignal, right: SuspiciousSignal): number {
  return (
    severityRank(right.severity) - severityRank(left.severity) ||
    left.label.localeCompare(right.label)
  );
}

export function compareRunCases(left: SuspiciousRunCase, right: SuspiciousRunCase): number {
  return (
    severityRank(right.severity) - severityRank(left.severity) ||
    (right.finishedAt ?? '').localeCompare(left.finishedAt ?? '') ||
    left.attemptId.localeCompare(right.attemptId)
  );
}

export function compareRunHistory(left: SuspiciousRunCase, right: SuspiciousRunCase): number {
  return (
    (right.finishedAt ?? right.startedAt).localeCompare(left.finishedAt ?? left.startedAt) ||
    right.startedAt.localeCompare(left.startedAt) ||
    left.attemptId.localeCompare(right.attemptId)
  );
}

export function compareUserCases(left: SuspiciousUserCase, right: SuspiciousUserCase): number {
  return (
    severityRank(right.strongestSeverity) - severityRank(left.strongestSeverity) ||
    (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '') ||
    left.userDisplayName.localeCompare(right.userDisplayName)
  );
}

export function mergeFlaggedRunsIntoHistory(
  runs: SuspiciousRunCase[],
  flaggedRuns: SuspiciousRunCase[]
): SuspiciousRunCase[] {
  const flaggedByAttemptId = new Map(flaggedRuns.map((run) => [run.attemptId, run]));
  return runs
    .map((run) => {
      const flagged = flaggedByAttemptId.get(run.attemptId);
      if (!flagged) {
        return run;
      }
      return {
        ...run,
        severity: flagged.severity,
        ruleCodes: [...flagged.ruleCodes],
        previousBestElapsedMs: flagged.previousBestElapsedMs,
        improvementMs: flagged.improvementMs,
        improvementRatio: flagged.improvementRatio,
        repeatGroupCount: flagged.repeatGroupCount,
      };
    })
    .sort(compareRunHistory);
}

export function maxIso(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  return `${(ms / 1_000).toFixed(2)}s`;
}
