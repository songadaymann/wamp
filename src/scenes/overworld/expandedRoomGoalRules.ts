import type { CourseGoalType, CourseMarkerPoint } from '../../courses/model';
import type { Goal } from '../../goals/goalSchema';
import type { ActiveExpandedRoomRunState, TickActiveExpandedRoomRunOptions } from './expandedRoomRuns';
import { createTerminalMutation, NOOP_MUTATION_RESULT, type ExpandedRoomRunMutationResult } from './expandedRoomRunMutations';

interface ExpandedRoomRunTargets {
  readonly collectibleTarget: number | null;
  readonly checkpointTarget: number | null;
}
interface ExpandedRoomGoalRule<K extends CourseGoalType> {
  targets(goal: Goal<CourseMarkerPoint, K>): ExpandedRoomRunTargets;
  tick(goal: Goal<CourseMarkerPoint, K>, run: ActiveExpandedRoomRunState, options: TickActiveExpandedRoomRunOptions): ExpandedRoomRunMutationResult;
  markersReady(goal: Goal<CourseMarkerPoint, K>): boolean;
}
export type ExpandedRoomGoalRuleRegistry = { [K in CourseGoalType]: ExpandedRoomGoalRule<K> };
const EMPTY_TARGETS: ExpandedRoomRunTargets = { collectibleTarget: null, checkpointTarget: null };

/** Client-only rules: persisted course snapshots retain their existing shape. */
export const EXPANDED_ROOM_GOAL_RULES: ExpandedRoomGoalRuleRegistry = {
  reach_exit: {
    targets: () => EMPTY_TARGETS,
    markersReady: goal => Boolean(goal.exit),
    tick: (goal, _run, options) => goal.exit && options.touchesCoursePoint(goal.exit)
      ? { ...createTerminalMutation('completed', 'Exit reached.'), verificationGoalEvent: { type: 'reach_exit', marker: goal.exit, checkpointIndex: null } }
      : NOOP_MUTATION_RESULT,
  },
  collect_target: {
    targets: goal => ({ collectibleTarget: goal.requiredCount, checkpointTarget: null }),
    markersReady: () => true,
    tick: () => NOOP_MUTATION_RESULT,
  },
  defeat_all: {
    targets: () => EMPTY_TARGETS,
    markersReady: () => true,
    tick: () => NOOP_MUTATION_RESULT,
  },
  checkpoint_sprint: {
    targets: goal => ({ collectibleTarget: null, checkpointTarget: goal.checkpoints.length }),
    markersReady: goal => Boolean(goal.finish && goal.checkpoints.length > 0),
    tick: (goal, run, options) => {
      const checkpoint = goal.checkpoints[run.nextCheckpointIndex] ?? null;
      if (checkpoint && options.touchesCoursePoint(checkpoint)) {
        run.nextCheckpointIndex += 1;
        run.checkpointsReached += 1;
        return {
          changed: true, goalMarkersChanged: true,
          transientStatus: `Checkpoint ${run.checkpointsReached} reached.`,
          terminalResult: null, terminalMessage: null,
          checkpointEffectOrigin: options.getPlayerEffectOrigin(),
          verificationGoalEvent: { type: 'checkpoint', marker: checkpoint, checkpointIndex: run.nextCheckpointIndex - 1 },
        };
      }
      if (run.nextCheckpointIndex >= goal.checkpoints.length && goal.finish && options.touchesCoursePoint(goal.finish)) {
        return { ...createTerminalMutation('completed', 'Sprint clear.'), verificationGoalEvent: { type: 'finish', marker: goal.finish, checkpointIndex: null } };
      }
      return NOOP_MUTATION_RESULT;
    },
  },
  survival: {
    targets: () => EMPTY_TARGETS,
    markersReady: () => true,
    tick: (goal, run) => run.elapsedMs >= goal.durationMs
      ? createTerminalMutation('completed', 'Expanded room cleared.') : NOOP_MUTATION_RESULT,
  },
};

export function expandedRoomGoalTargets<K extends CourseGoalType>(goal: Goal<CourseMarkerPoint, K> | null): ExpandedRoomRunTargets {
  return goal ? EXPANDED_ROOM_GOAL_RULES[goal.type].targets(goal) : EMPTY_TARGETS;
}
export function tickExpandedRoomGoal<K extends CourseGoalType>(goal: Goal<CourseMarkerPoint, K>, run: ActiveExpandedRoomRunState, options: TickActiveExpandedRoomRunOptions): ExpandedRoomRunMutationResult {
  return EXPANDED_ROOM_GOAL_RULES[goal.type].tick(goal, run, options);
}
export function expandedRoomGoalMarkersReady<K extends CourseGoalType>(goal: Goal<CourseMarkerPoint, K>): boolean {
  return EXPANDED_ROOM_GOAL_RULES[goal.type].markersReady(goal);
}
