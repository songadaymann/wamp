import { TILE_SIZE } from '../config';

export const ROOM_GOAL_TYPES = [
  'reach_exit',
  'collect_target',
  'defeat_all',
  'checkpoint_sprint',
  'survival',
] as const;

export type RoomGoalType = typeof ROOM_GOAL_TYPES[number];

export interface GoalMarkerPoint {
  x: number;
  y: number;
}

export interface ReachExitGoal {
  type: 'reach_exit';
  exit: GoalMarkerPoint | null;
  timeLimitMs: number | null;
}

export interface CollectTargetGoal {
  type: 'collect_target';
  requiredCount: number;
  timeLimitMs: number | null;
}

export interface DefeatAllGoal {
  type: 'defeat_all';
  timeLimitMs: number | null;
}

export interface CheckpointSprintGoal {
  type: 'checkpoint_sprint';
  checkpoints: GoalMarkerPoint[];
  finish: GoalMarkerPoint | null;
  timeLimitMs: number | null;
}

export interface SurvivalGoal {
  type: 'survival';
  durationMs: number;
}

export type RoomGoal =
  | ReachExitGoal
  | CollectTargetGoal
  | DefeatAllGoal
  | CheckpointSprintGoal
  | SurvivalGoal;

export const ROOM_GOAL_LABELS: Record<RoomGoalType, string> = {
  reach_exit: 'Reach Exit',
  collect_target: 'Collect Target',
  defeat_all: 'Defeat All',
  checkpoint_sprint: 'Checkpoint Sprint',
  survival: 'Survival',
};

export function createDefaultRoomGoal(type: RoomGoalType): RoomGoal {
  switch (type) {
    case 'reach_exit':
      return {
        type,
        exit: null,
        timeLimitMs: null,
      };
    case 'collect_target':
      return {
        type,
        requiredCount: 3,
        timeLimitMs: null,
      };
    case 'defeat_all':
      return {
        type,
        timeLimitMs: null,
      };
    case 'checkpoint_sprint':
      return {
        type,
        checkpoints: [],
        finish: null,
        timeLimitMs: null,
      };
    case 'survival':
      return {
        type,
        durationMs: 30_000,
      };
  }
}

export function cloneGoalMarkerPoint(point: GoalMarkerPoint): GoalMarkerPoint {
  return {
    x: point.x,
    y: point.y,
  };
}

export function cloneRoomGoal(goal: RoomGoal | null): RoomGoal | null {
  if (!goal) {
    return null;
  }

  switch (goal.type) {
    case 'reach_exit':
      return {
        type: goal.type,
        exit: goal.exit ? cloneGoalMarkerPoint(goal.exit) : null,
        timeLimitMs: goal.timeLimitMs,
      };
    case 'collect_target':
      return {
        type: goal.type,
        requiredCount: goal.requiredCount,
        timeLimitMs: goal.timeLimitMs,
      };
    case 'defeat_all':
      return {
        type: goal.type,
        timeLimitMs: goal.timeLimitMs,
      };
    case 'checkpoint_sprint':
      return {
        type: goal.type,
        checkpoints: goal.checkpoints.map(cloneGoalMarkerPoint),
        finish: goal.finish ? cloneGoalMarkerPoint(goal.finish) : null,
        timeLimitMs: goal.timeLimitMs,
      };
    case 'survival':
      return {
        type: goal.type,
        durationMs: goal.durationMs,
      };
  }
}

export function createGoalMarkerPointFromTile(tileX: number, tileY: number): GoalMarkerPoint {
  return {
    x: tileX * TILE_SIZE + TILE_SIZE / 2,
    y: tileY * TILE_SIZE + TILE_SIZE,
  };
}

export function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  if (rounded <= 0) {
    return null;
  }

  return rounded;
}

function isGoalMarkerPointLike(value: unknown): value is GoalMarkerPoint {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const point = value as Partial<GoalMarkerPoint>;
  return typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y);
}

export function normalizeRoomGoal(value: unknown): RoomGoal | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const goal = value as Partial<RoomGoal> & {
    checkpoints?: unknown;
    finish?: unknown;
    exit?: unknown;
  };

  switch (goal.type) {
    case 'reach_exit':
      return {
        type: 'reach_exit',
        exit: isGoalMarkerPointLike(goal.exit) ? cloneGoalMarkerPoint(goal.exit) : null,
        timeLimitMs: normalizePositiveInteger(goal.timeLimitMs),
      };
    case 'collect_target':
      return {
        type: 'collect_target',
        requiredCount: normalizePositiveInteger(goal.requiredCount) ?? 1,
        timeLimitMs: normalizePositiveInteger(goal.timeLimitMs),
      };
    case 'defeat_all':
      return {
        type: 'defeat_all',
        timeLimitMs: normalizePositiveInteger(goal.timeLimitMs),
      };
    case 'checkpoint_sprint':
      return {
        type: 'checkpoint_sprint',
        checkpoints: Array.isArray(goal.checkpoints)
          ? goal.checkpoints.filter(isGoalMarkerPointLike).map(cloneGoalMarkerPoint)
          : [],
        finish: isGoalMarkerPointLike(goal.finish) ? cloneGoalMarkerPoint(goal.finish) : null,
        timeLimitMs: normalizePositiveInteger(goal.timeLimitMs),
      };
    case 'survival':
      return {
        type: 'survival',
        durationMs: normalizePositiveInteger(goal.durationMs) ?? 30_000,
      };
    default:
      return null;
  }
}

export function goalSupportsTimeLimit(goalType: RoomGoalType): boolean {
  return goalType !== 'survival';
}
