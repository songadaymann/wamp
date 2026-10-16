import type { Goal, GoalMarkerPoint, GoalType } from '../../goals/goalSchema';
import { ROOM_GOAL_LABELS } from '../../goals/roomGoals';
import type { RoomGoalRankingPolicy } from '../../goals/goalScoring';
import type { GoalRunState } from './goalRuns';

interface GoalRaceResolution { completed: boolean; message: string; }
interface GoalLifecycleRule<K extends GoalType> {
  resolvesNpcTarget: boolean;
  acceptsNpcDefeat: boolean;
  countsCheckpoints: boolean;
  destinationCompleted: (goal: Goal<GoalMarkerPoint, K>) => boolean;
  deliveryCompleted: (goal: Goal<GoalMarkerPoint, K>, collected: number) => boolean;
  startCompletion: (goal: Goal<GoalMarkerPoint, K>, run: Readonly<GoalRunState>) => string | null;
  countdown: (goal: Goal<GoalMarkerPoint, K>, elapsedMs: number) => string | null;
  status: (goal: Goal<GoalMarkerPoint, K>, run: Readonly<GoalRunState>, time: string, suffix: string) => string;
  scoreAsDuration: (goal: Goal<GoalMarkerPoint, K>) => boolean;
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
  scoreAsDuration: () => false,
  raceResolution: () => null,
};
const limitedCountdown = (goal: { timeLimitMs: number | null }, elapsedMs: number): string | null =>
  goal.timeLimitMs === null ? null : `${(Math.max(0, goal.timeLimitMs - elapsedMs) / 1000).toFixed(1)}s left`;

/** Per-goal decisions only. Qualification, room identity, submission and effects stay with the controller. */
export const GOAL_LIFECYCLE_RULES: GoalLifecycleRegistry = {
  reach_exit: {
    ...noSpecialLifecycle,
    countdown: limitedCountdown,
    status: (_goal, run, time, suffix) => `goal ${ROOM_GOAL_LABELS.reach_exit} · ${time} · deaths ${run.deaths}${suffix}`,
  },
  collect_target: {
    ...noSpecialLifecycle,
    countdown: limitedCountdown,
    status: (goal, run, time, suffix) => `goal ${run.collectiblesCollected}/${goal.requiredCount} collected · ${time}${suffix}`,
  },
  collect_race: {
    ...noSpecialLifecycle,
    countdown: limitedCountdown,
    status: (_goal, run, time, suffix) => `goal race · you ${run.collectiblesCollected} · hunter ${run.enemyCollectiblesCollected} · ${time}${suffix}`,
    raceResolution: run => {
      if (run.collectiblesCollected > run.enemyCollectiblesCollected) return { completed: true, message: `Collect race won ${run.collectiblesCollected}-${run.enemyCollectiblesCollected}.` };
      if (run.collectiblesCollected === run.enemyCollectiblesCollected) return { completed: false, message: `Collect race tied ${run.collectiblesCollected}-${run.enemyCollectiblesCollected}.` };
      return { completed: false, message: `Sword Hunter won ${run.enemyCollectiblesCollected}-${run.collectiblesCollected}.` };
    },
  },
  defeat_all: {
    ...noSpecialLifecycle,
    countdown: limitedCountdown,
    startCompletion: (_goal, run) => run.enemyTarget === 0 ? 'No enemies remain.' : null,
    status: (_goal, run, time, suffix) => `goal ${run.enemiesDefeated}/${run.enemyTarget ?? 0} defeated · ${time}${suffix}`,
  },
  checkpoint_sprint: {
    ...noSpecialLifecycle,
    countsCheckpoints: true,
    countdown: limitedCountdown,
    status: (_goal, run, time, suffix) => `goal ${run.checkpointsReached}/${run.checkpointTarget ?? 0} checkpoints · ${time}${suffix}`,
  },
  survival: {
    ...noSpecialLifecycle,
    countdown: () => null,
    status: (goal, run, _time, suffix) => {
      const remaining = Math.max(0, goal.durationMs - run.elapsedMs);
      const parts = [`goal survive ${(remaining / 1000).toFixed(1)}s`];
      if (run.collectiblesCollected > 0) parts.push(`${run.collectiblesCollected} item${run.collectiblesCollected === 1 ? '' : 's'}`);
      if (run.enemiesDefeated > 0) parts.push(`${run.enemiesDefeated} enem${run.enemiesDefeated === 1 ? 'y' : 'ies'}`);
      if (run.deaths > 0) parts.push(`deaths ${run.deaths}`);
      return `${parts.join(' · ')}${suffix}`;
    },
  },
  npc_quest: {
    ...noSpecialLifecycle,
    resolvesNpcTarget: true,
    acceptsNpcDefeat: true,
    destinationCompleted: goal => goal.questType === 'escort',
    deliveryCompleted: (goal, collected) => goal.questType === 'give' && !(collected < goal.requiredCount),
    countdown: () => null,
    scoreAsDuration: goal => goal.questType === 'protect',
    status: (goal, run, time, suffix) => {
      if (goal.questType === 'protect') {
        const protectedMs = Math.min(run.elapsedMs, goal.durationMs);
        return `goal protect ${(protectedMs / 1000).toFixed(1)}/${(goal.durationMs / 1000).toFixed(1)}s${suffix}`;
      }
      if (goal.questType === 'escort') return `goal escort NPC · ${time}${suffix}`;
      return `goal give ${Math.min(run.collectiblesCollected, goal.requiredCount)}/${goal.requiredCount} · ${run.collectiblesCollected >= goal.requiredCount ? 'return to NPC' : time}${suffix}`;
    },
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
export function formatGoalRunStatus<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, run: Readonly<GoalRunState>, suffix: string): string {
  const time = GOAL_LIFECYCLE_RULES[goal.type].countdown(goal, run.elapsedMs) ?? `${(run.elapsedMs / 1000).toFixed(1)}s`;
  return GOAL_LIFECYCLE_RULES[goal.type].status(goal, run, time, suffix);
}
export function formatGoalRoomLeaderboardMetric<K extends GoalType>(goal: Goal<GoalMarkerPoint, K> | null, rankingMode: RoomGoalRankingPolicy, entry: { elapsedMs: number; score: number }): string {
  if (rankingMode === 'time') return `${(entry.elapsedMs / 1000).toFixed(2)}s`;
  return goal && GOAL_LIFECYCLE_RULES[goal.type].scoreAsDuration(goal) ? `${(entry.elapsedMs / 1000).toFixed(1)}s` : `${entry.score} pts`;
}
