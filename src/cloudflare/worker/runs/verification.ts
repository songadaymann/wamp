import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH, placedObjectContributesToCategory } from '../../../config';
import type { CourseGoal, CourseSnapshot } from '../../../courses/model';
import { compareCourseLeaderboardEntries, getCourseLeaderboardRankingMode } from '../../../courses/scoring';
import type { CourseMarkerPoint } from '../../../courses/model';
import type { RoomGoal, GoalMarkerPoint } from '../../../goals/roomGoals';
import type { RoomCoordinates, RoomSnapshot } from '../../../persistence/roomModel';
import type { LeaderboardRankingMode } from '../../../runs/model';
import { compareLeaderboardEntries } from '../../../runs/scoring';
import {
  RANKED_RUN_TRACE_SCHEMA_VERSION,
  type RankedRunTraceBreadcrumb,
  type RankedRunTraceGoalEvent,
  type RankedRunTraceRoomTransition,
  type RankedRunVerificationTrace,
} from '../../../runs/verificationTrace';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';

const VERIFICATION_TIMEOUT_MS = 2_000;
const MAX_INPUT_EVENTS = 2_048;
const MAX_BREADCRUMBS = 2_048;
const MAX_ROOM_TRANSITIONS = 256;
const MAX_GOAL_EVENTS = 2_048;
const MAX_TRACE_DURATION_MS = 30 * 60 * 1000;
const TRACE_ELAPSED_TOLERANCE_MS = 600;
const GOAL_EVENT_RADIUS_PX = 32;
const MAX_HORIZONTAL_SPEED_PX_PER_SEC = 900;
const MAX_VERTICAL_SPEED_PX_PER_SEC = 1_500;
const MAX_TOTAL_SPEED_PX_PER_SEC = 1_800;
const POSITION_SLACK_PX = 80;
const GOAL_EVENT_OBJECT_RADIUS_PX = 64;
const GOAL_EVENT_INTERPOLATED_PATH_RADIUS_PX = 112;
const GOAL_EVENT_NEAREST_PATH_RADIUS_PX = 208;
const GOAL_EVENT_BURST_MIN_COUNT = 128;
const GOAL_EVENT_BURST_MIN_RATIO = 0.9;
const GOAL_EVENT_BURST_STATIONARY_LOOKBACK_MS = 4_000;
const GOAL_EVENT_BURST_STATIONARY_MAX_TRAVEL_PX = 48;

export type RunVerificationStatus = 'not_required' | 'passed' | 'failed' | 'timeout';
export type RunVerificationTriggerReason =
  | 'take_top_1'
  | 'enter_top_10'
  | 'record_gap'
  | 'point_gain';
export type RunVerificationFailureReason =
  | 'missing_trace'
  | 'trace_invalid'
  | 'trace_schema'
  | 'trace_nonce'
  | 'trace_snapshot'
  | 'trace_size'
  | 'trace_duration'
  | 'trace_time'
  | 'trace_path'
  | 'trace_transition'
  | 'trace_goal'
  | 'trace_timeout'
  | 'trace_client_outdated';

export interface RunVerificationBinding {
  verificationNonce: string | null;
  verificationSnapshotHash: string | null;
}

export interface RunVerificationDerivedMetrics {
  collectiblesCollected: number;
  enemiesDefeated: number;
  checkpointsReached: number;
}

export interface RunVerificationResult {
  status: Exclude<RunVerificationStatus, 'not_required'>;
  reason: RunVerificationFailureReason | null;
  derivedMetrics: RunVerificationDerivedMetrics;
  summary: Record<string, unknown>;
}

export interface RunVerificationAuditInput {
  attemptId: string;
  kind: 'room' | 'course';
  status: Exclude<RunVerificationStatus, 'not_required'>;
  triggerReason: RunVerificationTriggerReason;
  verificationReason: RunVerificationFailureReason | null;
  summary: Record<string, unknown>;
  trace: RankedRunVerificationTrace | null;
  createdAt: string;
}

interface VerificationComparableEntry {
  attemptId: string;
  userId: string;
  elapsedMs: number;
  deaths: number;
  score: number;
  finishedAt: string;
  overallRank: number | null;
}

interface TraceObjectBinding {
  x: number;
  y: number;
}

export interface RunVerificationTriggerResult {
  required: boolean;
  reason: RunVerificationTriggerReason | null;
  predictedRank: number | null;
  previousRank: number | null;
  improvementMs: number | null;
  improvementRatio: number | null;
  improvementScore: number | null;
  previousBestElapsedMs: number | null;
  previousBestScore: number | null;
  pointAwardPotential: boolean;
}

export async function computeRoomSnapshotVerificationHash(snapshot: RoomSnapshot): Promise<string> {
  return hashVerificationPayload({
    kind: 'room',
    id: snapshot.id,
    version: snapshot.version,
    coordinates: snapshot.coordinates,
    goal: snapshot.goal,
    spawnPoint: snapshot.spawnPoint,
    tileData: snapshot.tileData,
    placedObjects: snapshot.placedObjects.map((placed) => ({
      id: placed.id,
      instanceId: placed.instanceId,
      x: placed.x,
      y: placed.y,
      facing: placed.facing ?? null,
      layer: placed.layer ?? null,
      containedObjectId: placed.containedObjectId ?? null,
      triggerTargetInstanceId: placed.triggerTargetInstanceId ?? null,
    })),
  });
}

export async function computeCourseSnapshotVerificationHash(snapshot: CourseSnapshot): Promise<string> {
  return hashVerificationPayload({
    kind: 'course',
    id: snapshot.id,
    version: snapshot.version,
    goal: snapshot.goal,
    startPoint: snapshot.startPoint,
    roomRefs: snapshot.roomRefs.map((roomRef) => ({
      roomId: roomRef.roomId,
      coordinates: roomRef.coordinates,
      roomVersion: roomRef.roomVersion,
    })),
    pressurePlateLinks: snapshot.pressurePlateLinks,
  });
}

export function createRunVerificationNonce(): string {
  return crypto.randomUUID();
}

export function requireVerificationTrace(
  trace: RankedRunVerificationTrace | null | undefined
): RankedRunVerificationTrace {
  if (!trace) {
    throw new HttpError(409, 'Client update required for ranked verification.');
  }

  return trace;
}

export function createRoomVerificationTrigger(
  goal: RoomGoal,
  input: {
    candidate: Omit<VerificationComparableEntry, 'overallRank'>;
    currentTopEntries: VerificationComparableEntry[];
    viewerEntry: VerificationComparableEntry | null;
    pointAwardPotential?: boolean;
  }
): RunVerificationTriggerResult {
  return createGenericVerificationTrigger({
    ...input,
    rankingMode: goal.type === 'survival' ? 'score' : 'time',
    compare: (left, right) => compareLeaderboardEntries(left, right, goal),
  });
}

export function createCourseVerificationTrigger(
  goal: CourseGoal,
  input: {
    candidate: Omit<VerificationComparableEntry, 'overallRank'>;
    currentTopEntries: VerificationComparableEntry[];
    viewerEntry: VerificationComparableEntry | null;
    pointAwardPotential?: boolean;
  }
): RunVerificationTriggerResult {
  return createGenericVerificationTrigger({
    ...input,
    rankingMode: getCourseLeaderboardRankingMode(goal),
    compare: (left, right) => compareCourseLeaderboardEntries(left, right, goal),
  });
}

export async function verifyRoomRunTrace(input: {
  trace: RankedRunVerificationTrace;
  binding: RunVerificationBinding;
  room: RoomSnapshot;
  elapsedMs: number;
}): Promise<RunVerificationResult> {
  const deadline = Date.now() + VERIFICATION_TIMEOUT_MS;
  const validated = validateTraceEnvelope(input.trace, input.binding, input.elapsedMs);
  if (validated.status !== 'passed') {
    return validated;
  }

  const trace = input.trace;
  const pathCheck = verifyPath(trace.breadcrumbs, trace.roomTransitions, deadline);
  if (pathCheck) {
    return pathCheck;
  }

  const derivedMetrics = deriveRoomMetricsFromTrace(
    input.room,
    trace.breadcrumbs,
    trace.goalEvents,
    deadline,
  );
  if ('status' in derivedMetrics) {
    return derivedMetrics;
  }

  return {
    status: 'passed',
    reason: null,
    derivedMetrics,
    summary: {
      schemaVersion: trace.schemaVersion,
      breadcrumbs: trace.breadcrumbs.length,
      inputEvents: trace.inputEvents.length,
      goalEvents: trace.goalEvents.length,
      roomTransitions: trace.roomTransitions.length,
      traceDurationMs: trace.traceDurationMs,
    },
  };
}

export async function verifyCourseRunTrace(input: {
  trace: RankedRunVerificationTrace;
  binding: RunVerificationBinding;
  course: CourseSnapshot;
  roomsById: Map<string, RoomSnapshot>;
  elapsedMs: number;
}): Promise<RunVerificationResult> {
  const deadline = Date.now() + VERIFICATION_TIMEOUT_MS;
  const validated = validateTraceEnvelope(input.trace, input.binding, input.elapsedMs);
  if (validated.status !== 'passed') {
    return validated;
  }

  const trace = input.trace;
  const pathCheck = verifyPath(trace.breadcrumbs, trace.roomTransitions, deadline);
  if (pathCheck) {
    return pathCheck;
  }

  const derivedMetrics = deriveCourseMetricsFromTrace(
    input.course,
    input.roomsById,
    trace.breadcrumbs,
    trace.goalEvents,
    deadline,
  );
  if ('status' in derivedMetrics) {
    return derivedMetrics;
  }

  return {
    status: 'passed',
    reason: null,
    derivedMetrics,
    summary: {
      schemaVersion: trace.schemaVersion,
      breadcrumbs: trace.breadcrumbs.length,
      inputEvents: trace.inputEvents.length,
      goalEvents: trace.goalEvents.length,
      roomTransitions: trace.roomTransitions.length,
      traceDurationMs: trace.traceDurationMs,
    },
  };
}

export async function recordRunVerificationAudit(
  env: Env,
  input: RunVerificationAuditInput
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO run_verification_audit (
          attempt_id,
          run_kind,
          status,
          trigger_reason,
          verification_reason,
          summary_json,
          trace_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      input.attemptId,
      input.kind,
      input.status,
      input.triggerReason,
      input.verificationReason,
      JSON.stringify(input.summary),
      input.trace ? JSON.stringify(input.trace) : null,
      input.createdAt
    ),
  ]);
}

function createGenericVerificationTrigger(input: {
  candidate: Omit<VerificationComparableEntry, 'overallRank'>;
  currentTopEntries: VerificationComparableEntry[];
  viewerEntry: VerificationComparableEntry | null;
  rankingMode: LeaderboardRankingMode;
  compare: (left: VerificationComparableEntry, right: VerificationComparableEntry) => number;
  pointAwardPotential?: boolean;
}): RunVerificationTriggerResult {
  const currentBest = input.currentTopEntries[0] ?? null;
  const previousRank = input.viewerEntry?.overallRank ?? null;
  const candidate: VerificationComparableEntry = {
    ...input.candidate,
    overallRank: null,
  };
  const comparisonPool = input.currentTopEntries.filter((entry) => entry.userId !== candidate.userId);
  let betterEntryCount = 0;
  for (const entry of comparisonPool) {
    if (input.compare(entry, candidate) < 0) {
      betterEntryCount += 1;
    }
  }
  const normalizedPredictedRank = betterEntryCount + 1;

  const takesTopOne = normalizedPredictedRank === 1 && previousRank !== 1;
  const entersTopTen =
    normalizedPredictedRank !== null &&
    normalizedPredictedRank <= 10 &&
    (previousRank === null || previousRank > 10);

  let recordGap = false;
  let improvementMs: number | null = null;
  let improvementRatio: number | null = null;
  let improvementScore: number | null = null;

  if (currentBest && input.compare(candidate, currentBest) < 0) {
    if (input.rankingMode === 'time') {
      improvementMs = currentBest.elapsedMs - candidate.elapsedMs;
      improvementRatio =
        currentBest.elapsedMs > 0 ? improvementMs / currentBest.elapsedMs : null;
      recordGap =
        improvementMs >= 3_000 &&
        improvementRatio !== null &&
        improvementRatio >= 0.3;
    } else {
      improvementScore = candidate.score - currentBest.score;
      improvementRatio =
        currentBest.score > 0 ? improvementScore / currentBest.score : improvementScore > 0 ? 1 : 0;
      recordGap =
        improvementScore >= 100 &&
        improvementRatio >= 0.2;
    }
  }

  const pointAwardPotential = Boolean(input.pointAwardPotential);

  return {
    required: takesTopOne || entersTopTen || recordGap || pointAwardPotential,
    reason: takesTopOne
      ? 'take_top_1'
      : entersTopTen
        ? 'enter_top_10'
        : recordGap
          ? 'record_gap'
          : pointAwardPotential
            ? 'point_gain'
            : null,
    predictedRank: normalizedPredictedRank,
    previousRank,
    improvementMs,
    improvementRatio,
    improvementScore,
    previousBestElapsedMs: currentBest?.elapsedMs ?? null,
    previousBestScore: currentBest?.score ?? null,
    pointAwardPotential,
  };
}

function validateTraceEnvelope(
  trace: RankedRunVerificationTrace,
  binding: RunVerificationBinding,
  elapsedMs: number
): RunVerificationResult {
  if (trace.schemaVersion !== RANKED_RUN_TRACE_SCHEMA_VERSION) {
    return createFailedVerification('failed', 'trace_client_outdated', {
      expectedSchemaVersion: RANKED_RUN_TRACE_SCHEMA_VERSION,
      receivedSchemaVersion: trace.schemaVersion,
    });
  }

  if (!binding.verificationNonce || !binding.verificationSnapshotHash) {
    return createFailedVerification('failed', 'trace_invalid', {
      issue: 'missing_binding',
    });
  }

  if (trace.verificationNonce !== binding.verificationNonce) {
    return createFailedVerification('failed', 'trace_nonce', {
      expectedVerificationNonce: binding.verificationNonce,
      receivedVerificationNonce: trace.verificationNonce,
    });
  }

  if (trace.snapshotHash !== binding.verificationSnapshotHash) {
    return createFailedVerification('failed', 'trace_snapshot', {
      expectedSnapshotHash: binding.verificationSnapshotHash,
      receivedSnapshotHash: trace.snapshotHash,
    });
  }

  if (
    trace.inputEvents.length > MAX_INPUT_EVENTS ||
    trace.breadcrumbs.length > MAX_BREADCRUMBS ||
    trace.roomTransitions.length > MAX_ROOM_TRANSITIONS ||
    trace.goalEvents.length > MAX_GOAL_EVENTS
  ) {
    return createFailedVerification('failed', 'trace_size', {
      inputEvents: trace.inputEvents.length,
      breadcrumbs: trace.breadcrumbs.length,
      roomTransitions: trace.roomTransitions.length,
      goalEvents: trace.goalEvents.length,
    });
  }

  if (trace.traceDurationMs < 0 || trace.traceDurationMs > MAX_TRACE_DURATION_MS) {
    return createFailedVerification('failed', 'trace_duration', {
      traceDurationMs: trace.traceDurationMs,
    });
  }

  if (Math.abs(trace.traceDurationMs - elapsedMs) > TRACE_ELAPSED_TOLERANCE_MS) {
    return createFailedVerification('failed', 'trace_duration', {
      traceDurationMs: trace.traceDurationMs,
      elapsedMs,
    });
  }

  if (!isMonotonic(trace.inputEvents.map((entry) => entry.atMs), trace.traceDurationMs)) {
    return createFailedVerification('failed', 'trace_time', { field: 'inputEvents' });
  }
  if (!isMonotonic(trace.breadcrumbs.map((entry) => entry.atMs), trace.traceDurationMs)) {
    return createFailedVerification('failed', 'trace_time', { field: 'breadcrumbs' });
  }
  if (!isMonotonic(trace.roomTransitions.map((entry) => entry.atMs), trace.traceDurationMs)) {
    return createFailedVerification('failed', 'trace_time', { field: 'roomTransitions' });
  }
  if (!isMonotonic(trace.goalEvents.map((entry) => entry.atMs), trace.traceDurationMs)) {
    return createFailedVerification('failed', 'trace_time', { field: 'goalEvents' });
  }

  return {
    status: 'passed',
    reason: null,
    derivedMetrics: {
      collectiblesCollected: 0,
      enemiesDefeated: 0,
      checkpointsReached: 0,
    },
    summary: {},
  };
}

function verifyPath(
  breadcrumbs: RankedRunTraceBreadcrumb[],
  roomTransitions: RankedRunTraceRoomTransition[],
  deadline: number
): RunVerificationResult | null {
  for (let index = 1; index < breadcrumbs.length; index += 1) {
    if (Date.now() > deadline) {
      return createFailedVerification('timeout', 'trace_timeout', {
        phase: 'path',
      });
    }

    const previous = breadcrumbs[index - 1];
    const current = breadcrumbs[index];
    const deltaMs = current.atMs - previous.atMs;
    if (deltaMs <= 0) {
      return createFailedVerification('failed', 'trace_time', {
        field: 'breadcrumbs',
        atIndex: index,
      });
    }

    const worldDelta = getWorldDelta(previous, current);
    const seconds = deltaMs / 1000;
    if (Math.abs(worldDelta.dx) > MAX_HORIZONTAL_SPEED_PX_PER_SEC * seconds + POSITION_SLACK_PX) {
      return createFailedVerification('failed', 'trace_path', {
        axis: 'x',
        deltaPx: worldDelta.dx,
        deltaMs,
      });
    }
    if (Math.abs(worldDelta.dy) > MAX_VERTICAL_SPEED_PX_PER_SEC * seconds + POSITION_SLACK_PX) {
      return createFailedVerification('failed', 'trace_path', {
        axis: 'y',
        deltaPx: worldDelta.dy,
        deltaMs,
      });
    }

    const distance = Math.hypot(worldDelta.dx, worldDelta.dy);
    if (distance > MAX_TOTAL_SPEED_PX_PER_SEC * seconds + POSITION_SLACK_PX) {
      return createFailedVerification('failed', 'trace_path', {
        axis: 'distance',
        deltaPx: distance,
        deltaMs,
      });
    }

    const roomDistance =
      Math.abs(current.roomX - previous.roomX) + Math.abs(current.roomY - previous.roomY);
    if (roomDistance > 1) {
      return createFailedVerification('failed', 'trace_transition', {
        fromRoomX: previous.roomX,
        fromRoomY: previous.roomY,
        toRoomX: current.roomX,
        toRoomY: current.roomY,
      });
    }
  }

  for (const transition of roomTransitions) {
    if (Date.now() > deadline) {
      return createFailedVerification('timeout', 'trace_timeout', {
        phase: 'transitions',
      });
    }

    const roomDistance =
      Math.abs(transition.toRoomX - transition.fromRoomX) +
      Math.abs(transition.toRoomY - transition.fromRoomY);
    if (roomDistance !== 1) {
      return createFailedVerification('failed', 'trace_transition', { ...transition });
    }
  }

  return null;
}

function deriveRoomMetricsFromTrace(
  room: RoomSnapshot,
  breadcrumbs: RankedRunTraceBreadcrumb[],
  goalEvents: RankedRunTraceGoalEvent[],
  deadline: number
): RunVerificationDerivedMetrics | RunVerificationResult {
  const collectibleIds = new Set<string>();
  const enemyIds = new Set<string>();
  const collectibleBindings = new Map<string, TraceObjectBinding>();
  const enemyBindings = new Map<string, TraceObjectBinding>();

  for (const placed of room.placedObjects) {
    if (placedObjectContributesToCategory(placed, 'collectible')) {
      collectibleIds.add(placed.instanceId);
      collectibleBindings.set(placed.instanceId, {
        x: placed.x,
        y: placed.y,
      });
    }
    if (placedObjectContributesToCategory(placed, 'enemy')) {
      enemyIds.add(placed.instanceId);
      enemyBindings.set(placed.instanceId, {
        x: placed.x,
        y: placed.y,
      });
    }
  }

  return deriveMetricsForGoal({
    goal: room.goal,
    breadcrumbs,
    goalEvents,
    deadline,
    allowedRoomIds: new Set([room.id]),
    roomCoordinatesById: new Map([[room.id, room.coordinates]]),
    collectibleIdsByRoomId: new Map([[room.id, collectibleIds]]),
    enemyIdsByRoomId: new Map([[room.id, enemyIds]]),
    collectibleBindingsByRoomId: new Map([[room.id, collectibleBindings]]),
    enemyBindingsByRoomId: new Map([[room.id, enemyBindings]]),
  });
}

function deriveCourseMetricsFromTrace(
  course: CourseSnapshot,
  roomsById: Map<string, RoomSnapshot>,
  breadcrumbs: RankedRunTraceBreadcrumb[],
  goalEvents: RankedRunTraceGoalEvent[],
  deadline: number
): RunVerificationDerivedMetrics | RunVerificationResult {
  const allowedRoomIds = new Set<string>();
  const roomCoordinatesById = new Map<string, RoomCoordinates>();
  const collectibleIdsByRoomId = new Map<string, Set<string>>();
  const enemyIdsByRoomId = new Map<string, Set<string>>();
  const collectibleBindingsByRoomId = new Map<string, Map<string, TraceObjectBinding>>();
  const enemyBindingsByRoomId = new Map<string, Map<string, TraceObjectBinding>>();

  for (const roomRef of course.roomRefs) {
    const room = roomsById.get(roomRef.roomId);
    if (!room) {
      continue;
    }
    allowedRoomIds.add(room.id);
    roomCoordinatesById.set(room.id, room.coordinates);
    collectibleIdsByRoomId.set(
      room.id,
      new Set(
        room.placedObjects
          .filter((placed) => placedObjectContributesToCategory(placed, 'collectible'))
          .map((placed) => placed.instanceId)
      )
    );
    collectibleBindingsByRoomId.set(
      room.id,
      new Map(
        room.placedObjects
          .filter((placed) => placedObjectContributesToCategory(placed, 'collectible'))
          .map((placed) => [
            placed.instanceId,
            {
              x: placed.x,
              y: placed.y,
            } satisfies TraceObjectBinding,
          ])
      )
    );
    enemyIdsByRoomId.set(
      room.id,
      new Set(
        room.placedObjects
          .filter((placed) => placedObjectContributesToCategory(placed, 'enemy'))
          .map((placed) => placed.instanceId)
      )
    );
    enemyBindingsByRoomId.set(
      room.id,
      new Map(
        room.placedObjects
          .filter((placed) => placedObjectContributesToCategory(placed, 'enemy'))
          .map((placed) => [
            placed.instanceId,
            {
              x: placed.x,
              y: placed.y,
            } satisfies TraceObjectBinding,
          ])
      )
    );
  }

  return deriveMetricsForGoal({
    goal: course.goal,
    breadcrumbs,
    goalEvents,
    deadline,
    allowedRoomIds,
    roomCoordinatesById,
    collectibleIdsByRoomId,
    enemyIdsByRoomId,
    collectibleBindingsByRoomId,
    enemyBindingsByRoomId,
  });
}

function deriveMetricsForGoal(input: {
  goal: RoomSnapshot['goal'] | CourseSnapshot['goal'];
  breadcrumbs: RankedRunTraceBreadcrumb[];
  goalEvents: RankedRunTraceGoalEvent[];
  deadline: number;
  allowedRoomIds: Set<string>;
  roomCoordinatesById: Map<string, RoomCoordinates>;
  collectibleIdsByRoomId: Map<string, Set<string>>;
  enemyIdsByRoomId: Map<string, Set<string>>;
  collectibleBindingsByRoomId: Map<string, Map<string, TraceObjectBinding>>;
  enemyBindingsByRoomId: Map<string, Map<string, TraceObjectBinding>>;
}): RunVerificationDerivedMetrics | RunVerificationResult {
  const collectibleIds = new Set<string>();
  const enemyIds = new Set<string>();
  const checkpoints = new Set<number>();
  let reachedExit = false;
  let reachedFinish = false;

  const burstCheck = verifyGoalEventBurstPattern(input.goalEvents, input.breadcrumbs);
  if (burstCheck) {
    return burstCheck;
  }

  for (const event of input.goalEvents) {
    if (Date.now() > input.deadline) {
      return createFailedVerification('timeout', 'trace_timeout', {
        phase: 'goal_events',
      });
    }

    if (event.roomId && !input.allowedRoomIds.has(event.roomId)) {
      return createFailedVerification('failed', 'trace_goal', {
        issue: 'unknown_room',
        roomId: event.roomId,
      });
    }

    if (event.roomId) {
      const coordinates = input.roomCoordinatesById.get(event.roomId);
      if (
        coordinates &&
        (coordinates.x !== event.roomX || coordinates.y !== event.roomY)
      ) {
        return createFailedVerification('failed', 'trace_goal', {
          issue: 'room_coordinate_mismatch',
          roomId: event.roomId,
          roomX: event.roomX,
          roomY: event.roomY,
        });
      }
    }

    const pathDistance = getGoalEventPathDistance(event, input.breadcrumbs);
    if (pathDistance === null || pathDistance.distancePx > pathDistance.maxDistancePx) {
      return createFailedVerification('failed', 'trace_goal', {
        issue: 'goal_event_path_mismatch',
        type: event.type,
        roomId: event.roomId,
        atMs: event.atMs,
        distancePx: pathDistance?.distancePx ?? null,
        maxDistancePx: pathDistance?.maxDistancePx ?? null,
      });
    }

    switch (event.type) {
      case 'collectible':
        if (!event.roomId || !event.instanceId) {
          return createFailedVerification('failed', 'trace_goal', {
            issue: 'collectible_missing_binding',
          });
        }
        if (!input.collectibleIdsByRoomId.get(event.roomId)?.has(event.instanceId)) {
          return createFailedVerification('failed', 'trace_goal', {
            issue: 'collectible_unknown_instance',
            roomId: event.roomId,
            instanceId: event.instanceId,
          });
        }
        {
          const binding = input.collectibleBindingsByRoomId.get(event.roomId)?.get(event.instanceId);
          if (
            !binding ||
            !isEventNearBoundObject(event, binding)
          ) {
            return createFailedVerification('failed', 'trace_goal', {
              issue: 'collectible_position_mismatch',
              roomId: event.roomId,
              instanceId: event.instanceId,
              eventX: event.x,
              eventY: event.y,
              bindingX: binding?.x ?? null,
              bindingY: binding?.y ?? null,
            });
          }
        }
        collectibleIds.add(`${event.roomId}:${event.instanceId}`);
        break;
      case 'enemy':
        if (!event.roomId || !event.instanceId) {
          return createFailedVerification('failed', 'trace_goal', {
            issue: 'enemy_missing_binding',
          });
        }
        if (!input.enemyIdsByRoomId.get(event.roomId)?.has(event.instanceId)) {
          return createFailedVerification('failed', 'trace_goal', {
            issue: 'enemy_unknown_instance',
            roomId: event.roomId,
            instanceId: event.instanceId,
          });
        }
        {
          const binding = input.enemyBindingsByRoomId.get(event.roomId)?.get(event.instanceId);
          if (
            !binding ||
            !isEventNearBoundObject(event, binding)
          ) {
            return createFailedVerification('failed', 'trace_goal', {
              issue: 'enemy_position_mismatch',
              roomId: event.roomId,
              instanceId: event.instanceId,
              eventX: event.x,
              eventY: event.y,
              bindingX: binding?.x ?? null,
              bindingY: binding?.y ?? null,
            });
          }
        }
        enemyIds.add(`${event.roomId}:${event.instanceId}`);
        break;
      case 'checkpoint':
        if (typeof event.checkpointIndex !== 'number' || event.checkpointIndex < 0) {
          return createFailedVerification('failed', 'trace_goal', {
            issue: 'checkpoint_index',
          });
        }
        checkpoints.add(event.checkpointIndex);
        break;
      case 'reach_exit':
        reachedExit = true;
        break;
      case 'finish':
      case 'complete':
        reachedFinish = true;
        break;
    }
  }

  const goal = input.goal;
  if (!goal) {
    return {
      collectiblesCollected: collectibleIds.size,
      enemiesDefeated: enemyIds.size,
      checkpointsReached: checkpoints.size,
    };
  }

  switch (goal.type) {
    case 'reach_exit':
      if (!hasGoalEventNearMarker(input.goalEvents, 'reach_exit', goal.exit ?? null)) {
        return createFailedVerification('failed', 'trace_goal', {
          issue: 'missing_exit',
        });
      }
      break;
    case 'collect_target':
      if (collectibleIds.size < goal.requiredCount) {
        return createFailedVerification('failed', 'trace_goal', {
          issue: 'collect_target_shortfall',
          requiredCount: goal.requiredCount,
          collectedCount: collectibleIds.size,
        });
      }
      break;
    case 'defeat_all':
      if (enemyIds.size < totalCountFromMap(input.enemyIdsByRoomId)) {
        return createFailedVerification('failed', 'trace_goal', {
          issue: 'defeat_all_shortfall',
          requiredCount: totalCountFromMap(input.enemyIdsByRoomId),
          defeatedCount: enemyIds.size,
        });
      }
      break;
    case 'checkpoint_sprint':
      if (checkpoints.size < goal.checkpoints.length) {
        return createFailedVerification('failed', 'trace_goal', {
          issue: 'checkpoint_shortfall',
          requiredCount: goal.checkpoints.length,
          reachedCount: checkpoints.size,
        });
      }
      if (!reachedFinish && !hasGoalEventNearMarker(input.goalEvents, 'finish', goal.finish ?? null)) {
        return createFailedVerification('failed', 'trace_goal', {
          issue: 'missing_finish',
        });
      }
      break;
    case 'survival':
      break;
  }

  return {
    collectiblesCollected: collectibleIds.size,
    enemiesDefeated: enemyIds.size,
    checkpointsReached: checkpoints.size,
  };
}

function hasGoalEventNearMarker(
  goalEvents: RankedRunTraceGoalEvent[],
  type: RankedRunTraceGoalEvent['type'],
  point: GoalMarkerPoint | CourseMarkerPoint | null
): boolean {
  if (!point) {
    return goalEvents.some((event) => event.type === type);
  }

  return goalEvents.some(
    (event) =>
      event.type === type &&
      (!('roomId' in point) || point.roomId === event.roomId) &&
      Math.abs(event.x - point.x) <= GOAL_EVENT_RADIUS_PX &&
      Math.abs(event.y - point.y) <= GOAL_EVENT_RADIUS_PX
  );
}

function isEventNearBoundObject(
  event: RankedRunTraceGoalEvent,
  binding: TraceObjectBinding,
): boolean {
  return (
    Math.abs(event.x - binding.x) <= GOAL_EVENT_OBJECT_RADIUS_PX &&
    Math.abs(event.y - binding.y) <= GOAL_EVENT_OBJECT_RADIUS_PX
  );
}

function getGoalEventPathDistance(
  event: RankedRunTraceGoalEvent,
  breadcrumbs: RankedRunTraceBreadcrumb[],
): { distancePx: number; maxDistancePx: number } | null {
  const matching = breadcrumbs.filter(
    (breadcrumb) => breadcrumb.roomX === event.roomX && breadcrumb.roomY === event.roomY,
  );
  if (matching.length === 0) {
    return null;
  }

  let previous: RankedRunTraceBreadcrumb | null = null;
  let next: RankedRunTraceBreadcrumb | null = null;
  for (const breadcrumb of matching) {
    if (breadcrumb.atMs <= event.atMs) {
      previous = breadcrumb;
      continue;
    }
    next = breadcrumb;
    break;
  }

  if (previous && next && next.atMs > previous.atMs) {
    const progress = (event.atMs - previous.atMs) / (next.atMs - previous.atMs);
    const estimatedX = previous.x + (next.x - previous.x) * progress;
    const estimatedY = previous.y + (next.y - previous.y) * progress;
    return {
      distancePx: Math.hypot(event.x - estimatedX, event.y - estimatedY),
      maxDistancePx: GOAL_EVENT_INTERPOLATED_PATH_RADIUS_PX,
    };
  }

  let nearest = matching[0];
  let nearestTimeDelta = Math.abs(event.atMs - nearest.atMs);
  for (let index = 1; index < matching.length; index += 1) {
    const breadcrumb = matching[index];
    const delta = Math.abs(event.atMs - breadcrumb.atMs);
    if (delta < nearestTimeDelta) {
      nearest = breadcrumb;
      nearestTimeDelta = delta;
    }
  }

  return {
    distancePx: Math.hypot(event.x - nearest.x, event.y - nearest.y),
    maxDistancePx: GOAL_EVENT_NEAREST_PATH_RADIUS_PX,
  };
}

function verifyGoalEventBurstPattern(
  goalEvents: RankedRunTraceGoalEvent[],
  breadcrumbs: RankedRunTraceBreadcrumb[],
): RunVerificationResult | null {
  if (goalEvents.length < GOAL_EVENT_BURST_MIN_COUNT || breadcrumbs.length === 0) {
    return null;
  }

  const countsByAtMs = new Map<number, number>();
  for (const event of goalEvents) {
    countsByAtMs.set(event.atMs, (countsByAtMs.get(event.atMs) ?? 0) + 1);
  }

  let dominantAtMs = 0;
  let dominantCount = 0;
  for (const [atMs, count] of countsByAtMs) {
    if (count > dominantCount) {
      dominantAtMs = atMs;
      dominantCount = count;
    }
  }

  const dominantRatio = dominantCount / goalEvents.length;
  if (
    dominantCount < GOAL_EVENT_BURST_MIN_COUNT ||
    dominantRatio < GOAL_EVENT_BURST_MIN_RATIO
  ) {
    return null;
  }

  const windowStart = Math.max(0, dominantAtMs - GOAL_EVENT_BURST_STATIONARY_LOOKBACK_MS);
  const windowBreadcrumbs = breadcrumbs.filter(
    (breadcrumb) => breadcrumb.atMs >= windowStart && breadcrumb.atMs <= dominantAtMs,
  );
  if (windowBreadcrumbs.length < 2) {
    return null;
  }

  let travelPx = 0;
  for (let index = 1; index < windowBreadcrumbs.length; index += 1) {
    const previous = windowBreadcrumbs[index - 1];
    const current = windowBreadcrumbs[index];
    const delta = getWorldDelta(previous, current);
    travelPx += Math.hypot(delta.dx, delta.dy);
  }

  if (travelPx > GOAL_EVENT_BURST_STATIONARY_MAX_TRAVEL_PX) {
    return null;
  }

  return createFailedVerification('failed', 'trace_goal', {
    issue: 'goal_event_burst_while_stationary',
    dominantAtMs,
    dominantCount,
    dominantRatio,
    stationaryLookbackMs: GOAL_EVENT_BURST_STATIONARY_LOOKBACK_MS,
    stationaryTravelPx: travelPx,
  });
}

function totalCountFromMap(map: Map<string, Set<string>>): number {
  let total = 0;
  for (const value of map.values()) {
    total += value.size;
  }
  return total;
}

function getWorldDelta(
  previous: RankedRunTraceBreadcrumb,
  current: RankedRunTraceBreadcrumb
): { dx: number; dy: number } {
  const previousWorldX = previous.roomX * ROOM_PX_WIDTH + previous.x;
  const previousWorldY = previous.roomY * ROOM_PX_HEIGHT + previous.y;
  const currentWorldX = current.roomX * ROOM_PX_WIDTH + current.x;
  const currentWorldY = current.roomY * ROOM_PX_HEIGHT + current.y;
  return {
    dx: currentWorldX - previousWorldX,
    dy: currentWorldY - previousWorldY,
  };
}

function isMonotonic(values: number[], maxValue: number): boolean {
  let previous = -1;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0 || value > maxValue || value < previous) {
      return false;
    }
    previous = value;
  }
  return true;
}

function createFailedVerification(
  status: Exclude<RunVerificationStatus, 'not_required' | 'passed'>,
  reason: RunVerificationFailureReason,
  summary: Record<string, unknown>
): RunVerificationResult {
  return {
    status,
    reason,
    derivedMetrics: {
      collectiblesCollected: 0,
      enemiesDefeated: 0,
      checkpointsReached: 0,
    },
    summary,
  };
}

async function hashVerificationPayload(payload: Record<string, unknown>): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
