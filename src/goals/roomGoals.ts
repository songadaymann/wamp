import { TILE_SIZE } from '../config';
import { createGoalDefinitions } from './goalDefinitions';
import {
  cloneGoal,
  formatGoalIntroText,
  formatGoalShortText,
  normalizeGoal,
  normalizeGoalPositiveInteger,
  validateGoal,
  type Goal,
  type GoalMarkerPoint,
  type GoalPublishValidationContext,
  type GoalTextOptions,
  type GoalType,
} from './goalSchema';

export { NPC_QUEST_TYPES, type NpcQuestType, type GoalMarkerPoint } from './goalSchema';
export type RoomGoalType = GoalType;
export type RoomGoal = Goal<GoalMarkerPoint>;
export type ReachExitGoal = Goal<GoalMarkerPoint, 'reach_exit'>;
export type CollectTargetGoal = Goal<GoalMarkerPoint, 'collect_target'>;
export type CollectRaceGoal = Goal<GoalMarkerPoint, 'collect_race'>;
export type DefeatAllGoal = Goal<GoalMarkerPoint, 'defeat_all'>;
export type CheckpointSprintGoal = Goal<GoalMarkerPoint, 'checkpoint_sprint'>;
export type SurvivalGoal = Goal<GoalMarkerPoint, 'survival'>;
export type NpcQuestGoal = Goal<GoalMarkerPoint, 'npc_quest'>;
export type RoomGoalPublishValidationContext = GoalPublishValidationContext;

export const ROOM_GOAL_DEFINITIONS = createGoalDefinitions<GoalMarkerPoint>({
  clone: cloneGoalMarkerPoint,
  normalize: value => isGoalMarkerPointLike(value) ? cloneGoalMarkerPoint(value) : null,
}, 3);
export const ROOM_GOAL_TYPES = Object.keys(ROOM_GOAL_DEFINITIONS) as readonly RoomGoalType[];
export const ROOM_GOAL_LABELS = Object.fromEntries(
  ROOM_GOAL_TYPES.map(type => [type, ROOM_GOAL_DEFINITIONS[type].label]),
) as Record<RoomGoalType, string>;
export const MAX_ROOM_GOAL_INTRO_TEXT_LENGTH = 140;

export function createDefaultRoomGoal(type: RoomGoalType): RoomGoal {
  return ROOM_GOAL_DEFINITIONS[type].createDefault();
}

export function cloneGoalMarkerPoint(point: GoalMarkerPoint): GoalMarkerPoint {
  return { x: point.x, y: point.y };
}

export function cloneRoomGoal(goal: RoomGoal | null): RoomGoal | null {
  return goal ? cloneGoal(goal, ROOM_GOAL_DEFINITIONS) : null;
}

export function createGoalMarkerPointFromTile(tileX: number, tileY: number): GoalMarkerPoint {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE };
}

export function normalizePositiveInteger(value: number | null | undefined): number | null {
  return normalizeGoalPositiveInteger(value);
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
  return normalizeGoal(value, ROOM_GOAL_DEFINITIONS, ROOM_GOAL_TYPES);
}

export function formatRoomGoalShortText(goal: RoomGoal, options: GoalTextOptions = {}): string {
  return formatGoalShortText(goal, ROOM_GOAL_DEFINITIONS, options);
}

export function buildAutomaticRoomGoalIntroText(goal: RoomGoal, options: GoalTextOptions = {}): string {
  return formatGoalIntroText(goal, ROOM_GOAL_DEFINITIONS, options);
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
  return goal ? validateGoal(goal, ROOM_GOAL_DEFINITIONS, context) : null;
}
