import { buildEditorGoalFlags, cloneGoal, type Goal, type GoalType } from '../../goals/goalSchema';
import { ROOM_GOAL_DEFINITIONS, type GoalMarkerPoint, type NpcQuestType, type RoomGoal } from '../../goals/roomGoals';
import type { GoalMarkerFlagVariant } from '../../goals/markerFlags';
import { EMPTY_GOAL_AUTHORING_FIELDS, GOAL_AUTHORING_RULES, type GoalPlacementMode, type RoomGoalSummaryContext } from './goalAuthoringRules';

export type { GoalPlacementMode, RoomGoalSummaryContext } from './goalAuthoringRules';
export interface GoalMarkerDescriptor { point: GoalMarkerPoint; label: string | null; variant: GoalMarkerFlagVariant; textColor: string; }
export interface GoalMarkerMutation<K extends GoalType = GoalType> { goal: Goal<GoalMarkerPoint, K>; placementComplete: boolean; }

export function roomGoalUsesMarkers(goal: RoomGoal | null): boolean {
  return goal ? GOAL_AUTHORING_RULES[goal.type].usesMarkers : false;
}

function withField<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, edit: (copy: Goal<GoalMarkerPoint, K>) => void): Goal<GoalMarkerPoint, K> {
  const copy = cloneGoal<GoalMarkerPoint, K>(goal, ROOM_GOAL_DEFINITIONS);
  edit(copy);
  return copy;
}

export function withRoomGoalTimeLimitSeconds<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, seconds: number | null): Goal<GoalMarkerPoint, K> {
  return withField(goal, copy => GOAL_AUTHORING_RULES[copy.type].timeLimit(copy, seconds));
}
export function withRoomGoalRequiredCount<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, count: number): Goal<GoalMarkerPoint, K> {
  return withField(goal, copy => GOAL_AUTHORING_RULES[copy.type].requiredCount(copy, count));
}
export function withRoomGoalSurvivalSeconds<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, seconds: number): Goal<GoalMarkerPoint, K> {
  return withField(goal, copy => GOAL_AUTHORING_RULES[copy.type].duration(copy, seconds));
}
export function withNpcQuestType<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, questType: NpcQuestType): Goal<GoalMarkerPoint, K> {
  return withField(goal, copy => GOAL_AUTHORING_RULES[copy.type].questType(copy, questType));
}
export function clearRoomGoalMarkers<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>): Goal<GoalMarkerPoint, K> {
  return withField(goal, copy => GOAL_AUTHORING_RULES[copy.type].clearMarkers(copy));
}
export function placeRoomGoalMarker<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, mode: Exclude<GoalPlacementMode, null>, point: GoalMarkerPoint, linkedNpcInstanceId: string | null = null): GoalMarkerMutation<K> | null {
  const copy = cloneGoal<GoalMarkerPoint, K>(goal, ROOM_GOAL_DEFINITIONS);
  const placementComplete = GOAL_AUTHORING_RULES[copy.type].placeMarker(copy, mode, point, linkedNpcInstanceId);
  return placementComplete === null ? null : { goal: copy, placementComplete };
}
export function removeRoomGoalMarkerAt<K extends GoalType>(goal: Goal<GoalMarkerPoint, K>, worldX: number, worldY: number): Goal<GoalMarkerPoint, K> | null {
  return GOAL_AUTHORING_RULES[goal.type].removeMarker(goal, worldX, worldY);
}
export function buildRoomGoalMarkerDescriptors(goal: RoomGoal | null): GoalMarkerDescriptor[] {
  return goal ? buildEditorGoalFlags(goal, ROOM_GOAL_DEFINITIONS) : [];
}
export function getRoomGoalSummaryText<K extends GoalType>(goal: Goal<GoalMarkerPoint, K> | null, context: RoomGoalSummaryContext): string {
  return goal ? GOAL_AUTHORING_RULES[goal.type].summary(goal, context) : 'No room goal selected.';
}

/** The editor controls and their command guards share the same per-goal fields. */
export function getRoomGoalAuthoringControls<K extends GoalType>(goal: Goal<GoalMarkerPoint, K> | null) {
  const fields = goal ? GOAL_AUTHORING_RULES[goal.type].fields(goal) : EMPTY_GOAL_AUTHORING_FIELDS;
  return {
    npcQuestTypeHidden: fields.npcQuestType === null,
    npcQuestTypeValue: fields.npcQuestType ?? 'protect',
    timeLimitHidden: fields.timeLimitSeconds === null,
    timeLimitValue: fields.timeLimitSeconds ?? '',
    requiredCountHidden: fields.requiredCount === null,
    requiredCountValue: fields.requiredCount ?? '1',
    survivalHidden: fields.durationSeconds === null,
    survivalValue: fields.durationSeconds ?? '30',
    placeExitHidden: fields.exit === 'hidden',
    placeExitNeeded: fields.exit === 'missing',
    addCheckpointHidden: !fields.checkpoints,
    placeFinishHidden: fields.finish === 'hidden',
    placeFinishNeeded: fields.finish === 'missing',
    linkNpcHidden: fields.npcQuestType === null,
    placeNpcDestinationHidden: !fields.npcDestination,
  };
}
