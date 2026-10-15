import type { CourseMarkerPoint } from '../../courses/model';
import type { GoalMarkerPoint } from '../../goals/roomGoals';
import type { ActiveExpandedRoomRunState } from './expandedRoomRuns';

export interface ExpandedRoomRunMutationResult {
  changed: boolean;
  goalMarkersChanged: boolean;
  transientStatus: string | null;
  terminalResult: 'completed' | 'failed' | null;
  terminalMessage: string | null;
  checkpointEffectOrigin: GoalMarkerPoint | null;
  verificationGoalEvent:
    | {
        type: 'checkpoint' | 'reach_exit' | 'finish';
        marker: CourseMarkerPoint;
        checkpointIndex: number | null;
      }
    | null;
}

export const NOOP_MUTATION_RESULT: ExpandedRoomRunMutationResult = {
  changed: false,
  goalMarkersChanged: false,
  transientStatus: null,
  terminalResult: null,
  terminalMessage: null,
  checkpointEffectOrigin: null,
  verificationGoalEvent: null,
};

export function createTerminalMutation(
  terminalResult: 'completed' | 'failed',
  terminalMessage: string,
): ExpandedRoomRunMutationResult {
  return {
    changed: true,
    goalMarkersChanged: false,
    transientStatus: null,
    terminalResult,
    terminalMessage,
    checkpointEffectOrigin: null,
    verificationGoalEvent: null,
  };
}

const TARGET_EVENTS = {
  enemyDefeated: { counter: 'enemiesDefeated', target: 'enemyTarget', completion: 'All enemies defeated.' },
  collectibleCollected: { counter: 'collectiblesCollected', target: 'collectibleTarget', completion: 'Collection target reached.' },
} as const;

/** Caller-provided targets own eligibility, including legacy or goal-less runs. */
export function recordExpandedRoomTargetEvent(
  runState: ActiveExpandedRoomRunState | null,
  event: keyof typeof TARGET_EVENTS,
): ExpandedRoomRunMutationResult {
  const rule = TARGET_EVENTS[event];
  if (!runState || runState.result !== 'active' || runState[rule.target] === null) return NOOP_MUTATION_RESULT;
  const target = runState[rule.target];
  runState[rule.counter] += 1;
  if (target !== null && runState[rule.counter] >= target) return createTerminalMutation('completed', rule.completion);
  return { ...NOOP_MUTATION_RESULT, changed: true };
}
