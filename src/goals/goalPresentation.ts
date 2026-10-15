import type { Goal, GoalMarkerPoint, GoalType } from './goalSchema';

export interface GoalProgressFacts {
  readonly result: 'active' | 'completed' | 'failed' | 'abandoned';
  readonly collectiblesCollected: number;
  readonly enemiesDefeated: number;
  readonly checkpointsReached: number;
  readonly enemyTarget: number | null;
  readonly checkpointTarget: number | null;
}
export interface RoomGoalProgressFacts extends GoalProgressFacts {
  readonly enemyCollectiblesCollected: number;
}
export interface CourseGoalProgressFacts extends GoalProgressFacts {
  readonly collectibleTarget: number | null;
}
export type GoalTimerFormatter = (ms: number) => string;

export interface GoalPresentation<P extends GoalMarkerPoint, K extends GoalType> {
  badge: (goal: Goal<P, K>) => string;
  /** Avoid scanning room objects for selected goals that do not use enemy counts. */
  selectedNeedsEnemyCount: boolean;
  selected: (goal: Goal<P, K>, enemyCount: number) => string;
  progress: (goal: Goal<P, K>, facts: RoomGoalProgressFacts) => string;
  timer: (goal: Goal<P, K>, elapsedMs: number, formatTimer: GoalTimerFormatter) => string;
}

export function formatLimitedGoalTimer(timeLimitMs: number | null, elapsedMs: number, formatTimer: GoalTimerFormatter): string {
  return timeLimitMs !== null
    ? `${formatTimer(Math.max(0, timeLimitMs - elapsedMs))} LEFT`
    : formatTimer(elapsedMs);
}

export function formatGoalOverlayTimer(ms: number): string {
  const clampedMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((clampedMs % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
