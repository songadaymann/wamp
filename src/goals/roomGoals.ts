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

export interface RoomGoalPublishValidationContext {
  collectiblesPlaced: number;
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

export const MAX_ROOM_GOAL_INTRO_TEXT_LENGTH = 140;

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

export function normalizeRoomGoalIntroText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, MAX_ROOM_GOAL_INTRO_TEXT_LENGTH);
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

export function formatRoomGoalShortText(
  goal: RoomGoal,
  options: {
    enemyCount?: number | null;
  } = {},
): string {
  switch (goal.type) {
    case 'reach_exit':
      return 'Reach exit';
    case 'collect_target':
      return `Collect ${goal.requiredCount}`;
    case 'defeat_all': {
      const enemyCount = options.enemyCount ?? null;
      if (typeof enemyCount === 'number' && Number.isFinite(enemyCount) && enemyCount > 0) {
        return `Defeat ${enemyCount} ${enemyCount === 1 ? 'enemy' : 'enemies'}`;
      }
      return 'Defeat all enemies';
    }
    case 'checkpoint_sprint':
      return `Reach ${goal.checkpoints.length || 0} ${goal.checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}`;
    case 'survival':
      return `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`;
  }
}

export function buildAutomaticRoomGoalIntroText(
  goal: RoomGoal,
  options: {
    enemyCount?: number | null;
  } = {},
): string {
  switch (goal.type) {
    case 'reach_exit':
      return 'Reach the exit as fast as you can!';
    case 'collect_target':
      return `Collect ${goal.requiredCount} item${goal.requiredCount === 1 ? '' : 's'} as fast as you can!`;
    case 'defeat_all': {
      const enemyCount = options.enemyCount ?? null;
      if (typeof enemyCount === 'number' && Number.isFinite(enemyCount) && enemyCount > 0) {
        return `Defeat ${enemyCount} ${enemyCount === 1 ? 'enemy' : 'enemies'} as fast as you can!`;
      }
      return 'Defeat all enemies as fast as you can!';
    }
    case 'checkpoint_sprint': {
      const checkpointCount = goal.checkpoints.length;
      return `Reach ${checkpointCount} ${checkpointCount === 1 ? 'checkpoint' : 'checkpoints'}, then hit the finish as fast as you can!`;
    }
    case 'survival':
      return `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds!`;
  }
}

export function resolveRoomGoalIntroText(
  goal: RoomGoal,
  options: {
    customText?: string | null;
    enemyCount?: number | null;
  } = {},
): string {
  return (
    normalizeRoomGoalIntroText(options.customText)
    ?? buildAutomaticRoomGoalIntroText(goal, {
      enemyCount: options.enemyCount,
    })
  );
}

export function getRoomGoalPublishValidationError(
  goal: RoomGoal | null,
  context: RoomGoalPublishValidationContext,
): string | null {
  if (!goal) {
    return null;
  }

  if (goal.type === 'collect_target' && context.collectiblesPlaced < goal.requiredCount) {
    return `You've set the collect goal for ${goal.requiredCount} object${goal.requiredCount === 1 ? '' : 's'}, but you've only placed ${context.collectiblesPlaced}.`;
  }

  return null;
}
