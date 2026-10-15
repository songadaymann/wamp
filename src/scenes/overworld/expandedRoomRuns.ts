import { expandedRoomGoalTargets, tickExpandedRoomGoal, expandedRoomGoalMarkersReady } from './expandedRoomGoalRules';
import { NOOP_MUTATION_RESULT, createTerminalMutation, recordExpandedRoomTargetEvent } from './expandedRoomRunMutations';
import type { ExpandedRoomRunMutationResult } from './expandedRoomRunMutations';
export type { ExpandedRoomRunMutationResult } from './expandedRoomRunMutations';
import type { GameObjectConfig } from '../../config';
import type {
  CourseGoal,
  CourseMarkerPoint,
  CourseSnapshot,
} from '../../courses/model';
import { COURSE_GOAL_DEFINITIONS, courseGoalRequiresStartPoint } from '../../courses/model';
import { formatGoalBadgeText, formatCourseGoalProgressText, formatGoalTimerText } from '../../goals/goalSchema';
import type { GoalMarkerPoint } from '../../goals/roomGoals';
import type { RoomCoordinates } from '../../persistence/roomModel';
import type { GuestRunSaveResult } from '../../guestRooms/runService';

export interface ActiveExpandedRoomRunState {
  course: CourseSnapshot;
  expandedRoomId: string | null;
  expandedRoomVersion: number | null;
  submissionTarget: 'course' | 'expanded_room' | null;
  returnCoordinates: RoomCoordinates;
  startRoomId: string | null;
  elapsedMs: number;
  deaths: number;
  collectiblesCollected: number;
  collectibleTarget: number | null;
  enemiesDefeated: number;
  enemyTarget: number | null;
  checkpointsReached: number;
  checkpointTarget: number | null;
  nextCheckpointIndex: number;
  result: 'active' | 'completed' | 'failed';
  completionMessage: string | null;
  attemptId: string | null;
  submissionState: 'local-only' | 'starting' | 'active' | 'finishing' | 'submitted' | 'error';
  submissionMessage: string | null;
  pendingResult: 'completed' | 'failed' | 'abandoned' | null;
  submittedScore: number | null;
  leaderboardEligible: boolean;
  cooperative?: boolean;
  hadPreviousCompletion: boolean;
  previousViewerRank: number | null;
  verificationSchemaVersion: number | null;
  verificationNonce: string | null;
  snapshotHash: string | null;
  guestProgress?: GuestRunSaveResult;
}

export interface CreateActiveExpandedRoomRunStateOptions {
  course: CourseSnapshot;
  expandedRoomId?: string | null;
  expandedRoomVersion?: number | null;
  returnCoordinates: RoomCoordinates;
  startRoomId?: string | null;
  leaderboardEligible: boolean;
  cooperative?: boolean;
  hadPreviousCompletion?: boolean;
  previousViewerRank?: number | null;
  enemyTarget: number | null;
  localOnlyMessage?: string | null;
}

export interface TickActiveExpandedRoomRunOptions {
  delta: number;
  suspendGoalResolution?: boolean;
  touchesCoursePoint: (point: CourseMarkerPoint) => boolean;
  getPlayerEffectOrigin: () => GoalMarkerPoint | null;
}

export function createActiveExpandedRoomRunState(
  options: CreateActiveExpandedRoomRunStateOptions,
): ActiveExpandedRoomRunState {
  const {
    course,
    expandedRoomId = null,
    expandedRoomVersion = null,
    returnCoordinates,
    startRoomId = null,
    leaderboardEligible,
    cooperative = false,
    hadPreviousCompletion = false,
    previousViewerRank = null,
    enemyTarget,
    localOnlyMessage,
  } = options;
  const targets = expandedRoomGoalTargets(course.goal);
  return {
    course,
    expandedRoomId,
    expandedRoomVersion,
    submissionTarget: null,
    returnCoordinates: { ...returnCoordinates },
    startRoomId,
    elapsedMs: 0,
    deaths: 0,
    collectiblesCollected: 0,
    collectibleTarget: targets.collectibleTarget,
    enemiesDefeated: 0,
    enemyTarget,
    checkpointsReached: 0,
    checkpointTarget: targets.checkpointTarget,
    nextCheckpointIndex: 0,
    result: 'active',
    completionMessage: null,
    attemptId: null,
    submissionState: leaderboardEligible ? 'starting' : 'local-only',
    submissionMessage: leaderboardEligible
      ? 'Starting ranked expanded room run...'
      : localOnlyMessage ?? 'Expanded room run stays local.',
    pendingResult: null,
    submittedScore: null,
    leaderboardEligible,
    cooperative,
    hadPreviousCompletion,
    previousViewerRank,
    verificationSchemaVersion: null,
    verificationNonce: null,
    snapshotHash: null,
  };
}

export function tickActiveExpandedRoomRun(
  runState: ActiveExpandedRoomRunState | null,
  options: TickActiveExpandedRoomRunOptions,
): ExpandedRoomRunMutationResult {
  if (!runState || runState.result !== 'active') {
    return NOOP_MUTATION_RESULT;
  }

  runState.elapsedMs += options.delta;
  if (options.suspendGoalResolution) return NOOP_MUTATION_RESULT;
  const goal = runState.course.goal;
  if (!goal) {
    return NOOP_MUTATION_RESULT;
  }

  if ('timeLimitMs' in goal && goal.timeLimitMs !== null && runState.elapsedMs >= goal.timeLimitMs) {
    return createTerminalMutation('failed', 'Time up.');
  }

  return tickExpandedRoomGoal(goal, runState, options);
}

export function recordExpandedRoomRunDeath(runState: ActiveExpandedRoomRunState | null): void {
  if (!runState || runState.result !== 'active') {
    return;
  }

  runState.deaths += 1;
}

export function recordExpandedRoomRunEnemyDefeated(runState: ActiveExpandedRoomRunState | null): ExpandedRoomRunMutationResult {
  return recordExpandedRoomTargetEvent(runState, 'enemyDefeated');
}

export function recordExpandedRoomRunCollectibleCollected(runState: ActiveExpandedRoomRunState | null): ExpandedRoomRunMutationResult {
  return recordExpandedRoomTargetEvent(runState, 'collectibleCollected');
}

export function getExpandedRoomGoalBadgeText(goal: CourseGoal | null): string {
  return goal ? formatGoalBadgeText(goal, COURSE_GOAL_DEFINITIONS) : 'Expanded Room';
}

export function getExpandedRoomGoalTimerText(
  runState: ActiveExpandedRoomRunState,
  formatTimer: (ms: number) => string,
): string {
  const goal = runState.course.goal;
  return goal ? formatGoalTimerText(goal, COURSE_GOAL_DEFINITIONS, runState.elapsedMs, formatTimer)
    : formatTimer(runState.elapsedMs);
}

export function getExpandedRoomGoalProgressText(runState: ActiveExpandedRoomRunState): string {
  const goal = runState.course.goal;
  return goal ? formatCourseGoalProgressText(goal, COURSE_GOAL_DEFINITIONS, runState) : '';
}

export type ExpandedRoomObjectCounter = (
  course: CourseSnapshot,
  category: GameObjectConfig['category'],
) => number;

export function isExpandedRoomDraftPreviewReady(
  course: CourseSnapshot | null,
  activeRoomId: string,
): boolean {
  if (!course?.goal) {
    return false;
  }

  if (courseGoalRequiresStartPoint(course.goal) && !course.startPoint) {
    return false;
  }

  if (!course.roomRefs.some((roomRef) => roomRef.roomId === activeRoomId)) {
    return false;
  }

  return expandedRoomGoalMarkersReady(course.goal);
}
