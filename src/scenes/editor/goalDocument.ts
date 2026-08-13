import {
  cloneRoomGoal,
  type GoalMarkerPoint,
  type NpcQuestType,
  type RoomGoal,
} from '../../goals/roomGoals';
import type { GoalMarkerFlagVariant } from '../../goals/markerFlags';

export type GoalPlacementMode =
  | 'exit'
  | 'checkpoint'
  | 'finish'
  | 'npc'
  | 'npc_destination'
  | null;

export interface RoomGoalSummaryContext {
  collectiblesPlaced: number;
  enemiesPlaced: number;
  collectModeEnemyCount: number;
  linkedNpcLabel: string;
}

export interface GoalMarkerDescriptor {
  point: GoalMarkerPoint;
  label: string | null;
  variant: GoalMarkerFlagVariant;
  textColor: string;
}

export interface GoalMarkerMutation {
  goal: RoomGoal;
  placementComplete: boolean;
}

export function roomGoalUsesMarkers(goal: RoomGoal | null): boolean {
  return (
    goal?.type === 'reach_exit' ||
    goal?.type === 'checkpoint_sprint' ||
    goal?.type === 'npc_quest'
  );
}

export function withRoomGoalTimeLimitSeconds(
  goal: RoomGoal,
  seconds: number | null,
): RoomGoal {
  const nextGoal = cloneRoomGoal(goal)!;
  if (nextGoal.type !== 'survival' && nextGoal.type !== 'npc_quest') {
    nextGoal.timeLimitMs = seconds && seconds > 0 ? Math.round(seconds * 1000) : null;
  }
  return nextGoal;
}

export function withRoomGoalRequiredCount(goal: RoomGoal, requiredCount: number): RoomGoal {
  const nextGoal = cloneRoomGoal(goal)!;
  if (
    nextGoal.type === 'collect_target' ||
    (nextGoal.type === 'npc_quest' && nextGoal.questType === 'give')
  ) {
    nextGoal.requiredCount = Math.max(1, Math.round(requiredCount));
  }
  return nextGoal;
}

export function withRoomGoalSurvivalSeconds(goal: RoomGoal, seconds: number): RoomGoal {
  const nextGoal = cloneRoomGoal(goal)!;
  if (
    nextGoal.type === 'survival' ||
    (nextGoal.type === 'npc_quest' && nextGoal.questType === 'protect')
  ) {
    nextGoal.durationMs = Math.max(1, Math.round(seconds)) * 1000;
  }
  return nextGoal;
}

export function withNpcQuestType(goal: RoomGoal, questType: NpcQuestType): RoomGoal {
  const nextGoal = cloneRoomGoal(goal)!;
  if (nextGoal.type === 'npc_quest') {
    nextGoal.questType = questType;
  }
  return nextGoal;
}

export function clearRoomGoalMarkers(goal: RoomGoal): RoomGoal {
  const nextGoal = cloneRoomGoal(goal)!;
  if (nextGoal.type === 'reach_exit') {
    nextGoal.exit = null;
  } else if (nextGoal.type === 'checkpoint_sprint') {
    nextGoal.checkpoints = [];
    nextGoal.finish = null;
  } else if (nextGoal.type === 'npc_quest') {
    nextGoal.npcInstanceId = null;
    nextGoal.destination = null;
  }
  return nextGoal;
}

export function placeRoomGoalMarker(
  goal: RoomGoal,
  mode: Exclude<GoalPlacementMode, null>,
  point: GoalMarkerPoint,
  linkedNpcInstanceId: string | null = null,
): GoalMarkerMutation | null {
  const nextGoal = cloneRoomGoal(goal)!;
  if (nextGoal.type === 'reach_exit' && mode === 'exit') {
    nextGoal.exit = { ...point };
    return { goal: nextGoal, placementComplete: true };
  }

  if (nextGoal.type === 'npc_quest') {
    if (mode === 'npc' && linkedNpcInstanceId) {
      nextGoal.npcInstanceId = linkedNpcInstanceId;
      return { goal: nextGoal, placementComplete: true };
    }
    if (mode === 'npc_destination') {
      nextGoal.destination = { ...point };
      return { goal: nextGoal, placementComplete: true };
    }
    return null;
  }

  if (nextGoal.type !== 'checkpoint_sprint') {
    return null;
  }
  if (mode === 'checkpoint') {
    nextGoal.checkpoints = [...nextGoal.checkpoints, { ...point }];
    return { goal: nextGoal, placementComplete: false };
  }
  if (mode === 'finish') {
    nextGoal.finish = { ...point };
    return { goal: nextGoal, placementComplete: true };
  }
  return null;
}

export function removeRoomGoalMarkerAt(
  goal: RoomGoal,
  worldX: number,
  worldY: number,
): RoomGoal | null {
  const isNear = (point: GoalMarkerPoint | null): boolean =>
    Boolean(point && Math.hypot(point.x - worldX, point.y - worldY) < 16);

  if (goal.type === 'reach_exit' && isNear(goal.exit)) {
    const nextGoal = cloneRoomGoal(goal)!;
    if (nextGoal.type === 'reach_exit') {
      nextGoal.exit = null;
    }
    return nextGoal;
  }

  if (goal.type === 'npc_quest' && isNear(goal.destination)) {
    const nextGoal = cloneRoomGoal(goal)!;
    if (nextGoal.type === 'npc_quest') {
      nextGoal.destination = null;
    }
    return nextGoal;
  }

  if (goal.type !== 'checkpoint_sprint') {
    return null;
  }
  if (isNear(goal.finish)) {
    const nextGoal = cloneRoomGoal(goal)!;
    if (nextGoal.type === 'checkpoint_sprint') {
      nextGoal.finish = null;
    }
    return nextGoal;
  }

  let bestIndex = -1;
  let bestDistance = 16;
  goal.checkpoints.forEach((checkpoint, index) => {
    const distance = Math.hypot(checkpoint.x - worldX, checkpoint.y - worldY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  if (bestIndex < 0) {
    return null;
  }

  const nextGoal = cloneRoomGoal(goal)!;
  if (nextGoal.type === 'checkpoint_sprint') {
    nextGoal.checkpoints.splice(bestIndex, 1);
  }
  return nextGoal;
}

export function buildRoomGoalMarkerDescriptors(goal: RoomGoal | null): GoalMarkerDescriptor[] {
  switch (goal?.type) {
    case 'reach_exit':
      return goal.exit
        ? [{ point: goal.exit, label: null, variant: 'finish-pending', textColor: '#ffefef' }]
        : [];
    case 'checkpoint_sprint':
      return [
        ...goal.checkpoints.map((checkpoint, index) => ({
          point: checkpoint,
          label: `${index + 1}`,
          variant: 'checkpoint-pending' as GoalMarkerFlagVariant,
          textColor: '#ffefef',
        })),
        ...(goal.finish
          ? [{ point: goal.finish, label: null, variant: 'finish-pending' as GoalMarkerFlagVariant, textColor: '#ffefef' }]
          : []),
      ];
    case 'npc_quest':
      return goal.destination
        ? [{ point: goal.destination, label: 'NPC', variant: 'finish-pending', textColor: '#ffefef' }]
        : [];
    default:
      return [];
  }
}

export function getRoomGoalSummaryText(
  goal: RoomGoal | null,
  context: RoomGoalSummaryContext,
): string {
  if (!goal) {
    return 'No room goal selected.';
  }

  switch (goal.type) {
    case 'reach_exit':
      return goal.exit
        ? 'Reach the exit marker to clear the room.'
        : 'Set an exit marker to finish the room.';
    case 'collect_target':
      return `Collect ${goal.requiredCount} item${goal.requiredCount === 1 ? '' : 's'} (${context.collectiblesPlaced} placed).`;
    case 'collect_race':
      return `Collect more items than the Sword Hunter (${context.collectiblesPlaced} collectibles, ${context.collectModeEnemyCount} collector${context.collectModeEnemyCount === 1 ? '' : 's'}).`;
    case 'defeat_all':
      return `Defeat every enemy in the room (${context.enemiesPlaced} placed).`;
    case 'checkpoint_sprint':
      return `Hit ${goal.checkpoints.length} checkpoint${goal.checkpoints.length === 1 ? '' : 's'} then reach the finish marker.`;
    case 'survival':
      return `Stay alive for ${Math.round(goal.durationMs / 1000)} seconds.`;
    case 'npc_quest':
      if (goal.questType === 'protect') {
        return `Protect ${context.linkedNpcLabel} for ${Math.round(goal.durationMs / 1000)} seconds.`;
      }
      if (goal.questType === 'escort') {
        return `Escort ${context.linkedNpcLabel} to ${goal.destination ? 'the destination' : 'a destination you still need to place'}.`;
      }
      return `Collect ${goal.requiredCount} item${goal.requiredCount === 1 ? '' : 's'}, then return to ${context.linkedNpcLabel}.`;
  }
}
