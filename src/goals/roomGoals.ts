import { TILE_SIZE } from '../config';

export const ROOM_GOAL_TYPES = [
  'reach_exit',
  'collect_target',
  'collect_race',
  'defeat_all',
  'checkpoint_sprint',
  'survival',
  'npc_quest',
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

export interface CollectRaceGoal {
  type: 'collect_race';
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

export const NPC_QUEST_TYPES = ['protect', 'escort', 'give'] as const;
export type NpcQuestType = typeof NPC_QUEST_TYPES[number];

export interface NpcQuestGoal {
  type: 'npc_quest';
  questType: NpcQuestType;
  npcInstanceId: string | null;
  durationMs: number;
  requiredCount: number;
  destination: GoalMarkerPoint | null;
  timeLimitMs: null;
}

export interface RoomGoalPublishValidationContext {
  collectiblesPlaced: number;
  collectModeEnemyCount: number;
  npcInstanceIds?: string[];
}

export type RoomGoal =
  | ReachExitGoal
  | CollectTargetGoal
  | CollectRaceGoal
  | DefeatAllGoal
  | CheckpointSprintGoal
  | SurvivalGoal
  | NpcQuestGoal;

export const ROOM_GOAL_LABELS: Record<RoomGoalType, string> = {
  reach_exit: 'Reach Exit',
  collect_target: 'Collect Target',
  collect_race: 'Collect Race',
  defeat_all: 'Defeat All',
  checkpoint_sprint: 'Checkpoint Sprint',
  survival: 'Survival',
  npc_quest: 'NPC Quest',
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
    case 'collect_race':
      return {
        type,
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
    case 'npc_quest':
      return {
        type,
        questType: 'protect',
        npcInstanceId: null,
        durationMs: 30_000,
        requiredCount: 3,
        destination: null,
        timeLimitMs: null,
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
    case 'collect_race':
      return {
        type: goal.type,
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
    case 'npc_quest':
      return {
        type: goal.type,
        questType: goal.questType,
        npcInstanceId: goal.npcInstanceId,
        durationMs: goal.durationMs,
        requiredCount: goal.requiredCount,
        destination: goal.destination ? cloneGoalMarkerPoint(goal.destination) : null,
        timeLimitMs: null,
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
    destination?: unknown;
    questType?: unknown;
    npcInstanceId?: unknown;
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
    case 'collect_race':
      return {
        type: 'collect_race',
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
    case 'npc_quest': {
      const questType = (NPC_QUEST_TYPES as readonly unknown[]).includes(goal.questType)
        ? goal.questType as NpcQuestType
        : 'protect';
      return {
        type: 'npc_quest',
        questType,
        npcInstanceId:
          typeof goal.npcInstanceId === 'string' && goal.npcInstanceId.trim()
            ? goal.npcInstanceId.trim()
            : null,
        durationMs: normalizePositiveInteger(goal.durationMs) ?? 30_000,
        requiredCount: normalizePositiveInteger(goal.requiredCount) ?? 1,
        destination:
          isGoalMarkerPointLike(goal.destination)
            ? cloneGoalMarkerPoint(goal.destination)
            : null,
        timeLimitMs: null,
      };
    }
    default:
      return null;
  }
}

export function goalSupportsTimeLimit(goalType: RoomGoalType): boolean {
  return goalType !== 'survival' && goalType !== 'npc_quest';
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
    case 'collect_race':
      return 'Collect race';
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
    case 'npc_quest':
      switch (goal.questType) {
        case 'protect':
          return `Protect NPC for ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds`;
        case 'escort':
          return 'Escort NPC to the destination';
        case 'give':
          return `Collect ${goal.requiredCount} and return to NPC`;
      }
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
    case 'collect_race':
      return 'Collect more items than the Sword Hunter before the room is empty!';
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
      return `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds. Pickups, enemy defeats, and zero-death clears raise your score!`;
    case 'npc_quest':
      switch (goal.questType) {
        case 'protect':
          return `Keep the NPC alive for ${Math.max(1, Math.round(goal.durationMs / 1000))} seconds!`;
        case 'escort':
          return 'Escort the NPC to the marked destination!';
        case 'give':
          return `Collect ${goal.requiredCount} item${goal.requiredCount === 1 ? '' : 's'}, then return to the NPC!`;
      }
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

  if (goal.type === 'collect_race') {
    if (context.collectiblesPlaced <= 0) {
      return 'Collect Race needs at least one collectible in the room.';
    }

    if (context.collectModeEnemyCount <= 0) {
      return 'Collect Race needs one Sword Hunter set to Collect Items.';
    }

    if (context.collectModeEnemyCount > 1) {
      return 'Collect Race currently supports exactly one Sword Hunter set to Collect Items.';
    }
  }

  if (goal.type === 'npc_quest') {
    const npcInstanceIds = context.npcInstanceIds ?? [];
    if (npcInstanceIds.length === 0) {
      return 'NPC Quest needs at least one NPC in the room.';
    }
    if (goal.npcInstanceId && !npcInstanceIds.includes(goal.npcInstanceId)) {
      return 'The NPC linked to this quest is no longer in the room. Link another NPC.';
    }
    if (goal.questType === 'escort' && !goal.destination) {
      return 'Escort needs a destination marker.';
    }
    if (goal.questType === 'give' && context.collectiblesPlaced < goal.requiredCount) {
      return `Give needs ${goal.requiredCount} collectible${goal.requiredCount === 1 ? '' : 's'}, but only ${context.collectiblesPlaced} are placed.`;
    }
  }

  return null;
}
