import type { GameObjectConfig } from '../../config';
import type {
  CourseGoal,
  CourseMarkerPoint,
  CourseSnapshot,
} from '../../courses/model';
import { courseGoalRequiresStartPoint } from '../../courses/model';
import type { GoalMarkerPoint } from '../../goals/roomGoals';
import type { RoomCoordinates } from '../../persistence/roomModel';

export interface ActiveCourseRunState {
  course: CourseSnapshot;
  returnCoordinates: RoomCoordinates;
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
}

export interface CreateActiveCourseRunStateOptions {
  course: CourseSnapshot;
  returnCoordinates: RoomCoordinates;
  leaderboardEligible: boolean;
  enemyTarget: number | null;
  localOnlyMessage?: string | null;
}

export interface CourseRunMutationResult {
  changed: boolean;
  goalMarkersChanged: boolean;
  transientStatus: string | null;
  terminalResult: 'completed' | 'failed' | null;
  terminalMessage: string | null;
  checkpointEffectOrigin: GoalMarkerPoint | null;
}

export interface TickActiveCourseRunOptions {
  delta: number;
  touchesCoursePoint: (point: CourseMarkerPoint) => boolean;
  getPlayerEffectOrigin: () => GoalMarkerPoint | null;
}

const NOOP_MUTATION_RESULT: CourseRunMutationResult = {
  changed: false,
  goalMarkersChanged: false,
  transientStatus: null,
  terminalResult: null,
  terminalMessage: null,
  checkpointEffectOrigin: null,
};

export function createActiveCourseRunState(
  options: CreateActiveCourseRunStateOptions,
): ActiveCourseRunState {
  const {
    course,
    returnCoordinates,
    leaderboardEligible,
    enemyTarget,
    localOnlyMessage,
  } = options;
  return {
    course,
    returnCoordinates: { ...returnCoordinates },
    elapsedMs: 0,
    deaths: 0,
    collectiblesCollected: 0,
    collectibleTarget: course.goal?.type === 'collect_target' ? course.goal.requiredCount : null,
    enemiesDefeated: 0,
    enemyTarget,
    checkpointsReached: 0,
    checkpointTarget:
      course.goal?.type === 'checkpoint_sprint' ? course.goal.checkpoints.length : null,
    nextCheckpointIndex: 0,
    result: 'active',
    completionMessage: null,
    attemptId: null,
    submissionState: leaderboardEligible ? 'starting' : 'local-only',
    submissionMessage: leaderboardEligible
      ? 'Starting ranked course run...'
      : localOnlyMessage ?? 'Course run stays local.',
    pendingResult: null,
    submittedScore: null,
    leaderboardEligible,
  };
}

export function tickActiveCourseRun(
  runState: ActiveCourseRunState | null,
  options: TickActiveCourseRunOptions,
): CourseRunMutationResult {
  if (!runState || runState.result !== 'active') {
    return NOOP_MUTATION_RESULT;
  }

  runState.elapsedMs += options.delta;
  const goal = runState.course.goal;
  if (!goal) {
    return NOOP_MUTATION_RESULT;
  }

  if ('timeLimitMs' in goal && goal.timeLimitMs !== null && runState.elapsedMs >= goal.timeLimitMs) {
    return createTerminalMutation('failed', 'Time up.');
  }

  if (goal.type === 'survival' && runState.elapsedMs >= goal.durationMs) {
    return createTerminalMutation('completed', 'Course cleared.');
  }

  if (goal.type === 'reach_exit' && goal.exit && options.touchesCoursePoint(goal.exit)) {
    return createTerminalMutation('completed', 'Exit reached.');
  }

  if (goal.type !== 'checkpoint_sprint') {
    return NOOP_MUTATION_RESULT;
  }

  const nextCheckpoint = goal.checkpoints[runState.nextCheckpointIndex] ?? null;
  if (nextCheckpoint && options.touchesCoursePoint(nextCheckpoint)) {
    runState.nextCheckpointIndex += 1;
    runState.checkpointsReached += 1;
    return {
      changed: true,
      goalMarkersChanged: true,
      transientStatus: `Checkpoint ${runState.checkpointsReached} reached.`,
      terminalResult: null,
      terminalMessage: null,
      checkpointEffectOrigin: options.getPlayerEffectOrigin(),
    };
  }

  if (
    runState.nextCheckpointIndex >= goal.checkpoints.length &&
    goal.finish &&
    options.touchesCoursePoint(goal.finish)
  ) {
    return createTerminalMutation('completed', 'Sprint clear.');
  }

  return NOOP_MUTATION_RESULT;
}

export function recordCourseRunDeath(runState: ActiveCourseRunState | null): void {
  if (!runState || runState.result !== 'active') {
    return;
  }

  runState.deaths += 1;
}

export function recordCourseRunEnemyDefeated(
  runState: ActiveCourseRunState | null,
): CourseRunMutationResult {
  if (!runState || runState.result !== 'active' || runState.enemyTarget === null) {
    return NOOP_MUTATION_RESULT;
  }

  runState.enemiesDefeated += 1;
  if (runState.enemiesDefeated >= runState.enemyTarget) {
    return createTerminalMutation('completed', 'All enemies defeated.');
  }

  return {
    changed: true,
    goalMarkersChanged: false,
    transientStatus: null,
    terminalResult: null,
    terminalMessage: null,
    checkpointEffectOrigin: null,
  };
}

export function recordCourseRunCollectibleCollected(
  runState: ActiveCourseRunState | null,
): CourseRunMutationResult {
  if (!runState || runState.result !== 'active' || runState.collectibleTarget === null) {
    return NOOP_MUTATION_RESULT;
  }

  runState.collectiblesCollected += 1;
  if (runState.collectiblesCollected >= runState.collectibleTarget) {
    return createTerminalMutation('completed', 'Collection target reached.');
  }

  return {
    changed: true,
    goalMarkersChanged: false,
    transientStatus: null,
    terminalResult: null,
    terminalMessage: null,
    checkpointEffectOrigin: null,
  };
}

export function getCourseGoalBadgeText(goal: CourseGoal | null): string {
  if (!goal) {
    return 'Course';
  }

  switch (goal.type) {
    case 'reach_exit':
      return 'Reach Exit';
    case 'collect_target':
      return `Collect ${goal.requiredCount}`;
    case 'defeat_all':
      return 'Defeat All';
    case 'checkpoint_sprint':
      return `${goal.checkpoints.length || 0} Checkpoints`;
    case 'survival':
      return `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))}s`;
  }
}

export function getCourseGoalTimerText(
  runState: ActiveCourseRunState,
  formatTimer: (ms: number) => string,
): string {
  const goal = runState.course.goal;
  if (!goal) {
    return formatTimer(runState.elapsedMs);
  }

  if (goal.type === 'survival') {
    return `${formatTimer(Math.max(0, goal.durationMs - runState.elapsedMs))} LEFT`;
  }

  if ('timeLimitMs' in goal && goal.timeLimitMs !== null) {
    return `${formatTimer(Math.max(0, goal.timeLimitMs - runState.elapsedMs))} LEFT`;
  }

  return formatTimer(runState.elapsedMs);
}

export function getCourseGoalProgressText(runState: ActiveCourseRunState): string {
  const goal = runState.course.goal;
  if (!goal) {
    return '';
  }

  switch (goal.type) {
    case 'reach_exit':
      return runState.result === 'completed' ? 'Exit reached' : 'Reach the exit';
    case 'collect_target':
      return `${runState.collectiblesCollected}/${runState.collectibleTarget ?? goal.requiredCount} collected`;
    case 'defeat_all':
      return `${runState.enemiesDefeated}/${runState.enemyTarget ?? 0} defeated`;
    case 'checkpoint_sprint':
      return `${runState.checkpointsReached}/${runState.checkpointTarget ?? goal.checkpoints.length} checkpoints`;
    case 'survival':
      return runState.result === 'completed' ? 'Survived' : 'Stay alive';
  }
}

export type CourseObjectCounter = (
  course: CourseSnapshot,
  category: GameObjectConfig['category'],
) => number;

export function isCourseDraftPreviewReady(
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

  if (course.goal.type === 'reach_exit' && !course.goal.exit) {
    return false;
  }

  if (
    course.goal.type === 'checkpoint_sprint' &&
    (!course.goal.finish || course.goal.checkpoints.length === 0)
  ) {
    return false;
  }

  return true;
}

function createTerminalMutation(
  terminalResult: 'completed' | 'failed',
  terminalMessage: string,
): CourseRunMutationResult {
  return {
    changed: true,
    goalMarkersChanged: false,
    transientStatus: null,
    terminalResult,
    terminalMessage,
    checkpointEffectOrigin: null,
  };
}
