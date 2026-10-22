import type { Goal, GoalMarkerPoint, GoalType } from '../../goals/goalSchema';
import type { GoalRunState } from './goalRuns';

interface GoalRaceResolution { completed: boolean; message: string; }
interface GoalLifecycleRule<K extends GoalType> {
  resolvesNpcTarget: boolean;
  acceptsNpcDefeat: boolean;
  countsCheckpoints: boolean;
  destinationCompleted: (goal: Goal<GoalMarkerPoint, K>) => boolean;
  deliveryCompleted: (goal: Goal<GoalMarkerPoint, K>, collected: number) => boolean;
  startCompletion: (goal: Goal<GoalMarkerPoint, K>, run: Readonly<GoalRunState>) => string | null;
  raceResolution: (run: Readonly<GoalRunState>) => GoalRaceResolution | null;
}
export type GoalLifecycleRegistry = { [K in GoalType]: GoalLifecycleRule<K> };
const noSpecialLifecycle = {
  resolvesNpcTarget: false,
  acceptsNpcDefeat: false,
  countsCheckpoints: false,
  destinationCompleted: () => false,
  deliveryCompleted: () => false,
  startCompletion: () => null,
  raceResolution: () => null,
};

/** Per-goal decisions only. Qualification, room identity, submission and effects stay with the controller. */
export const GOAL_LIFECYCLE_RULES: GoalLifecycleRegistry = {
  reach_exit: { ...noSpecialLifecycle },
  collect_target: { ...noSpecialLifecycle },
  collect_race: {
    ...noSpecialLifecycle,
    raceResolution: run => {
      if (run.collectiblesCollected > run.enemyCollectiblesCollected) return { completed: true, message: `Collect race won ${run.collectiblesCollected}-${run.enemyCollectiblesCollected}.` };
      if (run.collectiblesCollected === run.enemyCollectiblesCollected) return { completed: false, message: `Collect race tied ${run.collectiblesCollected}-${run.enemyCollectiblesCollected}.` };
      return { completed: false, message: `Sword Hunter won ${run.enemyCollectiblesCollected}-${run.collectiblesCollected}.` };
    },
  },
  defeat_all: {
    ...noSpecialLifecycle,
    startCompletion: (_goal, run) => run.enemyTarget === 0 ? 'No enemies remain.' : null,
  },
  checkpoint_sprint: {
    ...noSpecialLifecycle,
    countsCheckpoints: true,
  },
  survival: { ...noSpecialLifecycle },
  npc_quest: {
    ...noSpecialLifecycle,
    resolvesNpcTarget: true,
    acceptsNpcDefeat: true,
    destinationCompleted: goal => goal.questType === 'escort',
    deliveryCompleted: (goal, collected) => goal.questType === 'give' && !(collected < goal.requiredCount),
  },
};

export function roomGoalDestinationCompleted<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>): boolean {
  return GOAL_LIFECYCLE_RULES[goal.type].destinationCompleted(goal);
}
export function roomGoalDeliveryCompleted<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, collected: number): boolean {
  return GOAL_LIFECYCLE_RULES[goal.type].deliveryCompleted(goal, collected);
}
export function roomGoalStartCompletion<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, run: Readonly<GoalRunState>): string | null {
  return GOAL_LIFECYCLE_RULES[goal.type].startCompletion(goal, run);
}
